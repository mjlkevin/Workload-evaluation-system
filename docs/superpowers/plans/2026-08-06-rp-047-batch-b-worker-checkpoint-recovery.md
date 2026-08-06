# RP-047 Batch B 实施计划 · Worker、检查点与恢复协调器

date: 2026-08-06
requirement: RP-047
batch: O3-B / Batch B
taskClass: implementation-plan
author: 计划编制会话（代行 Codex 工单编制职责）
scopeBasis: `docs/superpowers/plans/2026-08-03-rp-047-post-a2-execution-roadmap.md` Task 2 与 Gate B 原文（唯一范围基准）
approvedDesign: `docs/superpowers/specs/2026-08-02-rp-047-durable-multichannel-checkpoint-runtime-design.md`
status: `DRAFT / 待主会话复核`
companionWorkOrder: `docs/agent-loop/work-orders/2026-08-06-qoder-RP-047-B.md`

> 本计划为纯文档交付，不含任何代码改动。范围基准零漂移：每一节实施内容均对应 roadmap Task 2 原文条款；超出条款的内容一律在 §17「扩展项登记表」中显式标注并说明理由，未经主会话确认不得实施。

---

## 0. 范围基准与开工前事实冻结

roadmap Task 2（Batch B）原文条款共 8 步，本计划的章节映射如下：

| roadmap 条款 | 本计划章节 |
|---|---|
| Step 2：fake workflow/provider 先写四类崩溃 RED | §11、§12 |
| Step 3：Worker 认领、45s lease、15s heartbeat、优雅停机与硬退出后租约过期 | §3 |
| Step 4：10s Recovery Coordinator、最多 3 次自动恢复、2/10/30s 退避、`RECOVERY_LIMIT_EXCEEDED` | §4 |
| Step 5：structural + semantic 混合检查点；模型流中断从 `model_input_ready` 重做，不拼接中断文本 | §5 |
| Step 6：稳定 `effectKey` + outbox deduplication key，工具副作用与 Session 消息投影不重复 | §6、§7 |
| Step 7：接入现有 workbench dispatch 时传递服务端 `AbortSignal`，不改前端与现有同步 API | §8 |
| Step 8：focused fault-injection、Testcontainers Harness、`test:modules`、`test:ai`、API/Web build | §15 |

开工前事实（2026-08-06 本会话只读核对）：

- 业务主线为 `main`，HEAD = `e20e2c6`；A2 已合入主线（集成记录提交 `21239d9`，A2 集成候选 `88054d5` 是 `main` HEAD 的祖先）。
- roadmap §0 记载的业务主线 `codex/role-driven-ai-home-workbench @ cd02e8d` 在本地仓库已不存在；工单 baseCommit 以「开工时 `main` HEAD」为准（见 §18 疑点 D2）。
- 主 checkout 当前存在大量未提交修改（看板 HTML、`AGENTS.md`、`config/auth/users.json`、`config/system/requirement-settings.json`、`scripts/*`、若干 ui 文件等），远超 roadmap §0 冻结时的两个运行态文件。Qoder 全程在独立 worktree 施工，不得触碰主 checkout（见 §18 疑点 D5）。

硬口径复述（integrated-optimization-plan §5.3「口径支持（硬约束）」原文，实施期间零变更）：

1. SSE/事件只推送**已发生**的状态变更，不引入任何「自动进入下一阶段」逻辑，stage 推进仍由用户意图动作触发；
2. `isExplicitReportRequest` 双端闸门零变更（后端闸门定义于 `apps/api/src/services/ai/handlers/workbench-shared.ts` L162，调用点 `handlers/workbench-chat.handler.ts` L64——O4 合入 251b73d 后由 chat.service.ts 搬迁至此，原 L439/L474 行号已失效；前端 `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/utils/reportParser.js`）；
3. 前端与现有同步 API 在 Batch B/C 中不改（Batch E 前）。

---

## 1. 基座事实核对：A2 已落位原语清单与 Batch B 复用映射

以下事实逐一核对自 `apps/api/src/modules/harness/harness-runtime.repository.ts`（732 行）、`harness-runtime.types.ts`（60 行）与 `apps/api/src/db/schema/harness.ts`（444 行）。附件原始指令中的 `apps/api/src/services/harness/...` 路径不存在，实际实现位于 `apps/api/src/modules/harness/`，与 AGENTS.md §5 口径一致（见 §18 疑点 D1）。

### 1.1 可直接复用的原语（零改动或仅调用）

| 原语 | 位置 | Batch B 用途 |
|---|---|---|
| `createQueuedRun`（原子创建 + `run_queued` 首事件同事务 + owner+submissionKey 幂等重放 + `ACTIVE_WORKBENCH_RUN_EXISTS`） | repository L317–375 | 测试装配 durable Run；无需新建队列原语 |
| `claimNextQueuedRun`（`FOR UPDATE SKIP LOCKED`、attempt_no 原子递增、lease 写入、`run_claimed` 事件；lease 边界 1000–300000ms） | repository L389–450 | Worker 认领循环的唯一入口；恢复再认领复用（认领谓词需扩展，见 §4.3） |
| `heartbeatAttempt`（workerId + lease 有效期 + 状态守卫） | repository L452–479 | 15s 心跳循环直接调用 |
| `appendRunEvent` / `allocateEventSequence`（Run 行原子递增事件序号，多 Worker 下唯一有序） | repository L481–493 / L171–183 | Worker/Coordinator 全部生命周期事件 |
| `commitCheckpoint`（Run 行锁串行化、checkpointKey 幂等、`CHECKPOINT_KEY_CONFLICT`、五查 `runtimeValidation` 强制、`checkpoint_committed` 事件、回写 `lastCheckpointId`/`currentStepKey`） | repository L495–592 | 混合检查点提交器的唯一写入通道 |
| `upsertRunOutput`（版本递增、`FINAL_OUTPUT_IMMUTABLE`、hash 幂等、`output_updated` 事件） | repository L594–671 | 模型流部分/最终输出落库 |
| `enqueueSessionOutbox`（`RUN_SESSION_MISMATCH` 守卫、`(aiSessionId, deduplicationKey)` 幂等、`outbox_enqueued` 事件） | repository L673–731 | 用户消息/最终回复/失败提示的投影投递 |
| `HarnessRuntimeError` 固定 code 安全错误（原始 pg/Drizzle 错误绝不穿透） | repository L41–54 | 新增 repository 方法必须沿用同一模式 |
| `readDbNow`（以 DB 时钟为准） | repository L204–208 | lease/退避/outbox 可用时间一律读 DB 时钟 |
| payload 校验（普通对象、可序列化、≤1 MiB） | repository L210–242 | checkpoint state、outbox payload 复用 |
| `createHarnessEffectKey({runId, stepKey, effectName, ordinal})` → `${runId}:${stepKey}:${effectName}:${ordinal}` | types L58–60 | 工具副作用稳定 effectKey 的唯一工厂（A2 Gate 已冻结，不含 attempt 维度，天然 attempt 无关；与设计稿 §9.1 格式差异见 §18 疑点 D3） |
| 状态词汇：Run active/terminal、Attempt、`CheckpointKind`、`ResumePolicy`、Outbox 状态 | types L10–45 | Worker/Coordinator/Projector 状态机共享 |

### 1.2 Schema 层已就绪、A2 尚未暴露 repository 方法的能力

| 能力 | schema 位置 | Batch B 处理方式 |
|---|---|---|
| `harness_runs.status` 枚举已含 `recovering`、`cancelling`；`availableAt`、`recoveryCount`、`cancelRequestedAt/By`、`lastCheckpointId`、`currentStepKey` 列齐备；队列索引 `(status, available_at, created_at)` | schema/harness.ts L22–77 | Coordinator/Worker 使用；新增 repository 方法（§9） |
| `harness_run_attempts`：`leaseExpiresAt`/`heartbeatAt`/`resumeCheckpointId`；部分唯一索引「同一 Run 仅一个 claimed/running attempt」；lease 索引 `(status, lease_expires_at)` | schema L79–107 | lease 过期扫描、`orphaned` 标记、恢复 checkpoint 记录 |
| `harness_session_outbox`：`lockedBy/lockedAt/attempts/availableAt/publishedAt/lastError`；`(aiSessionId, deduplicationKey)` 唯一；pending 索引 | schema L181–210 | Projector 认领与发布标记 |
| `harness_tool_events.effectKey` + `(runId, effectKey)` 唯一索引 `harness_tool_events_run_effect_unique` | schema L261–284 | 工具副作用幂等登记（新增 repository 方法，见 §6.2） |
| `harness_run_events`：`(runId, sequence)` 唯一 | schema L141–157 | 已由 appendRunEvent 覆盖 |

### 1.3 复用映射结论

Batch B 不新增任何表、列、索引或迁移文件。所有持久化能力要么复用 A2 已暴露方法，要么在既有表上扩展 repository 方法（§9），schema 与 `apps/api/drizzle/**` 全程零变更。

---

## 2. 目标模块划分（对应 roadmap Task 2 Primary files 原文）

新建 6 个文件（3 实现 + 3 测试），全部位于 `apps/api/src/modules/harness/`：

| 文件 | 职责 |
|---|---|
| `harness-runtime.worker.ts` | Worker：认领循环、执行引擎、lease/heartbeat、优雅停机、检查点提交、effectKey 幂等包装、AbortSignal 生成与传播 |
| `harness-runtime.worker.test.ts` | Worker focused 测试 + 崩溃类 1/2/3 的 RED→GREEN 故障注入 |
| `harness-runtime.recovery.ts` | Recovery Coordinator：周期扫描、orphan、退避重排、恢复上限、取消收尾 |
| `harness-runtime.recovery.test.ts` | Coordinator focused 测试（扫描谓词、退避序列、上限、并发恢复互斥） |
| `harness-session-projector.ts` | Session Message Projector：outbox 认领、幂等投影、发布标记、失败重试 |
| `harness-session-projector.test.ts` | Projector focused 测试 + 崩溃类 4 的 RED→GREEN 故障注入 |

修改 5 个文件（roadmap 原文清单）：

| 文件 | 修改内容 |
|---|---|
| `harness-runtime.repository.ts`（+`.test.ts`） | 新增 §9 列出的方法；`claimNextQueuedRun` 认领谓词扩展（§4.3）；既有方法行为零回归 |
| `harness-runtime.types.ts`（+`.test.ts`） | additive 增加 Worker/Coordinator/Projector 配置与状态类型；additive 事件类型扩展（扩展项 E1，§17） |
| `harness.module.ts` | barrel 导出三个新模块 |
| `ai-sessions.repository.ts` | 新增来源键幂等追加函数（§7.3）；JSON 存储结构不变 |
| `workbench-dispatch.service.ts`（+ 相邻 focused test `workbench-dispatch.service.test.ts`） | `WorkbenchDispatchInput` 增加可选 `abortSignal` 并传播至模型调用路径（§8）；既有调用方行为零变更 |

分工原则：**Coordinator 只做检测、上限、退避与 orphan；checkpoint 兼容性选择与 resume 执行归 Worker**（单一权威，避免双处选择漂移，详见 §4.4）。

---

## 3. Worker 认领与租约设计（roadmap Step 3）

### 3.1 时序参数（生产默认常量 + 可注入配置）

```text
HARNESS_WORKER_TIMING = {
  leaseMs: 45_000,            // roadmap 原文 45s
  heartbeatIntervalMs: 15_000, // roadmap 原文 15s
  claimPollIntervalMs: 2_000,  // 空闲轮询间隔（实现自定，非 roadmap 条款）
  concurrency: 1,              // 默认单并发；AI_RUN_WORKER_CONCURRENCY 语义预留
}
```

- `leaseMs`/`heartbeatIntervalMs` 必须作为可注入配置传入 `createHarnessRuntimeWorker`，生产默认值由常量给出；单测断言默认值精确等于 45_000 / 15_000（roadmap 口径守护），故障注入测试注入小值（lease ≥ 1000ms，受 repository `assertLeaseMs` 边界约束）。
- 所有 lease 比较以 DB 时钟为准（复用 `readDbNow` 语义），不使用进程时钟。

### 3.2 认领循环

1. Worker 启动后按 `claimPollIntervalMs` 轮询 `claimNextQueuedRun({workerId, leaseMs})`；
2. 认领成功即进入执行循环（§3.3），并发度受 `concurrency` 上限控制，超出容量的 Run 保持 `queued`；
3. 认领谓词扩展见 §4.3（`recovering` 态 Run 进入同一认领通道）。

### 3.3 执行循环与心跳

- 认领成功后启动独立 heartbeat 定时器：每 `heartbeatIntervalMs` 调用 `heartbeatAttempt({attemptId, workerId, leaseMs})`；
- heartbeat 返回 `null`（lease 已失效或 attempt 已被 orphan）时，Worker 必须立刻中止当前执行（触发自身 AbortSignal），不再写任何 checkpoint/output/outbox——这是「lease 失效后禁写」守卫；
- 每个工作流步骤执行前后检查：cancel 请求（§13）与 heartbeat 有效性。

### 3.4 优雅停机

`worker.stop()`（或信号处理入口，见 §18 疑点 D6）语义：

1. 停止认领新任务（claim 循环退出）；
2. 等待当前执行到达**安全边界**（步骤边界、模型调用返回后、工具副作用提交后）；
3. 在安全边界结束 attempt：正常完成标 `succeeded`；停机中断时把 attempt 标 `cancelled`（Worker 主动放弃），Run 状态回 `queued`（`available_at = now`），保证 lease 不悬空、后续 Worker 可立即认领；
4. 清理全部定时器；`stop()` 返回 Promise，测试可 await。

### 3.5 硬退出

进程硬退出不做任何内存清理：lease 自然过期（`lease_expires_at` 到期），attempt 保持 `claimed/running`，由 Recovery Coordinator 检测并 orphan（§4）。测试用「不调用 stop、直接抛弃 Worker 实例并停止 heartbeat」模拟，故障注入点见 §11.3。

---

## 4. Recovery Coordinator 设计（roadmap Step 4）

### 4.1 时序参数

```text
HARNESS_RECOVERY_TIMING = {
  scanIntervalMs: 10_000,             // roadmap 原文 10s
  maxAutoRecoveries: 3,               // roadmap 原文最多 3 次
  backoffMs: [2_000, 10_000, 30_000], // roadmap 原文 2/10/30s
}
```

- 同样可注入；单测断言默认常量精确等于 roadmap 口径，集成测试注入毫秒级小值。

### 4.2 扫描与处置流程（每轮）

1. 查询失联 Run：`status IN ('running','recovering','cancelling')` 且其 active attempt（`claimed/running`）`lease_expires_at < now`（新方法 §9 R1）；
2. 对每个候选 Run 在**单事务 + Run 行锁**内处置，保证同一 Run 只有一个恢复者（并发恢复互斥测试必须覆盖）：
   a. 旧 attempt 标记 `orphaned`（§9 R2），追加事件；
   b. 若 `cancelRequestedAt` 已设置 → 不再恢复，直接进入取消收尾（Run → `cancelled`，追加事件，§13.3）；
   c. 检查是否存在至少一个兼容检查点（§5.4 判定规则）；不存在 → Run → `failed`，`errorCode = RECOVERY_CHECKPOINT_INCOMPATIBLE`（设计稿 §8.3），不再消耗自动恢复次数；
   d. `recoveryCount >= 3` → Run → `failed`，`errorCode = RECOVERY_LIMIT_EXCEEDED`，保留完整 attempts/checkpoints 证据，不再重排；
   e. 否则 `recoveryCount += 1`，Run → `recovering`，`available_at = now + backoffMs[recoveryCount - 1]`（第 1/2/3 次分别 2s/10s/30s），追加恢复事件（事件类型见扩展项 E1）；
3. `recovering` 且 `available_at` 到期后由认领谓词纳入 Worker 认领（§4.3），Run 回到 `running`。

### 4.3 认领谓词扩展（repository Modify 范围内决策）

`claimNextQueuedRun` 的选取谓词由 `status = 'queued'` 扩展为 `status IN ('queued','recovering')`，其余（`available_at <= now`、`FOR UPDATE SKIP LOCKED`、attempt_no 递增、`run_claimed` 事件）不变。理由：设计稿 §10.2 要求「标为 recovering，再放回可认领队列」，`recovering` 在被重新认领前对外保持可见语义；不新增第二个认领通道。此决策属 A2 未规定的新行为，列 §18 疑点 D7 供主会话复核。

### 4.4 职责边界

Coordinator 不选择具体恢复检查点、不创建 attempt；Worker 认领 `recovering` Run 后自行执行 §5.4 的从后向前兼容选择，把选中的 checkpointId 写入新 attempt 的 `resumeCheckpointId`（§9 R5），随后从该检查点的 `resumePolicy`/`nextStep` 继续。Coordinator 仅在步骤 2c 做「是否存在任一兼容检查点」的预判，避免无意义消耗恢复次数。

### 4.5 queued 孤儿与 outbox 兜底

- `queued` 且无 active attempt 的 Run 本就是可认领状态，无需 Coordinator 特殊处理（设计稿 §10.2 扫描项 2 由现有认领循环天然覆盖，计划中显式说明，不额外实现）；
- 未投影完成的 outbox 事件由 Projector 周期轮询兜底（§7.2），Coordinator 不管 outbox。

---

## 5. 混合检查点设计（roadmap Step 5）

### 5.1 两类信号

- **structural（Runtime 结构检查点）**：输入已落库、上下文已固定、工具结果已提交、模型输入已就绪、最终回复已提交等机器可验证边界；
- **semantic（AI 语义检查点建议）**：模型结构化输出中的 `checkpointHint`（semanticLabel/summary/nextStepKey），只作为建议；
- `combined`：同一检查点同时携带结构边界与语义里程碑（`aiMilestone` 字段承载 semantic 建议）。
- 提交前必须满足设计稿 §8.1 的全部条件（Schema 校验通过、本步声明的写入已提交、幂等副作用已有稳定 effectKey、nextStepKey 属于当前固定工作流版本、快照通过去敏/大小/引用完整性校验、无结果未知的非幂等外部调用），并通过 A2 已冻结的五查 `HarnessRuntimeValidation`（`ownerBound/workflowVersionMatched/stateHashMatched/nextStepKnown/effectsStable` 全 true）。`validatorVersion` 建议固定为 `harness-worker/v1`。

### 5.2 默认检查点边界（设计稿 §8.2 原文映射）

| checkpointKey | kind | resumePolicy | 恢复语义 |
|---|---|---|---|
| `input_committed` | structural | resume_next | 从上下文解析开始 |
| `context_resolved` | combined | resume_next | 从意图路由/计划步骤开始 |
| `intent_routed` | combined | resume_next | 从已选工作流首个执行步骤开始 |
| `tool_result_committed:<effectKey>` | structural | resume_next | 跳过已提交工具副作用 |
| `artifact_committed:<artifactKey>` | combined | resume_next | 复用已提交产物 |
| `model_input_ready:<stepKey>` | structural | **restart_step** | 重新执行本模型调用 |
| `awaiting_user_confirmation:<actionId>` | combined | resume_next | 恢复为 waiting，不重复待确认动作 |
| `final_response_committed` | structural | resume_next | 只补 Session 投影或结束 |

Batch B 的 fake workflow 至少覆盖 `input_committed`、`tool_result_committed:<effectKey>`、`model_input_ready:<stepKey>`、`final_response_committed` 四类（对应四类崩溃注入点）；`context_resolved`/`intent_routed`/`artifact_committed`/`awaiting_user_confirmation` 在 fake workflow 中作为可选节点，不强制（见 §18 疑点 D8）。

### 5.3 模型流中断语义（roadmap Step 5 后半句原文）

- Worker 在每次模型调用**之前**提交 `model_input_ready:<stepKey>`（含固定输入 hash、prompt/模型配置快照引用）；
- 流式生成中断（provider 抛错或进程崩溃）后：
  1. 未提交为 `final` 的部分输出**丢弃**（`harness_run_outputs` 中 status=partial 的内容不得被新 attempt 读取拼接；可保留为审计或标记取代，但新 attempt 输出从空开始）；
  2. 复用固定输入/prompt/模型配置，**从 `model_input_ready` 重新执行整个模型步骤**；
  3. 仅当完整输出通过 Schema/业务校验后才提交产物与后置检查点；
- 严禁把中断文本与新 attempt 文本拼接成伪连续输出（roadmap 原文「不拼接中断文本」；设计稿 §10.3）。

### 5.4 兼容性判定（恢复时，设计稿 §8.3 映射）

Worker 对检查点从后向前选择「最近兼容」者，判定项与五查一一对应：

1. Run 固定的 `workflowVersion` 仍可加载（工作流注册表存在该版本）；
2. `stateHash` 与 state 重算一致；
3. `nextStepKey`/恢复目标步骤仍属于该工作流版本（`nextStepKnown`）；
4. 引用事实 owner 一致（`ownerBound`）；
5. `effectKeys` 引用的副作用记录稳定存在（`effectsStable`）。

任一不满足则继续向前找；全部不兼容 → `failed / RECOVERY_CHECKPOINT_INCOMPATIBLE`（不猜测恢复）。

---

## 6. 幂等设计（roadmap Step 6 前半）

### 6.1 稳定 effectKey

统一使用 A2 冻结的 `createHarnessEffectKey({runId, stepKey, effectName, ordinal})`：

- 与 attempt 无关（runId 维度），attempt 重建不改变 effectKey；
- Worker 内所有有副作用步骤（工具调用、Session 投影投递）必须先计算 effectKey 再执行；
- checkpoint 的 `effectKeys` 数组记录该检查点前已完成的 effectKey 集合，供兼容性判定与审计。

### 6.2 工具副作用幂等（新 repository 方法 §9 R6）

复用既有 `harness_tool_events` 表与 `(runId, effectKey)` 唯一索引：

1. Worker 执行工具副作用前调用 `recordToolEffectOnce` 的「查询」语义：已存在同 effectKey 的成功记录 → **跳过副作用执行**，直接复用已记录输出引用；
2. 不存在则执行副作用，成功后以同事务写入工具事件行；唯一索引冲突（并发/重放竞态）视为「已被其他执行者完成」，回读已有记录继续使用；
3. 只读工具可安全重试但仍记录输入 hash；非幂等且结果未知的外部工具禁止自动恢复（进入 `manual` resumePolicy，Batch B fake workflow 用桩覆盖该分支语义即可，不接真实外部工具）。

### 6.3 outbox deduplication key（roadmap Step 6 后半）

投递键规范（Worker 生成，全局稳定、attempt 无关）：

```text
run:<runId>:user-message:<clientMessageId>
run:<runId>:final-response
run:<runId>:failure-notice:<errorCode>
```

- 复用 `enqueueSessionOutbox` 的 `(aiSessionId, deduplicationKey)` 幂等：重放返回 `created=false`，不产生第二条 outbox 行；
- Session 侧来源键幂等见 §7.3。

---

## 7. Session Message Projector 设计（roadmap Primary files 新建件）

### 7.1 职责

把 `harness_session_outbox` 中 pending 的事件幂等投影到 AI Session（JSON 文件存储）：用户消息、最终 AI 回复、任务失败提示。设计稿 §7.5「至少一次投递 + 业务层幂等」，不伪称跨存储全局事务。

### 7.2 投影循环

1. 按可注入 `pollIntervalMs` 轮询认领 pending 且 `available_at <= now` 的 outbox 行（新方法 §9 R7：`lockedBy/lockedAt` 抢占，`processing` 状态，认领超时未发布自动回 pending 可重试）；
2. 对每行执行 §7.3 的幂等追加；成功 → `published`（`publishedAt`）；失败 → `attempts += 1` + `lastError`（去敏）+ 指数回退 `available_at`；attempts 超阈值（建议 5，实现常量）→ `failed`，不再自动重试；
3. Projector 与 Worker 解耦：Worker 只负责 `enqueueSessionOutbox`，Projector 独立可重启。

### 7.3 Session 侧来源键幂等（`ai-sessions.repository.ts` 修改点）

- 新增 `appendAiSessionMessageIdempotent({sessionId, message, source})`：`source = { deduplicationKey, runId, eventType }` 写入 `message.metadata.projectionSource`（`AiMessageMetadata` 是 `Record<string, unknown>` 开放类型，**无需修改 `ai-sessions.types.ts`**；若实施中认定必须类型化，按扩展项 E3 预授权处理）；
- 追加前扫描该 session `messages[].metadata.projectionSource.deduplicationKey`，命中则返回既有消息 `{created: false}`；
- 读改写使用既有 `loadAiSessionsStore`/`saveAiSessionsStore`（临时文件 + rename 原子写），不引入新存储结构；
- 「Session 已写入、outbox 未确认」崩溃场景：重放命中来源键 → 不产生重复消息（崩溃类 4b 的核心断言）。

---

## 8. workbench dispatch 接入：服务端 AbortSignal（roadmap Step 7）

### 8.1 修改面（最小、可选、向后兼容）

- `WorkbenchDispatchInput` 增加可选字段 `abortSignal?: AbortSignal`；
- dispatch 内部模型调用路径（`answerWithModelAndContext` 与流式 adapter 路径）在调用 `modelChat`/`modelChatStream` 前检查 `abortSignal.aborted`，并在生成期间监听 abort：触发后停止消费流、抛出去敏的取消错误；
- 字段可选：既有调用方（`handlers/workbench-chat.handler.ts` 同步入口、`handlers/workbench-chat-stream.handler.ts` 流式入口，O4 合入 251b73d 后由 chat.service.ts 搬迁至此）**零改动**，现有同步/流式 API 行为、响应结构与前端契约完全不变；
- `chat.service.ts`（O4 后已为 26 行 barrel）与 `apps/api/src/services/ai/handlers/**` 均不在本批修改清单（现有同步 API 不改的 roadmap 条款即指此）；Batch B 的 AbortSignal 接入仅限 `workbench-dispatch.service.ts`（入口/步骤边界检查 + 对注入的 `modelChat` 在 dispatch 内包装 abort 监听），Worker 侧亦可在注入 `modelChat` 时自行包装 abort 感知层，不侵入 handlers 目录。

### 8.2 AbortSignal 的权威来源

- signal 由 **Worker 服务端创建**：来源是持久化的 `cancelRequestedAt` 轮询/步骤边界检查 + heartbeat 失效 + `stop()`，与浏览器 SSE/HTTP 连接状态无关（设计稿 §10.3）；
- durable Worker 路径执行 dispatch 时传入该 signal；取消在最近安全边界生效（§13）。

### 8.3 Batch B 接入深度声明

Batch B 只要求「Worker 路径可携带 AbortSignal 调用 dispatch 并有 focused 测试证明取消传播」；**不要求**把既有同步 HTTP 入口切换到 durable 执行（那是 Batch C/E 的范围，且 roadmap 明确不改现有同步 API）。

---

## 9. Repository 扩展清单（`harness-runtime.repository.ts` Modify 范围内）

全部沿用 `HarnessRuntimeError` 固定 code、事务 + Run 行锁、DB 时钟、payload 校验模式。签名级清单：

| # | 方法 | 语义 |
|---|---|---|
| R1 | `findRunsWithExpiredActiveLease({now?, limit?})` | 扫描 §4.2-1 候选 Run（含 active attempt 信息），只读 |
| R2 | `orphanAttempt({attemptId, reason?})` | `claimed/running → orphaned`，写 `finishedAt`；同事务由调用方追加事件 |
| R3 | `scheduleRunRecovery({runId, backoffMs, limit, now?})` | 单事务：行锁 → 校验 cancel/incompatible/limit → `recoveryCount+1`、`recovering`、`available_at` 退避；超限/不兼容时直接 `failed` + 对应 errorCode；追加恢复/失败事件 |
| R4 | `listCheckpointsForRun({runId})` | 按 `sequence` 倒序列出，供 Worker 兼容选择 |
| R5 | `setAttemptResumeCheckpoint({attemptId, checkpointId})` | 写入 `resumeCheckpointId`（Worker 认领后、执行前调用） |
| R6 | `recordToolEffectOnce({runId, attemptId?, effectKey, toolName, input, output?})` | §6.2 幂等登记；返回 `{toolEvent, created}` |
| R7 | `claimPendingSessionOutbox({lockerId, limit, lockMs, now?})` | outbox 抢占认领（`lockedBy/lockedAt/processing`），过期锁回收 |
| R8 | `markSessionOutboxPublished({outboxId, lockerId})` / `markSessionOutboxFailed({outboxId, lockerId, errorCode, retryAfterMs, maxAttempts})` | 发布标记与失败回退（§7.2-2） |
| R9 | `completeAttemptAndRun({attemptId, runId, outcome: "succeeded"|"failed"|"cancelled", errorCode?})` | 单事务：attempt 终态 + Run 终态/状态回写 + 终态事件（`run_completed`/`run_failed`/取消事件见 E1）；保证状态转换只发生一次 |
| R10 | `requestRunCancel({runId, requestedBy, now?})` | 写 `cancelRequestedAt/By` + `cancel_requested` 事件 + 非终态 → `cancelling`；**Batch B 无 HTTP cancel API**，此方法供 Worker/Coordinator 语义与测试装配使用，不暴露路由 |
| R11 | `releaseAttemptForShutdown({attemptId, runId})` | 优雅停机：attempt → `cancelled`，Run 回 `queued`（§3.4-3） |

> 以上是对「Modify: harness-runtime.repository.ts」条款的实现分解，不新增表/列/索引。若实施中发现某项可用既有方法组合替代，以更少新表面为准，但需在 handoff 说明。

---

## 10. Types 扩展清单（`harness-runtime.types.ts` Modify 范围内）

- Worker/Recovery/Projector 配置类型（`HarnessWorkerTiming`、`HarnessRecoveryTiming`、`HarnessProjectorTiming` 等）与默认常量；
- fake workflow 步骤契约类型（仅测试与新模块使用）；
- **扩展项 E1**：additive 增加事件类型 `recovery_started`、`recovery_completed`、`run_cancelled`（理由与设计稿出处见 §17；additive、向后兼容，既有 9 类事件与消费方零影响）。

---

## 11. fake workflow / provider 与故障注入点规范（roadmap Step 2 前置）

### 11.1 fake workflow

- 确定性步骤图（固定 `workflowId = "fake_workbench_chat"`、`workflowVersion = "fake-v1"`，注册进 Worker 的工作流注册表）：

```text
s1 input_commit        → checkpoint: input_committed
s2 context_resolve     → checkpoint: context_resolved（可选节点）
s3 tool_effect         → 工具副作用（fake 计数器）+ effectKey + checkpoint: tool_result_committed:<effectKey>
s4 model_prepare       → checkpoint: model_input_ready:s5
s5 model_generate      → 调 fake provider（流式）
s6 final_commit        → checkpoint: final_response_committed + outbox 投递（用户消息/最终回复）
```

- 每个步骤暴露命名注入钩子 `failAfter:<stepKey>` / `failDuring:<stepKey>`：命中即抛 `FaultInjectedError`，Worker 不做清理直接终止当前实例（模拟硬退出，heartbeat 随之停止）；
- fake 工具副作用 = 测试内计数器 + 结果登记，用于断言「副作用只发生一次」。

### 11.2 fake provider

- `AsyncIterable<StreamingChunk>`：按脚本发出 N 个 chunk 后 complete，或按脚本在第 k 个 chunk 后抛错（`failAtChunk`）；
- 支持「按 attempt 区分脚本」：attempt 1 中断、attempt 2 完整输出，用于崩溃类 3；
- 输出文本含 attempt 标记，用于断言「无拼接」（最终输出只含 attempt 2 文本）。

### 11.3 四类崩溃注入点（roadmap Step 2 原文四类）

| # | 崩溃类 | 注入点 | 恢复期望 |
|---|---|---|---|
| C1 | 输入后崩 | `failAfter:s1`（`input_committed` 已提交） | 从 `input_committed` resume_next；用户消息投影不重复 |
| C2 | 工具成功后崩 | `failAfter:s3`（副作用已提交、`tool_result_committed` 已提交） | 重执行 s3 时 effectKey 命中跳过副作用；计数器 == 1 |
| C3 | 模型流中断 | `failDuring:s5`（`model_input_ready:s5` 已提交、流中途） | 丢弃 partial，从 `model_input_ready` 重做 s5；最终输出无拼接 |
| C4 | 投影前后崩 | C4a `failAfter:s6` 中「checkpoint 已提交、outbox 未投递」；C4b「Session 已写入、outbox 未标 published」（Projector 侧注入） | C4a：重放 `enqueueSessionOutbox` 命中 dedupe key，`created=false`；C4b：重放命中 Session 来源键，消息数不增 |

---

## 12. RED 先行测试矩阵

| 测试组 | 归属文件 | 关键断言 |
|---|---|---|
| T1 Worker 认领/lease/heartbeat | worker.test | claim 成功创建 attempt；heartbeat 续约；lease 失效后禁写；并发 claim 只有一个赢家 |
| T2 优雅停机/硬退出 | worker.test | stop 后不再认领、attempt 正确收尾、Run 回 queued；硬退出后 lease 到期被 R1 扫描发现 |
| T3 C1 输入后崩恢复 | worker.test | 恢复后从 s2 继续；用户消息仅一条；`resumeCheckpointId` 指向 `input_committed` |
| T4 C2 工具幂等 | worker.test | 副作用计数器 == 1；`recordToolEffectOnce` 第二次 `created=false` |
| T5 C3 模型流重做 | worker.test | partial 被丢弃；final 输出 == attempt2 全文（无拼接）；Session 最终回复仅一条 |
| T6 Coordinator 扫描/退避/上限 | recovery.test | 扫描只命中过期 lease；退避序列 2/10/30s（注入小值断言比例与顺序，常量单测守护真实值）；第 4 次失联 → `RECOVERY_LIMIT_EXCEEDED` |
| T7 恢复互斥与取消优先 | recovery.test | 并发 Coordinator 只有一个恢复成功；cancelRequestedAt 存在时不恢复直接取消收尾 |
| T8 检查点兼容性 | recovery.test | 不兼容 checkpoint 被跳过选更早兼容者；全不兼容 → `RECOVERY_CHECKPOINT_INCOMPATIBLE` |
| T9 C4 投影幂等 | projector.test | C4a/C4b 均无重复消息；outbox attempts/回退/上限 failed 语义 |
| T10 dispatch AbortSignal | workbench-dispatch.service.test.ts | 传入已 abort 的 signal → 不调模型；流式中途 abort → 停止消费；不传 signal 的既有用例全绿（零回归） |
| T11 取消安全边界 | worker.test | 取消在步骤边界生效；取消后无新副作用/checkpoint；终态 `cancelled` |
| T12 A2 回归守护 | 既有 harness 套件 | migration 0 skip、owner、并发、错误安全既有断言全绿（不改既有测试） |

顺序要求：**先提交 T3/T4/T5/T9 的 RED（失败证明），再实现 Worker/Coordinator/Projector 转 GREEN**；handoff 必须保留每个 RED→GREEN 的证据。

---

## 13. 取消安全边界设计（Gate B 第三条的实施分解）

1. Batch B 不新增任何 HTTP cancel 接口（属 Batch C）；`requestRunCancel`（R10）仅供内部与测试装配；
2. Worker 在以下安全边界检查取消：步骤进入前、checkpoint 提交后、模型调用前、流式 chunk 消费中（经 AbortSignal）、工具副作用执行前；
3. 取消生效路径：`cancelling` → 当前步骤到达边界后停止 → attempt `cancelled` → Run `cancelled` + 终态事件；**取消后严禁再写任何 checkpoint/output/outbox/工具副作用**；
4. 失联 Run 已带 `cancelRequestedAt` 时，Coordinator 直接取消收尾（§4.2-2b），不消耗恢复次数。

---

## 14. Gate B 验收逐条分解（roadmap 原文四条 → 可执行测试项，零改写）

| Gate B 原文 | 可执行验收项 |
|---|---|
| ① 四类崩溃均能从最近兼容检查点恢复 | T3、T4、T5、T9 全绿；每组断言 `resumeCheckpointId` 指向期望检查点、恢复事件序列完整、Run 最终 `completed`（或按场景的期望终态） |
| ② 工具和消息无重复 | T4 副作用计数器 == 1 且 `recordToolEffectOnce.created == false`；T9 Session 消息条数断言（用户消息 1 条、最终回复 1 条）；outbox 无重复行（`(sessionId, dedupeKey)` 唯一） |
| ③ 取消请求在安全边界结束 | T7 取消优先分支 + T10 AbortSignal 传播 + T11 取消后零写入；终态 `cancelled` 事件序列完整 |
| ④ A2 迁移、owner、并发与错误安全回归保持绿色 | `test:harness` 既有 5 个测试文件 0 fail 0 skip（migration 不 skip）；`test:modules`、`test:ai`、`test:integration`、`build:api`、`build:web` 全部退出 0；两个 lockfile 零变更 |

---

## 15. 验证套件与执行命令（roadmap Step 8 + 工单口径）

```bash
# Harness 真实 PostgreSQL（Testcontainers，Colima 进程级环境变量写法）
RP047_DOCKER_HOST="$(docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}')"
DOCKER_HOST="$RP047_DOCKER_HOST" \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
USE_TESTCONTAINERS=true npm run test:harness -w apps/api

npm run test:modules
npm run test:ai
npm run test:integration
npm run build:api
npm run build:web
git diff --check
git diff --exit-code -- package-lock.json ui/V2_PROTOTYPE/package-lock.json
git status --short --untracked-files=all
```

- 新建的 worker/recovery/projector 测试文件必须注册进 `apps/api/package.json` 的 `test:harness` 枚举并保持 `--test-concurrency=1`（扩展项 E2）；
- `test:modules` 若触发已知 `config/system/requirement-settings.json` 副作用，只允许精确恢复该单一文件（沿用 A2-R1 口径）。

---

## 16. 分批建议（30–40h 若过大，拆 3 个可独立 Gate 的子批；Gate B 整体口径不缩水）

| 子批 | 内容 | 粗估 | 独立可 Gate 点 |
|---|---|---:|---|
| B1 Worker 核心与检查点 | §3 全部 + §5.1/5.2 + §11 fake 基建 + T1/T2/T3（C1） | 12–15h | Worker 认领/lease/优雅停机/硬退出 + 输入后崩恢复可证 |
| B2 Recovery 与工具幂等 | §4 全部 + §5.3/5.4 + §6 + T4/T5/T6/T7/T8（C2、C3） | 10–13h | 退避/上限/互斥/兼容性 + 工具与模型两类恢复可证 |
| B3 投影与取消接入 | §7 + §8 + §13 + T9/T10/T11（C4）+ §15 全量套件 | 8–12h | 投影幂等 + AbortSignal + 取消安全边界可证，合拢 Gate B |

拆批时每个子批仍是「一个 worktree、一个分支、一次 handoff、一次 Codex 复核」；三批全过 = Gate B 四条完整达成，不以子批 Gate 替代 Gate B。默认建议先按单批执行，仅在 Qoder ACK 阶段评估工作量确实超载时启用拆批。

---

## 17. 扩展项登记表（超出 roadmap Task 2 原文条款的内容，逐项说明理由；未经主会话确认不得实施）

| # | 扩展项 | 理由 | 预授权建议 |
|---|---|---|---|
| E1 | `harness-runtime.types.ts` additive 增加 `recovery_started`/`recovery_completed`/`run_cancelled` 事件类型 | A2 冻结的 9 类事件无恢复与取消终态事件；设计稿 §7.3 明确列出这些事件名；Coordinator/Worker 语义落地必需；additive 向后兼容 | 建议预授权，限 additive |
| E2 | `apps/api/package.json` 修改 `test:harness` 脚本枚举（仅追加 3 个新测试文件路径） | roadmap Primary files 未列 package.json，但新测试不注册就进不了验证套件（§15 是 roadmap Step 8 条款）；A2 工单曾同样授权 package.json | 建议预授权，仅限 scripts 字段 |
| E3 | `apps/api/src/modules/ai-sessions/ai-sessions.types.ts` 增加 optional 的投影来源键类型字段 | 默认方案用 `AiMessageMetadata` 开放 Record 承载（零 types 改动）；仅当实施中证明开放键不可维护时才需要；additive optional 字段 | 条件预授权：Qoder 须在 handoff 论证必要性，否则不得改 |
| E4 | Worker 独立进程入口文件与启动脚本（如 `apps/api/src/harness-worker.entry.ts`） | 设计稿 §5.1 要求独立入口形态；但 roadmap Task 2 未列该文件，Gate B 不要求生产 wiring（Batch C/E 自然承接）；本批默认由测试在进程内驱动 Worker | **不预授权**，默认不实施；确有需要先停止报 Codex |

---

## 18. 风险与未决疑点（只列出，不擅自决策）

| # | 疑点 | 现状 | 待谁决策 |
|---|---|---|---|
| D1 | 附件指令给出的 A2 基座路径 `apps/api/src/services/harness/...` 不存在 | 实际位于 `apps/api/src/modules/harness/`，本计划与工单已按实际路径编写 | 主会话知悉即可 |
| D2 | roadmap §0 记载业务主线 `codex/role-driven-ai-home-workbench @ cd02e8d`，本地已不存在该分支 | 当前主线为 `main`（编制时 HEAD `e20e2c6`，主会话复核时已推进至 `251b73d`），A2 已合入（`21239d9`）；工单 baseCommit 按「开工时 main HEAD」 | 主会话已确认：以 main 为准 |
| D3 | effectKey 格式：设计稿 §9.1 含 `workflowVersion` 段，A2 冻结的 `createHarnessEffectKey` 无该段 | 本计划按 A2 冻结契约复用（runId 维度已保证 attempt 无关）；若要对齐设计稿需改 A2 已 Gate 的契约 | 用户/Codex |
| D4 | 分支名：附件指令写 `qoder/rp-047-batch-b`，roadmap Task 2 原文为 `qoder/rp-047-b-worker-recovery` | 按「roadmap 唯一基准」采用后者 | 主会话确认 |
| D5 | 主 checkout 未提交修改远超 roadmap §0 冻结时的两个运行态文件 | 工单沿用 `preserve-and-stop-on-overlap` + Qoder 不触碰主 checkout；基线事实已变化 | 主会话知悉 |
| D6 | Worker 生产入口（独立进程/app.ts 挂载）不在 roadmap Task 2 文件清单 | 默认不实施（E4）；优雅停机语义由 `worker.stop()` 在测试内证明 | Codex Gate B 时复核 |
| D7 | `recovering` Run 重新进入认领通道的方式（扩展认领谓词 vs Coordinator 翻转回 queued） | 本计划选择扩展认领谓词（§4.3），属 A2 未规定的新行为 | Codex Gate B 时复核 |
| D8 | fake workflow 是否必须覆盖设计稿 §8.2 全部 8 类检查点 | 本计划要求 4 类必需 + 4 类可选（§5.2）；`awaiting_user_confirmation` 涉及确认闸门，Batch B 用桩语义覆盖还是留待后续批次 | Codex Gate B 时复核 |
| D9 | `harness-runtime.migration.test.ts` 是否需为 Batch B 增加迁移断言 | 本批零迁移，默认不需要；若 E1 事件类型扩展涉及枚举约束（当前 `eventType` 为自由 text，无 DB 枚举），无需迁移 | Codex Gate B 时复核 |

---

## Self-review

- [x] 范围基准零漂移：§3–§15 逐节对应 roadmap Task 2 Step 2–8；E1–E4 全部显式登记，默认不实施未授权项。
- [x] Gate B 四条原文在 §14 逐条分解，无缩水、无改写。
- [x] Allowed/Forbidden 路径均以 2026-08-06 只读核对的实际文件为准（modules 路径、后端闸门 workbench-shared.ts L162、ai.routes.ts L54–55、schema 实际列名）。

---

## 主会话复核更正（2026-08-06，Codex 复核时落笔）

- **基线漂移修正**：本计划与工单编制于 O4（251b73d）合入前后交界，原文 3 处引用 `chat.service.ts` L439/L474/L552/L819 已过期——O4 handler 化后该文件为 26 行 barrel，后端 `isExplicitReportRequest` 闸门实际定义于 `handlers/workbench-shared.ts` L162（调用点 `handlers/workbench-chat.handler.ts` L64），同步/流式入口位于 `handlers/workbench-chat.handler.ts` / `workbench-chat-stream.handler.ts`。已在 §0、§8.1 原位更正。
- **禁改圈扩展**：工单 Forbidden 同步增补 `apps/api/src/services/ai/handlers/**`（闸门与 handler 实现的现居住地），与 §8.1「handlers 目录零侵入」声明对齐。
- **主线口径**（裁决 D2）：业务主线为 `main`，编制时 HEAD `e20e2c6`，复核时已推进至 `251b73d`（O4）；工单 Assignment Commit 按「开工时 main HEAD」动态解析，不受本次更正影响。
- 其余章节（§1–§7、§9–§13、§14–§17）不受 O4 影响：Batch B 只修改 `workbench-dispatch.service.ts` 可选字段，不触碰 handlers 与 intent 服务，18 条意图快照回归基线自动守护路由行为。
- [x] 不含 Batch C 内容：无异步 Run API、无 SSE replay、无 `ai-runs.routes.ts`/`harness-runtime.usecase.ts`/OpenAPI 改动；cancel 仅内部语义（R10 不暴露路由）。
- [x] 硬口径三条在 §0 复述并在工单中强制复述。
- [x] 本计划不自动启动 Batch B、不提交、不更新总看板。
