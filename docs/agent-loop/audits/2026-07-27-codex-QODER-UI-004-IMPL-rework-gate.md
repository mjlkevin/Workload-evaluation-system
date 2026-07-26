# Codex Gate · QODER-UI-004-IMPL Rework

date: 2026-07-27
taskId: QODER-UI-004-IMPL
target: `/system/model-config`
qoderWorktree: `/Users/kevin/AI/Workload-evaluation-system/.claude/worktrees/ui-004-model-config`
qoderBranch: `qoder/ui-004-model-config`
baseCommit: `90f9838`
reviewedCommit: `97db787`
verdict: `ACCEPTED_PENDING_INTEGRATION`
allowNextTask: `false`
mustReworkFirst: `false`
integrationAuthorized: `false`
nextOwner: `codex`

## Gate Conclusion

`97db787` 已修复上一轮 Gate 的两项 P1 Blocking Findings 和一项 P2
Non-Blocking Finding。本轮没有发现新的阻断项：

1. “放弃修改”会恢复打开编辑弹窗前的完整模型配置快照，卡片摘要和重新打开后的输入值均回到原值。
2. 编辑弹窗保存已由单一 async handler 承接；失败时保留弹窗和输入并显示 `role="alert"`，成功后才关闭并显示页面内联 `role="status"`。
3. 保存期间确定、取消、右上角关闭、Escape 和遮罩关闭均被锁定。
4. worktree 已清除未跟踪 `node_modules` 符号链接，复核结束时保持 clean。

本 Gate 只接受 Qoder handoff，不代表已经集成到当前主分支。用户尚未授权
cherry-pick，因此不修改业务主线，也不允许自动开始下一项 UI 优化。

## Gate Checks

- metadataComplete: `pass`
- scopeClean: `pass`
- focusedVerification: `pass 8/8`
- fullWebVerification: `pass 25 files / 177 tests`
- buildVerification: `pass with existing chunk-size warning`
- uiScopeCheck: `pass`
- browserVerification: `pass`
- implementationSemantics: `pass`
- worktreeClean: `pass`
- boardSyncReady: `event only / visible HTML apply blocked by unrelated dirty changes`

## Resolved Findings

### P1-1 · 放弃修改恢复页面配置

`SystemManagement.jsx` 在打开模型编辑弹窗时保存 `modelConfig` 深拷贝快照。
确认放弃时，按配置 owner 将快照写回页面状态，然后关闭确认弹窗和编辑弹窗。

Codex 在真实浏览器中复现：

- 将 KIMI 模型标识从 `kimi-k2.5` 修改为临时值；
- 按 Escape，出现“放弃修改”确认；
- 确认放弃后，卡片不再显示临时值；
- 重新打开编辑弹窗，模型标识恢复为 `kimi-k2.5`。

### P1-2 · 保存结果、失败保留与关闭锁定

`handleModelEditSave` 等待 `actions.saveModelDraft()` 的实际结果。保存失败时：

- 编辑弹窗保持打开；
- 输入内容保持不变；
- 弹窗内显示归属于本次保存的 `role="alert"`；
- 用户可以直接修改并重试。

保存成功时：

- 编辑弹窗关闭；
- 页面显示“草稿已保存”的 `role="status"`；
- 模型卡片显示成功保存后的值。

保存请求处于 pending 时，Codex 在浏览器中确认以下控件均不可用：

- 确定按钮；
- 取消按钮；
- 右上角关闭按钮。

同时，`dismissDisabled` 阻止 Escape 和遮罩关闭。

### P2 · Worktree 环境残留

复核开始和结束时，`git status --short --branch --untracked-files=all`
均只显示：

```text
## qoder/ui-004-model-config
```

不存在未跟踪 `ui/V2_PROTOTYPE/node_modules` 符号链接。

## Verification Reproduced

- `git diff --check 90f9838..97db787`
  - `pass`
- `npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/ModelConfig.test.jsx`
  - `pass 1 file / 8 tests`
- `npm run test:web`
  - `pass 25 files / 177 tests`
- `npm run build:web`
  - `pass`
  - 保留既有大于 500 kB chunk-size warning
- `node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base 90f9838 -- ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js ui/V2_PROTOTYPE/src/__tests__/ModelConfig.test.jsx`
  - `pass / No new deterministic UI findings`

复核测试临时复用了主项目的前端依赖目录；临时链接在每次命令后清理，最终
worktree status clean。

## Browser Evidence

浏览器验收使用 Chrome 加载 `97db787` 的构建产物。为避免修改实时 WES
业务数据，使用隔离的本地 QA API 确定性模拟登录、模型配置读取、保存成功和
保存失败；验收结束后已停止并删除该临时服务。

### 1440px

- 模型卡片、API Key 面板和页面内联成功状态正常显示；
- 三张模型卡片没有可见重叠或裁切；
- Escape 脏关闭、确认放弃恢复、失败保留和成功重试均通过；
- 页面使用语义 surface token，未观察到本提交引入的 raw white 回归。

### 760px

- 页面 `documentScrollWidth = 745`，与 `viewport clientWidth = 745` 相等，
  未出现横向页面溢出；
- 编辑弹窗 `left = 17`、`right = 728`、`width = 711`，位于 745px
  可用视口内；
- 弹窗 `clientWidth = 709`、`scrollWidth = 709`，未出现内部横向溢出；
- 页面和弹窗内容可见，操作按钮没有被裁切。

### Keyboard / Runtime

- Escape 可触发脏关闭确认；
- 确认放弃后原值恢复；
- 保存 pending 时所有关闭入口被锁定；
- 浏览器控制台 error 数量：`0`。

## Residual Risks

- 构建仍有既有的单 chunk 大于 500 kB 警告，本任务没有扩大或处理该性能范围。
- 760px 下全局侧栏采用现有纵向堆叠策略，页面可用且无横向溢出；该 shell
  策略不是 `97db787` 引入，不作为本 Gate 阻断。
- 浏览器验收覆盖 UI owner 与成功/失败生命周期，不替代真实管理员环境下的
  后端集成回归；聚焦测试和全量 Web 测试已覆盖前端 API 契约。

## Next

等待用户授权后，由 Codex 精确集成 `97db787`。集成时必须：

1. 保留当前主 checkout 的无关未提交修改；
2. 只引入 Qoder 提交声明的三个文件；
3. 复跑聚焦测试、`npm run test:web`、`npm run build:web` 和 UI scope checker；
4. 集成完成前不把 QODER-UI-004 标记为“已交付”；
5. 不自动领取下一项 UI 优化。
