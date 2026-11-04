import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSkillConversationService } from './skills.conversation';
import type { AuthUser, RequirementSystemConfig } from '../../types';
const user = { id: 'reader', username: 'reader', role: 'admin', status: 'active' } as AuthUser;
const request = { submissionKey: 'turn-1', content: '这个skill能做什么？', selection: { kind: 'skill', id: 's1', versionId: 'v1' } };
const settings = { modelProviders: [{ id: 'p', enabled: true, protocol: 'openai-compatible', baseUrl: 'https://test.invalid/v1', models: [{ id: 'model' }] }], scenarioBindings: { generation: { providerId: 'p', modelId: 'model' } } } as unknown as RequirementSystemConfig;
function fixture(output: unknown = { action: 'reply', message: '我可以将原始需求拆成独立条目。' }) {
 const calls: any[] = [], saves: any[] = [], runs: any[] = [];
 let reads = 0, changed = false, existing: any = null;
 const context: any = { target: { ...request.selection, name: '需求拆解', inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1 } }, required: ['text'], additionalProperties: false } },
  capability: { instructions: '保留查询和导出，至少两项', references: [] }, history: [], sources: [], materials: [], revision: 'rev1' };
 const service = createSkillConversationService({
  repository: { projectExecutionUser: async () => {}, read: async () => { reads++; return { ...context, revision: changed && reads > 1 ? 'rev2' : 'rev1' }; }, saveReply: async (...args: any[]) => { saves.push(args); return args[5]; } },
  queue: { findRunForSubmissionKey: async () => existing },
  invocation: { submitInvocation: async (...args: any[]) => { runs.push(args); return { status: 202, data: { runId: 'run-1', sessionId: 'session', status: 'queued', eventCursor: 0 } }; } },
  model: { loadSettings: async () => settings, loadCredential: async () => 'test-placeholder', provider: { chatCompletion: async req => { calls.push(req); return { content: JSON.stringify(output), rawContent: '', attempts: 1, model: 'model', provider: 'fixture', usage: { completionTokens: 40, promptTokens: 30, totalTokens: 70 } }; } } },
 });
 return { service, calls, saves, runs, context, change: () => { changed = true; }, existing: (value: any) => { existing = value; } };
}
test('能力询问由LLM自然回答，不套业务输出Schema，不创建执行任务', async () => {
 const f = fixture(); const result = await f.service.respond(user, 'session', request);
 assert.equal(result.action, 'reply'); assert.match(result.message, /独立条目/); assert.equal(f.runs.length, 0); assert.equal(f.saves.length, 1);
 const input = JSON.parse(f.calls[0].messages[1].content);
 assert.equal(input.content, request.content); assert.equal(input.capability.instructions, f.context.capability.instructions);
 assert.match(f.calls[0].messages[0].content, /选择.*不.*执行/); assert.equal(f.calls[0].tools, undefined);
 assert.equal(f.calls[0].messages[0].content.includes('保留查询和导出，至少两项'), false);
});
test('信息不足先追问，后续补充带会话历史并生成合并输入再执行', async () => {
 const f = fixture({ action: 'clarify', message: '请提供需要拆解的原始需求。' });
 assert.equal((await f.service.respond(user, 'session', { ...request, content: '帮我拆解' })).action, 'clarify'); assert.equal(f.runs.length, 0);
 const next = fixture({ action: 'execute', message: '开始拆解。', input: { text: '销售主管按客户查询订单，并导出Excel' } });
 next.context.history = [{ role: 'user', content: '帮我拆解' }, { role: 'assistant', content: '请提供原始需求' }];
 next.context.sources = [{ kind: 'file', id: 'original' }];
 const result = await next.service.respond(user, 'session', { ...request, content: '销售主管按客户查询订单，并导出Excel' });
 assert.equal(result.action, 'execute'); assert.equal(next.saves.length, 0); assert.equal(next.runs.length, 1);
 assert.deepEqual(next.runs[0][2].execution.input, { text: '销售主管按客户查询订单，并导出Excel' });
 assert.deepEqual(next.runs[0][2].execution.sources, next.context.sources);
 assert.deepEqual(JSON.parse(next.calls[0].messages[1].content).history, next.context.history);
});
test('LLM声明执行但输入不满足契约，不能启动', async () => {
 const f = fixture({ action: 'execute', message: '开始', input: {} });
 await assert.rejects(f.service.respond(user, 'session', request), /输入|无效/); assert.equal(f.runs.length, 0);
});
for (const output of [null, { action: 'execute', message: '开始', input: { text: 'x' }, tools: ['write'] }, { action: 'reply', message: '', input: {} }, { action: 'reply', message: '回答', input: { text: '偷偷执行' } }]) {
 test(`无效模型结果不能进入执行 ${JSON.stringify(output)}`, async () => { const f = fixture(output); await assert.rejects(f.service.respond(user, 'session', request)); assert.equal(f.runs.length, 0); assert.equal(f.saves.length, 0); });
}
test('调用期间会话变化，不能保存迟到答复或启动任务', async () => {
 const f = fixture(); f.change(); await assert.rejects(f.service.respond(user, 'session', request), /变化/); assert.equal(f.saves.length, 0);
});
for (const patch of [{ history: [] }, { instructions: 'forged' }, { selection: { ...request.selection, definition: {} } }, { content: '' }]) {
 test(`客户端不能伪造上下文 ${JSON.stringify(patch)}`, async () => { const f = fixture(); await assert.rejects(f.service.respond(user, 'session', { ...request, ...patch })); assert.equal(f.calls.length, 0); });
}
test('相同已落库答复重放不再调用模型', async () => {
 const f = fixture(); f.context.existing = { action: 'clarify', message: '请给原文' };
 assert.equal((await f.service.respond(user, 'session', request)).action, 'clarify'); assert.equal(f.calls.length, 0);
});
