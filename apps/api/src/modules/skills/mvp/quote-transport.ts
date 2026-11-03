import {
 mvpInvalid, parseMvpContract, REQUIREMENT_CANDIDATES_SCHEMA, REQUIREMENT_EXTRACTION_INPUT_SCHEMA,
 REQUIREMENT_REPORT_SCHEMA, validateRequirementClarification,
 type RequirementCandidate, type RequirementReport, type RequirementSource, type SourceQuote,
} from './requirements';

type TransportQuote = Omit<SourceQuote, 'start' | 'end'> & { start?: number; end?: number };
type TransportCandidate = Omit<RequirementCandidate, 'sources'> & { sources: TransportQuote[] };
type CandidateRelation = { kind: 'duplicate' | 'conflict'; leftIndex: number; rightIndex: number; reason: string };
type Candidates = { requirements: RequirementCandidate[]; relations: CandidateRelation[] };
type TransportCandidates = { requirements: TransportCandidate[]; relations: CandidateRelation[] };
type TransportReport = { requirements: Array<TransportCandidate & { id: string }>; relations: RequirementReport['relations'] };
type SchemaNode = { properties?: Record<string, SchemaNode>; items?: SchemaNode; required?: string[] };

/** Keep all canonical keys and quotas; only the computed offsets become optional in transit. */
function transportSchema(canonical: Record<string, unknown>): Record<string, unknown> {
 const schema = structuredClone(canonical);
 (schema as SchemaNode).properties!.requirements.items!.properties!.sources.items!.required = ['sourceId', 'quote'];
 return schema;
}
export const TRANSPORT_REQUIREMENT_CANDIDATES_SCHEMA = transportSchema(REQUIREMENT_CANDIDATES_SCHEMA);
export const TRANSPORT_REQUIREMENT_REPORT_SCHEMA = transportSchema(REQUIREMENT_REPORT_SCHEMA);

function checkedSources(input: unknown): RequirementSource[] {
 const { sources } = parseMvpContract<{ sources: RequirementSource[] }>(REQUIREMENT_EXTRACTION_INPUT_SCHEMA, { sources: input });
 if (new Set(sources.map(source => source.id)).size !== sources.length
  || sources.some(source => !source.id.trim() || !source.text.trim())) mvpInvalid('MVP_SOURCE_INVALID');
 return sources;
}

function resolveQuote(sources: RequirementSource[], ref: TransportQuote, previous: SourceQuote[] = []): SourceQuote {
 const source = sources.find(value => value.id === ref.sourceId);
 if (!source) return mvpInvalid('MVP_SOURCE_INVALID');
 if (ref.start !== undefined || ref.end !== undefined) {
  // A supplied bad range is an error, never an invitation to find a different occurrence.
  const { start, end } = ref;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start === undefined || end === undefined
   || start < 0 || start >= end || end > source.text.length || ref.quote.length !== end - start
   || source.text.slice(start, end) !== ref.quote) return mvpInvalid('MVP_SOURCE_INVALID');
  return { ...ref, start, end };
 }
 const start = source.text.indexOf(ref.quote);
 if (start < 0) return mvpInvalid('MVP_SOURCE_INVALID');
 if (source.text.indexOf(ref.quote, start + 1) < 0) return { ...ref, start, end: start + ref.quote.length };
 // Previous references have already passed the actual canonical validator against these sources.
 // Only this same requirement may retain its known occurrence; multiple old anchors still need offsets.
 const known = previous.filter(value => value.sourceId === ref.sourceId && value.quote === ref.quote);
 const anchors = new Map(known.map(value => [`${value.start}:${value.end}`, value]));
 if (anchors.size === 1) return { ...anchors.values().next().value! };
 return mvpInvalid('MVP_SOURCE_INVALID');
}

/** Returns canonical offsets; ID assignment and all business validation remain in the existing normalizer. */
export function resolveCandidateQuotes(inputSources: unknown, output: unknown): Candidates {
 const sources = checkedSources(inputSources);
 const candidates = parseMvpContract<TransportCandidates>(TRANSPORT_REQUIREMENT_CANDIDATES_SCHEMA, output);
 return { ...candidates, requirements: candidates.requirements.map(item => ({ ...item,
  sources: item.sources.map(ref => resolveQuote(sources, ref)) })) };
}

/** The old report must itself be canonical and source-valid before it can supply an anchor. */
export function resolveReportQuotes(inputSources: unknown, output: unknown, previous: RequirementReport): RequirementReport {
 const sources = checkedSources(inputSources);
 const before = validateRequirementClarification(previous, sources, previous);
 const report = parseMvpContract<TransportReport>(TRANSPORT_REQUIREMENT_REPORT_SCHEMA, output);
 return { ...report, requirements: report.requirements.map(item => ({ ...item,
  sources: item.sources.map(ref => resolveQuote(sources, ref, before.requirements.find(old => old.id === item.id)?.sources)) })) };
}
