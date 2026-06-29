# WES Agent Phase 1H-A 施工提示词

> 用途：交给 KIMI/Codex 执行 Phase 1H-A 实现。  
> 当前状态：Phase 1G 已交付；Phase 1H-A 已从需求池完成迭代规划，进入实现准备。  
> 工作区：`/Users/kevin/AI/Workload-evaluation-system-agent`。  
> 实施计划：`docs/superpowers/plans/2026-06-23-wes-agent-phase-1h-a-workbench-ux.md`。  
> 需求池事实源：`03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`。  
> 测试计划：`03_技术设计/系统架构/WES-Agent-升级总看板/testing.html` 中 `MT-1H-A-001` ~ `MT-1H-A-006`。

## 角色与目标

你是资深前端工程师 + 全栈边界审查者。请在当前 WES Agent 主线中实现 Phase 1H-A：**AI 工作台体验闭环批次**。

本轮只处理需求池中已排期的 5 条需求：

1. `RP-017` AI 工作台切换后会话丢失。
2. `RP-014` AI 工作台消息发送后自动滚动到底部。
3. `RP-015` AI 工作台消息发送框高度不可调节。
4. `RP-016` AI 工作台创建项目后关联记录与列表未刷新。
5. `RP-011` 检索主体弹窗化改造收尾。

本轮产品目标：

> 用户在 AI 工作台完成“发起会话 → 长文本输入 → 发送消息 → 检索客户主体 → 创建项目 → 切换页面再返回”的连续操作时，状态不丢、视图不滞后、输入区可控、反馈可见。

## 必须遵守的边界

- 当前 Web 主线是 `ui/V2_PROTOTYPE`，禁止恢复或新增第二前端。
- 当前后端主线是 `apps/api`，除非确实缺少响应字段，否则本轮不要扩展后端接口。
- 业务接口默认 JWT 鉴权，禁止回退到 `X-Role`。
- 不绕过 owner 隔离、权限、版本和人工确认链路。
- 保持 Phase 1G 意图路由：普通追问不生成 v2，明确报告请求和结构化补充才进入 Harness 报告链路。
- 本轮不实现 `RP-013` 通用化交互渲染、不实现 `RP-001` 低代码工作流设计器、不实现 `RP-012` WES Skill。
- 当前 worktree 可能有既有 dirty changes。不要执行 `git reset --hard`、`git checkout --`、`git restore` 大范围还原，也不要清理无关文件。

## 当前代码事实

优先读取这些文件：

- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- `ui/V2_PROTOTYPE/src/hooks/useAiSessions.js`
- `ui/V2_PROTOTYPE/src/components/AiWorkbench/CompanyLookupDialog.jsx`
- `ui/V2_PROTOTYPE/src/components/AiWorkbench/ArtifactPanel.jsx`
- `ui/V2_PROTOTYPE/src/api/ai.js`
- `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
- `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`

已观察到的实现基线：

- `AiHomeWorkbench.jsx` 已导入 `useLayoutEffect`、`useRef`，但消息面板尚未显式绑定滚动 ref。
- `useAiSessions.js` 的 `loadSessions()` 当前会 `setActiveSession((current) => current || items[0] || null)`，无法恢复卸载前的活跃会话。
- `AiHomeWorkbench.jsx` 当前 `loadSessions().catch(() => {})` 静默吞掉会话加载失败。
- 底部 composer 已使用 `textarea`，但高度固定感明显，需要用更稳定的 min/max/resize 策略。
- `CompanyLookupDialog.jsx` 已存在，当前需要收尾 loading、空态、失败态、选择写回和可访问性。
- `confirmPendingAction()` 创建项目后会 `upsertSession()` 写入 `linkedRecords`，但还需要确保关联记录面板和项目列表能感知刷新。

## 推荐实施顺序

### 1. 会话恢复与错误提示（RP-017）

修改 `ui/V2_PROTOTYPE/src/hooks/useAiSessions.js`：

- 增加 `ACTIVE_SESSION_STORAGE_KEY = 'wes-ai-active-session-id'`。
- 在 `upsertSession(session)` 成功后写入 active session ID。
- 在 `loadSessions()` 完成后优先用 localStorage 中的 sessionId 恢复 active session。
- 如果 stored ID 不存在于后端返回列表，则回退到当前 active session；当前 active session 也不存在时回退到 `items[0]`。
- 增加 `sessionsError` 状态和 `clearSessionsError()`。
- `loadSessions()` 失败时写入 `AI 会话加载失败：<message>`，并继续向外 throw，让调用方可以维持现有 catch。

修改 `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`：

- 从 hook 解构 `sessionsError`、`clearSessionsError`。
- 在头部区域展示 `role="alert"` 的错误提示和关闭按钮。
- `startNewSession()`、`selectSession(session)`、删除当前 session 后都要通过 hook 暴露的 `setActiveSession` 包装函数更新 localStorage。

验收：

- `MT-1H-A-001` 通过。
- 切换侧边栏或 AI/传统工作台后返回，原会话与消息完整恢复。
- `/ai-sessions` 失败时有可见错误，而不是空白或静默失败。

### 2. 消息自动滚动与 composer 高度（RP-014 / RP-015）

修改 `AiHomeWorkbench.jsx`：

- 新增 `const messagePaneRef = useRef(null)`。
- 给 `data-testid="ai-home-message-pane"` 的 div 绑定 `ref={messagePaneRef}`。
- 增加 `useLayoutEffect`，在 `messages.length`、`sending` 或最后一条消息内容变化后执行：

```js
const pane = messagePaneRef.current
if (pane) pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' })
```

- 保持滚动只发生在消息面板，不要让整个页面滚动。
- 将底部 textarea 调整为：
  - `minHeight: 54`
  - `maxHeight: 180`
  - `resize: 'vertical'`
  - `overflowY: 'auto'`
  - 发送按钮和附件按钮使用固定高度，不随 textarea 内容跳动。

验收：

- `MT-1H-A-002`、`MT-1H-A-003` 通过。
- 连续发送消息后最新消息可见。
- 长文本输入时可扩大编辑区；按钮始终可见。

### 3. 创建项目后的刷新闭环（RP-016）

修改 `AiHomeWorkbench.jsx` 的 `confirmPendingAction(action)`：

- 项目创建成功后保留现有 `linkedRecords.projectId/projectName` 写入。
- 追加一条 assistant 消息：`项目已创建并关联：<projectName>`。
- 派发同窗口事件：

```js
window.dispatchEvent(new CustomEvent('wes-project-evaluation-created', { detail: { project } }))
```

- 如果项目列表组件已有数据加载函数，则在项目列表组件里监听该事件并触发局部刷新；如果没有事件监听机制，则在切换传统工作台时确保项目列表重新拉取 `/project-evaluations`。
- 不要用整页 `window.location.reload()`。

验收：

- `MT-1H-A-004` 通过。
- AI 创建项目成功后右侧关联记录立即显示新项目。
- 切换到项目列表后可见新项目。

### 4. 检索主体弹窗收尾（RP-011）

修改 `CompanyLookupDialog.jsx`：

- 保持 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`。
- 关闭按钮使用明确 `aria-label="关闭检索主体弹窗"`。
- loading 态展示 spinner + `正在检索近似企业…`。
- error 态展示错误文案和关闭按钮，不使用空白图标。
- empty 态展示 `未找到近似企业，请尝试更具体的关键词`。
- candidates 列表按钮支持点击选择。

修改 `AiHomeWorkbench.jsx`：

- 确认已有状态：`companyLookupOpen`、`companyLookupLoading`、`companyLookupError`、`companyCandidates`。如果名称不同，沿用当前文件已有命名。
- 触发检索时调用 `summarizeCompanyProfile()`。
- 选择候选后关闭 Dialog，并追加 assistant 消息：`已选择客户主体：<displayName>`。
- 如当前报告卡片或附件理解上下文里有 customerName，可优先作为检索入参。

验收：

- `MT-1H-A-005` 通过。
- 弹窗打开、loading、选择、关闭、空结果、失败提示都可见。

### 5. Phase 1G 回归保护

本轮改动不能破坏 Phase 1G：

- 上传附件 + 业务问题：不自动生成 v1。
- 上传附件 + 明确“生成需求解析报告”：继续生成 v1。
- v1 后普通追问：不自动生成 v2。
- 结构化补充：继续生成 v2。

验收：

- `MT-1H-A-006` 通过。
- 既有 `HomeWorkspace.test.jsx` 中 Phase 1G 相关测试保持通过。

## 自动化测试要求

至少补充这些前端测试：

1. `restores the last active AI session after the workbench remounts`
2. `shows a visible error when AI sessions fail to load`
3. `scrolls the AI message pane to bottom after sending and receiving messages`
4. `keeps composer controls visible for long text input`
5. `updates linked records and project list after confirming project creation`
6. `opens company lookup dialog and writes selected candidate back to the workbench`
7. Phase 1G 回归：普通追问不生成 v2，明确报告请求仍生成 v1，结构化补充仍生成 v2。

建议命令：

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace.test.jsx
npm run test --prefix ui/V2_PROTOTYPE
npm run build --prefix ui/V2_PROTOTYPE
```

如果改动 `apps/api` 或接口契约，再运行：

```bash
npm run test:modules -w apps/api
npm run build -w apps/api
```

## 文档与看板交付要求

实现完成后才允许把需求状态改为已交付或完成。

需要同步：

- `requirements.html`：`RP-011` / `RP-014` / `RP-015` / `RP-016` / `RP-017` 的状态。
- 【历史说明，已下线】`requirements-editor.html` 已于 2026-06-26 移除；后续直接维护 `requirements.html`。
- `testing.html`：`MT-1H-A-*` 保持待执行，除非有真实人工测试结果。
- `changes.html`：记录实现内容、验证命令和结果。
- `monitoring.html`：如产生新的验证快照，记录命令结果。

## 提交建议

提交前先检查：

```bash
git status --short
```

只 stage 本轮相关文件，不 stage 无关 dirty changes。

建议提交信息：

```bash
git commit -m "fix(WES Phase 1H-A): 闭合 AI 工作台高频体验断点"
```

## 最终验收口径

本轮完成必须同时满足：

- 自动化测试通过。
- V2 前端构建通过。
- 会话切换后可恢复。
- 消息发送/回复后自动滚动到底部。
- 长文本 composer 可用且按钮不被遮挡。
- AI 创建项目后关联记录和项目列表可见新项目。
- 检索主体 Dialog 交互完整。
- Phase 1G 意图路由行为不回退。
- 总看板记录实现和验证证据，人工测试结果未执行时明确保持待执行。
