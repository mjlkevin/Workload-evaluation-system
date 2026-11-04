import { and, eq, desc } from "drizzle-orm";
import { db } from "../../../db/client";
import { aiSessions, harnessRuns, harnessRunOutputs } from "../../../db/schema";
import type { AuthUser } from "../../../types";
import {
  createHarnessRuntimeRepository,
  attachWorkbenchConversationFact,
  buildWorkbenchUserMessageFact,
} from "../harness.module";
import { createInvocationPgRepository } from "../../skills/skills.invocation-pg.repository";
import { skillDefinitionHash as hash } from "../../skills/skills.hash";
import type {
  ConversationContext,
  ConversationRequest,
} from "../../skills/skills.conversation";
import { SandboxError } from "./sandbox.types";
export const SANDBOX_WORKFLOW_ID = "sandbox-task-v1";
export const SANDBOX_WORKFLOW_VERSION = "1.0.0";
export async function submitSandboxConversation(
  user: AuthUser,
  sessionId: string,
  request: ConversationRequest,
  fingerprint: string,
  context: ConversationContext,
) {
  const queue = createHarnessRuntimeRepository();
  const sources = await createInvocationPgRepository().prepare(
    user,
    sessionId,
    context.sources,
  );
  const { executionConfig, fact } = attachWorkbenchConversationFact({
    content: request.content,
  });
  const [previous] = await db
    .select({
      content: harnessRunOutputs.content,
      runId: harnessRuns.harnessRunId,
    })
    .from(harnessRuns)
    .innerJoin(
      harnessRunOutputs,
      eq(harnessRuns.harnessRunId, harnessRunOutputs.harnessRunId),
    )
    .where(
      and(
        eq(harnessRuns.ownerUserId, user.id),
        eq(harnessRuns.aiSessionId, sessionId),
        eq(harnessRuns.status, "completed"),
      ),
    )
    .orderBy(desc(harnessRuns.completedAt))
    .limit(1);
  const sandboxContext = {
    selection: request.selection,
    capability: context.capability,
    materials: context.materials,
    ...(previous ? { previousResult: previous } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(sandboxContext)) > 160 * 1024)
    throw new SandboxError(
      "SANDBOX_CONTEXT_LIMIT",
      "材料过长，请减少材料后重试",
      413,
    );
  const queued = await queue.createQueuedRun({
    ownerUserId: user.id,
    ownerUsername: user.username,
    aiSessionId: sessionId,
    submissionKey: `skill-chat:${hash({ owner: user.id, sessionId, key: request.submissionKey })}`,
    title: request.content.slice(0, 80),
    workflowId: SANDBOX_WORKFLOW_ID,
    workflowVersion: SANDBOX_WORKFLOW_VERSION,
    executionConfig: {
      ...executionConfig,
      conversationFingerprint: fingerprint,
      sandboxContext,
    },
    validateSubmission: async (tx) => {
      await sources.verify(tx);
      const [s] = await tx
        .select()
        .from(aiSessions)
        .where(
          and(
            eq(aiSessions.sessionId, sessionId),
            eq(aiSessions.ownerUserId, user.id),
          ),
        )
        .for("update");
      if (
        !s ||
        hash({
          messages: s.messages,
          attachments: s.attachments,
          versionId: request.selection.versionId,
        }) !== context.revision
      )
        throw new SandboxError(
          "SANDBOX_CONTEXT_CHANGED",
          "会话已变化，请重新提交",
          409,
        );
    },
    userMessageFact: (runId) => ({
      ...buildWorkbenchUserMessageFact({
        runId,
        fact,
        content: request.content,
      }),
      metadata: {
        skillConversation: {
          selection: { ...request.selection, name: context.target.name },
          sources: context.sources,
        },
      },
    }),
  });
  return {
    status: 202 as const,
    data: {
      runId: queued.run.harnessRunId,
      sessionId,
      status: queued.run.status,
      eventCursor: queued.run.eventSequence,
    },
  };
}
