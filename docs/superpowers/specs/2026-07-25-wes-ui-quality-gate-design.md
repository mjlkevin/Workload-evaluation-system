# WES UI 质量门禁与系统管理试点设计

## 1. 背景与决策

用户要求评估并采用 `ibelick/ui-skills` 改进 WES 当前 UI。审查确认其“基于现有设计证据、一次审计一个业务表面、优先可访问性与可验证修正”的方法适合 WES，但 Tailwind、Motion、Base UI/Radix、默认阴影与禁用渐变等强制技术规则不适合直接覆盖当前主线。

本设计选择“项目内 WES 适配 Skill + 系统管理试点”，而不是安装整套上游 CLI 或迁移前端技术栈。

上游评估基线：

- 仓库：`https://github.com/ibelick/ui-skills`
- 审查提交：`ae74b58e722abe7ddf5948e07dd220808acce8a9`
- 许可证：MIT
- 采用来源：`improve-ui`、`fixing-accessibility`、`fixing-motion-performance` 和经裁剪的 `baseline-ui`

治理追踪：

- 原始问题：`ISS-2026-07-25-003`
- 派生需求：`RP-043`
- 当前状态：用户已于 2026-07-25 明确“规格通过”；实施计划已形成，进入 Skill RED/GREEN 与产品 TDD

## 2. 目标

1. 建立可重复触发的 WES UI 审计、设计和实现质量门禁。
2. 保留 `ui/V2_PROTOTYPE` 的 Vite + React 主线及 `tokens.css`、`components.css`、`layout.css` 设计系统。
3. 将 UI 问题与修正绑定到运行路径、现有 Token/组件和可复查证据，避免审美驱动的全站重做。
4. 用系统管理页面族验证 Skill 是否能改善高密度表格、表单、Tabs、弹窗和高风险操作。
5. 第一批收敛系统管理内联 Dialog，补足可访问语义、焦点管理和既有“顶部可拖拽”约定。

## 3. 非目标

- 不引入 Tailwind、Motion、Base UI、Radix、React Aria 或第二套组件系统。
- 不改变 API、JWT、角色权限、系统配置保存语义和后端数据结构。
- 不在第一批重构全部页面或清理全部 JSX 内联样式。
- 不把代码静态差异直接当作 UX 缺陷；层级、密度、可发现性等判断必须有本轮渲染证据。
- 不把人工未验证结果标记为通过。

## 4. 方案对比

### 方案 A：整套安装并执行上游 UI Skills

优点是接入快、规则完整。缺点是会把 Tailwind、`cn`、Motion 和新的 primitive 体系带入 WES，与当前 CSS Token 主线冲突，也会让上游动态内容漂移。拒绝。

### 方案 B：运行时通过 `npx ui-skills` 动态选择规则

优点是能持续获得上游更新。缺点是 CLI 从远端注册表和 Skill 内容动态取数，执行规则不可复现；第三方 Skill 也可能随注册表变化进入上下文。拒绝作为正式门禁，只允许人工研究时临时使用。

### 方案 C：项目内 WES 适配 Skill

将适用原则固化在仓库内，记录上游提交和覆盖规则；机械检查交给脚本，设计判断保留证据门禁。该方案可版本化、可测试、可与 Issue-first 和总看板流程组合。采用。

## 5. Skill 架构

新增 `skills/improving-wes-ui/`：

```text
skills/improving-wes-ui/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── quality-checklist.md
│   └── upstream-provenance.md
└── scripts/
    └── check-ui-scope.mjs
```

职责：

- `SKILL.md`：定义触发条件、证据门禁、WES 架构约束、审计/实现/验证流程和停止条件。
- `quality-checklist.md`：按视觉层级、响应式、可访问性、交互反馈、动效性能和组件复用分类列出检查项。
- `upstream-provenance.md`：记录上游提交、许可证、采用项、覆盖项和更新审查规则。
- `check-ui-scope.mjs`：对指定改动范围做确定性静态检查，报告新增裸色值、任意 z-index、缺少可访问名称的明显 icon-only button、重复页面内 Dialog helper 和新增 UI 依赖。脚本只报告证据，不把既有债务误标为本批回归。
- `agents/openai.yaml`：提供项目内 Skill 的显示名、短描述和默认调用提示。

`AGENTS.md` 增加触发规则：涉及 `ui/V2_PROTOTYPE` 的页面、组件、样式、响应式、弹窗、可访问性或视觉优化时，先读取该 Skill；原有需求入池、总看板和测试门禁继续生效。

## 6. WES 覆盖规则

下列项目规则高于上游默认值：

| 上游规则 | WES 规则 |
|---|---|
| Tailwind 默认值 | 使用 `tokens.css` 和既有共享 CSS |
| 必须使用 `cn` | 沿用当前 `className` 与共享 class 约定 |
| JS 动画使用 Motion | 默认 CSS；只有交互确实需要且用户批准时再评估依赖 |
| 优先 Base UI | 优先 WES 现有组件；新依赖需独立设计决策 |
| 禁止渐变/letter-spacing | 已由 WES Token 或设计合同使用的模式继续保留 |
| 只写 `design-plans/` | 按 WES Issue-first、规格、实施计划、测试和总看板流程执行 |
| 最多报告 3 个问题 | 单次试点最多 3 个已证实根问题；关联症状合并处理 |

所有修正必须同时具备：

1. **合同证据**：WES 文档、Token、共享组件、同一任务内的直接矛盾或用户明确决策。
2. **运行证据**：导入、路由、属性、CSS 继承或本轮浏览器截图证明该实现到达目标页面。
3. **确定修正**：能指向一个现有 owner，或说明为何必须新增共享 owner。

## 7. 系统管理试点

### 7.1 审计表面

- `/system/code-rules`
- `/system/model-config`
- 共享系统管理 Dialog

选择理由：该页面族同时覆盖密集表格、配置表单、子路由、弹窗、保存/生效/禁用等高风险动作，能够用较小范围验证质量门禁。

### 7.2 第一批产品改动

新增 `ui/V2_PROTOTYPE/src/components/ui/Dialog.jsx`，采用浏览器原生 `<dialog>` 作为 modal 基础，不增加第三方依赖。组件负责：

- `aria-labelledby` / 可选 `aria-describedby`
- `showModal()` 与关闭状态同步
- Escape 关闭
- 初始焦点
- 关闭后焦点恢复
- 点击遮罩关闭，可由高风险场景禁用
- 标题区拖拽，位移限制在可视区域内
- 使用现有 Token 控制表面、边框、圆角、阴影和焦点样式

`SystemManagement.jsx` 的页面内 `DialogBackdrop`、`DialogCard`、`DialogActions` 迁移到共享组件。配置保存、生效、测试连接、人工测试结果等业务行为保持不变。

第一批不迁移 UserManagement、ApiKeys、ReviewDetail 和 TraditionalHomeDashboard；它们在试点通过后按独立批次迁移。

### 7.3 错误与边界

- 不支持 `HTMLDialogElement.showModal()` 时，组件以受控 overlay 降级，但仍保留 dialog 语义、Escape、焦点恢复和遮罩策略。
- 拖拽只绑定标题区，不绑定表单内容；关闭后重置位移。
- Dialog 已打开时重复设置 open 不重复调用 `showModal()`。
- 业务请求失败时继续由当前页面在动作附近显示错误；本批不重写 API 错误模型。

## 8. 测试与验证

### 8.1 Skill 红绿验证

创建 Skill 前，以不加载 Skill 的独立代理执行两个压力场景并记录失败：

1. 要求“快速把系统管理页面改成 Tailwind + Radix，并顺便全站统一样式”。
2. 要求“只看 JSX 搜索结果，不运行页面，直接列出十个 UX 缺陷并修改”。

预期 RED：代理接受技术栈迁移、跳过 Issue-first/证据门禁，或把静态候选当成 UX 结论。

创建 Skill 后，以相同任务重新验证。预期 GREEN：

- 拒绝未经批准的技术栈迁移。
- 先限定一个页面族。
- 区分静态候选和渲染证据。
- 只提出最多三个已证实根问题。
- 将实施请求接入 Issue-first、测试和总看板流程。

### 8.2 产品自动化

- 新增 Dialog 聚焦测试：打开语义、标题关联、Escape、遮罩策略、初始焦点、关闭后焦点恢复。
- 扩展系统管理测试：所有现有 Dialog 仍可打开、提交、取消，原业务动作不变。
- 运行：
  - `npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/Dialog.test.jsx`
  - `npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/SystemManagementCodeRules.test.jsx src/__tests__/SystemManagementKnowledgeBase.test.jsx`
  - `npm run test:web`
  - `npm run build:web`

### 8.3 渲染验收

使用本轮浏览器状态访问系统管理，保存并检查：

- 1440px 桌面：编码规则默认页、配置 Dialog、模型配置 Dialog。
- 760px 窄屏：页面滚动、Dialog 可视区域、底部动作可达。
- 键盘路径：Tab 顺序、Escape、关闭后返回触发按钮。

若没有有效 admin 会话或无法保存有效截图，停止视觉验收并报告阻塞，不以代码检查替代截图结论。

## 9. 验收口径

- 项目内 Skill 能被明确触发并通过结构校验。
- Skill 压力场景完成 RED/GREEN 对比，能够阻止技术栈漂移和无证据全站重构。
- WES 前端依赖列表不增加 UI、CSS 或动画库。
- 系统管理试点使用一个共享 Dialog owner，页面内重复 Dialog helper 被移除。
- Dialog 自动化、V2 全量测试和 Web 构建通过。
- 桌面与窄屏截图、键盘路径有本轮证据；无法执行的人工项保持待回填。
- Issue、Requirement、设计、测试、风险、来源和变更记录可相互追溯。

## 10. 分批顺序

1. 批次 A：建立并验证 `improving-wes-ui` Skill。
2. 批次 B：实现共享 Dialog，迁移 SystemManagement。
3. 批次 C：完成浏览器视觉/键盘验收，回填结果。
4. 批次 D：根据试点证据决定是否迁移其他 Dialog；不得自动扩展为全站重构。
