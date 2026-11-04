import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { resolveCandidateQuotes, resolveReportQuotes, TRANSPORT_REQUIREMENT_CANDIDATES_SCHEMA, TRANSPORT_REQUIREMENT_REPORT_SCHEMA } from './quote-transport';
import { normalizeRequirementCandidates, validateRequirementClarification, parseMvpContract, REQUIREMENT_CANDIDATES_SCHEMA, REQUIREMENT_REPORT_SCHEMA, mvpObject, type RequirementReport } from './requirements';
import { compileSkillPayloadSchema } from '../skills.validation';
import { validateWorkflowDefinition } from '../../workflows/workflows.validation';
import { buildMvpRequirementTools, requirementReportEnvelope } from '../../../agent/tools/mvp-requirements.tools';
import type { RuntimeContext } from '../../../agent/context/context.types';
import type { MvpExecutionProof } from './execution-proof.repository';

const source = { id: 'material:actual-id', kind: 'conversation' as const, text: '前言😀销售主管查询订单，导出Excel。查询订单' };
const ref = (quote = '😀销售主管查询订单') => ({ sourceId: source.id, quote });
const candidate = () => ({ title: '查询销售订单', description: '销售主管查询订单', role: '销售主管', action: '查询', object: '订单', constraints: [], openQuestions: [], assumptions: [], sources: [ref()] });
const candidates = () => ({ requirements: [candidate()], relations: [] });
const fail = (fn: () => unknown, code: string) => assert.throws(fn, (e: any) => e.code === code);
const canonical = () => normalizeRequirementCandidates({ sources: [source] }, resolveCandidateQuotes([source], candidates()));
function withoutRanges(report: RequirementReport) {
 return { ...report, requirements: report.requirements.map(item => ({ ...item, sources: item.sources.map(({ sourceId, quote }) => ({ sourceId, quote })) })) };
}

test('Chinese and emoji quotes resolve to exact UTF-16 positions without changing material or candidates', () => {
 const input = candidates(), before = structuredClone(input), sources = structuredClone([source]);
 const resolved = resolveCandidateQuotes(sources, input), span = resolved.requirements[0].sources[0];
 assert.deepEqual(span, { ...ref(), start: 2, end: 2 + ref().quote.length });
 assert.equal(span.end - span.start, 10); assert.equal(source.text.slice(span.start, span.end), span.quote);
 assert.deepEqual(input, before); assert.deepEqual(sources, [source]);
 const report = normalizeRequirementCandidates({ sources }, resolved);
 assert.equal(report.requirements[0].id, 'REQ-001');
 parseMvpContract(REQUIREMENT_CANDIDATES_SCHEMA, resolved); parseMvpContract(REQUIREMENT_REPORT_SCHEMA, report);
});
test('canonical supplied ranges remain compatible and duplicate quotes may use explicit exact ranges', () => {
 const input = candidates(); input.requirements[0].sources = [{ ...ref('查询订单'), start: source.text.lastIndexOf('查询订单'), end: source.text.length } as any];
 assert.deepEqual(resolveCandidateQuotes([source], input), input);
 const report = normalizeRequirementCandidates({ sources: [source] }, input);
 assert.deepEqual(resolveReportQuotes([source], report, report), report);
});
test('never shifts a bad provided range or fills only one provided endpoint', () => {
 for (const range of [{ start: 2 }, { end: 12 }, { start: 3, end: 13 }, { start: 2, end: 999 }, { start: 12, end: 2 }]) {
  const input = candidates(); Object.assign(input.requirements[0].sources[0], range);
  fail(() => resolveCandidateQuotes([source], input), 'MVP_SOURCE_INVALID');
 }
});
test('unknown, absent, ambiguous, whitespace-normalized and Unicode-normalized references are rejected', () => {
 for (const quote of ['未出现', '查询订单', '销售主管 查询订单', '😀销售主管查询订单 ']) {
  const input = candidates(); input.requirements[0].sources = [ref(quote)];
  fail(() => resolveCandidateQuotes([source], input), 'MVP_SOURCE_INVALID');
 }
 const unknown = candidates(); unknown.requirements[0].sources[0].sourceId = 'source-1';
 fail(() => resolveCandidateQuotes([source], unknown), 'MVP_SOURCE_INVALID');
 const unicode = { ...source, text: 'e\u0301' }; const input = candidates(); input.requirements[0].sources = [ref('é')];
 fail(() => resolveCandidateQuotes([unicode], input), 'MVP_SOURCE_INVALID');
});
test('overlapping repeated occurrences are ambiguous too', () => {
 const input = candidates(); input.requirements[0].sources = [ref('aa')];
 fail(() => resolveCandidateQuotes([{ ...source, text: 'aaa' }], input), 'MVP_SOURCE_INVALID');
});
test('strict JSON, source and schema boundaries reject unsafe or unbounded transport without invoking getters', () => {
 let read = false; const getter = { get requirements() { read = true; return []; } };
 for (const input of [getter, JSON.parse('{"__proto__":{}}'), { n: NaN }, new Date()]) fail(() => resolveCandidateQuotes([source], input), 'MVP_JSON_INVALID');
 assert.equal(read, false);
 const unsafeSource = { ...source }; Object.defineProperty(unsafeSource, 'text', { enumerable: true, get() { read = true; return source.text; } });
 fail(() => resolveCandidateQuotes([unsafeSource], candidates()), 'MVP_JSON_INVALID'); assert.equal(read, false);
 const notFinite = candidates(); Object.assign(notFinite.requirements[0].sources[0], { start: NaN, end: 12 });
 fail(() => resolveCandidateQuotes([source], notFinite), 'MVP_JSON_INVALID');
 const huge = candidates(); huge.requirements[0].description = '界'.repeat(400000);
 fail(() => resolveCandidateQuotes([source], huge), 'MVP_JSON_INVALID');
 for (const input of [ { ...candidates(), confirmed: true }, { ...candidates(), requirements: [{ ...candidate(), id: 'REQ-999' }] }, { ...candidates(), requirements: [{ ...candidate(), sources: [ref('')] }] } ])
  fail(() => resolveCandidateQuotes([source], input), 'MVP_SCHEMA_INVALID');
 fail(() => resolveCandidateQuotes([source, source], candidates()), 'MVP_SOURCE_INVALID');
 const range = candidates(); Object.assign(range.requirements[0].sources[0], { start: 2.5, end: 12 });
 fail(() => resolveCandidateQuotes([source], range), 'MVP_SCHEMA_INVALID');
});
test('clarification inherits only the same requirement verified duplicate quote and preserves stable IDs', () => {
 const input = candidates(); input.requirements[0].sources = [{ ...ref('查询订单'), start: source.text.lastIndexOf('查询订单'), end: source.text.length } as any];
 const previous = normalizeRequirementCandidates({ sources: [source] }, input), raw = withoutRanges(previous);
 const resolved = resolveReportQuotes([source], raw, previous);
 assert.deepEqual(validateRequirementClarification(previous, [source], resolved), previous);
 const foreign = structuredClone(raw); foreign.requirements[0].id = 'REQ-002';
 fail(() => resolveReportQuotes([source], foreign, previous), 'MVP_SOURCE_INVALID');
 const corrupt = structuredClone(previous); corrupt.requirements[0].sources[0].start--;
 fail(() => resolveReportQuotes([source], raw, corrupt), 'MVP_SOURCE_INVALID');
});
test('unique new clarification answers derive offsets while original anchors and IDs remain mandatory', () => {
 const previous = canonical(), answer = { id: 'answer:actual', kind: 'conversation' as const, text: '只读，限授权客户' }, sources = [source, answer];
 const raw = withoutRanges(previous); raw.requirements[0].sources.push({ sourceId: answer.id, quote: '限授权客户' });
 const result = validateRequirementClarification(previous, sources, resolveReportQuotes(sources, raw, previous));
 assert.equal(result.requirements[0].sources[1].start, 3);
 const dropped = structuredClone(raw); dropped.requirements[0].sources.shift();
 fail(() => validateRequirementClarification(previous, sources, resolveReportQuotes(sources, dropped, previous)), 'MVP_SOURCE_DROPPED');
 const changed = structuredClone(raw); changed.requirements[0].id = 'REQ-002';
 fail(() => validateRequirementClarification(previous, sources, resolveReportQuotes(sources, changed, previous)), 'MVP_REQUIREMENT_IDS_CHANGED');
});
test('only reference requiredness broadens and transport contracts compile through real Skill and Workflow validation', () => {
 for (const [transport, strict] of [[TRANSPORT_REQUIREMENT_CANDIDATES_SCHEMA, REQUIREMENT_CANDIDATES_SCHEMA], [TRANSPORT_REQUIREMENT_REPORT_SCHEMA, REQUIREMENT_REPORT_SCHEMA]]) {
  const expected: any = structuredClone(strict); expected.properties.requirements.items.properties.sources.items.required = ['sourceId', 'quote'];
  assert.deepEqual(transport, expected);
  compileSkillPayloadSchema(transport, 'outputSchema');
  const wrapper = mvpObject({ result: transport });
  const definition: any = { name: '引用传输纯测试', description: '', category: 'delivery', roles: ['delivery'], inputSchema: wrapper, outputSchema: wrapper,
   steps: [{ id: 's', name: '来源', type: 'skill', skillId: 's', skillVersionId: 'v', inputMapping: [{ target: 'result', source: { kind: 'path', path: '$.input.result' } }], onFailure: 'wait' }],
   outputMapping: [{ target: 'result', source: { kind: 'path', path: '$.steps.s.output.result' } }] };
  assert.deepEqual(validateWorkflowDefinition(definition, { skills: [{ stepId: 's', skillId: 's', skillVersionId: 'v', hash: 'fixture', enabled: true, archived: false, status: 'published', definition: { roles: ['delivery'], inputSchema: wrapper, outputSchema: wrapper } }], tools: [] }), definition);
 }
});
test('real native normalize and clarify adapters accept transport and retain canonical output envelope/proof binding', async () => {
 const owner = 'fixture-owner', user = { id: owner, capabilities: ['estimates:read' as const] };
 const runtime: RuntimeContext = { requestId: 'fixture', traceId: 'fixture', actor: { userId: owner, roles: ['IMPL'], capabilities: user.capabilities }, channel: 'api', workflowKey: 'business_skills' };
 let previous: unknown; const calls: string[] = [];
 const proof = { sources: [source], assertPreviousOutput(names: readonly string[], output: unknown) { assert.deepEqual(names, ['requirement_normalize', 'requirement_clarify']); assert.ok(isDeepStrictEqual(previous, output)); } } as unknown as MvpExecutionProof;
 const tools = buildMvpRequirementTools(owner, async (id, trusted, name) => { assert.equal(id, owner); assert.equal(trusted, runtime); calls.push(name); return proof; });
 const normalized = await tools.find(t => t.name === 'requirement_normalize')!.execute({ candidates: candidates() }, user, runtime);
 assert.deepEqual(normalized, requirementReportEnvelope(canonical())); previous = normalized;
 const clarified = await tools.find(t => t.name === 'requirement_clarify')!.execute({ previous: canonical(), report: withoutRanges(canonical()) }, user, runtime);
 assert.deepEqual(clarified, normalized); assert.deepEqual(calls, ['requirement_normalize', 'requirement_clarify']);
 assert.equal(tools.length, 4);
});
