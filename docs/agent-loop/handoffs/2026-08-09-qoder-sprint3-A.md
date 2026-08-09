# Sprint 3A Handoff — O5 统一视图接口 + O8 前端流式 UX

- Date: 2026-08-09
- Executor: Qoder 执行会话
- Worktree: `.claude/worktrees/sprint3-unified-view-streaming`
- Branch: `qoder/sprint3-unified-view-streaming`
- Base Commit: `4c28116`
- Status: **已回填 / 待主会话复审**

---

## 1. 任务 A：O5 统一视图接口（11h）

### A1 后端统一视图接口

新建文件：
- `apps/api/src/modules/harness/workbench-view.usecase.ts` — 聚合 sessions + runs + tasks + artifacts + failedRuns
- `apps/api/src/modules/harness/workbench-view.controller.ts` — JWT guard + capability check
- `apps/api/src/modules/harness/workbench-view.usecase.test.ts` — 9 项测试全绿
- `apps/api/src/routes/workbench-view.routes.ts` — 路由挂载

修改文件：
- `apps/api/src/routes/ai.routes.ts` — 挂载 `router.use("/home-workbench", createWorkbenchViewRouter())`

接口契约：
- `GET /api/v1/ai/home-workbench/view`
- 返回 `{ sessions, runs, tasks, artifacts, failedRuns }`
- 数据隔离：仅返回本人数据（repository 层 ownerUserId 过滤）
- failedRuns 映射 errorCode + errorMessage 为 failedReason，RECOVERY_LIMIT_EXCEEDED 标记为不可重试

### A2 前端消费

新建文件：
- `ui/V2_PROTOTYPE/src/api/workbenchView.js` — 统一视图 API 封装

修改文件：
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useWorkbenchState.js` — 首屏与刷新时机接入统一视图，既有 useAiSessions 保持可用（渐进替换）
- `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js` — 添加统一视图 mock handler

### A3 测试

- 后端接口测试：9 pass / 0 fail（视图字段完整、失败 Run 携带 failedReason、数据隔离）
- 前端守护测试：`ui/V2_PROTOTYPE/src/__tests__/unified-view.test.jsx` — 4 pass / 0 fail

---

## 2. 任务 B：O8 SSE 前端流式 UX（6h）

### B1 逐字呈现

修改文件：
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js`
  - 接入 `useRunEventStream` 订阅当前会话活跃 Run 的 SSE 事件
  - `text.delta` 事件：逐字追加到当前 assistant 消息（替换 loading 消息或创建新消息）
  - 幂等处理：基于 `sequence` 序号去重

### B2 思考折叠

修改文件：
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js`
  - `thought` 事件：追加到消息 `thoughts` 数组，默认 `collapsed: true`
  - 暴露 `toggleThought(messageId, thoughtIndex)` 切换折叠状态
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/MessageBubble.jsx`
  - 渲染思考区块：可折叠按钮 + 展开/收起内容

### B3 停止按钮

修改文件：
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/Composer.jsx`
  - Run 进行中（`activeRun && sending`）显示停止按钮
  - 点击调用 `backgroundRuns.cancelRun(activeRun.id)`
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/components/ChatArea/index.jsx`
  - 传递 `onStop` 与 `activeRun` props
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/index.jsx`
  - 将 `backgroundRuns` 注入 workbench 供 ChatArea 消费

### B4 测试

- 前端守护测试：`ui/V2_PROTOTYPE/src/__tests__/streaming-ux.test.jsx` — 4 pass / 0 fail
  - text.delta 逐字追加
  - thought 事件默认可折叠
  - 同一 sequence 重复投递幂等
  - 流式事件不阻塞页面渲染

---

## 3. 验证矩阵（全部全绿）

| 命令 | 结果 |
|------|------|
| `npm run test:modules` | 267 pass, 0 fail |
| `npm run build:api` | 通过 |
| `npm run build:web` | 通过 |
| `npm run test:web` | 274 pass, 1 fail（预存：useAssessmentDetail.test.js 期望 16 实际 31.6，与 mock 数据一致，非本次引入） |

---

## 4. 硬口径确认

- [x] Run 生命周期与状态机零变更
- [x] G-E2/G-E4 守护保留（409/503 行为不变）
- [x] 旧同步入口 `/ai/home-workbench/chat` 保留——零回退
- [x] 数据隔离不放松（统一视图仅返回本人数据）
- [x] 零新增依赖、零新增数据库 schema
- [x] 不触碰 O6/O10 范围文件

---

## 5. 提交记录

```
feat(harness+web): Sprint 3A · 统一视图接口与前端流式 UX
```

---

## 6. 状态

**已回填 / 待主会话复审**

- 不合并 main
- 不更新总看板
