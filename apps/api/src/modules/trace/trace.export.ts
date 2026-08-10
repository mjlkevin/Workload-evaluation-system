// ============================================================
// O7 · Trace 导出模块 — PG → Langfuse NDJSON
// ============================================================
// 从 traces 表读取 → 经映射函数 → 输出 NDJSON（Langfuse batch ingest 格式）。
// 不碰生产路由，纯脚本模块。不引入 Langfuse SDK。
// ============================================================

import { toLangfuseTrace, type LangfuseTrace } from "./trace.langfuse";
import type { TraceRecord } from "./trace.types";

/**
 * 将一组 TraceRecord 转换为 Langfuse batch ingest NDJSON 字符串。
 * 每行一个 LangfuseTrace JSON 对象。
 */
export function tracesToLangfuseNdjson(traces: TraceRecord[]): string {
  const lines = traces.map((trace) => {
    const lfTrace = toLangfuseTrace(trace);
    return JSON.stringify(lfTrace);
  });
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

/**
 * 将单个 TraceRecord 转换为 Langfuse batch ingest JSON 对象。
 * 可用于 POST /api/public/ingestion 批量提交。
 */
export function traceToLangfuseIngestEvent(trace: TraceRecord): {
  type: "trace-create";
  body: LangfuseTrace;
} {
  return {
    type: "trace-create" as const,
    body: toLangfuseTrace(trace),
  };
}

/**
 * 将一组 TraceRecord 转换为 Langfuse batch ingest 事件数组。
 * 包含 trace-create 事件和对应的 observation-create 事件。
 */
export function tracesToLangfuseBatchEvents(traces: TraceRecord[]): Array<
  | { type: "trace-create"; body: LangfuseTrace }
  | { type: "observation-create"; body: { id: string; traceId: string; parentObservationId?: string; type: string; name: string; startTime: string; endTime?: string; metadata: Record<string, unknown>; level: string; statusMessage?: string; model?: string; usage?: { input: number; output: number; total: number; unit?: string } } }
> {
  const events: Array<Record<string, unknown>> = [];

  for (const trace of traces) {
    const lfTrace = toLangfuseTrace(trace);

    // trace-create 事件（不含 observations，分开提交）
    events.push({
      type: "trace-create",
      body: {
        id: lfTrace.id,
        name: lfTrace.name,
        sessionId: lfTrace.sessionId,
        userId: lfTrace.userId,
        input: lfTrace.input,
        tags: lfTrace.tags,
        metadata: lfTrace.metadata,
        timestamp: lfTrace.timestamp,
      },
    });

    // observation-create 事件
    for (const obs of lfTrace.observations) {
      events.push({
        type: "observation-create",
        body: {
          id: obs.id,
          traceId: lfTrace.id,
          ...(obs.parentObservationId ? { parentObservationId: obs.parentObservationId } : {}),
          type: obs.type,
          name: obs.name,
          startTime: obs.startTime,
          ...(obs.endTime ? { endTime: obs.endTime } : {}),
          metadata: obs.metadata,
          level: obs.level,
          ...(obs.statusMessage ? { statusMessage: obs.statusMessage } : {}),
          ...(obs.model ? { model: obs.model } : {}),
          ...(obs.usage ? { usage: obs.usage } : {}),
        },
      });
    }
  }

  return events as Array<
    | { type: "trace-create"; body: LangfuseTrace }
    | { type: "observation-create"; body: { id: string; traceId: string; parentObservationId?: string; type: string; name: string; startTime: string; endTime?: string; metadata: Record<string, unknown>; level: string; statusMessage?: string; model?: string; usage?: { input: number; output: number; total: number; unit?: string } } }
  >;
}

/**
 * 将一组 TraceRecord 转换为 Langfuse batch ingest NDJSON 字符串。
 * 每行一个 ingest event JSON 对象（trace-create 或 observation-create）。
 */
export function tracesToLangfuseBatchNdjson(traces: TraceRecord[]): string {
  const events = tracesToLangfuseBatchEvents(traces);
  const lines = events.map((event) => JSON.stringify(event));
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}
