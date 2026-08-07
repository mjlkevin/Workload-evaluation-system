# RP-047 Batch C 实施计划 — 异步 Run API 与可回放事件

- 日期：2026-08-07
- 编制：Codex 主会话（O3-C 计划编制）
- 范围基准（唯一）：`docs/superpowers/plans/2026-08-03-rp-047-post-a2-execution-roadmap.md` Task 3；
  API 契约基准：`docs/superpowers/specs/2026-08-02-rp-047-durable-multichannel-checkpoint-runtime-design.md` §11；
  治理口径：`03_技术设计/系统架构/WES-Agent-升级总看板/integrated-optimization-plan-2026-08-04.md` §5.3 阶段二 O3-C
- 前置：Gate B 审计通过并已合入 main（squash 提交 `1bd8477`，2026-08-07）
- 配套工单：`docs/agent-loop/work-orders/2026-08-07-qoder-RP-047-C.md`（16 节）

## 0. 范围映射（roadmap Task 3 ↔ 本计划）

| roadmap Task 3 步骤 | 原文要点 | 本计划章节 |
|---|---|---|
| Step 1 | 冻结 `POST /api/v1/ai-sessions/:sessionId/runs` 的 HTTP 202、`submissionKey`、`clientMessageId` 与响应 envelope 测试 | §2 契约冻结 / §5 C1 / §4-G1 |
| Step 2 | active Runs 列表、Run snapshot、SSE replay、cancel、inputs、confirm、retry 契约 | §2 / §5 C1–C3 |
| Step 3 | JWT + owner 隔离；猜测他人 runId 返回 404，不泄露存在性 | §4-G2 |
| Step 4 | SSE 支持 `after` 与 `Last-Event-ID`；连接关闭只释放连接，不触发 cancel 或 aborted | §4-G3 / §6.2 |
| Step 5 | Session 有非终态 Run 时硬删除返回 `409 SESSION_HAS_ACTIVE_RUN`；重命名/切换/普通归档不影响 Run | §4-G1 / §6.4 |
| Step 6 | 新接口受 feature flag 控制，旧同步入口继续可用；更新 OpenAPI 与实现对齐说明 | §3-D2 / §5-D / §4-G4 |
| Step 7 | 运行 route integration、Harness、modules、AI、API build；Gate C 独立验证重复提交、跨 owner、断线重连、取消、retry 与删除冲突 | §8 测试矩阵 / §4 |

**Gate C 完成定义（roadmap 原文，禁止缩水改写）**：API 契约、状态码、owner 安全、SSE 回放和断线不取消全部有集成测试；旧路径未被删除，feature flag 可关闭新入口。

## 1. 基线事实（2026-08-07 勘察）

### 1.1 主线与测试基线

- main = `1bd8477`（RP-047-B squash 合入）；工单 Assignment Commit 以两份派单文档提交后的
  `git log -1 -- docs/agent-loop/work-orders/2026-08-07-qoder-RP-047-C.md` 为准。
- 合入后 main 全量验证基线：test:harness **128/128**（0 fail 0 skip）、test:modules **255/255**、
  test:ai **242/242**、test:integration **1/1**、build:api / build:web 退出 0。
- Batch C 结束时各套件计数 = 基线 + 本批新增，既有测试零失败零跳过。

### 1.2 可复用的地基能力（Batch A2/B 已合入）

| 能力 | 位置 | 说明 |
|---|---|---|
| `createQueuedRun(input)` | `harness-runtime.repository.ts` | 已支持 `submissionKey`，返回 `{ run, created }`（重复提交幂等已在地基层） |
| `findRunForOwner(runId, ownerUserId)` | 同上 | owner 隔离读取的现成原语 |
| `requestRunCancel(input)` | 同上 | cancel 语义已有（Batch B T7b/T11 验证过取消优先与零写入） |
| `appendRunEvent / commitCheckpoint / upsertRunOutput` | 同上 | 事件序列与 sequence 分配已有 |
| schema 列 | `db/schema/harness.ts` | `submission_key`、`cancel_requested_at/by`、`retry_of_run_id`、`waiting` 状态、active workbench_chat 部分索引（L74）均已存在 |
| SSE 工具 | `utils/sse.ts` | `openSse` / `writeSse` / `createAbortBridge`；既有用例：`harness.controller.ts` eventsHandler、`handlers/workbench-chat-stream.handler.ts` |
| 事件词汇 | `harness-runtime.types.ts` | 12 类（含 Batch B E1 追加的 recovery_started/recovery_completed/run_cancelled），词汇测试守护 |
| Session 投影幂等 | `harness-session-projector.ts` | outbox deduplicationKey 机制已验证（T9a/T9b/T9c） |

### 1.3 缺口（Batch C 必须补齐）

1. **repository 无读取面**：无 events 按 sequence 读取、无 owner 维度 active runs 列表、无
   snapshot 聚合（当前 attempt/最近检查点/output）。SSE replay 与 snapshot 端点全部依赖这些读方法。
2. **无 feature flag 机制**：全仓无 `FEATURE*`/`WES_AI_*` 环境变量先例，Batch C 需新建。
3. **`clientMessageId` 未出现过**：契约新字段，需定义承载方式（见 D4）。
4. **Session 删除无 Run 检查**：`ai-sessions.usecase.ts` deleteAiSession 为 JSON 文件
   filter 硬删除，与规格 §11.3 冲突（ISS-2026-08-06-003 / risks 看板已登记）。
5. **openapi.yaml 无 ai-runs/ai-sessions 条目**：现有 136 条 path 仅覆盖 harness 旧域等。

### 1.4 既有边界（本批不得触碰）

- 旧 Harness 域：`harness.routes.ts`（含既有单次快照端点 `/harness/runs/:runId/events`）与
  `harness.controller/usecase/repository` —— 集成优化计划 §5.3 风险③冻结至 Batch C 交付，
  本批决定：**保持原样，不在 Batch C 改造**。
- 同步 AI 路径：`chat.service.ts`（26 行 barrel）、`services/ai/handlers/**`、
  `ai.routes.ts`（`/home-workbench/chat`、`/chat/stream`）、`workbench-dispatch.service.ts`
  （Batch B 已 additive 接入 AbortSignal，本批不再改）。
- `drizzle/**`：零迁移（见 D4/D7，全部需求可用现有 schema 承载）。

## 2. API 契约冻结（以规格 §11 为准）

所有接口 JWT 鉴权，响应 envelope `{ code, message, data }`，业务路由前缀 `/api/v1`。

### 2.1 提交任务

`POST /api/v1/ai-sessions/:sessionId/runs` → HTTP 202

```json
// 请求
{ "submissionKey": "uuid", "clientMessageId": "uuid", "content": "…", "attachmentIds": [], "workflowHint": "file_analysis" }
// 响应 data
{ "runId": "uuid", "sessionId": "…", "status": "queued", "eventCursor": 1 }
```

- 重复 `submissionKey` 返回同一 `runId`（幂等）。
- Session 不属于当前用户 → **404**（不泄露存在性）。
- 参数非法（缺 submissionKey/content 为空等）→ 422。

### 2.2 读取与动作（挂载 `/api/v1/ai-runs`）

| 端点 | 语义 | 关键状态码 |
|---|---|---|
| `GET /ai-runs?status=active` | 当前用户活跃任务列表（供 Shell 恢复） | 200 |
| `GET /ai-runs/:runId` | Run + 当前 attempt + 最近检查点 + output snapshot + 错误摘要 | 200 / 404（非 owner） |
| `GET /ai-runs/:runId/events?after=<seq>` | 可回放 SSE；支持 `Last-Event-ID` | 200（SSE）/ 404 |
| `POST /ai-runs/:runId/cancel` | 明确取消 | 202 / 404 / 409（已终态） |
| `POST /ai-runs/:runId/inputs` | 为 `waiting` Run 提交补充信息并继续同一 Run | 202 / 404 / 409（非 waiting） |
| `POST /ai-runs/:runId/actions/:actionId/confirm` | 复用确认闸门语义，幂等确认后继续 | 200/202 / 404 / 409 |
| `POST /ai-runs/:runId/retry` | 仅终态 `failed` 可重试；新建带 `retryOfRunId` 的 Run，原 Run 不可变 | 202 / 404 / 409（非 failed 终态） |

### 2.3 Session 删除规则（规格 §11.3）

- 重命名、切换、普通归档不影响 Run。
- 存在非终态 Run（queued/running/waiting/recovering/cancelling）时硬删除返回
  `409 SESSION_HAS_ACTIVE_RUN`。

## 3. 设计决策（D1–D8）

| # | 决策 | 结论与理由 |
|---|---|---|
| D1 | repository 读方法扩展 | roadmap Task 3 文件清单未列 `harness-runtime.repository.ts`，但 SSE replay/snapshot/active 列表必须有读取面。**范围澄清**：允许对该文件 **additive** 扩展（新增读方法与 inputs/confirm/retry 事务方法；既有方法签名与 Batch B R 系行为零修改），并同步扩展其测试文件。 |
| D2 | feature flag | 新建环境变量 `WES_AI_DURABLE_RUNS_ENABLED`（默认 `false`，与 roadmap Batch E Step 3 同名同语义，Batch E 复用不重造）。关闭时：`/ai-runs/*` 与 `POST …/runs` 返回 `503 ASYNC_RUNS_DISABLED`；Session 删除 409 检查不启用（保持既有行为）。开启时契约全量生效。读取点收敛在 usecase/controller 工厂入参，不散落。 |
| D3 | Worker 不 boot-start | Batch C **不**在应用启动时拉起 Worker/Recovery/Projector（防"半激活 API"，roadmap Batch E Step 3 口径）。提交的 Run 保持 `queued`，直到 Batch E 灰度启用。Gate C 集成测试用 fake workflow registry + 测试内驱动的 Worker 证明全链路。 |
| D4 | clientMessageId 承载 | **零 DB 列**：随 `createQueuedRun` 的 `metadata.clientMessageId` 承载并原样可回读；提交幂等主键是 `submissionKey`（DB 唯一），clientMessageId 供前端乐观 UI 对齐，不承担 DB 层去重语义。二者关系在 openapi 描述中写明。 |
| D5 | 删除 409 实现位置 | owner 归 `ai-sessions.usecase.ts`（roadmap 指定）：`deleteAiSession` 增加**可选** deps 参数（`activeRunChecker?: (sessionId) => Promise<boolean>`），缺省保持同步旧行为（向后兼容）；routes 层按 flag 注入真实 checker（经 harness module 暴露的读 API）。controller 相应做 async 适配。 |
| D6 | SSE 行为细节 | 游标 = 事件 `sequence`；`Last-Event-ID` 头优先于 `after` 查询参数；每 15s 心跳 comment 保活；单次回放批量上限 200 条（均可注入）；Run 终态且事件排空后发送终态事件并主动关闭；`req.on("close")` 只释放连接资源，**禁止**调用 cancel 或写 aborted。 |
| D7 | inputs/confirm 续跑语义 | waiting Run 收到 inputs/confirm：repository 事务内 append 事件 + `waiting→queued`；Worker 后续认领从最近兼容检查点继续（Batch B 恢复路径，不在本批重造）。retry 走 `createQueuedRun` 附加 `retryOfRunId`（input 类型 additive 扩展，schema 列已存在）。 |
| D8 | openapi/对齐说明范围 | openapi.yaml 新增本批 8 个端点 + 所需 component schemas；**不回填**既有 ai-sessions/harness 旧域条目（防范围蔓延）。`实现与文档对齐说明.md` §3 增补 AI Runs 小节并声明 flag 语义。 |

## 4. Gate C 审计合同（四条，逐条分解）

> Gate C 完成定义（roadmap 原文）：API 契约、状态码、owner 安全、SSE 回放和断线不取消全部有集成测试；旧路径未被删除，feature flag 可关闭新入口。

### G1 API 契约与状态码全部有集成测试

- `POST …/runs`：202 envelope；重复 submissionKey 返回同一 runId（created=false）；
  缺字段/空 content 422；session 非 owner 404。
- snapshot/list/cancel/inputs/confirm/retry 状态码矩阵（§2.2 表）逐条有测试：
  cancel 已终态 409；inputs 非 waiting 409；confirm 幂等（二次确认不重复事件）；
  retry 仅 failed 终态允许，新 Run 带 retryOfRunId 且原 Run 行零变更。
- Session 删除：有非终态 Run → `409 SESSION_HAS_ACTIVE_RUN`；无活跃 Run 删除成功；
  重命名不受影响。

### G2 owner 安全

- 全部端点 JWT 强制；跨 owner 读取/动作一律 404，且响应体不泄露资源存在性
  （同一 runId：owner 得 200/202，非 owner 得 404）。
- SSE 端点同样鉴权：非 owner 订阅在握手阶段 404，不建立事件流。
- 列表端点只返回当前 owner 的 Run（构造双用户数据断言互不可见）。

### G3 SSE 回放与断线不取消

- `after=<seq>` 从游标续读：断点前后的事件不丢不重（sequence 严格递增断言）。
- `Last-Event-ID` 与 `after` 双通道一致性测试。
- 客户端中断连接后：Run 状态不变（无 cancel_requested、无 run_cancelled 事件、
  无 aborted 类状态写入）；重连后事件可继续回放。
- 终态 Run：回放排空后连接正常关闭。

### G4 旧路径未删除 + feature flag 可关闭新入口

- flag 关闭：新端点 503 `ASYNC_RUNS_DISABLED`；Session 删除保持旧行为（200/false 语义不变）。
- 既有回归零退化：test:ai（含 workbench-routing.snapshot 快照集与 handlers 单测）、
  test:modules、test:harness 既有测试全绿；`/home-workbench/chat`、`/chat/stream`、
  `/harness/*` 旧域代码零 diff。
- flag 开启/关闭两态均有集成测试覆盖。

## 5. 实施步骤（RED 先行，C1→C2→C3）

### C1 提交与读取（契约骨架 + flag + 409）

1. RED：先落 `ai-runs.routes.test.ts` 与 usecase/controller 测试中 C1 部分
   （202 契约、submissionKey 幂等、404/422、flag 503、删除 409），观察失败。
2. repository additive：`listActiveRunsForOwner`、`getRunSnapshot`（attempt+最近检查点+output）、
   `hasActiveRunForSession`；`createQueuedRun` input 追加可选 `retryOfRunId`。
3. usecase/controller：提交（校验 session owner → createQueuedRun → 202 envelope）、
   列表、snapshot；flag 读取收敛。
4. ai-sessions：D5 可选 checker 接线；`POST /:sessionId/runs` 挂 `ai-sessions.routes.ts`。
5. `routes/index.ts` 挂 `/ai-runs`。

### C2 SSE 回放

6. RED：断线不取消、after/Last-Event-ID 续读、终态关闭测试先行。
7. repository additive：`listRunEventsAfter(runId, afterSequence, limit)`。
8. controller：基于 `utils/sse.ts` 实现回放循环（批量 200、心跳 15s、终态关闭），
   `req.on("close")` 只清理连接。

### C3 动作与文档

9. RED：cancel/inputs/confirm/retry 状态矩阵与跨 owner 404 先行。
10. repository additive：`submitRunInput`（事件+waiting→queued 事务）、
    `confirmRunAction`（幂等确认事务）、retry 复用 createQueuedRun。
11. types additive：E1 事件词汇追加（见 §7-E1），词汇测试同步扩展。
12. openapi.yaml 新端点 + schemas；`实现与文档对齐说明.md` §3 增补；handoff 落盘。

## 6. 关键参数冻结

| 参数 | 值 | 说明 |
|---|---|---|
| feature flag | `WES_AI_DURABLE_RUNS_ENABLED`，默认 `false` | 与 roadmap Batch E Step 3 同名 |
| SSE 心跳 | 15s（可注入） | comment 帧保活 |
| 回放批量上限 | 200 条/轮（可注入） | 防大 Run 一次性加载 |
| 关闭时错误码 | `ASYNC_RUNS_DISABLED`（503） | flag 关闭统一口径 |
| 删除冲突错误码 | `SESSION_HAS_ACTIVE_RUN`（409） | 规格 §11.3 原文 |
| Batch B 时序常量 | 零修改 | 45s/15s/10s/3 次/2-10-30s 由 types 测试守护 |

## 7. 扩展项登记（执行会话越界前必须声明的口子）

| # | 扩展项 | 预授权范围 |
|---|---|---|
| E1 | 事件词汇 additive | 至多追加 `run_inputs_submitted`、`run_action_confirmed` 两个事件类型；既有 12 类零修改；词汇测试守护 |
| E2 | `apps/api/package.json` | 仅 `test:harness` 枚举追加新测试文件；依赖与 lockfile 零变更 |
| E3 | 环境变量 | 仅新增 `WES_AI_DURABLE_RUNS_ENABLED` 读取；不改 `.env*` 已提交内容 |
| E4 | 其他 | 不预授权。需要 DB 迁移、新依赖、前端改动、Worker boot-start 时停止并回填疑点 |

## 8. 测试矩阵（Gate C 验证套件）

| 层 | 内容 | 挂载 |
|---|---|---|
| 契约 RED/GREEN | usecase/controller 单测（flag 双态、幂等、状态矩阵） | test:harness（E2 追加） |
| 路由集成 | `ai-runs.routes.test.ts`（supertest + 真实 PG，跨 owner、SSE、409） | test:harness（E2 追加） |
| repository | 新增读方法与事务方法的真实 PG 测试 | test:harness（既有文件扩展） |
| 回归 | test:modules 255、test:ai 242（含快照集）、test:integration 1 全绿 | 既有枚举零变更 |
| 构建 | build:api / build:web 退出 0 | — |
| 边界 | `git diff --check`、双 lockfile 零变更、`drizzle/**` 零 diff、容器无新增长期项 | — |

## 9. 风险与已知缺口

1. **端到端人工验收仍缺**：Batch C 交付后 API 可用但 Worker 不 boot-start（D3），
   真实 chat→Run→恢复→投影全链路要等 Batch E 灰度；Batch D 前端联调阶段可提前局部走通。
2. **SSE 长连接资源**：回放循环轮询 DB，多连接场景未做压测；以批量上限+心跳控制，
   压测归 Batch E 容量观察（roadmap Task 5 Step 4/5）。
3. **openapi 未回填旧域**：ai-sessions/harness 旧域条目仍缺，属既有债务，
   本批不扩大范围，对齐说明中声明。
4. **flag 双态复杂度**：删除 409 与端点可用性均随 flag 变化，测试必须覆盖双态，
   防止 Batch E 启用时行为漂移。

## 10. 分批建议

- **方案 A（默认）**：单批执行 C1→C2→C3，一次 handoff、一次 Gate C。粗估 20–25h
  （集成优化计划 §5.3 口径），与 Batch B 单批执行先例一致。
- **方案 B（可选）**：拆 C1（提交/读取/flag/409）、C2（SSE）、C3（动作/文档）三小批，
  每小批独立 handoff。**注意：拆批不缩水 Gate C —— 最终审计仍按 §4 四条全量执行**，
  中间小批只做范围与 RED 证据核验。
- 批准派单时由用户选定；未指定按方案 A。

## 11. 疑点清单（编制自查，供复核裁决）

| # | 疑点 | 编制会话倾向 |
|---|---|---|
| D1' | repository 扩展超出 roadmap 文件清单 | 已按"范围澄清"处理：additive only + 既有行为零修改 + 测试守护；工单 §7 显式列出 |
| D2' | flag 默认值 false 意味着合入后生产无新能力 | 有意为之（灰度安全）；Batch E 负责启用与回滚演练 |
| D3' | confirm 端点与旧域 `/harness/runs/:runId/actions/:actionId/confirm` 并存 | 两套互不影响：旧域服务旧 Harness Run，新端点服务 durable Run；openapi 描述中写明区分 |
| D4' | `waiting` 状态当前无生产写入方（Batch B fake workflow 之外） | 契约先行：inputs/confirm 的 409 非 waiting 分支照样可测（直接造 waiting 行）；真实 waiting 写入归 Batch D/E 工作流 |
| D5' | 测试文件挂载 test:harness 而非 test:modules | ai-runs 路由测试依赖 testcontainers PG 与 concurrency=1，与 harness.routes.test.ts 同性质；E2 仅追加枚举 |

## 12. 与看板/治理文档的关系

- 本计划与工单提交后：plan.html 状态推进"Batch C 工单已编制待派单"；changes.html 记编制事件。
- 执行与 Gate C 阶段的看板同步由主会话负责；执行会话禁改看板（工单 §8/§14）。
- Batch C 完成定义中"更新实现对齐说明"是 roadmap Step 6 原文要求，已列入 Allowed Paths
  与 C3 步骤，属执行会话交付物。
