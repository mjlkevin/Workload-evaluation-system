import Ajv from 'ajv';
import { skillDefinitionHash } from '../skills.hash';

export type RequirementSource = { id: string; kind: 'file' | 'conversation'; text: string; location?: string };
export type SourceQuote = { sourceId: string; quote: string; start: number; end: number };
export type RequirementCandidate = {
  title: string; description: string; role: string; action: string; object: string;
  constraints: string[]; openQuestions: string[]; assumptions: string[]; sources: SourceQuote[];
};
export type RequirementItem = RequirementCandidate & { id: string };
export type RequirementRelation = { kind: 'duplicate' | 'conflict'; leftId: string; rightId: string; reason: string };
export type RequirementReport = { requirements: RequirementItem[]; relations: RequirementRelation[] };
/** Supplied by the server's authenticated explicit-confirmation path, never model output. */
export type RequirementConfirmation = { reportDigest: string; requirementIds: string[]; actorId: string; decisionId: string;
  resolvedConflicts?: Array<{ leftId: string; rightId: string; resolution: string }> };
export type ConfirmedRequirements = { report: RequirementReport; confirmation: RequirementConfirmation };

// The exported schemas describe data integrity, not NLP intent or a hard-coded business workflow.
export const mvpText = (maxLength = 4000, minLength = 1) => ({ type: 'string', minLength, maxLength });
export const mvpObject = (properties: Record<string, unknown>, required = Object.keys(properties)): Record<string, unknown> =>
  ({ type: 'object', additionalProperties: false, properties, required });
export const mvpArray = (items: unknown, minItems = 0, maxItems = 200) => ({ type: 'array', items, minItems, maxItems });
const strings = () => mvpArray(mvpText());
const sourceSchema = mvpObject({ id: mvpText(160), kind: { enum: ['file', 'conversation'] }, text: mvpText(200000), location: mvpText(500) }, ['id', 'kind', 'text']);
const sourcesSchema = mvpArray(sourceSchema, 1, 100);
const quoteSchema = mvpObject({ sourceId: mvpText(160), quote: mvpText(200000), start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 1 } });
const candidateProperties = {
  title: mvpText(200), description: mvpText(), role: mvpText(200, 0), action: mvpText(200, 0), object: mvpText(200, 0),
  constraints: strings(), openQuestions: strings(), assumptions: strings(), sources: mvpArray(quoteSchema, 1, 100),
};
const relationProperties = { kind: { enum: ['duplicate', 'conflict'] }, leftId: mvpText(160), rightId: mvpText(160), reason: mvpText() };
export const REQUIREMENT_REPORT_SCHEMA = mvpObject({ requirements: mvpArray(mvpObject({ id: mvpText(160), ...candidateProperties }), 1), relations: mvpArray(mvpObject(relationProperties)) });
export const REQUIREMENT_EXTRACTION_INPUT_SCHEMA = mvpObject({ sources: sourcesSchema });
export const REQUIREMENT_CANDIDATES_SCHEMA = mvpObject({
  requirements: mvpArray(mvpObject(candidateProperties), 1),
  relations: mvpArray(mvpObject({ kind: relationProperties.kind, leftIndex: { type: 'integer', minimum: 0 }, rightIndex: { type: 'integer', minimum: 0 }, reason: mvpText() })),
});
export const REQUIREMENT_CLARIFICATION_INPUT_SCHEMA = mvpObject({ sources: sourcesSchema, previous: REQUIREMENT_REPORT_SCHEMA });
export const REQUIREMENT_CLARIFICATION_OUTPUT_SCHEMA = REQUIREMENT_REPORT_SCHEMA;

export class MvpContractError extends Error {
  constructor(public code: string) { super(code); this.name = 'MvpContractError'; }
}
export function mvpInvalid(code: string): never { throw new MvpContractError(code); }
/** Strict JSON boundary before AJV; no coercion, getters, custom prototypes, silent omission or secrets in errors. */
export function parseMvpContract<T>(schema: Record<string, unknown>, value: unknown): T {
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 100000 || depth > 24) mvpInvalid('MVP_JSON_INVALID');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object') mvpInvalid('MVP_JSON_INVALID');
    const proto = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) mvpInvalid('MVP_JSON_INVALID');
    const keys = Reflect.ownKeys(item);
    if (Array.isArray(item) && (keys.length !== item.length + 1 || Array.from({ length: item.length }, (_, i) => String(i)).some(key => !Object.prototype.hasOwnProperty.call(item, key)))) mvpInvalid('MVP_JSON_INVALID');
    for (const key of keys) {
      if (Array.isArray(item) && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) mvpInvalid('MVP_JSON_INVALID');
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) mvpInvalid('MVP_JSON_INVALID');
      visit(descriptor.value, depth + 1);
    }
  };
  let copy: unknown;
  try {
    visit(value, 0);
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > 1024 * 1024) mvpInvalid('MVP_JSON_INVALID');
    copy = JSON.parse(json);
  } catch { return mvpInvalid('MVP_JSON_INVALID'); }
  if (!new Ajv({ strict: false, allErrors: false, addUsedSchema: false }).validate(schema, copy)) mvpInvalid('MVP_SCHEMA_INVALID');
  return copy as T;
}
export const requirementReportDigest = (report: RequirementReport): string => skillDefinitionHash(report);
function checkedSources(value: unknown): RequirementSource[] {
  const { sources } = parseMvpContract<{ sources: RequirementSource[] }>(REQUIREMENT_EXTRACTION_INPUT_SCHEMA, value);
  if (new Set(sources.map(s => s.id)).size !== sources.length || sources.some(s => !s.id.trim() || !s.text.trim())) mvpInvalid('MVP_SOURCE_INVALID');
  return sources;
}
function relationKey(r: RequirementRelation): string { return `${r.kind}:${[r.leftId, r.rightId].sort().join(':')}`; }
function checkReport(report: RequirementReport, sources?: RequirementSource[]): void {
  const ids = new Set(report.requirements.map(r => r.id));
  if (ids.size !== report.requirements.length || report.requirements.some(r => !/^REQ-[0-9]{3,}$/.test(r.id))) mvpInvalid('MVP_REQUIREMENT_IDS_CHANGED');
  const relationKeys = new Set<string>();
  for (const relation of report.relations) {
    const key = relationKey(relation);
    if (!ids.has(relation.leftId) || !ids.has(relation.rightId) || relation.leftId === relation.rightId || relationKeys.has(key) || !relation.reason.trim()) mvpInvalid('MVP_RELATION_INVALID');
    relationKeys.add(key);
  }
  for (const item of report.requirements) {
    if (!item.title.trim() || !item.description.trim()) mvpInvalid('MVP_SCHEMA_INVALID');
    for (const ref of item.sources) {
      if (ref.start >= ref.end || ref.quote.length !== ref.end - ref.start) mvpInvalid('MVP_SOURCE_INVALID');
      if (sources) {
        const source = sources.find(s => s.id === ref.sourceId);
        if (!source || source.text.slice(ref.start, ref.end) !== ref.quote) mvpInvalid('MVP_SOURCE_INVALID');
      }
    }
  }
  // Detect exact duplicated structured claims only; semantic duplicate/conflict discovery belongs to Skill content.
  for (let i = 0; i < report.requirements.length; i++) for (let j = 0; j < i; j++) {
    const claim = (r: RequirementItem) => skillDefinitionHash({ description: r.description, role: r.role, action: r.action, object: r.object, constraints: r.constraints });
    if (claim(report.requirements[i]) === claim(report.requirements[j]) && !relationKeys.has(relationKey({ kind: 'duplicate', leftId: report.requirements[i].id, rightId: report.requirements[j].id, reason: '' }))) mvpInvalid('MVP_DUPLICATE_UNMARKED');
  }
}
export function normalizeRequirementCandidates(input: unknown, output: unknown): RequirementReport {
  const sources = checkedSources(input);
  const candidates = parseMvpContract<{ requirements: RequirementCandidate[]; relations: Array<{ kind: 'duplicate' | 'conflict'; leftIndex: number; rightIndex: number; reason: string }> }>(REQUIREMENT_CANDIDATES_SCHEMA, output);
  const requirements = candidates.requirements.map((item, index) => ({ id: `REQ-${String(index + 1).padStart(3, '0')}`, ...item }));
  const relations = candidates.relations.map(r => {
    if (!requirements[r.leftIndex] || !requirements[r.rightIndex]) return mvpInvalid('MVP_RELATION_INVALID');
    return { kind: r.kind, leftId: requirements[r.leftIndex].id, rightId: requirements[r.rightIndex].id, reason: r.reason };
  });
  const report = { requirements, relations }; checkReport(report, sources); return report;
}
export function validateRequirementClarification(previous: RequirementReport, inputSources: unknown, output: unknown): RequirementReport {
  const sources = checkedSources({ sources: inputSources });
  const before = parseMvpContract<RequirementReport>(REQUIREMENT_REPORT_SCHEMA, previous); checkReport(before, sources);
  const after = parseMvpContract<RequirementReport>(REQUIREMENT_CLARIFICATION_OUTPUT_SCHEMA, output);
  const ids = (r: RequirementReport) => r.requirements.map(item => item.id).sort().join(',');
  if (ids(before) !== ids(after)) mvpInvalid('MVP_REQUIREMENT_IDS_CHANGED');
  checkReport(after, sources);
  for (const item of before.requirements) {
    const next = after.requirements.find(r => r.id === item.id)!;
    if (item.sources.some(ref => !next.sources.some(r => skillDefinitionHash(r) === skillDefinitionHash(ref)))) mvpInvalid('MVP_SOURCE_DROPPED');
  }
  if (before.relations.some(r => !after.relations.some(next => skillDefinitionHash(next) === skillDefinitionHash(r)))) mvpInvalid('MVP_RELATION_DROPPED');
  return after;
}
export function confirmRequirements(report: RequirementReport, trustedConfirmation: RequirementConfirmation): ConfirmedRequirements {
  const value = parseMvpContract<RequirementReport>(REQUIREMENT_REPORT_SCHEMA, report); checkReport(value);
  const schema = mvpObject({ reportDigest: mvpText(160), requirementIds: { ...mvpArray(mvpText(160), 1), uniqueItems: true }, actorId: mvpText(160), decisionId: mvpText(160),
    resolvedConflicts: mvpArray(mvpObject({ leftId: mvpText(160), rightId: mvpText(160), resolution: mvpText() })) }, ['reportDigest', 'requirementIds', 'actorId', 'decisionId']);
  const confirmation = parseMvpContract<RequirementConfirmation>(schema, trustedConfirmation);
  if (confirmation.reportDigest !== requirementReportDigest(value)) mvpInvalid('MVP_CONFIRMATION_STALE');
  if (!confirmation.actorId.trim() || !confirmation.decisionId.trim() || confirmation.requirementIds.some(id => !value.requirements.some(r => r.id === id))) mvpInvalid('MVP_CONFIRMATION_INVALID');
  const resolved = new Set<string>();
  for (const resolution of confirmation.resolvedConflicts ?? []) {
    const key = relationKey({ ...resolution, kind: 'conflict', reason: '' });
    if (!resolution.resolution.trim() || resolved.has(key) || !value.relations.some(r => relationKey(r) === key)) mvpInvalid('MVP_CONFIRMATION_INVALID');
    resolved.add(key);
  }
  for (const id of confirmation.requirementIds) {
    const item = value.requirements.find(r => r.id === id)!;
    if (item.openQuestions.length || item.assumptions.length || !item.role.trim() || !item.action.trim() || !item.object.trim()
      || value.relations.some(r => r.kind === 'conflict' && !resolved.has(relationKey(r)) && (r.leftId === id || r.rightId === id))) mvpInvalid('MVP_REQUIREMENT_UNRESOLVED');
  }
  return { report: value, confirmation };
}
