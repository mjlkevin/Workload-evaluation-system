import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeRequirementCandidates, validateRequirementClarification, confirmRequirements, requirementReportDigest,
  parseMvpContract, REQUIREMENT_EXTRACTION_INPUT_SCHEMA, type RequirementCandidate, type RequirementReport,
} from './requirements';
import { assessmentCatalogDigest, assessmentMatchingDigest, validateAssessmentMatching, buildAssessmentItems,
  type FrozenAssessmentCatalog, type AssessmentMatching } from './assessment-matching';

// Synthetic unit fixtures only; these IDs and days are not real catalog or business acceptance evidence.
const text = '销售主管需要按客户查询销售订单，并将查询结果导出为Excel';
const source = (kind: 'file' | 'conversation' = 'conversation') => ({ id: 'fixture-source', kind, text });
const quote = (value: string) => ({ sourceId: 'fixture-source', quote: value, start: text.indexOf(value), end: text.indexOf(value) + value.length });
function candidates() {
  const base = { role: '销售主管', constraints: [], assumptions: [], openQuestions: [], sources: [quote(text)] };
  return { requirements: [
    { ...base, title: '按客户查询销售订单', description: '销售主管按客户查询销售订单', action: '查询', object: '销售订单', sources: [quote('销售主管需要按客户查询销售订单')] },
    { ...base, title: '导出查询结果', description: '将查询结果导出为Excel', action: '导出', object: '查询结果', constraints: ['Excel'], sources: [quote('并将查询结果导出为Excel')] },
  ], relations: [] as Array<{ kind: 'duplicate' | 'conflict'; leftIndex: number; rightIndex: number; reason: string }> };
}
function report(): RequirementReport { return normalizeRequirementCandidates({ sources: [source()] }, candidates()); }
function confirmed() {
  const value = report();
  return confirmRequirements(value, { reportDigest: requirementReportDigest(value), requirementIds: value.requirements.map(r => r.id), actorId: 'fixture-user', decisionId: 'fixture-explicit-decision' });
}
function catalog(): FrozenAssessmentCatalog {
  const value = { template: { templateId: 'fixture-template', templateVersion: 'fixture-v1', templateName: '纯测试目录',
    groups: [{ groupId: 'fixture-group', groupName: '纯测试分组' }], items: [
      { templateItemId: 'fixture-query', groupId: 'fixture-group', itemName: '纯测试查询项', standardDays: 3 },
      { templateItemId: 'fixture-export', groupId: 'fixture-group', itemName: '纯测试导出项', standardDays: 2 },
    ] }, ruleSet: { ruleSetId: 'fixture-rules', ruleVersion: 'fixture-v1', pipelineVersion: 'fixture-v1', pipeline: ['baseRule'],
      baseRule: { userCountTiers: [{ min: 0, max: 100, factor: 0 }], difficultyFactorList: [0, 0.2] }, orgIncrementRule: { enabled: false } } };
  return { ...value, snapshotDigest: assessmentCatalogDigest(value) };
}
function matching(): AssessmentMatching {
  const c = catalog();
  return { requirementReportDigest: confirmed().confirmation.reportDigest, templateId: c.template.templateId, templateVersion: c.template.templateVersion,
    ruleSetId: c.ruleSet.ruleSetId, ruleVersion: c.ruleSet.ruleVersion, snapshotDigest: c.snapshotDigest,
    matches: [{ reqId: 'REQ-001', templateItemIds: ['fixture-query'], scope: 'include', rationale: '纯测试映射' }],
    unmatched: [{ reqId: 'REQ-002', reason: '需业务确认真实导出范围' }], params: {}, aiAdjustments: [] };
}
function rejects(call: () => unknown, code: string) { assert.throws(call, (error: any) => error.code === code); }

test('normalizes two independently supplied long-sentence candidates with backend IDs and exact source spans', () => {
  const value = report();
  assert.deepEqual(value.requirements.map(r => [r.id, r.action, r.object]), [['REQ-001', '查询', '销售订单'], ['REQ-002', '导出', '查询结果']]);
  assert.deepEqual(value.requirements.map(r => r.sources), candidates().requirements.map(r => r.sources));
  assert.equal(value.requirements[1].constraints[0], 'Excel');
  // Semantics come from published Skill content and the human baseline, never an intent-regex splitter here.
  assert.deepEqual(report(), value);
});
test('parsed file and text use the same entry contract and preserve supplied real location only', () => {
  const file = normalizeRequirementCandidates({ sources: [{ ...source('file'), location: 'fixture-sheet!A2' }] }, candidates());
  assert.deepEqual(file, report());
  parseMvpContract(REQUIREMENT_EXTRACTION_INPUT_SCHEMA, { sources: [source()] });
});
test('rejects invented sources, fabricated quotes, invalid offsets and unknown source location claims', () => {
  for (const change of [
    (c: ReturnType<typeof candidates>) => { c.requirements[0].sources[0].sourceId = 'invented'; },
    (c: ReturnType<typeof candidates>) => { c.requirements[0].sources[0].quote = '未说过的原文'; },
    (c: ReturnType<typeof candidates>) => { c.requirements[0].sources[0].start = 1; },
    (c: ReturnType<typeof candidates>) => { c.requirements[0].sources[0].end += 1; },
  ]) { const c = candidates(); change(c); rejects(() => normalizeRequirementCandidates({ sources: [source()] }, c), 'MVP_SOURCE_INVALID'); }
  const c = candidates(); Object.assign(c.requirements[0].sources[0], { location: 'invented!A9' });
  rejects(() => normalizeRequirementCandidates({ sources: [source()] }, c), 'MVP_SCHEMA_INVALID');
});
test('rejects model IDs and confirmations instead of treating them as trusted state', () => {
  for (const extra of [{ id: 'MODEL-99' }, { confirmed: true }, { status: 'confirmed' }]) {
    const c = candidates(); Object.assign(c.requirements[0], extra);
    rejects(() => normalizeRequirementCandidates({ sources: [source()] }, c), 'MVP_SCHEMA_INVALID');
  }
});
test('rejects extra input, duplicate source identity, unsafe JSON and non-JSON values without echoing payload', () => {
  rejects(() => normalizeRequirementCandidates({ sources: [source()], owner: 'other' }, candidates()), 'MVP_SCHEMA_INVALID');
  rejects(() => normalizeRequirementCandidates({ sources: [source(), source()] }, candidates()), 'MVP_SOURCE_INVALID');
  for (const value of [JSON.parse('{"__proto__":{}}'), { n: NaN }, { n: undefined }, new Date(), { get secret() { throw Error('private'); } }]) {
    rejects(() => parseMvpContract({}, value), 'MVP_JSON_INVALID');
  }
});
test('safe JSON rejects sparse arrays carrying side properties instead of silently converting them', () => {
  const value = new Array(1); Object.assign(value, { hidden: 'would-disappear' });
  rejects(() => parseMvpContract({}, { value }), 'MVP_JSON_INVALID');
});
test('clarification preserves every existing ID even when model order changes', () => {
  const previous = report(); const next = structuredClone(previous); next.requirements.reverse();
  next.requirements[0].constraints.push('只读导出');
  const result = validateRequirementClarification(previous, [source()], next);
  assert.equal(result.requirements[0].id, 'REQ-002'); assert.equal(result.requirements[1].id, 'REQ-001');
  assert.deepEqual(previous.requirements[1].constraints, ['Excel']);
});
test('clarification rejects missing, added or duplicate requirement IDs', () => {
  for (const change of [
    (r: RequirementReport) => { r.requirements.pop(); },
    (r: RequirementReport) => { r.requirements[0].id = 'REQ-999'; },
    (r: RequirementReport) => { r.requirements[1].id = r.requirements[0].id; },
  ]) { const previous = report(); const next = structuredClone(previous); change(next);
    rejects(() => validateRequirementClarification(previous, [source()], next), 'MVP_REQUIREMENT_IDS_CHANGED'); }
});

test('clarification keeps original source anchors while allowing new authenticated answer sources', () => {
  const previous = report(); const next = structuredClone(previous);
  const answer = { id: 'fixture-answer', kind: 'conversation', text: '限授权客户' };
  next.requirements[0].sources.push({ sourceId: answer.id, quote: answer.text, start: 0, end: answer.text.length });
  assert.equal(validateRequirementClarification(previous, [source(), answer], next).requirements[0].sources.length, 2);
  next.requirements[0].sources.shift();
  rejects(() => validateRequirementClarification(previous, [source(), answer], next), 'MVP_SOURCE_DROPPED');
});
test('source quotes use literal UTF-16 positions including emoji and never content guessing', () => {
  const value = { id: 'emoji', kind: 'conversation', text: '😀查询订单' };
  const c = candidates(); c.requirements = [c.requirements[0]];
  c.requirements[0].sources = [{ sourceId: value.id, quote: '查询订单', start: 2, end: 6 }];
  assert.equal(normalizeRequirementCandidates({ sources: [value] }, c).requirements[0].sources[0].start, 2);
});

test('duplicates and conflicts remain visible, including across clarification', () => {
  const c = candidates(); c.relations = [{ kind: 'conflict', leftIndex: 0, rightIndex: 1, reason: '人工标记的待核冲突' }];
  const previous = normalizeRequirementCandidates({ sources: [source()] }, c);
  assert.equal(previous.requirements.length, 2); assert.equal(previous.relations[0].leftId, 'REQ-001');
  const next = structuredClone(previous); next.relations = [];
  rejects(() => validateRequirementClarification(previous, [source()], next), 'MVP_RELATION_DROPPED');
  const duplicate = candidates(); duplicate.requirements.push(structuredClone(duplicate.requirements[0]));
  rejects(() => normalizeRequirementCandidates({ sources: [source()] }, duplicate), 'MVP_DUPLICATE_UNMARKED');
  duplicate.relations = [{ kind: 'duplicate', leftIndex: 0, rightIndex: 2, reason: '保留重复原条目' }];
  assert.equal(normalizeRequirementCandidates({ sources: [source()] }, duplicate).requirements.length, 3);
});
test('only explicit trusted conflict resolution can confirm a conflict while preserving the original relation', () => {
  const c = candidates(); c.relations = [{ kind: 'conflict', leftIndex: 0, rightIndex: 1, reason: '人工标记待核冲突' }];
  const r = normalizeRequirementCandidates({ sources: [source()] }, c);
  const approval = { reportDigest: requirementReportDigest(r), requirementIds: ['REQ-001', 'REQ-002'], actorId: 'fixture-user', decisionId: 'fixture-resolution' };
  rejects(() => confirmRequirements(r, approval), 'MVP_REQUIREMENT_UNRESOLVED');
  const result = confirmRequirements(r, { ...approval, resolvedConflicts: [{ leftId: 'REQ-001', rightId: 'REQ-002', resolution: '人工已核对两个范围可并存' }] });
  assert.deepEqual(result.report.relations, r.relations);
  assert.equal(result.confirmation.resolvedConflicts![0].resolution, '人工已核对两个范围可并存');
  rejects(() => confirmRequirements(r, { ...approval, resolvedConflicts: [{ leftId: 'REQ-001', rightId: 'REQ-999', resolution: '无效' }] }), 'MVP_CONFIRMATION_INVALID');
});
test('unknown fields, open questions and assumptions cannot become confirmed', () => {
  for (const change of [
    (r: RequirementCandidate) => { r.openQuestions = ['查询范围待回答']; },
    (r: RequirementCandidate) => { r.assumptions = ['暂按全部客户']; },
    (r: RequirementCandidate) => { r.role = ''; },
  ]) { const value = report(); change(value.requirements[0]);
    rejects(() => confirmRequirements(value, { reportDigest: requirementReportDigest(value), requirementIds: ['REQ-001'], actorId: 'fixture-user', decisionId: 'fixture-decision' }), 'MVP_REQUIREMENT_UNRESOLVED'); }
});
test('explicit confirmation is bound to current report content and exact selected IDs', () => {
  assert.equal(confirmed().confirmation.actorId, 'fixture-user');
  const r = report(); const confirmation = { reportDigest: requirementReportDigest(r), requirementIds: ['REQ-001'], actorId: 'fixture-user', decisionId: 'fixture-decision' };
  r.requirements[0].constraints.push('changed'); rejects(() => confirmRequirements(r, confirmation), 'MVP_CONFIRMATION_STALE');
  rejects(() => confirmRequirements(report(), { ...confirmation, requirementIds: ['REQ-404'] }), 'MVP_CONFIRMATION_INVALID');
});
test('matching covers all confirmed requirements and keeps unmatched visible with reasons', () => {
  const value = validateAssessmentMatching(confirmed(), catalog(), matching());
  assert.equal(value.unmatched[0].reqId, 'REQ-002'); assert.equal(value.matches[0].templateItemIds[0], 'fixture-query');
});
test('matching rejects missing requirement coverage, invented IDs, conflicting matches and duplicate coverage', () => {
  for (const change of [
    (m: AssessmentMatching) => { m.unmatched = []; },
    (m: AssessmentMatching) => { m.matches[0].reqId = 'REQ-404'; },
    (m: AssessmentMatching) => { m.matches[0].templateItemIds = ['invented-item']; },
    (m: AssessmentMatching) => { m.matches.push({ ...m.matches[0], scope: 'review' }); },
    (m: AssessmentMatching) => { m.unmatched.push({ reqId: 'REQ-001', reason: '冲突' }); },
  ]) { const m = matching(); change(m); rejects(() => validateAssessmentMatching(confirmed(), catalog(), m), 'MVP_MATCHING_REFERENCE_INVALID'); }
});
test('matching rejects cross-template, cross-rule and changed snapshot bindings', () => {
  for (const key of ['templateId', 'templateVersion', 'ruleSetId', 'ruleVersion', 'snapshotDigest'] as const) {
    const m = matching(); m[key] = 'another'; rejects(() => validateAssessmentMatching(confirmed(), catalog(), m), 'MVP_CATALOG_CHANGED');
  }
  const c = catalog(); c.template.items[0].standardDays++;
  rejects(() => validateAssessmentMatching(confirmed(), c, matching()), 'MVP_CATALOG_CHANGED');
});
test('matching cannot reuse stable IDs against a changed confirmed requirement report', () => {
  const old = matching(); const changed = report(); changed.requirements[0].constraints.push('新确认范围');
  const approval = confirmRequirements(changed, { reportDigest: requirementReportDigest(changed), requirementIds: ['REQ-001', 'REQ-002'], actorId: 'fixture-user', decisionId: 'fixture-new-decision' });
  rejects(() => validateAssessmentMatching(approval, catalog(), old), 'MVP_REQUIREMENTS_CHANGED');
});
test('model effort cannot masquerade as WES standard days, total days or item overrides', () => {
  for (const extra of [{ standardDays: 99 }, { totalDays: 99 }, { customStandardDays: 99 }]) {
    rejects(() => validateAssessmentMatching(confirmed(), catalog(), { ...matching(), ...extra }), 'MVP_SCHEMA_INVALID');
  }
});
test('calculation bridge uses explicit reviewed scope/params and never applies AI effort suggestions', () => {
  const m = matching(); m.aiAdjustments = [{ reqId: 'REQ-001', proposedDays: 99, basis: '仅AI建议' }];
  const c = catalog(); const before = structuredClone(c);
  const result = buildAssessmentItems(confirmed(), c, m, { matchingDigest: assessmentMatchingDigest(m), actorId: 'fixture-user', decisionId: 'fixture-scope',
    selectedItemIds: ['fixture-query'], params: { userCount: 0, difficultyFactor: 0, orgCount: 1, orgSimilarityFactor: 1 } });
  assert.deepEqual(result.items, [{ templateItemId: 'fixture-query', included: true }, { templateItemId: 'fixture-export', included: false }]);
  assert.equal(result.difficultyFactor, 0); assert.equal('totalDays' in result, false); assert.deepEqual(c, before);
});
test('calculation bridge rejects stale review, unreviewed item IDs and parameters outside frozen rule set', () => {
  const m = matching(); const confirmation = { matchingDigest: assessmentMatchingDigest(m), actorId: 'fixture-user', decisionId: 'fixture-scope',
    selectedItemIds: ['fixture-query'], params: { userCount: 1, difficultyFactor: 0, orgCount: 1, orgSimilarityFactor: 1 } };
  rejects(() => buildAssessmentItems(confirmed(), catalog(), m, { ...confirmation, matchingDigest: 'old' }), 'MVP_CONFIRMATION_STALE');
  rejects(() => buildAssessmentItems(confirmed(), catalog(), m, { ...confirmation, selectedItemIds: ['invented'] }), 'MVP_SCOPE_INVALID');
  rejects(() => buildAssessmentItems(confirmed(), catalog(), m, { ...confirmation, params: { ...confirmation.params, difficultyFactor: 9 } }), 'MVP_CALCULATION_INVALID');
});
