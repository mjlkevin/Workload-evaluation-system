# RP-047 Batch D 实施计划 — 前端多会话与后台任务体验

- 编制：Codex 主会话（O3-D），2026-08-07
- 范围基准：roadmap `docs/superpowers/plans/2026-08-03-rp-047-post-a2-execution-roadmap.md` Task 4（L174-200，唯一范围来源）
- 规格依据：`docs/superpowers/specs/2026-08-02-rp-047-durable-multichannel-checkpoint-runtime-design.md` §4.3 / §12 / §16 批次 D
- 前置：Batch B（1bd8477）与 Batch C（70e78b1）已合入 main，Gate B/C 关闭

## 0. 范围映射（roadmap Task 4 ↔ 本计划）

| roadmap Task 4 要素 | 本计划章节 |
|---|---|
| Branch `qoder/rp-047-d-multisession-ui` | §3 D0、工单 §1 |
| Business surface（AI 工作台 + Shell 后台任务提示，必读 improving-wes-ui） | §3 D6/D7、工单 §4 Step 5/6 |
| Primary files（7 条，含 Shell owner 待识别、focused tests） | §1.3、工单 §7（Shell owner 已识别为 `components/Layout/Shell.jsx`） |
| Step 1 会话隔离 | §4 G1、§5 Step 1 |
| Step 2 后台运行 | §4 G2、§5 Step 2 |
| Step 3 恢复 | §4 G3、§5 Step 3 |
| Step 4 明确停止 | §4 G4、§5 Step 4 |
| Step 5 SessionRail 状态 | §5 Step 5 |
| Step 6 视觉与可访问性 | §5 Step 6 |
| Step 7 全量验证 + 人工验收 + Gate D | §5 Step 7、§4 |
| Gate D 完成定义（L200 原文） | §4（逐字引用，不得缩水） |

## 1. 基线事实（main = 70e78b1，编制时核验）

### 1.1 后端测试基线（Batch C 合入后，2026-08-07 复跑全绿）

test:harness **173**、test:modules **255**、test:ai **242**、test:integration **1**；build:api / build:web 退出 0。

### 1.2 前端测试基线（编制时复跑，含 2 处既有失败）

`npm run test:web`（vitest）：**209 条，208 通过，1 失败；2 个失败文件**：

1. `src/__tests__/aiWorkbenchReportGateConsistency.test.js`（整套件失败）：O1 拆分时（c8b1acb）建立的双端闸门一致性守护测试，扫描后端 `chat.service.ts` 的 `isExplicitReportRequest`；O4 handler 化后闸门迁至 `services/ai/handlers/workbench-shared.ts:162`，守护扫描路径未同步。**归属：O4 遗留基线漂移**（O4 复核只跑 test:ai/test:modules，漏 test:web）。
2. `src/__tests__/HomeWorkspace.test.jsx`（"检索客户主体"弹窗用例失败）：能力发现 suggestedAction → CompanyLookupDialog 链路断。最后相关文件变更为 O1 拆分；O4 前端零改动，归属待 Step 0 归因。

**处置**：编入 Step 0（E2 基线修复），Gate D 的"Web 全量"必须绿，否则审计无法判定失败归属。

### 1.3 前端现状（Batch D 触点）

| 文件 | 行数 | 现状要点 |
|---|---|---|
| `src/hooks/useAiSessions.js` | 134 | 会话 CRUD；`deleteSession` 乐观硬删、无 409 处理；localStorage 活跃会话键 `wes-ai-active-session-id` |
| `src/api/ai.js` | 150 | 仅旧同步链路 `streamHomeWorkbenchChat`（fetch SSE，Bearer 头，自含 SSE 解析 `readSseStream`） |
| `src/api/harness.js` | 33 | 旧 Harness 同步路径 8 函数（createHarnessRun 等），本批不改 |
| `src/pages/AiHomeWorkbench/index.jsx` | 95 | 纯布局组装；`AiHomeWorkbench.jsx` 为 6 行 re-export 壳 |
| `src/pages/AiHomeWorkbench/hooks/useWorkbenchState.js` | 176 | 12 个 useState；composer 为**全局单草稿**（未按会话键控） |
| `src/pages/AiHomeWorkbench/hooks/useChatMessages.js` | 314 | **全局 `sending`**；消息为单列表（未按 sessionId 键控）——会话串扰根因 |
| `src/pages/AiHomeWorkbench/hooks/useHarnessRun.js` | 287 | 旧同步报告流（isExplicitReportRequest 闸门把守），本批不改 |
| `src/components/AiWorkbench/SessionRail.jsx` | 361 | 无 Run 状态显示 |
| `src/components/Layout/Shell.jsx` | 189 | BackgroundRunProvider 挂载点；已有 `UnsavedChangesProvider`（L179）先例 |
| `src/index.css` | — | 状态徽标/通知样式落点 |

前端测试基础设施：vitest + MSW 2.14.5（已在 devDependencies）。UI scope checker：`node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base <ref> -- <files>`。

### 1.4 Batch C 已交付契约（本批消费方，冻结不改）

- `GET /api/v1/ai-runs`（active 列表）、`GET /api/v1/ai-runs/:runId`（snapshot）、
  `GET /api/v1/ai-runs/:runId/events?after=<cursor>`（SSE 回放；`Last-Event-ID` 头优先；心跳 15s；批量 200；终态排空主动关闭；断线不取消）
- `POST /:runId/cancel | inputs | actions/:actionId/confirm | retry`
- `POST /api/v1/ai-sessions/:sessionId/runs`：202 `{ runId, sessionId, status:"queued", eventCursor }`；flag 关闭 503 `ASYNC_RUNS_DISABLED`；同会话活动 Run 409（实现码 `SESSION_HAS_ACTIVE_RUN`，harness-runtime.usecase.ts L162；规格 §5.2 的 `SESSION_RUN_ACTIVE` 在实现中已收敛为同一码，前端两场景同码处理）
- 删除冲突 409 `SESSION_HAS_ACTIVE_RUN`（Batch C 已落 usecase 层；旧 DELETE 端点未接线，见 D8）
- 事件词汇 14 类（types 测试守护，本批纯消费）

## 2. 硬约束（逐字引用，不得改写）

- **Gate D 完成定义**（roadmap L200）："自动化证明会话隔离、后台继续、重连与明确停止；浏览器人工验收覆盖 1440px、760px 和键盘路径；没有引入第二状态/UI 栈。"
- roadmap L218："前端与现有同步 API 在 B/C 中不改（Batch E 前）"——本批是 roadmap 指定的前端批次，**旧同步链路行为零变更**（文件允许改，行为不许变）。
- spec §4.3："前端组件卸载、路由切换、刷新和登出不得触发取消接口。"
- spec §12.2："切换会话只切换渲染源，不取消请求、不清空其他会话状态。"
- spec §12.1："页面不再使用全局 `sending`。当前会话的 `sending` 由该会话是否存在 `queued/running/recovering/cancelling` Run 派生。"（注：新路径派生；旧同步路径保留自身 sending，双轨并存至 Batch E）
- 不引入 Redux、Zustand 或第二 UI 技术栈（roadmap L178 + Gate D）。
- O10-A 口径守护：`ADOPTABLE_INTENTS`/0.85/`isExplicitReportRequest` 行为零变更。

## 3. 关键决策（D0–D9）

- **D0 分支与 worktree**：`qoder/rp-047-d-multisession-ui` @ `.claude/worktrees/rp-047-d-multisession-ui`（roadmap L176 原名）。
- **D1 BackgroundRunProvider 挂载**：`Shell.jsx`，包在 `UnsavedChangesProvider` 外层；仅登录态挂载。职责：当前用户活跃 Run 摘要、离页后 SSE 归属、一次性完成通知（spec §12.3）。
- **D2 SessionRuntimeStore**：新建 `src/hooks/useSessionRuntimeStore.js`，以 `sessionId` 为键的内存 store（消息视图 / Run 状态 / 事件游标 / unread 标记）；composer 草稿按 `userId:sessionId` 键控（替换全局单草稿）；cursor 持久化 `localStorage` 键 `wes-run-cursor:<runId>`（spec §12.4"持久 cursor"）。
- **D3 SSE 客户端**：新建 `src/api/aiRuns.js`，fetch + Bearer 流式读（EventSource 无法附 Authorization 头）；SSE 解析自含实现（参考 `api/ai.js` 模式但**不 import 其内部函数**，旧链路文件行为零变更）。
- **D4 提交双轨口径**：本批**不改提交主链路**——用户发消息仍走 `streamHomeWorkbenchChat`（旧路径）。新路径能力（订阅/恢复/取消/状态展示）由 MSW mock 的 `/api/v1/ai-runs` 端点驱动 focused tests 证明；真实提交切换（flag 开启后的新入口）属 Batch E。依据：roadmap L218 + Worker 未 boot-start（Run 提交后停留 queued，端到端无真实 workflow 可跑）。
- **D5 flag 关闭降级**：`WES_AI_DURABLE_RUNS_ENABLED` 默认 false（生产现状）。前端对 `GET /ai-runs` 的 503/空/网络失败一律视为"无后台任务"，静默退避重试（不弹全屏错误、不刷 toast 风暴）；SessionRail 状态槽空渲染。
- **D6 明确停止入口**：SessionRail 行级"停止"（活动 Run 时出现）+ StatusPanel 主按钮；仅用户显式点击调 `POST /:runId/cancel`，经 ConfirmDialog 二次确认；卸载/切换/刷新/关页/登出路径断言零 cancel 调用（G4 守护测试）。
- **D7 SessionRail 七态**：排队中/执行中/恢复中/等待确认/已完成未读/失败/已取消（spec §12.2 全量）；文本 + 图标 + 颜色三通道冗余，不得只依赖颜色（roadmap Step 5）。
- **D8 删除守护接旧端点（E1，后端小修）**：`ai-sessions.controller.ts` DELETE 与 `ai-sessions.routes.ts` L60 注入 `activeRunChecker`（Batch C usecase 重载已就绪），409 `SESSION_HAS_ACTIVE_RUN` 对旧端点生效；前端 `deleteSession` 处理 409 文案"该会话仍有后台任务运行中，请先停止任务"。依据：看板 risks/issues 已承诺"待 Batch D 接旧端点"（ISS-2026-08-06-003）。
- **D9 基线修复（E2，Step 0）**：① `aiWorkbenchReportGateConsistency.test.js` 扫描源从 `chat.service.ts` 迁至 `handlers/workbench-shared.ts`（守护语义与双正则断言不变）；② HomeWorkspace 失败用例归因：根因在测试/mock 层则修测试；根因在业务代码则停止并回填疑点（停止条件），不擅自扩围修业务。

### 范围外登记

- **checkpoint 可观测性 UI spec**（`docs/superpowers/specs/2026-08-07-rp-047-checkpoint-observability-ui-design.md`）：与 Batch D 仅 StatusPanel 弱重叠，自成一体（含 4 个后端端点与审计页面族），登记为后续批次（C-OBS/D-OBS），本批不并入；StatusPanel 改动保留可扩展结构即可。
- O5 统一视图聚合接口（integrated-optimization-plan §5.5）：独立 P1 项，与本批无依赖，不并入。
- Worker boot-start、flag 生产开启、灰度回滚：Batch E。

## 4. Gate D 四条分解（完成定义原文见 §2）

| # | 口径 | 自动化证明方式 |
|---|---|---|
| G1 | 会话隔离 | focused test：MSW 双会话 SSE 流并发；A 运行中切 B 发送；断言 A 事件/最终消息不写入 B、不抢回当前渲染源；切换不清空 B 已有状态 |
| G2 | 后台继续 | focused test：离开 AI 页面（unmount）断言——本地 SSE 关闭、**零 cancel 调用**、provider 仍持有 Run 摘要、完成事件触发一次性通知；Shell 显示活跃数量 |
| G3 | 重连 | focused test：模拟刷新（store 重建）→ 恢复序列 §12.4（Sessions → active Runs → 合并 → snapshot → cursor 续订）；断言事件不丢不重（after=持久 cursor） |
| G4 | 明确停止 | focused test：卸载/路由切换/刷新/登出四场景断言 cancel 调用次数为 0；仅"停止"按钮点击产生恰 1 次 cancel |
| 人工 | 1440px / 760px / 键盘 | 执行会话产出验收指引（含 flag 开启方法与预期行为）；Codex Gate D 审计后由用户执行 |
| 边界 | 无第二状态/UI 栈 | 审计检查：无新状态依赖、无新 UI 框架依赖（package.json diff 守护） |

**人工验收能力边界（诚实声明）**：Worker 未 boot-start + flag 默认关闭，真实端到端（提交→执行→完成）在 Batch E 前不可走通；本批人工验收仅覆盖：flag 关闭降级行为、会话隔离展示、SSE 重连（联调环境 flag 开启 + 测试驱动 fake run）、明确停止。

## 5. 实施步骤（RED 先行，顺序执行）

- **Step 0（E2）基线修复**：按 D9 修复 2 处既有失败，test:web 回到 209+ 全绿后开工；归因记录写入 handoff。
- **Step 1（G1）会话隔离**：RED 先行。新建 `useSessionRuntimeStore.js`（sessionId 键控）；`useChatMessages`/`useWorkbenchState` 接入 store（消息视图按会话渲染、composer 按会话键控）；旧同步发送链路行为不变。
- **Step 2（G2）后台运行**：新建 `useBackgroundRuns.jsx`（含 BackgroundRunProvider）；Shell.jsx 接线；离页只关本地 SSE；活跃数量徽标 + 一次性完成通知（aria-live polite）。
- **Step 3（G3）恢复**：刷新/重登恢复序列（§12.4 六步）；cursor 持久化与续订；登出清敏感缓存（cursor/草稿）但不 cancel。
- **Step 4（G4）明确停止**：`api/aiRuns.js` cancel 接线；两处停止入口 + ConfirmDialog；四场景零 cancel 守护测试。
- **Step 5 SessionRail 七态**：状态徽标（文本+图标+颜色）；活动 Run 行级停止；409 删除文案（E1 前端侧）。
- **Step 6 视觉与可访问性**：1440px/760px 无横向溢出、键盘焦点路径、ARIA live region；按 improving-wes-ui 口径单轮最多三个已证实根问题。
- **Step 7 全量验证**：§6 测试矩阵全跑；UI scope checker；产出人工验收指引；handoff 回填。
- **E1（可与 Step 4/5 并行）**：删除守护接旧端点（D8）+ modules focused test（mock checker，不占用 test:harness）。

## 6. 测试矩阵

| 套件 | 基线 | 结束要求 |
|---|---|---|
| test:web | 209（含 2 处既有失败） | Step 0 后全绿；新增 focused tests 全 GREEN；既有测试零删改 |
| test:modules | 255 | +E1 focused（预计 2-4 条）；既有零失败 |
| test:ai | 242 | 零失败（O10-A 快照集不动） |
| test:harness | 173 | 零失败（Colima socket 环境） |
| test:integration | 1 | 零失败 |
| build:api / build:web | exit 0 | exit 0 |
| UI scope checker | — | 对全部 UI 改动文件运行并通过 |
| 依赖 diff | — | 两套 package.json/lockfile 零新依赖 |

## 7. 分批建议

- **方案 A（默认）单批**：Step 0→7 + E1 一次交付，粗估 25–35h。Gate D 是整体关卡（隔离/后台/重连/停止互为上下文），拆批翻倍重连成本。
- **方案 B 拆两批**：D-1 状态层与守护（Step 0/1/3 + api/aiRuns.js + E1）→ D-2 UI 层与后台通知（Step 2/4/5/6）。仅在用户要求更小审计粒度时采用；Gate D 四条不因拆批缩水。

## 8. 疑点（编制倾向，待复核裁决）

- **D1' 人工验收分工**：执行会话无法替代浏览器人工验收；倾向"执行会话产出指引 + Codex Gate 审计后用户验收"，与 O4 冒烟先例一致。
- **D2' "后台继续"证明口径**：无 Worker 生产接入，自动化只能证明"离页零 cancel + 摘要存活 + 通知触发"（mock 事件流）；真实执行链归 Batch E。不构成 Gate D 缩水（roadmap 语境下"后台继续"指前端不中断服务端任务）。
- **D3' E1 后端小修越界风险**：roadmap Batch D Primary files 全为前端；E1 是看板已承诺的遗留接线（2 文件 + focused test）。倾向纳入并显式登记扩展项；复核若认为应独立小修，E1 移出即可，不影响 Step 1-7。
- **D4' E2 修复范围可控性**：限定测试/mock 层；触业务代码即停。若 HomeWorkspace 失败根因是真实回归，升级为独立 defect 处置，Batch D 基线以"该用例标注 skip + 疑点回填"方式开工（需复核批准）。
- **D5' 搁置 spec 处置**：checkpoint 可观测性登记为后续批次，本批不并入（子代理评估：仅 StatusPanel 弱重叠，无共享文件）。
