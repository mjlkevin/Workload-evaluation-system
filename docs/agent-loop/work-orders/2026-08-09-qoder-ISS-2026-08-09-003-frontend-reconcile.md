# ISS-2026-08-09-003 修复工单 · 离页返回前端旧缓存渲染（AI 回复不显示——读取侧对账缺陷）

- **缺陷来源**：用户截图反馈（会话 c118bc00-1e5d-4d49-a6b0-841f17c99e63）：异步通道发「利润中心是什么？」后切走再返回，AI 回复不显示
- **主会话根因取证**：后端数据完整（用户消息 23:43:43 / assistant 完整切题回复 23:44:00 均已落库，写入侧修复生效）；丢失发生在前端渲染源——返回后用发送时刻的旧缓存出图
- **优先级**：P1（异步通道每一轮离页返回均中招，直接打掉「后台持久执行」验收口径）
- **预计工时**：4h（含回归测试）

## 1. 根因（三处，已代码取证）

1. **useAiSessions.js `loadSessions` 的 `setActiveSession`**（约 L67-71）：重拉列表后「当前会话还在新列表里就继续用旧 `current` 对象」——旧对象 messages 数组停在发送时刻，后端新写入的 assistant 被挡在渲染源之外
2. **useChatMessages.js G1 会话切换快照**（L111-118）：`storedMessages || mapSessionMessages(...)` 短路——快照只捕获离页瞬间本地视图，从不与后端增量合并；注释声称「保留迟到响应」，但异步通道的迟到结果在离页期间无 SSE 订阅，永远进不了 store
3. **useChatMessages.js 同会话重映射守卫**（L124）：`prev.some(m => m.loading || m.error || m.action) return prev`——本地残留 loading 占位时直接丢弃后端最新数据（历史同款缺陷 ISS 先例：守卫阻断会话切换刷新，模式见记忆 3ad0df16）

**佐证**：截图 1 右下角「后台任务 0」——前端未追踪 durable run 完成状态，用户离页期间无任何「后台已完成」提示。

## 2. 修复方案

- **C1（最小修，必做）**：`loadSessions` 的 `setActiveSession` 改为「current 存在时取新列表同 id 对象」（后端最新为准）
- **C2（对账修，必做）**：会话切回 / 页签切回触发一次会话数据重拉，与 G1 快照合并——**后端 messages 为准**，仅保留本地进行中（loading）占位；L124 守卫改为「session id 变化时无条件替换，同会话内才保留守卫」
- **C3（体验修，本批做）**：「后台任务」角标接入统一视图 `unifiedView.runs` 的活跃/已完成计数（O5 接口已一次取齐 runs），返回时若有离页期间完成的 run，触发 C2 对账
- **forbidden**：不改后端、不改 SSE 协议、不新增依赖、不引入虚拟滚动/新组件库

## 3. 执行约定（Worktree Contract）

- **执行前置**：先读 `QODER.md`、`skills/wes-qoder-worktree-protocol/SKILL.md` 完成 ACK；**前端变更强制前置** `skills/improving-wes-ui/SKILL.md`；worktree 初始化后先 `npm install`（根 + ui/V2_PROTOTYPE 两步）
- **worktree**：`.claude/worktrees/iss-2026-08-09-003-frontend-reconcile`
- **分支**：`qoder/iss-2026-08-09-003-frontend-reconcile`
- **base**：`0c3a6eb`（main，C3 合入收官后）

## 4. Allowed Paths

- `ui/V2_PROTOTYPE/src/hooks/useAiSessions.js`（C1）
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/hooks/useChatMessages.js`（C2）
- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/` 下后台任务角标相关组件（C3，按现状就近）
- 既有前端测试文件（新用例写进已存在文件，**禁止新建测试文件**）
- `docs/agent-loop/handoffs/2026-08-09-qoder-ISS-2026-08-09-003.md`（handoff 新建）

## 5. 验证矩阵（回填附每项实测输出）

| 套件 | 期望 |
|---|---|
| `npm run test:web` | 275 + 新增（附算式） |
| `npm run test:modules` | 318/318（后端零改动复验） |
| `npm run build:api` + `npm run build:web` | 零错误 |
| `git diff --stat 0c3a6eb -- apps/ package-lock.json` | 零输出（纯前端批） |

**RED 先行回归用例**（至少 2 例）：
1. 「异步通道完成后切回会话，assistant 回复必须渲染」——mock 后端 session 在切换后新增 assistant，断言渲染列表包含它
2. 「会话切换时本地残留 loading 占位不得阻断目标会话消息刷新」

**人工验收口径**（合入后用户执行）：开异步开关发一句问题 → 切走页签 → 等后台完成 → 返回，AI 回复必须可见；「后台任务」角标在离页期间/返回时正确计数。

## 6. 硬纪律（违反即打回）

1. 新测试写进已存在测试文件，不动 package.json
2. handoff 必须贴 `git log --oneline -4` 实际输出
3. 汇报所有代号附业务主题注释
4. 全绿后先提交再回填，状态只到「已回填 / 待主会话复审」
