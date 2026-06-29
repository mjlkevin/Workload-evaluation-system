// ============================================================
// RP-030 · Trace Module Export
// ============================================================

export {
  listTracesHandler,
  getTraceHandler,
} from "./trace.controller";

export {
  recordWorkbenchTurnTrace,
  appendHarnessSpan,
  getTraceById,
  queryUserTraces,
  purgeOldTraces,
} from "./trace.usecase";

export {
  createTraceRecord,
  createTraceId,
  createSpanId,
  appendTraceSpan,
  redactSensitiveFields,
  TRACE_SPAN_TYPES,
  TRACE_SPAN_STATUSES,
  TRACE_SOURCE_DOMAINS,
  TRACE_REDACTED_FIELD_PATTERNS,
} from "./trace.types";

export type {
  TraceRecord,
  TraceSpanData,
  TraceSpanType,
  TraceSpanStatus,
  TraceSourceDomain,
  TraceQueryFilter,
  TraceQueryResult,
  TraceStore,
} from "./trace.types";

export {
  insertTraceRecord,
  findTraceById,
  queryTraces,
  updateTraceRecord,
  purgeTracesOlderThan,
} from "./trace.repository";
