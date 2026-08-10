# 工单 · O7：Trace 观测演进映射（自研 trace ↔ Langfuse 模型映射表 + PG 迁移 PoC）

> 状态：**已派发 KIMIK3（2026-08-10 Sprint 4 开工批准）**
> 类型：spike/PoC（P2 可观测性）· 来源：SP-2026-003 映射
> 交叉引用：O3（Harness 持久执行通道，已交付，trace 表已存在）/ ISS-2026-08-05-001（凭据域 DB 化，在途，PG 迁移经验可共享）
> base：`a0cfcf5`（main HEAD）
> 分支：`qoder/sprint4-o7-trace-langfuse-mapping` · worktree：`/Users/kevin/AI/wes-worktrees/sprint4-o7`

---

## 1. 业务目标

建立自研 trace 数据模型（`traces` 表已存在，`json_runtime.ts` L219-237）与 Langfuse 观测平台数据模型的双向映射表，证明 PG 迁移可行性，**不部署 Langfuse 平台**（纯模型映射 + 导出脚本 PoC）。

## 2. 现状（已取证）

- `apps/api/src/db/schema/json_runtime.ts` 已定义 `traces` 表（traceId PK、sourceDomain、spans jsonb、summary jsonb 等）；
- `apps/api/src/modules/trace/` 已有 controller/usecase/repository/types 五文件，types 定义了 TRACE_SPAN_TYPES / TRACE_SPAN_STATUSES / TRACE_SOURCE_DOMAINS；
- **Langfuse 零引用**：仓库无 langfuse SDK、无相关配置；
- 凭据域 DB 化（ISS-2026-08-05-001）正在做第二个 PG 迁移，经验可复用。

## 3. 方案（PoC 范围，不部署平台）

### 3.1 模型映射表（文档 + 代码类型）
- `docs/agent-loop/trace-langfuse-mapping.md`：自研 trace 字段 ↔ Langfuse trace/observation/span 模型对照表（字段名、类型、必填、映射规则、不可映射字段说明）；
- `apps/api/src/modules/trace/trace.langfuse.ts`：类型定义 + 序列化/反序列化函数（`toLangfuseTrace(selfTrace) → LangfuseTrace`、`fromLangfuseTrace(lfTrace) → Partial<SelfTrace>`）；
- 覆盖 spans 数组映射（自研 `TraceSpan[]` → Langfuse `observations[]`）、状态码映射、sourceDomain → Langfuse `tags`。

### 3.2 PG 迁移 PoC（可选导出脚本）
- `apps/api/src/modules/trace/trace.export.ts`：从 `traces` 表读取 → 经映射函数 → 输出 NDJSON（Langfuse batch ingest 格式）；
- 命令行入口：`npx tsx scripts/export-traces-to-langfuse.ts --session <id> --output <file>`（不碰生产路由，纯脚本）；
- 验证：导出脚本跑通 + 输出 JSON 通过 Langfuse 官方 schema 校验（可用在线文档或轻量 JSON Schema）。

### 3.3 明确禁止
1. 禁止引入 Langfuse SDK 为生产依赖（仅 dev 文档引用）；
2. 禁止改 traces 表结构（现有 schema 不动，映射层处理差异）；
3. 禁止部署任何外部平台或改路由/接口契约；
4. 禁止碰凭据域、流式通道、前端、看板。

## 4. Allowed Paths

1. `docs/agent-loop/trace-langfuse-mapping.md`（新增）
2. `apps/api/src/modules/trace/trace.langfuse.ts`（新增）
3. `apps/api/src/modules/trace/trace.langfuse.test.ts`（新增）
4. `apps/api/src/modules/trace/trace.export.ts`（新增）
5. `scripts/export-traces-to-langfuse.ts`（新增）

## 5. RED（≥2，PoC 性质）

1. **映射完整性**：自研 `TraceSpan` 全字段在 Langfuse 模型中有对应或显式标注「不可映射」——base 应红（无映射文件）；
2. **导出可运行**：导出脚本对现有 traces 表数据执行不报错、输出 NDJSON 结构通过 Langfuse schema 校验——base 应红（无脚本）。

## 6. 验证矩阵

- `npm run build:api`：零错误（新增类型文件须编译通过）
- `npx tsx --test trace.langfuse.test.ts`：映射用例全过
- `npx tsx scripts/export-traces-to-langfuse.ts --help`：脚本可运行（无真实 Langfuse 服务端也可本地验证输出格式）
- `git diff a0cfcf5`：全落 §4

## 7–9. 分支 / Handoff / 验收

- 分支 `qoder/sprint4-o7-trace-langfuse-mapping`；
- handoff 须附映射文档全文 + 导出脚本运行录屏/输出样例；
- 验收：映射表评审通过 + 导出脚本跑通 + 输出 JSON 结构正确。
