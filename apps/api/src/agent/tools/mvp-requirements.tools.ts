import type { AgentTool } from '../agent.types';
import type { RuntimeContext } from '../context/context.types';
import type { MvpExecutionProof } from '../../modules/skills/mvp/execution-proof.repository';
import {
 confirmRequirements, normalizeRequirementCandidates, validateRequirementClarification, requirementReportDigest,
 mvpArray, mvpInvalid, mvpObject, mvpText, parseMvpContract,
 REQUIREMENT_EXTRACTION_INPUT_SCHEMA, REQUIREMENT_REPORT_SCHEMA,
 type RequirementReport, type RequirementConfirmation,
} from '../../modules/skills/mvp/requirements';
import { resolveCandidateQuotes, resolveReportQuotes, TRANSPORT_REQUIREMENT_CANDIDATES_SCHEMA,
 TRANSPORT_REQUIREMENT_REPORT_SCHEMA } from '../../modules/skills/mvp/quote-transport';

export type MvpProofReader = (ownerUserId: string, runtime: RuntimeContext | undefined, toolName: string, parameters: unknown) => Promise<MvpExecutionProof>;
const readProof: MvpProofReader = async (owner, runtime, name, parameters) => {
 // Lazy import keeps registry/catalog construction free of persistence calls and circular host initialization.
 const { createMvpExecutionProofRepository } = await import('../../modules/skills/mvp/execution-proof.repository');
 return createMvpExecutionProofRepository().readCurrentExecution(owner, runtime, name, parameters);
};
const ids = { ...mvpArray(mvpText(160), 1), uniqueItems: true };
const resolutions = mvpArray(mvpObject({ leftId: mvpText(160), rightId: mvpText(160), resolution: mvpText() }));
export const REQUIREMENT_CONFIRM_PARAMETERS = mvpObject({ report: REQUIREMENT_REPORT_SCHEMA, requirementIds: ids,
 resolvedConflicts: resolutions }, ['report', 'requirementIds']);
export const CONFIRMED_REQUIREMENTS_SCHEMA = mvpObject({ report: REQUIREMENT_REPORT_SCHEMA,
 confirmation: mvpObject({ reportDigest: mvpText(160), requirementIds: ids, actorId: mvpText(160), decisionId: mvpText(160),
  resolvedConflicts: resolutions }, ['reportDigest', 'requirementIds', 'actorId', 'decisionId']) });
export const REQUIREMENT_REPORT_ENVELOPE_SCHEMA = mvpObject({ report: REQUIREMENT_REPORT_SCHEMA, requirementIds: ids, reportDigest: mvpText(160) });
export function requirementReportEnvelope(report: RequirementReport) {
 return { report, requirementIds: report.requirements.map(item => item.id), reportDigest: requirementReportDigest(report) };
}
export type RequirementConfirmParameters = { report: RequirementReport; requirementIds: string[]; resolvedConflicts?: RequirementConfirmation['resolvedConflicts'] };
function boundedSources(proof: MvpExecutionProof) {
 const sources = proof.sources;
 // Composed file, initial-text and answer sources share the existing pure-contract budget.
 // Refuse explicitly; never silently omit a source or shorten its original text.
 if (sources.length > 100 || sources.some(source => source.text.length > 200000)
  || Buffer.byteLength(JSON.stringify({ sources })) > 1024 * 1024) mvpInvalid('MVP_SOURCE_LIMIT');
 return sources;
}

/** A trusted read boundary, not a dispatcher for any business sequence. */
export function mvpReadTool<T>(ownerUserId: string, reader: MvpProofReader | undefined, spec: {
 name: string; description: string; parameters: Record<string, unknown>; outputSchema: Record<string, unknown>;
 run: (input: T, proof: MvpExecutionProof) => unknown;
}): AgentTool {
 const { run, ...contract } = spec;
 return { ...contract, capability: 'estimates:read', source: 'code', category: 'estimate', discoverable: true,
  mutates: false, exfiltrates: false, simulationOnly: false, sandboxReadSafe: true, businessExecutionOnly: true,
  async execute(args, user, runtime) {
   const input = parseMvpContract<T>(spec.parameters, args);
   if (user.id !== ownerUserId || !runtime || runtime.actor.userId !== ownerUserId) mvpInvalid('MVP_EXECUTION_PROOF_INVALID');
   const proof = await (reader ?? readProof)(ownerUserId, runtime, spec.name, input);
   return parseMvpContract(spec.outputSchema, run(input, proof));
  },
 };
}
export function buildMvpRequirementTools(ownerUserId: string, reader?: MvpProofReader): AgentTool[] {
 return [
  mvpReadTool(ownerUserId, reader, { name: 'requirement_sources', description: '读取本次已冻结材料和用户实际补充的需求来源',
   parameters: mvpObject({}), outputSchema: REQUIREMENT_EXTRACTION_INPUT_SCHEMA, run: (_input, proof) => ({ sources: boundedSources(proof) }) }),
  mvpReadTool(ownerUserId, reader, { name: 'requirement_normalize', description: '验证需求候选的原文出处并生成稳定需求编号',
   parameters: mvpObject({ candidates: TRANSPORT_REQUIREMENT_CANDIDATES_SCHEMA }), outputSchema: REQUIREMENT_REPORT_ENVELOPE_SCHEMA,
   run(input: { candidates: unknown }, proof) {
    const sources = boundedSources(proof);
    return requirementReportEnvelope(normalizeRequirementCandidates({ sources }, resolveCandidateQuotes(sources, input.candidates)));
   } }),
  mvpReadTool(ownerUserId, reader, { name: 'requirement_clarify', description: '根据真实补充回答验证澄清报告，保留需求编号和原文引用',
   parameters: mvpObject({ previous: REQUIREMENT_REPORT_SCHEMA, report: TRANSPORT_REQUIREMENT_REPORT_SCHEMA }), outputSchema: REQUIREMENT_REPORT_ENVELOPE_SCHEMA,
   run(input: { previous: RequirementReport; report: unknown }, proof) {
    proof.assertPreviousOutput(['requirement_normalize', 'requirement_clarify'], requirementReportEnvelope(input.previous));
    const sources = boundedSources(proof);
    return requirementReportEnvelope(validateRequirementClarification(input.previous, sources, resolveReportQuotes(sources, input.report, input.previous)));
   } }),
  mvpReadTool(ownerUserId, reader, { name: 'requirement_confirm', description: '核对用户已确认的完整报告、需求选择及冲突处理，输出可信需求范围',
   parameters: REQUIREMENT_CONFIRM_PARAMETERS, outputSchema: CONFIRMED_REQUIREMENTS_SCHEMA,
   run(input: RequirementConfirmParameters, proof) {
    proof.assertPreviousOutput(['requirement_normalize', 'requirement_clarify'], requirementReportEnvelope(input.report));
    const decision = proof.readConfirmation(input);
    return confirmRequirements(input.report, { reportDigest: requirementReportDigest(input.report), requirementIds: input.requirementIds,
     actorId: decision.actorId, decisionId: decision.decisionId, ...(input.resolvedConflicts !== undefined ? { resolvedConflicts: input.resolvedConflicts } : {}) });
   } }),
 ];
}
