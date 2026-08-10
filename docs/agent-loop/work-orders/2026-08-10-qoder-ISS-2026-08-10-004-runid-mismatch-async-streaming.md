# 工单 · ISS-2026-08-10-004：AI 工作台异步通道对话区收敛 + 逐字流式（runId 字段错配 & 异步流式事件接入）

> 状态：**已回填 / 待 Codex 复核（KIMIK3 2026-08-10 回填，合入须用户批准 --no-ff）**
> 类型：defect（P1 高频核心流）· 来源：用户实测截图 3 张（2026-08-10，两次反馈同题合并）
> 交叉引用：ISS-2026-08-09-003（读取侧对账兜底，不同题）/ ISS-2026-08-10-003（提交后刷新时机，已合入 ee547a5，相关但独立）/ ISS-2026-08-10-001、002（角标链路，已验收关闭，**不得触碰**）
> base：`8bcbd91`（main HEAD，派发时实填；含本工单文档，handoff 回填在分支内完成）

## 1. 业务症状

用户在 AI 工作台发问后（异步通道）：

1. **对话区不收敛**：任务在当前页完成后对话区仍停「正在理解你的问题 / 正在调用模型并组织回复」占位；切会话再切回才出现完整回复；
2. **无逐字流式、无思考过程**：执行期间对话区全程无逐字输出、无模型思考动态，恒停留占位；
3. **停止按钮失效**：对话区停止按钮点击无反应（`cancelRun` 收到 `undefined`）；
4. **provider 链路正常**：会话行「执行中/已完成未读」徽标、顶栏停止条、右下角「已完成」通知均正常——**该链路不得改动**。

## 2. 根因（已核验，置信度高，两层叠加）

### 层 1：前端字段名错配 → 页面级 SSE 订阅永不建立

- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js` L222-224：`activeRunId` 取 `runs.find(...)?.id`，而后端统一视图 runs 字段为 **`runId`**（`apps/api/src/modules/harness/workbench-view.usecase.ts` L203-210，无 `id` 字段）→ 恒 `''` → L299 `useRunEventStream(activeRunId, ...)` 永不订阅（`useBackgroundRuns.jsx` L265-278 `if (!runId) return undefined`）；
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/index.jsx` L71：`cancelRun(activeRun.id)` 同因传 `undefined`；
- **假绿洞**：`ui/V2_PROTOTYPE/src/__tests__/unified-view.test.jsx` mock 用 `{ id: 'run-1', ... }`（L48、L120、L156-157、L181 等），与后端契约不符，致流式发现用例在生产坏时仍绿。

### 层 2：后端异步通道从不发射流式事件 → 订阅建立也无内容

- `apps/api/src/modules/harness/workbench-chat.workflow.ts` L89-95：异步 worker 调 `deps.dispatch({ message, user, workflowKey })` **未传 `streamingAdapter`**；该接口定义于 `apps/api/src/services/ai/workbench-dispatch.service.ts` L150-154（`onToken(chunk)/onComplete/onError`，chunk 含 `contentDelta`/`reasoningContentDelta`），目前仅同步 SSE 路径接入（`workbench-chat-stream.handler.ts`）；
- 全后端 grep `text.delta`/`thought` 零命中：run 事件流从无逐字/思考事件；
- 事件类型白名单 `HARNESS_RUN_EVENT_TYPES`（`harness-runtime.types.ts` L34-50）不含此两类，且 `appendRunEvent` 在 `harness-runtime.repository.ts` L632 做白名单校验 → **新增事件必须 additive 扩展类型表**（`harness-runtime.types.test.ts` L78 仅断言既有类型不得移除，新增安全）；
- **前端消费侧已就绪可复用**：`useChatMessages.js` L22-28 `STREAM_EVENT_TYPES`（`text.delta`/`thought`）、L239-275 `handleStreamEvent` 读 `payload.delta || payload.text`（逐字）与 `payload.text || payload.content`（思考）；SSE 端点 `harness-runtime.controller.ts` L216-224 原样透传 `{ sequence, eventType, payload, createdAt }`。

## 3. 修复方案

### 层 1（前端，小改）

1. `useChatMessages.js` L222-224：取 `run.runId || run.id`（兼容写法，后端契约为主）；
2. `ChatArea/index.jsx` L71：`cancelRun(activeRun.runId || activeRun.id)`；
3. `unified-view.test.jsx`：全部 run mock 修为后端契约形状（`runId` 字段，移除假 `id`），既有用例断言同步适配——**堵假绿**，修后层 1 用例必须真实通过。

### 层 2（后端，中改，additive 不破坏既有契约）

1. `harness-runtime.types.ts`：`HARNESS_RUN_EVENT_TYPES` 追加 `"text.delta"`、`"thought"`；
2. `workbench-chat.workflow.ts`：
   - `WorkbenchChatWorkflowDeps` 新增 `appendRunEvent(input: { runId; eventType: "text.delta" | "thought"; payload: Record<string, unknown> }): Promise<unknown>`；
   - `recordToolEffectOnce.execute` 内调 `deps.dispatch` 时传入 `streamingAdapter`：`onToken(chunk)` → `chunk.reasoningContentDelta` 非空写 `thought` 事件（payload `{ text: chunk.reasoningContentDelta }`）；`chunk.contentDelta` 非空写 `text.delta` 事件（payload `{ delta: chunk.contentDelta }`）；`onComplete/onError` 不另写事件（终态事件由 runtime 既有链路发射）；
   - **幂等性天然成立**：流式副作用位于 `execute` 内，恢复重放时 `recordToolEffectOnce` 跳过 `execute`，不重复发射；
   - 逐 chunk 直发，**不做 coalescing 优化**（超出本单范围，可作后续优化项记录于 handoff）；
3. `harness-boot.ts` L48 `createWorkbenchChatWorkflow` 接线处补 `appendRunEvent` 依赖（复用 runtime repository 的 `appendRunEvent`，runId 用 `run.harnessRunId`）；
4. **同步路径零改动**：`workbench-chat-stream.handler.ts` 逐字行为不变。

### 明确禁止

- 不得改 `useBackgroundRuns.jsx` provider 链路 / 通知机制（ISS-001/002 验收口径）；
- 不得改后端统一视图契约（`runId` 字段名不得变更/新增 `id` 别名）；
- 不得改 503 回退同步路径与 `submitRun` 提交流程；
- 不得触碰 `UserManagement` 相关页面（另一会话 WIP）。

## 4. Allowed Paths

- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js`
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/index.jsx`
- `ui/V2_PROTOTYPE/src/__tests__/unified-view.test.jsx`
- `apps/api/src/modules/harness/harness-runtime.types.ts`
- `apps/api/src/modules/harness/harness-runtime.types.test.ts`（仅新增 additive 断言）
- `apps/api/src/modules/harness/workbench-chat.workflow.ts`
- `apps/api/src/modules/harness/workbench-chat.workflow.test.ts`
- `apps/api/src/modules/harness/harness-boot.ts`（仅接线）
- `docs/agent-loop/work-orders/2026-08-10-qoder-ISS-2026-08-10-004-runid-mismatch-async-streaming.md`（handoff 回填）

## 5. RED 要求（≥4，先贴红输出再修）

1. 前端新增：统一视图 run 为契约形状（`runId`）时 `activeRunId` 可被发现 → 修复前红；
2. 前端新增：ChatArea 停止按钮以 `runId` 调 `cancelRun` → 修复前红；
3. 后端 workflow 测试：dispatch 入参含 `streamingAdapter`，`onToken` 经 `appendRunEvent` 写 `text.delta`（payload.delta）/ `thought`（payload.text）事件 → 修复前红；
4. 后端 types 测试：`HARNESS_RUN_EVENT_TYPES` 含 `text.delta`/`thought`（additive 断言）→ 修复前红。

## 6. 验证矩阵

- `npm run test:web` ≥287 全绿；
- `npm run test:modules` ≥321 全绿；
- `npm run build:web`、`npm run build:api` 零错误；
- `git diff 8bcbd91 -- apps/ package-lock.json` 输出路径全部落在 Allowed Paths；
- 主检出零接触：执行全程在 worktree 内，不碰 main 工作区脏页。

## 7. 分支与提交

- 分支：`qoder/iss-2026-08-10-004-runid-mismatch-async-streaming`，从 main HEAD `8bcbd91` 开 worktree；
- 提交规范：`type(scope): 中文描述`，聚焦「为什么」；
- 合入须用户批准，一律 `--no-ff`；
- 回填状态只允许「已回填 / 待 Codex 复核」，不得自行宣布「已交付」。

## 8. Handoff 格式

按 `docs/codex-workflows/external-ai-handoff-template.md` 回填：目标、改动文件清单（对 Allowed Paths）、RED 先红证据、验证矩阵输出、风险与范围外观察、看板同步建议、下一步。

## 9. 验收口径（人工复测）

1. 发问后对话区占位约 2 秒内被逐字流式替换；模型有推理输出时思考块可见；
2. 执行期间停止按钮可点且能取消任务；
3. 完成后会话行徽标 / 右下角通知正常不回退（ISS-001/002 验收口径不回归）；
4. 切会话再切回内容与流式结果一致（ISS-2026-08-09-003 C2 兜底不回归）；
5. **ISS-2026-08-10-003 复测第 2 项（逐字流式及时开始）并入本单第 1 项一并复测**；003 第 1/3/4 项可先行独立复测。

---

## Handoff 回填（KIMIK3 · 2026-08-10）

### 状态
已回填 / 待 Codex 复核。分支 `qoder/iss-2026-08-10-004-runid-mismatch-async-streaming`，修复提交 `d3940d3`（base `caf45e6` worktree 执行，主检出零接触）。

### 目标
修复 AI 工作台异步通道两层叠加缺陷：层 1 前端 runId 字段错配（对话区不收敛、停止按钮失效、mock 假绿洞）；层 2 后端异步通道从不发射 text.delta/thought 流式事件（无逐字、无思考）。

### 变更文件（对照 §4 Allowed Paths，8/8 全部落界）
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js`：`activeRunId` 改取 `run.runId || run.id`（契约为主、兼容兜底），页面级 SSE 订阅恢复建立。
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/index.jsx`：停止按钮 `cancelRun(activeRun.runId || activeRun.id)`。
- `ui/V2_PROTOTYPE/src/__tests__/unified-view.test.jsx`：全部 run mock 修为后端契约形状（`runId`，移除假 `id`）堵假绿；新增停止按钮 cancelRun 契约字段用例。
- `apps/api/src/modules/harness/harness-runtime.types.ts`：`HARNESS_RUN_EVENT_TYPES` additive 追加 `text.delta`、`thought`（14 → 16）。
- `apps/api/src/modules/harness/harness-runtime.types.test.ts`：新增 ISS-004 additive 断言；两条既有 length 冻结断言 14 → 16（additive 必然结果）。
- `apps/api/src/modules/harness/workbench-chat.workflow.ts`：deps 新增 `appendRunEvent`（可选，见风险 2）；`execute` 内 dispatch 注入 `streamingAdapter`，`onToken` 逐 chunk 写事件（`contentDelta` → `text.delta({delta})`，`reasoningContentDelta` → `thought({text})`），写链串行化保序、execute 返回前冲刷；`onComplete/onError` 不另写事件。
- `apps/api/src/modules/harness/workbench-chat.workflow.test.ts`：新增流式事件写入与恢复重放幂等 2 条守护；既有构造点补 no-op dep。
- `apps/api/src/modules/harness/harness-boot.ts`：接线 `appendRunEvent`（复用 runtime repository）；dispatch 闭包转发 `streamingAdapter` 并补 `modelChatStream`（见风险 1）。

### RED 先红证据（修复前实跑输出）
- 前端（契约 mock 下 `vitest run unified-view`，2 failed / 9 passed）：
  1. `发问后统一视图刷新发现新 run，O8 页面级流式订阅建立并逐字呈现（ISS-2026-08-10-003）` × —— mock 改契约形状后假绿洞暴露，`activeRunId` 恒 `''`，`流式字` 不渲染；
  2. `对话区停止按钮以 runId 契约字段调用 cancelRun（ISS-2026-08-10-004）` × —— cancel 请求落 `/ai-runs/undefined/cancel`，`cancelCalls` 不含 `run-1`。
- 后端（`tsx --test` 直跑两文件，修复前）：
  3. `ISS-004 层 2：dispatch 入参携带 streamingAdapter…` × —— `dispatch 入参必须携带 streamingAdapter`，actual `undefined`；
  4. `ISS-2026-08-10-004 adds streaming text.delta/thought event types additively` × —— `逐字流式事件类型必须入白名单`；
  5. （加分项）`恢复重放跳过 execute，流式事件不重复发射` × —— `首次执行发射 1 条 text.delta`，0 !== 1。

### 验证命令与结果（修复后）
- `npm run test:web`：pass，42 文件 288/288（≥287 ✓，含 unified-view 11/11）
- `npm run test:modules`：pass，321/321（≥321 ✓）
- `npm run build:web`：pass，零错误（仅既有 chunk size 警告）
- `npm run build:api`：pass，`tsc` 零错误
- `npx tsx --test workbench-chat.workflow.test.ts harness-runtime.types.test.ts`：pass，15/15
- `git diff 8bcbd91 -- apps/ package-lock.json`：5 个变更文件全部落在 Allowed Paths（package-lock.json 零变更）
- 主检出零接触：全程在 `/Users/kevin/AI/wes-worktrees/iss-2026-08-10-004` 执行；`config/auth/users.json` 测试污染已还原未提交

### 风险与范围外观察
1. **工单 §3 层 2 未覆盖的必要接线（已在界内补齐）**：dispatch 流式闸门（`model-answer.ts` L51）要求 `streamingAdapter` + `modelChatStream` 同时存在，缺一则静默回退非流式。仅按工单字面注入 adapter 验收 §9.1 逐字流式不会发生；已在 `harness-boot.ts`（Allowed Paths「仅接线」）补 `modelChatStream`，参数与同步 SSE 路径同款（异步通道无历史消息，直推当前 userContent）。同步路径 `workbench-chat-stream.handler.ts` 零改动。
2. **`appendRunEvent` dep 调整为可选**：工单 §3 给的签名为必填，但 `harness-session-projector.test.ts` L365 存在另一 `createWorkbenchChatWorkflow` 构造点且不在 Allowed Paths，必填会破坏 `build:api`。可选保持 additive 不破坏既有契约；生产 boot 始终注入，未注入时流式事件静默跳过不影响主链路。
3. **`workbench-chat.workflow.test.ts` 未挂在任何 npm 测试脚本**（pre-existing 缺口，test:modules/test:harness 清单均无）：本单经 `npx tsx --test` 直跑验证；`apps/api/package.json` 不在 Allowed Paths 未改，建议后续单独立项挂入脚本。
4. `test:harness`（testcontainers/PostgreSQL）本机 Docker 不可用未执行；types 测试已单跑 15/15 验证，建议复核环境补跑。
5. 逐 chunk 直发未做 coalescing（工单明确范围外）：高频 token 下 run 事件行数较多，记录为后续优化项。
6. 流式事件单条写失败仅 `console.error` 不阻断模型主链路；最终答案仍以 outbox assistant 消息落库为准，对话区收敛不依赖逐字事件全部成功。

### 是否需看板同步
是。建议页面：
- requirements：ISS-2026-08-10-004 状态流转「已回填 / 待 Codex 复核」；
- testing：新增 5 条守护用例（前端 2 + 后端 3）与验证矩阵结果；
- changes：提交 `d3940d3` 两层修复证据。

```text
type=implementation
date=2026-08-10
scope=ISS-2026-08-10-004 异步通道对话区收敛+逐字流式（runId 错配 & 流式事件接入）两层修复
evidence=commit d3940d3；test:web 288/288；test:modules 321/321；build:web/build:api 零错误
pages=requirements,testing,changes
status=待验证
next=人工验收 §9 五项（含 ISS-2026-08-10-003 复测第 2 项并入），用户批准后 --no-ff 合入
```

### 下一步建议
- 等待人工验收（§9 五项：2s 内逐字替换占位/思考块可见、停止可取消、徽标与通知不回归、切会话一致、003 第 2 项并入复测）；
- 合入须用户批准，`--no-ff`；
- 后续优化项入池：流式事件 coalescing；workflow 测试挂入 npm 脚本。
