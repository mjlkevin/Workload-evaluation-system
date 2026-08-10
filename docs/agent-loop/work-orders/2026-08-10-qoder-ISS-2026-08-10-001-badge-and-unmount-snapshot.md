# ISS-2026-08-10-001 修复工单 · ISS-003 复验残留两处体验缺口（未完成时返回占位不恢复 + 后台任务角标不显示）

- **缺陷来源**：用户 2026-08-10 复验 ISS-2026-08-09-003（离页返回旧缓存渲染、AI 回复不显示）实测反馈：①回复未完成时切走再返回，只见自己发出的问题气泡，「正在理解你的问题」进行中占位不可见（回复完成后补显正常）；②侧栏「后台任务 进行中 X · 已完成 Y」角标不显示进行中
- **优先级**：P2（展示层体验缺口，无数据风险、不阻塞其他批次，但直接削弱「后台持久执行」的信任感）
- **预计工时**：3–4h（含后端小改与回归测试）

## 1. 根因（已代码取证，含对初判的修正）

### 根因 A：「后台任务」角标的数据源只返回活跃 run

- 统一视图 `getUnifiedView`（`apps/api/src/modules/harness/workbench-view.usecase.ts` 约 L166）用 `repo.listActiveRunsForOwner(user.id)` 取 runs
- 该查询（`harness-runtime.repository.ts` L1351-1367）只查 `status IN HARNESS_RUN_ACTIVE_STATUSES`（= queued/running/waiting/recovering/cancelling，见 `harness-runtime.types.ts` L13）
- 推论链：run 进入 `completed` 终态 → **立即从统一视图消失** →
  - `index.jsx` L45 `completed: runs.filter(status === 'completed')` **永远计数 0**
  - `completedInBackground` 第一分支（L57 `run.status === 'completed'`）**永远不触发**
  - 第二分支「从活跃列表消失」依赖 `prevRunStatusesRef` 持有离开前状态；**组件卸载重挂载后 ref 清空**，previous 为空 → 同样不触发
  - 用户返回那一刻 unifiedView 尚在异步加载，等加载完 run 往往已完成消失 → active 也数不到 → 角标条件 `active > 0 || completed > 0` 不满足，整体不渲染
- **修正初判**：harness_runs run 级终态即 `completed`（schema L31 实锤），前端角标用词没有错；`succeeded`/`claimed` 属 `harness_run_attempts` 表（attempt 级），与本缺陷无关

### 根因 B：页面级离开不存快照，未完成占位无法恢复

- 「正在理解你的问题 / 正在调用模型并组织回复」是发送时追加的**纯本地 loading 占位**，后端无「进行中」消息实体
- G1 快照 `sessionRuntimeStore.setSessionMessages` 仅在**会话切换**时写入（`useChatMessages.js` L149）及迟到消息回填点（L473/475/525/530）；**离开工作台页面（组件卸载）不写快照**
- 重挂载后 `messages` 从空数组起步、只能从后端拉——后端此刻只有用户消息（assistant 未写完）→ 只渲染问题气泡
- 回复写完后靠 `visibilitychange` 重拉路径补回 assistant——故「完成后回复可见」正常（ISS-003 验收口径已达标）

## 2. 修复方案

- **A（角标数据源，必做，后端小改）**：统一视图 runs 增补「近期已完成 run」——`harness-runtime.repository.ts` 新增 `listRecentlyCompletedRunsForOwner(ownerUserId, limit)`（status='completed'，按 updated_at desc，limit ≤ 10），`workbench-view.usecase.ts` 合并进 runs 视图项（前端按既有 `status === 'completed'` 即可计数）；配套 `completedInBackground` 对账：重挂载后 runs 含 completed 且本地存在未完成 loading 占位时触发一次 `loadSessions()` 对账（不依赖卸载前 ref）
- **B（卸载快照，必做，纯前端）**：`useChatMessages.js` 增加卸载清理（useEffect cleanup）：`sessionRuntimeStore.setSessionMessages(activeSessionKey, messagesRef.current)`（有活跃会话且有消息时）；重挂载首帧检测到 store 存在该会话快照时，走既有 `reconcileWithBackendMessages(后端 messages, 快照)` 对账路径出图——后端为准、仅保留未完成进行中占位（与 ISS-003 C2 同一合并语义）
- **forbidden**：不改 SSE 协议、不改 run 状态机、不新增依赖、不新建测试文件、不动 package.json、不引入新组件库

## 3. 执行约定（Worktree Contract）

- **执行前置**：先读 `QODER.md`、`skills/wes-qoder-worktree-protocol/SKILL.md` 完成 ACK；**前端变更强制前置** `skills/improving-wes-ui/SKILL.md`；worktree 初始化后先 `npm install`（根 + ui/V2_PROTOTYPE 两步）
- **worktree**：`.claude/worktrees/iss-2026-08-10-001-badge-and-unmount-snapshot`
- **分支**：`qoder/iss-2026-08-10-001-badge-and-unmount-snapshot`
- **base**：`7943b23`（main，ISS-003 合入收官 + ISS-001 入池/工单看板提交后；执行时以 main 当前 HEAD 为准）

## 4. Allowed Paths

- `apps/api/src/modules/harness/harness-runtime.repository.ts`（A：新增近期已完成查询）
- `apps/api/src/modules/harness/workbench-view.usecase.ts`（A：runs 合并）
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js`（B：卸载快照 + 重挂载快照优先对账）
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/index.jsx`（角标对账触发微调，按现状就近）
- `ui/V2_PROTOTYPE/src/hooks/useSessionRuntimeStore.js`（如需，仅既有 API 复用，不改存储语义）
- 既有测试文件（`workbench-view.usecase.test.ts` / `harness-runtime.usecase.test.ts` / 前端 unified-view.test.jsx / session-isolation.test.jsx，新用例写进已存在文件，**禁止新建测试文件**）
- `docs/agent-loop/handoffs/2026-08-10-qoder-ISS-2026-08-10-001.md`（handoff 新建）

## 5. 验证矩阵（回填附每项实测输出）

| 套件 | 期望 |
|---|---|
| `npm run test:web` | 278 + 新增（附算式） |
| `npm run test:modules` | 318 + 新增（A 为后端小改，workbench-view 用例需覆盖近期已完成 run 合并） |
| `npm run build:api` + `npm run build:web` | 零错误 |

**RED 先行回归用例**（至少 3 例，前后端各覆盖）：
1. 后端：「统一视图 runs 包含近期已完成 run」（mock 一条 completed run，断言出现在视图且 status 透传）
2. 前端：「卸载时本地进行中占位写入快照，重挂载后占位恢复渲染（后端尚无 assistant）」
3. 前端：「runs 含已完成 run 时角标『已完成』计数 ≥ 1」（修正永远 0 缺陷）

**人工验收口径**（合入后用户执行）：开异步开关发一句问题 → ①回复**未完成**时切走再返回：问题气泡 + 进行中占位均可见，角标显示「进行中 ≥ 1」；②回复**已完成**时返回：完整回复可见，角标显示「已完成 ≥ 1」。

## 6. 硬纪律（违反即打回）

1. 新测试写进已存在测试文件，不动 package.json
2. handoff 必须贴 `git log --oneline -4` 实际输出
3. 汇报所有代号附业务主题注释
4. 全绿后先提交再回填，状态只到「已回填 / 待主会话复审」
