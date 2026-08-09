# Qoder Sprint 3A 返工工单 — 工作区清理 + 提交闭环 + 干净复验

- Date: 2026-08-09
- Executor: Qoder 执行会话（kimi-for-coding）
- Status: 待派单（用户 2026-08-09 裁决退回返工）

## 1. 退回原因（主会话复审三处硬伤，均有实锤）

1. **零提交**：分支 `qoder/sprint3-unified-view-streaming` HEAD 停在 baseCommit=4c28116，全部成果（含 handoff）漂在工作区未提交，违反工单 §6「全绿后按规范提交并回填」。
2. **工作区污染**：暂存区混入 15 个文件（+565 行）「会话管理审计」功能代码，与 main 已合入提交 4ba312b 逐字相同，属其他任务内容。
3. **验证数字失真**：回填报 modules 267 / web 274，系污染环境下跑出（干净基线 modules=265、web=255），不可采信。

## 2. 合同坐标（不变）

- worktree: `.claude/worktrees/sprint3-unified-view-streaming`（沿用，不新建）
- branch: `qoder/sprint3-unified-view-streaming`（沿用，baseCommit=4c28116）
- 返工完成后 HEAD 必须有 ≥2 个新提交（业务 + handoff），可用 `git log --oneline` 核验

## 3. 返工步骤（严格按顺序，每步做完自查再进下一步）

### 步骤 1：文件归属裁决（先列清单，后动手）
把当前工作区所有改动逐文件分类，写入临时清单：
- **3A 保留**（本任务成果）：`apps/api/src/modules/harness/workbench-view.controller.ts`（新）、`workbench-view.usecase.ts`（新）、`workbench-view.usecase.test.ts`（新）、统一视图路由挂载文件；前端 `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench/` 下 Composer.jsx、MessageBubble.jsx、ChatArea/index.jsx、useChatMessages.js、useWorkbenchState.js、index.jsx；`src/api/` 下新增的视图封装；`src/__tests__/` 下新增的统一视图与流式守护测试；`docs/agent-loop/handoffs/2026-08-09-qoder-sprint3-A.md`
- **清理**（会话管理域，main 4ba312b 已含，删了零损失）：`apps/api/src/modules/ai-sessions/*`（4 文件）、`apps/api/src/routes/system.routes.ts`、`apps/api/src/utils/file.ts`、SystemManagement.jsx、AiSessionAuditPanel.jsx、useAdminAiSessions.js、systemManagementSections.js、SystemManagementSessions.test.jsx、mocks/data.js、总看板 index.html
- **模糊文件逐个裁决**：layout.css、mocks/handlers.js、ai.routes.ts、ChatArea 相关——用 `git diff` 逐行看，只保留 3A 部分（如停止按钮样式、视图接口 mock）；会话管理部分（sys-* 样式、sessions mock、system 路由）一并清理。每个模糊文件的裁决结论必须写进 handoff。

### 步骤 2：执行清理
```
git restore --staged .                      # 全部撤出暂存区
git checkout HEAD -- <清理清单文件>          # 已跟踪的恢复为 HEAD 版本
# 未跟踪的清理文件直接删除
```
清理后自查：`git status --short` 输出必须**只剩 3A 保留清单**的文件；`git diff HEAD -- apps/api/src/modules/ai-sessions/` 必须为空。

### 步骤 3：干净环境重跑验证（依赖已在主会话装好，无需重装）
```
cd apps/api && npm run test:modules     # 期望 = 265 + 本批后端新增用例数
npm run test:ai                          # 期望 256（本批不动 ai）
cd apps/api && DOCKER_HOST=unix:///Users/kevin/.colima/default/docker.sock \
  TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
  USE_TESTCONTAINERS=true npm run test:harness   # 期望 173（colima 需运行中）
cd ui/V2_PROTOTYPE && npx vitest run    # 期望 = 255 + 本批前端新增用例数
npm run build:api && npm run build:web  # 均 exit=0
```
每项在 handoff 中附实际输出摘要，并写明期望值的算式（例：265 + 9 视图用例 = 274）。

### 步骤 4：硬口径自查（逐条在 handoff 打勾）
- Run 状态机（scheduled/running/succeeded/failed）零变更
- G-E2/G-E4 守护测试仍全绿、409/503 行为未动
- 旧同步入口 `/ai/home-workbench/chat` 保留
- 统一视图接口仅返回本人数据（数据隔离测试存在且通过）
- 零新增依赖、零 schema 变更（`git diff HEAD -- package.json package-lock.json apps/api/package.json` 除测试脚本入口外为空）

### 步骤 5：提交与回填（提交纪律为硬条款）
1. 先提交业务：`feat(harness+web): Sprint 3A · 统一视图接口与前端流式 UX`
2. 再提交 handoff：`docs(handoff): Sprint 3A 返工回填 · 清理污染+提交闭环+干净复验`
3. **回填 handoff 前必须执行 `git log --oneline -3` 并把输出贴进 handoff**，证明提交真实存在于分支
4. 状态停在「已回填 / 待主会话复审」；不合并 main、不更新总看板

## 4. 禁止事项

- 禁止重写 3A 已完成的业务代码（返工只修流程，不改功能；复验暴露真 bug 时另报，不得顺手改）
- 禁止动清理清单之外的任何文件；禁止动总看板
- 禁止跳过步骤 1 直接清理
