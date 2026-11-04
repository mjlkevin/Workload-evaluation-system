import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, type Database } from '../../db/client';
import { aiSessions, harnessRuns, harnessRunEvents } from '../../db/schema';
import type { AuthUser } from '../../types';
import type { AiMessage, AiSessionRecord } from '../ai-sessions/ai-sessions.types';
import { resolveSessionHistory } from '../ai-sessions/ai-sessions.module';
import { createAiSessionsPgRepository } from '../ai-sessions/ai-sessions.module';
import { createConversationEventHistorySource, workbenchUserProjectionSource } from '../harness/harness.module';
import { getKnowledgeRepository } from '../knowledge/knowledge.module';
import { loadTemplate } from '../templates/templates.module';
import { createExecutionCatalogService } from './skills.workbench';
import { createExecutionManifestPgRepository } from './execution-manifest-pg.repository';
import { createInvocationPgRepository } from './skills.invocation-pg.repository';
import { resolveSkillReferences } from './skills.runtime';
import { skillDefinitionHash as hash } from './skills.hash';
import { SkillError } from './skills.types';
import type { ConversationRequest, ConversationReply, SkillConversationRepository } from './skills.conversation';
import type { SourceReference } from './execution-manifest.types';
const missing = () => new SkillError('INVOCATION_NOT_FOUND', '会话或能力不存在或不可用', 404);
const changed = () => new SkillError('SKILL_CONVERSATION_CHANGED', '会话或能力已变化，请刷新后重试', 409);
const same = (a: any,b: any) => a?.kind === b?.kind && a?.id === b?.id && a?.versionId === b?.versionId;
function replay(messages: AiMessage[], request: ConversationRequest, fingerprint: string): ConversationReply | undefined {
 const found = messages.filter(m => m.role === 'assistant').map(m => m.metadata?.skillConversation as any).find(m => m?.submissionKey === request.submissionKey);
 if (!found) return;
 if (found.fingerprint !== fingerprint || !same(found.selection, request.selection)) throw changed();
 if (!['reply','clarify'].includes(found.action) || typeof found.message !== 'string') throw changed();
 return { action: found.action, message: found.message };
}
function revision(session: { messages: unknown; attachments: unknown }, versionId: string) { return hash({ messages: session.messages, attachments: session.attachments, versionId }); }
/** All model context originates from owned server records. No model/network call holds a DB lock. */
export function createSkillConversationRepository(database: Database = db, options: { catalog?: Pick<ReturnType<typeof createExecutionCatalogService>, 'list'> } = {}): SkillConversationRepository {
 const manifests = createExecutionManifestPgRepository(), catalog = options.catalog ?? createExecutionCatalogService({ database });
 return {
  async projectExecutionUser(user, sessionId, runId) {
   const [fact] = await database.select({ message: harnessRunEvents.payload }).from(harnessRunEvents)
    .innerJoin(harnessRuns,eq(harnessRunEvents.harnessRunId,harnessRuns.harnessRunId))
    .innerJoin(aiSessions,eq(harnessRuns.aiSessionId,aiSessions.sessionId))
    .where(and(eq(harnessRuns.harnessRunId,runId),eq(harnessRuns.ownerUserId,user.id),eq(harnessRuns.aiSessionId,sessionId),eq(aiSessions.ownerUserId,user.id),eq(harnessRunEvents.eventType,'user/message')));
   const message = fact?.message as AiMessage | undefined;
   if (!message?.messageId || message.role !== 'user' || typeof message.content !== 'string') throw missing();
   const result = await createAiSessionsPgRepository(database).appendMessageIdempotent({ sessionId,message,source: workbenchUserProjectionSource(runId) });
   if (!result.found) throw missing();
  },
  async read(user, sessionId, request, fingerprint) {
   const entries = await catalog.list(user);
   const selected = entries.find(e => same(e, request.selection)); if (!selected) throw missing();
   const stored = await database.transaction(async tx => {
    await manifests.verifyCaller(tx,user);
    const [session] = await tx.select().from(aiSessions).where(and(eq(aiSessions.sessionId,sessionId),eq(aiSessions.ownerUserId,user.id))).for('share');
    if (!session || session.status === 'archived') throw missing();
    const snapshot = await manifests.read(tx,{ kind: request.selection.kind, [request.selection.kind === 'skill' ? 'skillId' : 'workflowId']: request.selection.id, input: {} } as any,false);
    if (snapshot.target.versionId !== request.selection.versionId) throw changed();
    const facts = await createConversationEventHistorySource(tx,user.id,true).loadConversationFacts([sessionId]);
    const history = resolveSessionHistory(session as unknown as AiSessionRecord,facts.get(sessionId)).messages;
    return { session, snapshot, history };
   });
   const { session, snapshot, history } = stored;
   const existing = replay(session.messages as AiMessage[],request,fingerprint);
   const tail = history.at(-1)?.metadata?.skillConversation as any;
   const inherited = same(tail?.selection,request.selection) && ['reply','clarify'].includes(tail?.action) && Array.isArray(tail?.sources) ? tail.sources as SourceReference[] : [];
   const sources = [...new Map([...inherited,...request.sources].map(s => [`${s.kind}:${s.id}`,s])).values()];
   if (sources.length > 8) throw new SkillError('SKILL_CONVERSATION_LIMIT','原文材料超过8份，请新建会话',413);
   const prepared = await createInvocationPgRepository(database).prepare(user,sessionId,sources);
   const references: unknown[] = [];
   for (const skill of snapshot.skills) {
    const resolved = await resolveSkillReferences(skill.definition.references,id => getKnowledgeRepository().get(id));
    if (resolved.content) references.push({ skill: skill.definition.name, content: resolved.content });
   }
   const capability = { name: selected.name, description: selected.description,
    ...(snapshot.kind === 'skill' ? { instructions: snapshot.skills[0].definition.instructions } : { steps: (snapshot.target.definition as any).steps.map((s: any) => ({ name: s.name, type: s.type, ...(s.prompt ? { prompt: s.prompt } : {}) })),
     skills: snapshot.skills.map(s => ({ name: s.definition.name, instructions: s.definition.instructions })) }), references };
   const needsTemplate = !!(selected.inputSchema as any)?.properties?.templateId;
   const template = needsTemplate ? await loadTemplate() : null;
   return { target: { ...request.selection, name: selected.name, inputSchema: selected.inputSchema as Record<string,unknown> }, capability,
    history: history.filter(m => ['user','assistant'].includes(m.role)).slice(-16).map(m => ({ role: m.role, content: m.content.slice(-6000) })),
    sources, materials: prepared.sourceMaterials ?? [], revision: revision(session,request.selection.versionId),
    ...(template ? { templates: [{ templateId: template.templateId, templateName: template.templateName }] } : {}), ...(existing ? { existing } : {}) };
  },
  async saveReply(user, sessionId, request, fingerprint, context, reply, model) {
   return database.transaction(async tx => {
    await manifests.verifyCaller(tx,user);
    const [session] = await tx.select().from(aiSessions).where(and(eq(aiSessions.sessionId,sessionId),eq(aiSessions.ownerUserId,user.id))).for('update');
    if (!session || session.status === 'archived') throw missing();
    const existing = replay(session.messages as AiMessage[],request,fingerprint); if (existing) return existing;
    if (revision(session,request.selection.versionId) !== context.revision) throw changed();
    const now = new Date().toISOString();
    const metadata = { skillConversation: { selection: { ...request.selection,name: context.target.name }, sources: context.sources,
     submissionKey: request.submissionKey, fingerprint, ...reply } };
    const pair: AiMessage[] = [
     { messageId: randomUUID(), role: 'user', content: request.content, createdAt: now, attachmentIds: request.sources.map(s => s.id), metadata },
     { messageId: randomUUID(), role: 'assistant', content: reply.message, createdAt: now, metadata: { ...metadata, trace: { modelRun: { model } } } },
    ];
    await tx.update(aiSessions).set({ messages: sql`${aiSessions.messages} || ${JSON.stringify(pair)}::jsonb`, updatedAt: new Date() }).where(eq(aiSessions.sessionId,sessionId));
    return reply;
   });
  },
 };
}
