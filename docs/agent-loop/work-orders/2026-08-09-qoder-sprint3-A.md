# Qoder Sprint 3A Work Order — O5 统一视图接口 + O8 前端流式 UX（串行）

- Date: 2026-08-09
- Executor: Qoder 执行会话
- Sprint 3 批次 A（用户 2026-08-09 批准开工）
- Status: 已派单（用户批准 Sprint 3 开工）

## 1. 合同坐标

- worktree: `.claude/worktrees/sprint3-unified-view-streaming`
- branch: `qoder/sprint3-unified-view-streaming`
- baseCommit: `4c28116`（main 当前 HEAD，O10 B/C 已合入）
- 预计: 17h（O5 11h → O8 6h，严格串行：O5 先行）
- 与 Sprint 3B（O6 质量基线，另一 worktree）文件零交集，可并行

## 2. 任务 A：O5 统一视图接口（11h）

目标：一个接口返回会话 + Run + 待办任务 + 产物 + 失败原因，消除前端多套状态拼装；为 RP-035（工作台页面数据一次取齐）建数据底座。

### A1 后端统一视图接口
- 新建 `apps/api/src/modules/harness/workbench-view.ts`（或在既有 harness 模块内新增）：
  - `GET /api/v1/ai/home-workbench/view`（JWT 鉴权）返回：
    `{ sessions: [...], runs: [{ id, sessionId, status, latestEventKind, failedReason? }], tasks: [...], artifacts: [...], failedRuns: [{ runId, error, retriable }] }`
  - 数据源复用既有 repository（sessions / runs / artifacts），不得新建重复存储
- 挂路由：`apps/api/src/routes/` 既有 harness/workbench 路由文件 + `routes/index.ts` 聚合

### A2 前端消费
- `ui/V2_PROTOTYPE/src/api/` 新增 view 接口封装（复用既有 fetch 层）
- AiHomeWorkbench 首屏与刷新时机接入统一视图；既有 useAiSessions / useAiTasks 保持可用（渐进替换，不一把删）

### A3 测试
- 后端接口测试（node:test）：视图字段完整、失败 Run 携带 failedReason、数据隔离（仅本人数据）
- 前端守护测试：首屏渲染走统一视图接口

## 3. 任务 B：O8 SSE 前端流式 UX（6h，O5 完成后开工）

目标：回复逐字呈现 + 思考折叠 + 中断按钮（RP-029 批次 2 前端闭环）。后端事件流底座已就绪（`/api/v1/ai-runs/:runId/events` + `ui/V2_PROTOTYPE/src/api/aiRuns.js` 的 SSE 订阅封装，Batch E 已接线）。

- 逐字呈现：`useChatMessages.js` 消费 `text.delta` 事件流实时追加到消息气泡（替代/补强当前整条到达方式）
- 思考折叠：`thought` 事件渲染为可折叠区块，默认收起
- 中断按钮：Run 进行中 Composer 显示停止按钮，调用既有 `DELETE /api/v1/ai-runs/:runId`（aiRuns.js 已封装）
- 守护测试：delta 顺序拼接正确、停止按钮存在且调用 DELETE、事件乱序/重复的幂等处理（基于 eventCursor/seq）

## 4. 硬口径

- Run 生命周期与状态机（scheduled/running/succeeded/failed）零变更
- G-E2/G-E4 守护、409/503 行为、旧同步入口 `/ai/home-workbench/chat` 保留——全部不回退
- 数据隔离不放松（统一视图仅返回本人数据）
- 不新增依赖、不新增数据库 schema；不触碰 O6/O10 范围文件（services/ai/eval、capability 相关）

## 5. Allowed Paths（可修改范围）

- apps/api/src/modules/harness/（新增视图服务 + 测试）
- apps/api/src/routes/（视图路由）
- ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/（hooks + 组件）
- ui/V2_PROTOTYPE/src/api/（新增封装）
- ui/V2_PROTOTYPE/src/__tests__/（测试）
- docs/agent-loop/handoffs/2026-08-09-qoder-sprint3-A.md（回填）
- 禁止：services/ai/eval/、capability/intent 文件（O6/O10 域）、总看板（主会话维护）

## 6. 执行要求

- RED 先行：先写失败测试
- 验证命令（全部全绿方可回填）：
  - `npm run test:harness`（apps/api 下，需 colima + Testcontainers 环境变量，见 RP-047 工单先例）
  - `npm run test:modules`、`npm run test:web`、`npm run build:api`、`npm run build:web`
- 每项验证命令回填时**必须附实际输出摘要**（tests/pass/fail 计数），禁止只报部分命令
- 提交格式：`feat(harness+web): Sprint 3A · 统一视图接口与前端流式 UX`；handoff 提交用 `docs(handoff): Sprint 3A 回填 · ...`
- 完成后状态停在「已回填 / 待主会话复审」

## 7. 初始化提示词（派单用）

```
你是 WES 项目的 Qoder 执行会话，负责执行 Sprint 3A（O5 统一视图接口 + O8 前端流式 UX，串行）。先完整阅读 work order：docs/agent-loop/work-orders/2026-08-09-qoder-sprint3-A.md 与 AGENTS.md、QODER.md、skills/wes-qoder-worktree-protocol/SKILL.md。执行步骤：1) 完成 Worktree Contract ACK，初始化 worktree .claude/worktrees/sprint3-unified-view-streaming 与分支 qoder/sprint3-unified-view-streaming（baseCommit=4c28116）；2) 先执行任务 A（统一视图接口 + 前端接入），验收后再开工任务 B（逐字呈现/思考折叠/停止按钮）；3) 硬口径：Run 状态机、G-E2/G-E4 守护、409/503、数据隔离、旧同步入口零回退；零新增依赖与 schema；4) 每项验证命令的实际输出摘要必须写入 handoff；5) 全部绿后回填 docs/agent-loop/handoffs/2026-08-09-qoder-sprint3-A.md，状态停在「已回填 / 待主会话复审」，不合并 main、不更新总看板。
```
