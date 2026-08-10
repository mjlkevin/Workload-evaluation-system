# 自研 Trace ↔ Langfuse 模型映射表

> 工单：O7 · Sprint 4 · PoC  
> 日期：2026-08-10  
> 状态：**已实现，待评审**  
> 禁止：引入 Langfuse SDK 生产依赖 / 修改 traces 表结构 / 部署 Langfuse 平台

---

## 1. 概述

本文档定义自研 trace 数据模型（`TraceRecord` / `TraceSpanData`，定义于 `apps/api/src/modules/trace/trace.types.ts`）与 [Langfuse](https://langfuse.com) 观测平台数据模型（Trace / Observation）的双向字段映射关系。

映射实现位于 `apps/api/src/modules/trace/trace.langfuse.ts`，提供：
- `toLangfuseTrace(trace: TraceRecord) → LangfuseTrace` — 正向映射
- `fromLangfuseTrace(lfTrace: LangfuseTrace) → Partial<TraceRecord>` — 反向映射（PoC）
- `toLangfuseObservation(span: TraceSpanData) → LangfuseObservation` — Span 级映射

---

## 2. Trace 级映射（TraceRecord ↔ LangfuseTrace）

| 自研字段 | 类型 | Langfuse 字段 | 类型 | 必填 | 映射规则 |
|---|---|---|---|---|---|
| `traceId` | `string` | `id` | `string` | ✅ | 直接映射 |
| `sourceDomain` | `TraceSourceDomain` | `tags` | `string[]` | ✅ | `tags = [sourceDomain]` |
| `sourceId` | `string?` | `sessionId` | `string?` | ❌ | 直接映射 |
| `ownerUserId` | `string` | `userId` | `string?` | ❌ | 直接映射 |
| `userInputSummary` | `string?` | `input` | `unknown?` | ❌ | 直接映射 |
| `createdAt` | `string` | `timestamp` | `string` | ✅ | 直接映射（ISO 8601） |
| `spans` | `TraceSpanData[]` | `observations` | `LangfuseObservation[]` | ✅ | 逐条映射（见 §3） |
| —（自动生成） | — | `name` | `string` | ✅ | `${sourceDomain}_${sourceId ?? "unknown"}` |
| —（无对应） | — | `output` | `unknown?` | ❌ | 不映射（自研 trace 无 output 字段） |

### 2.1 不可映射字段 → metadata

以下自研字段在 Langfuse 标准模型中无对应，映射到 `trace.metadata`：

| 自研字段 | 类型 | metadata key | 说明 |
|---|---|---|---|
| `requestId` | `string?` | `requestId` | HTTP 请求关联 ID，Langfuse 无标准字段 |
| `ownerUsername` | `string` | `ownerUsername` | Langfuse 只有 userId，无 username |
| `intentResult.intent` | `string` | `intent` | 意图路由结果 |
| `intentResult.confidence` | `number` | `confidence` | 意图置信度 |
| `intentResult.routingRule` | `string` | `routingRule` | 路由规则名 |
| `summary` | `object` | `summary` | 汇总统计对象（totalDurationMs, spanCount, totalTokens, hasError, hasDegradation） |

---

## 3. Span 级映射（TraceSpanData ↔ LangfuseObservation）

| 自研字段 | 类型 | Langfuse 字段 | 类型 | 必填 | 映射规则 |
|---|---|---|---|---|---|
| `spanId` | `string` | `id` | `string` | ✅ | 直接映射 |
| `parentSpanId` | `string?` | `parentObservationId` | `string?` | ❌ | 直接映射 |
| `name` | `string` | `name` | `string` | ✅ | 直接映射 |
| `startedAt` | `string` | `startTime` | `string` | ✅ | 直接映射 |
| `endedAt` | `string?` | `endTime` | `string?` | ❌ | 直接映射 |
| `spanType` | `TraceSpanType` | `type` | `LangfuseObservationType` | ✅ | 见 §3.1 映射表 |
| `status` | `TraceSpanStatus` | `level` | `LangfuseLevel` | ✅ | 见 §3.2 映射表 |
| `tokenUsage` | `object?` | `usage` | `LangfuseUsage?` | ❌ | `{input: promptTokens, output: completionTokens, total: totalTokens, unit: "TOKENS"}` |
| `modelInfo.model` | `string?` | `model` | `string?` | ❌ | 直接映射 |
| `error.message` | `string?` | `statusMessage` | `string?` | ❌ | 错误信息映射到 statusMessage |

### 3.1 spanType → observation type 映射

| 自研 spanType | Langfuse observation type | 说明 |
|---|---|---|
| `model_call` | `generation` | Langfuse 中模型调用使用 generation 类型 |
| `write_action` | `event` | 写动作是一个离散事件 |
| `user_confirmation` | `event` | 人工确认是一个离散事件 |
| `degradation` | `event` | 降级事件 |
| `intent_routing` | `span` | 路由判定 |
| `knowledge_retrieval` | `span` | 检索操作 |
| `tool_call` | `span` | 工具调用 |
| `artifact_generation` | `span` | 产物生成 |

### 3.2 status → level 映射

| 自研 status | Langfuse level | 说明 |
|---|---|---|
| `failed` | `ERROR` | 失败 → 错误级别 |
| `degraded` | `WARNING` | 降级 → 警告级别 |
| `cancelled` | `WARNING` | 取消 → 警告级别 |
| `started` | `DEFAULT` | 默认级别 |
| `running` | `DEFAULT` | 默认级别 |
| `completed` | `DEFAULT` | 默认级别 |

### 3.3 不可映射字段 → observation metadata

| 自研字段 | 类型 | metadata key | 说明 |
|---|---|---|---|
| `spanType` | `TraceSpanType` | `spanType` | 原始 span 类型，保留用于反向映射 |
| `contextRefs` | `string[]` | `contextRefs` | 上下文引用列表 |
| `attributes` | `Record<string, unknown>` | （展开合并） | 扩展属性直接展开到 metadata |
| `durationMs` | `number?` | `durationMs` | Langfuse 从 startTime/endTime 计算，但保留原始值 |
| `degradation` | `object?` | `degradation` | 降级信息（reason + fallbackTo） |
| `error.code` | `string?` | `errorCode` | 错误代码 |
| `error.retryable` | `boolean?` | `retryable` | 是否可重试 |
| `modelInfo.provider` | `string?` | `provider` | 模型提供商 |
| `modelInfo.finishReason` | `string?` | `finishReason` | 完成原因 |
| `modelInfo.attempts` | `number?` | `attempts` | 尝试次数 |

---

## 4. 反向映射（Langfuse → 自研 Trace）

`fromLangfuseTrace(lfTrace: LangfuseTrace) → Partial<TraceRecord>` 提供 PoC 级反向映射：

| Langfuse 字段 | 自研字段 | 说明 |
|---|---|---|
| `id` | `traceId` | 直接映射 |
| `tags[0]`（匹配已知域） | `sourceDomain` | 从 tags 中查找已知 sourceDomain |
| `sessionId` | `sourceId` | 直接映射 |
| `userId` | `ownerUserId` | 直接映射 |
| `input`（string 时） | `userInputSummary` | 类型守卫后映射 |
| `timestamp` | `createdAt` | 直接映射 |
| `observations[]` | `spans[]` | 逐条反向映射 |
| `metadata.requestId` | `requestId` | 从 metadata 取回 |
| `metadata.ownerUsername` | `ownerUsername` | 从 metadata 取回 |
| `metadata.intent` | `intentResult.intent` | 从 metadata 重建 intentResult |
| `metadata.confidence` | `intentResult.confidence` | 同上 |
| `metadata.routingRule` | `intentResult.routingRule` | 同上 |
| `metadata.summary` | `summary` | 从 metadata 取回 |

### 4.1 反向映射的局限

- `sourceDomain` 反向映射仅支持已知域（`ai_session` / `harness_run` / `agent_runtime`），未匹配时为 `undefined`
- `status` 反向映射（`levelToStatus`）为有损映射：`WARNING` → `degraded`（原始可能是 `cancelled`）
- `spanType` 从 `metadata.spanType` 取回，缺失时默认为 `tool_call`

---

## 5. NDJSON 导出格式

### 5.1 simple 格式

每行一个 `LangfuseTrace` JSON 对象：

```jsonl
{"id":"trace-001","name":"ai_session_sess-001","sessionId":"sess-001","userId":"user-001","input":"帮我评估","tags":["ai_session"],"metadata":{"intent":"workbench_turn"},"timestamp":"2026-08-10T12:00:00.000Z","observations":[...]}
```

### 5.2 batch 格式（默认）

每行一个 Langfuse batch ingest event，包含 `trace-create` 和 `observation-create` 两种类型：

```jsonl
{"type":"trace-create","body":{"id":"trace-001","name":"ai_session_sess-001","sessionId":"sess-001",...}}
{"type":"observation-create","body":{"id":"span-001","traceId":"trace-001","type":"span","name":"intent-routing","startTime":"2026-08-10T12:00:00.000Z","level":"DEFAULT",...}}
{"type":"observation-create","body":{"id":"span-002","traceId":"trace-001","parentObservationId":"span-001","type":"generation","name":"model-call","startTime":"2026-08-10T12:00:00.000Z","level":"DEFAULT","model":"kimi-k2","usage":{"input":100,"output":50,"total":150,"unit":"TOKENS"},...}}
```

batch 格式可直接通过 `POST /api/public/ingestion` 提交到 Langfuse 平台。

---

## 6. 导出脚本使用

```bash
# 导出全量 trace（batch 格式到 stdout）
npx tsx scripts/export-traces-to-langfuse.ts

# 按 session 过滤，输出到文件
npx tsx scripts/export-traces-to-langfuse.ts --session sess-001 --output traces.ndjson

# 从 PG 读取，simple 格式
npx tsx scripts/export-traces-to-langfuse.ts --source pg --format simple --limit 50

# 查看帮助
npx tsx scripts/export-traces-to-langfuse.ts --help
```

---

## 7. 数据安全

- trace 数据在写入时已通过 `redactSensitiveFields()` 脱敏（apiKey/token/secret/password 等字段替换为 `[REDACTED]`）
- 导出脚本不额外处理敏感字段，依赖上游脱敏保证
- NDJSON 输出不包含 Langfuse SDK 依赖，纯 JSON 格式

---

## 8. 文件清单

| 文件 | 说明 |
|---|---|
| `apps/api/src/modules/trace/trace.langfuse.ts` | 类型定义 + 双向映射函数 |
| `apps/api/src/modules/trace/trace.langfuse.test.ts` | 映射完整性测试（20 用例） |
| `apps/api/src/modules/trace/trace.export.ts` | NDJSON 导出模块 |
| `scripts/export-traces-to-langfuse.ts` | 命令行导出脚本 |
| `docs/agent-loop/trace-langfuse-mapping.md` | 本文档 |
