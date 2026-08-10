# 工单 · ISS-2026-08-10-003：提交成功后统一视图即时刷新（顶栏角标即时性 + O8 流式发现）

> 状态：**已编制 / 待用户拍板派发**
> 类型：requirement（P2 体验改进）· 来源：ISS-2026-08-10-002 修复回填的两项范围外观察，主会话裁定同源合并，2026-08-10 用户拍板入池并编制本工单
> 交叉引用：ISS-2026-08-10-002（右下角角标，已验收关闭）/ ISS-2026-08-10-001（已验收关闭）/ ISS-2026-08-09-003（另一会话 8-09 前端对账，不同题）

## 1. 业务症状

用户在 AI 工作台发问后（异步通道）：

1. **顶栏角标不即时**：顶栏「进行中 N」要等下一次统一视图重拉（重挂载 / 页签切回）才出现，发问当下仍显示旧值；
2. **O8 逐字流式延迟**：页面级流式呈现依赖 `activeRunId`（取自统一视图 runs），发问后统一视图不刷新则 `activeRunId` 为空，SSE 逐字订阅不建立，逐字呈现要等下次重拉才开始。

右下角全局角标已由 ISS-2026-08-10-002 修复（provider 独立数据源 + `notifyRunsChanged` 入口），**本工单不涉及右下角链路，不得改动 `useBackgroundRuns.jsx` 的通知机制**。

## 2. 根因（已核验，置信度高）

统一视图（`unifiedView`）刷新时机仅两处：

- `useWorkbenchState.js` L64-83：挂载首拉；
- `useChatMessages.js` L211-219：`visibilitychange` 页签切回重拉。

而提交流程 `useChatMessages.js` L438-475：`submitRun` 成功（`runSubmitted === true`）后直接 `return` 等待 SSE，**不触发 `refreshUnifiedView`**。于是：

- 顶栏角标数据源 `workbench.unifiedView?.runs`（`AiHomeWorkbench/index.jsx` L40-43 `runCounts`）停留旧值；
- `activeRunId`（`useChatMessages.js` L222-224）为空，O8 页面级 SSE 订阅不建立。

## 3. 修复方案

### 方案 A（推荐）：提交成功后触发一次统一视图刷新

`useChatMessages.js` 中 `runSubmitted === true` 分支（return 前）调用一次：

```js
workbenchRef.current?.refreshUnifiedView?.().catch(() => {})
```

- 复用既有 `refreshUnifiedView`（= `loadUnifiedView`，幂等 GET）与页签切回同款 fire-and-forget 模式（对齐 L215 既有写法）；
- 仅异步通道成功路径触发；503 回退同步路径、409 冲突、flag 关闭路径**逐字不变**（同步路径无 run 概念，刷新无意义，不得添加）；
- 统一视图更新后 `activeRunId` 经渲染重算自然获得新 runId，O8 SSE 订阅随之建立，无需额外改动。

### 方案 B（备选）：`useWorkbenchState` 层对 `loadUnifiedView` 加节流并由页面侧调度

仅当方案 A 在 RED 阶段暴露时序竞争（如刷新早于后端 run 落库导致拉到空）时采用：节流 1-2s + 重试一次。默认不实施。

### 硬口径

- 零 cancel：不得引入任何 run 取消调用；
- 不动右下角链路：`useBackgroundRuns.jsx`、`notifyRunsChanged` 及其调用点零改动；
- 同步回退路径行为逐字不变。

## 4. 执行契约（Qoder worktree 协议）

- 执行前必读 `QODER.md` 与 `skills/wes-qoder-worktree-protocol/SKILL.md`，完成 Worktree Contract ACK；
- 分支：`qoder/iss-2026-08-10-003-unified-view-refresh-after-submit`；
- base：main `78245d3`（编制时 HEAD；派发时若 main 已前进，以派发时 main HEAD 为准并回填实值）；
- worktree 由执行方按协议新建，初始化执行根目录与 `ui/V2_PROTOTYPE` 两次 `npm install`；
- 主检出存在用户未提交工作（看板页、UserManagement 等），**全程零接触**。

## 5. Allowed Paths（仅允许改动）

1. `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js`（核心修复）
2. `ui/V2_PROTOTYPE/src/__tests__/background-runs.test.jsx`（仅追加用例）
3. `ui/V2_PROTOTYPE/src/__tests__/unified-view.test.jsx`（仅追加用例，如需要）
4. `docs/agent-loop/handoffs/2026-08-10-qoder-ISS-2026-08-10-003.md`（新建回填）

超出以上路径的任何改动（含 lockfile、apps/、看板页、`useBackgroundRuns.jsx`）一律返工。

## 6. RED 要求（≥3 例，先红后绿）

全部追加进既有测试文件，不新建文件、不改既有用例断言：

1. **提交成功触发统一视图刷新**：Shell 全挂载发问，`submitRun` 成功，断言 `refreshUnifiedView` 对应请求在合理时限内发出（或顶栏 `runCounts` 数据源更新）；
2. **O8 流式发现**：提交成功且统一视图刷新返回新 run 后，`activeRunId` 非空（页面级 SSE 订阅建立的前提成立）；
3. **同步回退路径零影响**：flag 关闭（或 503 回退）时发问，断言不产生额外统一视图刷新请求、行为与 base 一致。

## 7. 验证矩阵（执行方实跑 + 主会话复审复跑）

| 检查 | 口径 |
|---|---|
| RED 先行 | ≥3 新用例在 base 代码上失败，实现后转绿 |
| `npm run test:web` | ≥283 + 新增全绿（当前基线 283） |
| `npm run test:modules` | 321/321（后端零改动复验） |
| `npm run build:api` / `npm run build:web` | 双 exit 0 |
| `git diff <base> -- apps/ package-lock.json` | 零输出 |
| UI scope 检查 | `node skills/improving-wes-ui/scripts/check-ui-scope.mjs`（前置 `npx ui-skills start`）无新确定性发现 |

## 8. Handoff 回填要求

按 `docs/codex-workflows/external-ai-handoff-template.md` 回填 `docs/agent-loop/handoffs/2026-08-10-qoder-ISS-2026-08-10-003.md`：目标、worktree 信息、变更文件、RED 证据（实跑输出）、验证命令与结果、git log 实输出、风险、范围外观察、是否建议看板同步。状态上限「已回填 / 待主会话复审」，不得自宣「已交付」。

## 9. 验收口径（人工复测）

1. 开异步开关，在工作台发一句问题——**顶栏「进行中 ≥1」在 2 秒内出现**（无需切走页签）；
2. 发问后留在当前页——**AI 回复逐字流式呈现及时开始**（不等页签切回）；
3. 右下角角标行为不回退（ISS-002 验收口径仍满足：2s 内 ≥1 / 完成收敛 + 通知）;
4. 关闭异步开关回退同步路径——行为与修复前逐字一致。
