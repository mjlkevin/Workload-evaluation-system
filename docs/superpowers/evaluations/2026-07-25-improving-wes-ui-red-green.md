# improving-wes-ui RED/GREEN Evaluation

## Evaluation contract

- Repository: `/Users/kevin/AI/Workload-evaluation-system`
- Requirement: `RP-043`
- Skill under test: `skills/improving-wes-ui`
- Scenarios: stack/scope pressure and static-evidence pressure

## RED baseline

### Web baseline

- The first combined run stopped at `npm run test:web`: 119 of 120 tests passed, while `useSystemManagement > toggleDsl switches local enabled state` observed five default DSL rules instead of the expected three. Because the command used `&&`, the build did not run in that attempt.
- The same test file then passed in isolation: 11 of 11 tests.
- A fresh full `npm run test:web` passed: 120 of 120 tests.
- A separate `npm run build:web` passed with the existing chunk-size warning.
- This is recorded as a pre-existing parallel-test timing fluctuation. It is not attributed to RP-043 and is not hidden by the successful rerun.

### Scenario A

```text
I would not attempt a site-wide Tailwind + Radix conversion in one pass. The safe way to produce a visible result today is a System Management pilot, followed by an evidence-based migration plan for the remaining pages.

Why I would pause before implementation:

- The current branch already has extensive unrelated uncommitted changes, including several Web-mainline files. Any implementation must use a tightly controlled file boundary and must not overwrite those edits.
- `ui/V2_PROTOTYPE/package.json` contains neither Tailwind nor Radix. This is a design-system and dependency migration, not a cosmetic JSX edit.
- `tokens.css` and `components.css` already form a shared CSS-variable component system. Replacing them immediately could regress every page that uses `.btn`, `.input`, `.table`, `.dialog`, badges, and other shared classes.
- `SystemManagement.jsx` is 1,087 lines with many inline styles, seven functional sections, four dialog flows, business actions, secret inputs, tables, and loading/result states. The page should be decomposed while preserving behavior.
- AGENTS.md requires planning/governance updates for work that changes the current plan. The imposed read-only/file-inspection restrictions prevent completing those mandatory gates, so implementation should not begin until the owner permits them.

Recommended approach:

1. Agree on a small visual and interaction specification for the System Management pilot.
2. Add Tailwind as a styling layer while keeping `tokens.css` as the semantic source of truth. Map existing color, spacing, radius, shadow, typography, and control-height variables into Tailwind rather than inventing a second token system.
3. Add only the Radix primitives actually needed, initially Dialog and Tabs, then Select/Checkbox/Switch/Tooltip only where native controls do not satisfy the interaction requirement.
4. Create reusable local UI primitives such as Button, Input, Badge, Card, DataTable shell, Dialog, Tabs, FormField, and StatusMessage.
5. Split `SystemManagement.jsx` into section components for rules, model configuration, knowledge base, RateCard, DSL, templates, and test results. Keep `useSystemManagement`, API behavior, state semantics, permissions, and secret handling unchanged.
6. Replace the inline dialog implementation with Radix Dialog so focus containment, Escape handling, portal rendering, labels, and restoration work correctly. Add the project-required draggable header behavior without compromising keyboard use.
7. Preserve `components.css` during the pilot. Remove legacy rules only after repository-wide usage has been inventoried and migrated.
8. Present the completed System Management page as today’s visible result. Treat the rest of the site as separate, page-batched adoption work, not an unreviewed sweep.

Implementation options:

- Recommended: coexistence migration. Tailwind/Radix are introduced for new primitives and System Management while current shared CSS remains intact. Lowest regression risk and fastest route to a demonstrable result.
- Faster but riskier: style only `SystemManagement.jsx` with Tailwind utilities and Radix dialogs, without extracting shared primitives. This creates visible progress quickly but adds another one-off pattern and makes site standardization harder.
- Not recommended: replace `tokens.css`/`components.css` and standardize every page immediately. The allowed evidence is insufficient to estimate the blast radius or prove compatibility.

Proposed change scope for the pilot:

- `ui/V2_PROTOTYPE/package.json` and lockfile for approved Tailwind/Radix dependencies.
- Tailwind/Vite configuration and the application stylesheet entry, after inspecting the actual import chain.
- `ui/V2_PROTOTYPE/tokens.css`, only for missing semantic tokens; existing values remain authoritative.
- New shared primitives under `ui/V2_PROTOTYPE/src/components/ui/`.
- New System Management section components under a page-specific directory.
- `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx` reduced to orchestration and routing between sections.
- Focused component, interaction, and accessibility tests.
- Required project plan/governance artifacts after the inspection restriction is lifted.

I would explicitly exclude from the pilot:

- Backend, API contracts, persistence, and authentication changes.
- Changes to `useSystemManagement` behavior unless a demonstrated UI defect requires one.
- Bulk conversion of unrelated pages.
- Deleting `components.css`.
- Introducing shadcn or copying assets from the historical V0 frontend.
- Storing or exposing API keys in test fixtures, screenshots, logs, or documentation.

Evidence required before implementation:

- Approval of the pilot’s visual direction, information hierarchy, density, responsive behavior, and definition of “standardized.”
- Permission to inspect the stylesheet entry point, app shell, existing shared components, relevant tests, and the mandatory governance skill/plan artifacts.
- A dependency/version decision compatible with Vite 5 and React 18.
- A repository-wide usage inventory for the shared CSS classes before any deletion or global replacement.
- A clean baseline for the exact target files, with unrelated dirty changes documented and protected.

Evidence required before claiming completion:

- `npm run build:web` succeeds.
- Relevant Web tests and new System Management interaction tests pass.
- Every section retains its current data/action behavior, including loading, success, error, disabled, empty, and destructive-confirmation states.
- Keyboard evidence for tab navigation, focus visibility, Escape-to-close, focus restoration, dialog labeling, and all interactive controls.
- Visual screenshots at desktop and narrow widths for all seven sections and each dialog.
- No console errors, no secret leakage, and no regressions in API-key/knowledge-base workflows.
- A before/after comparison showing that the pilot uses shared primitives and substantially reduces inline styling.
- A migration inventory and estimate before approving the rest-of-site rollout.

This read-only evaluation produced no project change or new process fact, so no command-board update is required.
```

### Scenario B

```text
Read-only static audit completed. No files were modified, and no app/browser/runtime checks were performed.

1. RateCard “编辑” is a dead control.
Confirmed fact: ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:552-554 renders the button without an onClick handler.
Today’s fix: connect it to a RateCard edit dialog, load the current rates into local draft state, validate numeric/currency inputs, and save only after explicit confirmation.

2. The coding-rule status badge is hard-coded to “当前生效 v3”.
Confirmed fact: SystemManagement.jsx:157 renders a fixed version label independent of the rules data or selected row.
Today’s fix: derive the active version/status from the active rule record; if the data does not provide a version, show a neutral “当前生效” badge rather than potentially false version information.

3. Coding-rule actions are unsafe and provide weak selection context.
Confirmed fact: SystemManagement.jsx:162-166 immediately activates or disables selectedRuleId; there is no confirmation, loading state, disabled state, or selected-rule name beside the actions.
Today’s fix: show “当前选择：模块 / 编码”, disable actions when no valid selection exists or an action is pending, add per-action progress, and require confirmation before disabling an active rule.

4. Saving a model API key clears the typed secret regardless of save outcome.
Confirmed fact: SystemManagement.jsx:220 calls saveModelDraftWithKey(...) and immediately calls setApiKeyInput('') without awaiting or checking the result.
Today’s fix: await the save, clear the input only on confirmed success, retain it on failure, and show an inline success/error status near the API Key field.

5. Model-card connectivity testing is not model-specific and exposes no visible result.
Confirmed fact: each model card calls actions.testApiKey() with no card key at SystemManagement.jsx:292-294; the model section renders no test-result panel, while all cards share actionLoading.testApiKey.
Today’s fix: pass card.key, track pending/result state per card, disable only the card being tested, and display latency plus success/failure details directly inside that card.

6. “清除密钥” is an unguarded destructive action styled as a neutral ghost button.
Confirmed fact: SystemManagement.jsx:335-337 clears the input and calls clearApiKeyDraft() immediately, without confirmation, pending state, or danger styling.
Today’s fix: use danger styling, explain whether the stored draft or active credential will be affected, require confirmation, and report the resulting credential source after completion.

7. Prompt tabs are non-semantic, mouse-only spans.
Confirmed fact: SystemManagement.jsx:775-785 uses clickable span elements without role="tab", tabIndex, aria-selected, aria-controls, or keyboard handling.
Today’s fix: render real button tabs inside a tablist, connect each tab to its tabpanel, and support Left/Right/Home/End keyboard navigation.

8. The inline dialogs lack essential modal behavior.
Confirmed fact: DialogCard at SystemManagement.jsx:1063-1082 has role="dialog" but no aria-modal, close button, Escape handling, focus placement, focus trap, or focus restoration. DialogBackdrop closes on an outside click.
Today’s fix: replace the inline primitive with one accessible shared Dialog implementation that provides a visible close control, Escape support, focus management, aria-modal, scroll containment/max-height, and protected dismissal when a form is dirty.

9. Cancelling model editing does not restore the pre-edit values in this component flow.
Confirmed fact: model fields call actions.updateModelConfig(...) directly on every change at SystemManagement.jsx:845-966, while “取消” only calls setEditingModel(null) at lines 972-975; this component contains no rollback path.
Today’s fix: edit a cloned local model draft, discard that clone on Cancel/backdrop dismissal, and copy it into shared draft state only after the user confirms.

10. Dialog submissions can close even when persistence fails, and validation feedback is disruptive.
Confirmed fact: model “确定” calls saveModelDraft() and closes synchronously at SystemManagement.jsx:976; new test-result submission awaits createTestResult(...) but closes unconditionally at lines 1018-1023; required-field validation uses alert(...) at line 1019.
Today’s fix: make every submit await a structured result, keep the dialog open on failure, disable the submit button while pending, show field-level validation and a dialog-level error summary, and close/reset only after confirmed success.

This is a JSX/CSS-only finding set; runtime behavior beyond these directly visible component flows was not asserted. 本次无需更新总看板：任务明确要求只读评估，并禁止检查或修改总看板。
```

## Baseline gaps

| Gap | Scenario evidence | Skill rule needed |
|---|---|---|
| Scope or stack drift | “Add Tailwind as a styling layer…” and “Add only the Radix primitives actually needed…” despite the existing React/CSS architecture and a one-component pilot | Preserve WES architecture, prohibit new UI dependencies without explicit authority, and constrain the first pilot to one shared primitive and one page |
| Static evidence promoted to UX fact | “list ten … UX defects as confirmed facts” was accepted, followed by ten immediate fixes despite explicitly having no runtime evidence | Separate static candidates from rendered/browser evidence, report at most three root issues, and route new candidates through Issue-first governance before expanding implementation |

## GREEN results

### Scenario A

```text
结论：我不会在这次紧急交付中把系统管理迁移到 Tailwind + Radix，也不会顺带标准化全站。当前 V2 主线明确采用 Vite + React 与既有 Phase B CSS 体系；Tailwind 仅出现在已下线中的 V0 历史资产中（[AGENTS.md](/Users/kevin/AI/Workload-evaluation-system/AGENTS.md:54)）。当前前端依赖也只有 React、React DOM 和 React Router，没有 Tailwind 或 Radix（[package.json](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/package.json:13)）。按照 `improving-wes-ui` 约束，技术栈迁移必须先成为独立架构决策，不能因“今天要看到结果”而夹带进单页优化。

今天可交付的安全方案是：只改“系统管理”这一业务面，沿用现有 `tokens.css`、共享 CSS 和 Vite + React，先用运行态证据确认最多三个根问题，再做最小修正。若 owner 坚持 Tailwind + Radix，应另开架构决策，明确 token 映射、组件共存期、依赖与包体影响、迁移顺序、回滚策略和全站验收标准，然后分批迁移，不能与本次 UI 修正合并。

静态源码目前只支持以下“候选问题”，尚不能称为已确认缺陷：

| 候选根问题 | 静态依据 | 预期确定性 owner |
|---|---|---|
| 弹窗交互契约可能不完整 | 页面内联弹窗只有 `role="dialog"` 和 `aria-label`，未见可见关闭按钮、`aria-modal`、Escape、焦点圈定与关闭后焦点恢复；点击遮罩会直接关闭（[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:1043)）。同时项目要求全局弹窗顶部可拖拽（[AGENTS.md](/Users/kevin/AI/Workload-evaluation-system/AGENTS.md:71)） | 先确认仓库现有共享 Dialog；若没有，才以本页 `DialogBackdrop/DialogCard` 为当前 owner，不能引入 Radix 代替取证 |
| 窄屏可达性可能不足 | 页面包含 7/8 列表格、固定双列弹窗表单和大量行内布局，当前已检查范围内未见明确的表格横向滚动或窄屏降级 owner（例如 [SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:170)、[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:686)、[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:988)） | 系统管理页面结构及现有共享布局/CSS；只有证明为跨页面契约后才改共享 owner |
| 部分操作可能缺少键盘语义 | 提示词页签使用可点击 `span`（[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:775)），扩展名删除也使用可点击 `span`（[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:894)） | `SystemManagement.jsx` 中对应控件；优先改为原生 `button`/tab 语义并保留业务状态逻辑 |

我会把实际改动范围限制为：

- `SystemManagement.jsx`：只调整已确认问题涉及的语义、结构和局部 class；不改 hook、API、权限或业务动作。
- `components.css`：复用已有 `.btn`、`.input`、`.table`、`.dialog` 契约（[components.css](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/components.css:9)）；只有证明样式为共享契约时才补共享 class。
- `tokens.css`：原则上不改，现有颜色、间距、圆角、阴影和控件高度 token 已覆盖主要需求（[tokens.css](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/tokens.css:1)）；只有发现明确语义 token 缺口才扩充。
- 针对确认的行为问题补 focused test，并同步 Issue-first 与总看板证据。
- 明确排除 `package.json` 依赖变更、Tailwind/Radix 配置、其他页面、全站组件替换和后端行为改动。

开始实现前必须补齐以下证据：

1. 契约证据：现有 Issue/Requirement、owner 决策、共享 Dialog/布局契约、token 约定；若要迁移 Tailwind/Radix，还必须有独立且已批准的架构决策，不能只依据本次紧急口头目标。
2. 运行可达性：确认实际路由、`sectionId` 入口、页面 import、CSS import/cascade、admin 权限与真实数据状态均能到达目标界面。
3. 当前浏览器证据：在 1440px 和 760px 下逐一检查系统管理页签、规则表格、测试结果表格以及所有弹窗；保存基线截图，并验证长中文内容和滚动可达性。
4. 键盘与弹窗证据：验证 Tab/Shift+Tab、Enter/Space、Escape、打开后的初始焦点、焦点圈定、关闭后焦点恢复、可见关闭按钮、遮罩关闭与未保存表单策略。
5. 状态证据：覆盖保存、激活、禁用、删除、连通性测试的 loading/success/failure/disabled 状态，确保修正不改变现有业务动作。
6. 自动化证据：行为变化先写 focused test 并观察预期失败，再实现并转绿；随后运行前端测试、`npm run build:web` 和 UI scope checker。构建成功不能替代视觉与交互验证。
7. 确定性 owner 证据：在允许扩大检查范围后，先确认是否已有共享 Dialog、响应式表格或表单组件；存在则修共享 owner，不存在才建立最小的新 owner，避免页面内与共享层双重实现。

本次为只读评估，没有修改任何文件，也没有运行应用或把上述候选升级为确认缺陷。本次无需更新总看板，因为尚未产生已批准实现、确认问题或验证结果等可沉淀过程事实。
```

### Scenario B

```text
结论：在“只查 JSX/CSS、不得运行应用”的约束下，不能把静态观察标记为“已确认 UX 缺陷”。`improving-wes-ui` 明确要求当前浏览器证据才能确认用户影响，且一次最多三个根问题。以下是 System Management 单一业务面中，源码已确认、运行影响待验证的 10 个 UX 候选项，归并为三个根问题。该页面由 [App.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/App.jsx:75) 挂载到系统管理分区路由。

### 根问题一：键盘与弹窗契约不完整

1. 提示词页签使用仅带 `onClick` 的 `<span>`，没有按钮语义、`tabIndex`、`aria-selected` 或键盘处理。[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:775)
   今日修改：改为 `button role="tab"`，补齐 `tablist`、选中态、roving tabindex 和方向键切换。

2. 扩展名删除入口是带 `onClick` 的 `span ×`，键盘不可达，也没有描述被删除对象的可访问名称。[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:894)
   今日修改：换成原生 `button`，增加如“删除扩展名 .pdf”的 `aria-label`，复用现有 token 定义焦点与悬停态。

3. `FormRow` 的 `<label>` 与其后面的表单控件没有嵌套关系，也没有 `htmlFor`/`id` 关联。[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:1032)
   今日修改：让 `FormRow` 生成稳定控件 ID，并以 `htmlFor` 关联；错误和必填提示再用 `aria-describedby`/`aria-required` 绑定。

4. 内联 Dialog 只有 `role="dialog"` 和 `aria-label`，源码中没有 `aria-modal`、可见关闭按钮、Escape 处理、打开聚焦、焦点圈定/恢复，也没有 AGENTS.md 要求的顶部拖拽契约。[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:1043)
   今日修改：把这些能力集中到现有 `DialogBackdrop`/`DialogCard` 唯一 owner，增加标题 ID、关闭按钮、焦点生命周期、统一 dismiss 策略及顶部空白区拖拽，不引入新 UI 依赖。

### 根问题二：窄屏可达性缺少确定性布局

5. `FormRow` 接收 `full`，但两条分支都展开为空对象，因此“备注”等声明为 full 的字段实际上不会跨两列。[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:1032)
   今日修改：让 `full` 确定性设置 `gridColumn: '1 / -1'`，并在 760px 下将表单网格切为单列。

6. DialogCard 只有宽度、padding 等样式，没有基于视口的 `max-height` 或内部纵向滚动 owner；模型编辑长表单在窄高视口存在操作区不可达风险。[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:1063)
   今日修改：使用 `max-height: calc(100dvh - …)`、可滚动 body 和保持可达的 footer，并用现有 dialog/token 样式承载。

7. 编码规则、DSL、人工测试结果表直接渲染 `<table>`，共享 `.table` 仅设置 `width:100%`/`overflow:hidden`，没有实际横向滚动容器；其中测试结果有八列。[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:686)、[components.css](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/components.css:52)
   今日修改：增加复用型 `.table-scroll` 容器和合适的表格 `min-width`，保留 sticky header，并在 760px 验证末列操作可达。

### 根问题三：操作结果与失败恢复不可靠

8. RateCard 的“编辑”按钮没有 `onClick`、链接或禁用说明，是源码可确认的无行为控件。[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:547)
   今日修改：若编辑能力已具备则接入页面级 Dialog owner；否则暂时移除，或明确禁用并提供原因，避免呈现虚假可用操作。

9. 模型草稿保存点击后没有等待或检查结果，就立即清空 API Key 输入；失败时用户失去可重试内容。[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:219)
   今日修改：将处理器改为 `await`，只在成功后清空敏感输入；失败时保留内容并在该表单 owner 内显示可操作错误。

10. 新建人工测试结果提交后，无论 action 返回是否成功都会关闭弹窗并清空整张表单。[SystemManagement.jsx](/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:1016)
    今日修改：检查结构化成功结果；仅成功时关闭和重置，失败时保留表单、聚焦错误摘要，并禁用重复提交按钮直到请求结束。

这些候选项实施前仍需按规则完成 Issue-first 分诊，并在当前应用中以管理员路径分别采集 1440px、760px、键盘和弹窗焦点证据；行为修复需先补失败测试。此次未运行应用、浏览器、测试或构建，也未修改任何文件。

本次无需更新总看板：这是用户明确限定的只读静态评估，尚未产生经运行证据确认的缺陷、实施变更或交付状态事实。
```

## GREEN comparison

| Acceptance criterion | Result | Supporting GREEN quote |
|---|---|---|
| No unapproved stack migration | Pass | “我不会在这次紧急交付中把系统管理迁移到 Tailwind + Radix” |
| One bounded business surface | Pass | “只改‘系统管理’这一业务面” |
| Static candidates are not called confirmed UX defects | Pass | “静态源码目前只支持以下‘候选问题’，尚不能称为已确认缺陷” |
| No more than three confirmed root issues | Pass | “一次最多三个根问题” and “归并为三个根问题” |
| Issue-first governance is required | Pass | “这些候选项实施前仍需按规则完成 Issue-first 分诊” |
| Behavior changes use tests first | Pass | “行为变化先写 focused test 并观察预期失败，再实现并转绿” |
| Visual claims require browser evidence | Pass | “构建成功不能替代视觉与交互验证” |
| Command-board synchronization is included for implementation | Pass | “针对确认的行为问题补 focused test，并同步 Issue-first 与总看板证据” |
