# Codex Gate · QODER-UI-004-IMPL

date: 2026-07-27  
taskId: QODER-UI-004-IMPL  
target: `/system/model-config`  
qoderWorktree: `/Users/kevin/AI/Workload-evaluation-system/.claude/worktrees/ui-004-model-config`  
qoderBranch: `qoder/ui-004-model-config`  
baseCommit: `90f9838`  
reviewedCommit: `3f216bf`  
verdict: `REWORK_REQUIRED`  
allowNextTask: `false`  
mustReworkFirst: `true`  
nextOwner: `qoder1`

## Gate Checks

- metadataComplete: `pass`
- scopeClean: `fail` — worktree 仍有未跟踪的 `ui/V2_PROTOTYPE/node_modules` 符号链接
- focusedVerification: `pass 5/5`
- fullWebVerification: `pass after one unrelated intermittent failure`
- buildVerification: `pass with existing chunk-size warning`
- uiScopeCheck: `pass`
- browserVerification: `blocked by authentication / not passed`
- implementationSemantics: `fail`
- boardSyncReady: `event only / visible HTML apply blocked by unrelated dirty changes`

## Blocking Findings

### 1. “放弃修改”没有放弃页面中的修改

priority: `P1`  
files:

- `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:134`
- `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:147`
- `ui/V2_PROTOTYPE/src/__tests__/ModelConfig.test.jsx:94`

`handleModelConfigChange` 直接调用 `actions.updateModelConfig`，因此用户输入立即写入页面级 `modelConfig`。`confirmDiscard` 只清除 `modelDirty` 并关闭弹窗，没有恢复打开弹窗前的模型配置快照。

结果是：用户修改模型标识后点击“放弃修改”，弹窗虽然关闭，但模型卡片和下次打开弹窗仍会显示刚才的修改。“放弃修改”文案与实际行为冲突。

现有测试只断言编辑弹窗关闭，没有断言原值恢复，因此无法捕获该问题。

requiredCorrection:

1. 打开编辑弹窗时保存当前模型配置快照，或使用独立的 page-owned editor draft。
2. 确认放弃时恢复快照；继续编辑时保留当前 draft。
3. 新增回归测试：修改值 → 放弃 → 重新打开或检查卡片摘要 → 原值仍为修改前内容。

### 2. 编辑弹窗“确定”忽略保存结果并提前关闭

priority: `P1`  
files:

- `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:1038`
- `ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js:212`

编辑弹窗“确定”按钮以 fire-and-forget 方式调用 `actions.saveModelDraft()`，随即清除 dirty 状态并关闭弹窗。`saveModelDraft` 通过 `withAction` 返回 `{ success, error }`，但调用方没有等待或检查结果。

Qoder 同时删除了该 action 内原有的 `alert()`。因此当 PATCH 失败时：

- 弹窗仍然关闭；
- dirty 状态已经清除；
- 页面没有失败反馈；
- 用户失去原弹窗中的直接重试路径。

这与本任务“使用内联反馈替代 alert”的目标不一致。内联反馈应覆盖同一保存 owner 的全部可达入口，而不是只覆盖页面顶部“保存草稿”按钮。

requiredCorrection:

1. 使用单一 async handler 承接编辑弹窗保存。
2. 保存期间禁用确定和所有关闭入口，显示明确 busy 状态。
3. 成功后关闭编辑弹窗并在模型配置页面显示内联成功状态。
4. 失败时保持弹窗和输入内容，显示归属于该保存动作的可见错误。
5. 新增成功与失败回归测试，断言失败不关闭、输入仍在、错误可见且可重试。

## Non-Blocking Findings

### 3. Worktree 不是 clean handoff

priority: `P2`

`git status --short --branch` 显示：

```text
?? ui/V2_PROTOTYPE/node_modules
```

该对象是指向主项目依赖目录的符号链接，未进入 commit，但属于未声明的生成/环境残留。Qoder 应在返工 handoff 前移除该 worktree 内的未跟踪链接，并提交 clean status 证据；不得清理主项目依赖目录。

## Verification Reproduced

- `npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/ModelConfig.test.jsx`
  - `pass 5/5`
- `npm run test:web`
  - first run: `fail 173/174`
  - unrelated intermittent failure: `HomeWorkspace > renders AI formBlock stored in session message metadata`
- focused rerun of the failing HomeWorkspace test
  - `pass 1/1`
- second `npm run test:web`
  - `pass 25 files / 174 tests`
- `npm run build:web`
  - `pass`
  - retains existing `>500 kB` chunk-size warning
- `node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base 90f9838 -- ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js ui/V2_PROTOTYPE/src/__tests__/ModelConfig.test.jsx`
  - `pass / No new deterministic UI findings`

## Browser Evidence

Qoder 明确报告认证阻断，本轮没有当前浏览器下的 1440px、760px、键盘或弹窗交互证据。因此：

- 不把视觉结果标记为已验证；
- 语义 token 变更暂以静态 owner 与自动化测试为证据；
- 返工自动化通过后，仍需在可用管理员会话中补人工验收。

## Rework Prompt

继续处理 `QODER-UI-004-IMPL`，不得领取新任务。

仅修改：

- `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx`
- `ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js`（只有保存 owner 确实需要时）
- `ui/V2_PROTOTYPE/src/__tests__/ModelConfig.test.jsx`
- 现有相关 SystemManagement 测试（仅为修复回归所必需）

必须：

1. 先补两个会失败的测试：
   - 放弃修改后恢复打开编辑器前的原值；
   - 编辑弹窗保存失败时保持打开、保留输入并显示错误。
2. 实现最小修复，再运行到 GREEN。
3. 保存期间锁定确定、Escape、关闭按钮、取消和遮罩关闭。
4. 保存成功后关闭弹窗并显示页面内联成功状态。
5. 移除 worktree 内未跟踪的 `ui/V2_PROTOTYPE/node_modules` 符号链接，但不得删除主项目依赖目录。
6. 复跑聚焦测试、`npm run test:web`、`npm run build:web` 和 UI scope checker。
7. 回填新的 head commit、clean worktree status、验证结果及仍缺失的浏览器证据。

禁止：

- 扩展到其他系统管理子路由；
- 修改 API、权限、数据库或 OpenAPI；
- 引入第二 UI 技术栈；
- 把认证阻断描述为浏览器验收通过；
- 自动开始下一项 UI 优化。

最终状态仍只能写：`已回填 / 待 Codex 复核`。

