# Qoder UI 优化启动包

> 日期：2026-07-26  
> 当前状态：交接材料已形成 / 待 Qoder 初始化 ACK / 未分派新的实现任务  
> 适用范围：`ui/V2_PROTOTYPE`  
> 关联主线：RP-043 WES UI 质量门禁与页面任务流优化

## 1. 交接结论

`ibelick/ui-skills` 对 WES 有价值，但价值不在于给页面统一“换皮”，而在于把 UI 优化约束成一套可验证的产品与交付方法：

1. 从用户任务和业务风险出发，不把静态代码观感直接写成缺陷。
2. 一次只处理一个业务面，并把症状归并为最多三个根问题。
3. 每个修复都要同时具备契约依据、运行可达性和确定性 owner。
4. 行为变更走测试 RED/GREEN，视觉与交互结论走当前浏览器证据。
5. 复用 WES 现有 Vite + React、tokens、CSS 和共享组件，不借 UI 优化引入第二技术栈。

WES 已把上游方法裁剪为项目内 `skills/improving-wes-ui`。项目内版本固定审阅来源、补充 Issue-first、TDD、真实浏览器和总看板门禁，是后续 Qoder UI 工作的权威 Skill。上游仓库当前入口与命令可参考 <https://github.com/ibelick/ui-skills>，但 WES 不在实现阶段执行上游运行时 CLI，也不隐式跟踪上游最新分支。

## 2. 两轮已完成优化

| 批次 | 业务面 | 优化思路 | 已形成能力 | 验证状态 |
|---|---|---|---|---|
| 第一轮 | UI 质量门禁 + 系统管理共享 Dialog 试点 | 先建立项目内 UI Skill 和范围检查器，再用一个高频交互组件验证可访问、拖拽和关闭语义 | `skills/improving-wes-ui`；共享 `Dialog`；SystemManagement 四处弹窗迁移；上游来源与 WES override 固化 | Skill RED/GREEN 压力样本通过；聚焦测试 13/13；当轮 Web 128/128；构建通过；用户后续确认效果稳定 |
| 第二轮 | 用户管理 `/users` | 不做装饰性改版，围绕“筛选—选择—单用户编辑—批量操作—风险确认—结果反馈”重排任务流 | 页面动作分层；共享 `Drawer`；角色/业务角色/状态真实持久化；脏关闭保护；风险、密码和邀请反馈；桌面与窄屏可达 | 聚焦测试 53/53；Web 172/172；API handlers 52/52；Web/API 构建通过；OpenAPI 校验通过；1440px、760px、键盘和 Chrome 验收通过 |

### 第一轮沉淀

- 证据：
  - `skills/improving-wes-ui/SKILL.md`
  - `skills/improving-wes-ui/references/quality-checklist.md`
  - `skills/improving-wes-ui/references/upstream-provenance.md`
  - `docs/superpowers/evaluations/2026-07-25-improving-wes-ui-red-green.md`
  - `docs/superpowers/evaluations/2026-07-25-system-management-dialog-qa.md`
- 关键结果：
  - 能拦截未批准的 Tailwind、Radix 等第二技术栈。
  - 能拦截“全站一起改”和“静态候选直接升级为缺陷”。
  - 共享 Dialog 成为弹窗语义、焦点、Escape、遮罩和拖拽的确定性 owner。

### 第二轮沉淀

- 证据：
  - `docs/superpowers/specs/2026-07-25-wes-user-management-drawer-design.md`
  - `docs/superpowers/plans/2026-07-26-wes-user-management-drawer.md`
  - `docs/superpowers/evaluations/2026-07-26-user-management-drawer-qa.md`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-26-user-management-drawer-implementation.json`
- 关键结果：
  - 用户列表保持扫描效率，编辑进入侧栏，危险动作进入专用确认流程。
  - UI 状态与真实 API 持久化一致，不用视觉假状态代替服务端结果。
  - 保存期间、脏表单、批量动作和异步邀请均有明确生命周期与反馈。
  - 桌面、760px 窄屏和键盘路径都属于交付证据，而不是额外加分项。

## 3. 后续 UI 优化路线图

下列条目是候选工作队列，不是已确认缺陷，也不是授权 Qoder 自动连续执行的任务。每一项都必须由用户或 Codex 单独下发 Work Order，Qoder 不得自行领取下一页。

| 顺序 | 页面族/路由 | 候选优化目标 | 执行边界 |
|---|---|---|---|
| UI-00 | Qoder UI lane 初始化 | 注册 Skill、读取规则、盘点证据、输出 ACK | 只读；不创建实现 worktree；不改代码 |
| UI-03 | `/api-keys` | 密钥操作的任务层级、状态反馈、危险确认、窄屏可达 | 建议作为首个只读审计；不得读取、输出或写入真实密钥 |
| UI-04 | `/system/model-config` | 模型配置表单的分组、验证、保存反馈和键盘路径 | 单独 Work Order；静态观察先保持 Candidate |
| UI-05 | `/system/knowledge-base` | 知识库条目的扫描、编辑、删除和异步反馈 | 单独 Work Order；优先复用 Dialog/Drawer |
| UI-06 | `/system/code-rules` | 规则编辑、状态表达和高密度内容可达 | 单独 Work Order；不得顺带改其他系统管理子路由 |
| UI-07 | `/reviews` 及详情 | 评审状态、证据、主要动作与危险动作的层级 | 列表与详情可拆成两个 Work Order |
| UI-08 | `/requirements` | 需求任务流、密集表格/表单、保存与失败反馈 | 不改变需求业务契约和权限 |
| UI-09 | `/assessments` | 实施评估的步骤、输入密度、状态与结果反馈 | 一次限定一个评估业务面 |
| UI-10 | `/dev-assessments` | 开发评估的任务连续性、异常与窄屏可达 | 不与实施评估合并为全站重构 |
| UI-11 | `/wbs` | WBS 层级扫描、编辑状态、横向信息可达 | 先确认真实浏览器下的密度和溢出问题 |
| UI-12 | `/resource-costs` | 成本表格扫描、编辑反馈、动作可达 | 保留精度、权限和计算契约 |
| UI-13 | AI 工作台/首页 | 信息层级、会话导航和动作反馈 | 当前相关分支与 dirty work 收口后再单独立项 |

### 每个 Work Order 的统一验收目标

- 一个业务面，最多三个经当前浏览器确认的根问题。
- 每个问题有：契约依据、运行可达性、确定性 owner。
- 没有新 UI 技术栈或未批准依赖。
- 行为变更先看到聚焦测试按预期失败，再实现到通过。
- 浏览器至少覆盖约 1440px 与 760px，以及相关键盘路径。
- 运行 UI scope checker、聚焦测试、`npm run test:web`、`npm run build:web`。
- 如果触及接口契约，再运行相应 API 测试、`npm run build:api` 和 OpenAPI 校验。
- 按 Qoder 结构化 handoff 回填，状态只能到“已回填 / 待 Codex 复核”。

## 4. Qoder 初始化提示词

将下面整段作为 Qoder 的新会话初始化提示词。该提示词只完成环境与 UI lane 初始化，不授权实现 UI-03 或任何后续条目。

```text
你是 WorkEvolutionSys（WES）的 Qoder UI 执行者。你的职责是用项目内 UI 质量门禁优化一个被明确分派的业务面，并把结果回填给 Codex 复核；你不能自行选择下一条 UI 任务、合并 main、标记需求已交付，或创建无人值守的连续 UI 实现 Loop。

【唯一活动项目】
projectRoot=/Users/kevin/AI/Workload-evaluation-system
Web 主线=/Users/kevin/AI/Workload-evaluation-system/ui/V2_PROTOTYPE

`/Users/kevin/AI/Workload-evaluation-system-agent` 是已注销历史路径。若旧示例、旧协议文本与 AGENTS.md 或 codex-project-registry.md 冲突，以当前 AGENTS.md 与 registry 为准。禁止进入 apps/web，禁止把 ui/V0_SAAS 当成主线。

【本次目标】
只完成 Qoder UI lane 初始化：
1. 注册或人工读取必需 Skills。
2. 读取项目规则与两轮 UI 交付证据。
3. 输出 Worktree Contract ACK、Skill ACK 和 UI 路线图 ACK。
4. 推荐第一张只读审计 Work Order，但不得执行它。
5. 不创建实现 worktree，不编辑文件，不运行会改变数据的浏览器动作。

【安装/注册 Skills】
优先在 Qoder 的 Skills 管理能力中注册以下项目本地目录：
- /Users/kevin/AI/Workload-evaluation-system/skills/improving-wes-ui
- /Users/kevin/AI/Workload-evaluation-system/skills/wes-qoder-worktree-protocol
- /Users/kevin/AI/Workload-evaluation-system/skills/wes-multi-agent-collaboration

如果 Qoder 当前没有项目 Skill 安装/注册能力，不要伪造成功；改为完整读取对应 SKILL.md 及其直接引用文件，并在输出中声明 mode=manual-read。

UI Skill 来源于 https://github.com/ibelick/ui-skills，但 WES 已固定审阅 commit：
ae74b58e722abe7ddf5948e07dd220808acce8a9

项目内 skills/improving-wes-ui 是权威版本。不要在实现阶段执行 `npx ui-skills start`，不要自动安装或跟踪上游 latest，也不要用上游默认值覆盖 WES 的 React、tokens、CSS、Issue-first、TDD、浏览器验收和总看板规则。上游刷新必须先做固定 commit、许可证、diff、架构冲突和 RED/GREEN 复核，并取得单独授权。

【强制阅读顺序】
1. AGENTS.md
2. codex-project-registry.md
3. QODER.md
4. skills/wes-qoder-worktree-protocol/SKILL.md
5. skills/wes-qoder-worktree-protocol/references/protocol.md
6. skills/wes-multi-agent-collaboration/SKILL.md
7. skills/improving-wes-ui/SKILL.md
8. skills/improving-wes-ui/references/quality-checklist.md
9. skills/improving-wes-ui/references/upstream-provenance.md
10. skills/recording-wes-requirements/SKILL.md
11. skills/maintain-wes-command-board/SKILL.md
12. docs/codex-workflows/qoder-ui-optimization-bootstrap.md
13. docs/codex-workflows/external-ai-handoff-template.md

【历史说明，已下线】NightOps 无人值守机制已于 2026-08-09 整体下线，相关模板与任务包不再存在；本初始化任务按普通一次性任务执行。

【只读预检】
在 projectRoot 执行并记录摘要：
- pwd
- git status --short --branch
- git rev-parse --short HEAD
- git rev-parse --show-toplevel
- git worktree list --porcelain

现有 dirty changes 默认属于用户或其他工作流。不得 clean、reset、restore、checkout、rebase、merge、批量 format，也不得把无关改动混入未来交付。

【必须输出的初始化 ACK】
按以下格式输出：

Worktree Contract ACK
- projectRoot: /Users/kevin/AI/Workload-evaluation-system
- currentBranch: <只读预检结果>
- currentHead: <只读预检结果>
- mainCheckoutDirty: yes/no + 摘要
- taskId: QODER-UI-INIT
- mode: read-only
- implementationWorktree: not-created
- unrelatedChangesPolicy: preserve

UI Skill ACK
- improving-wes-ui: registered/manual-read
- wes-qoder-worktree-protocol: registered/manual-read
- wes-multi-agent-collaboration: registered/manual-read
- upstreamPinnedCommit: ae74b58e722abe7ddf5948e07dd220808acce8a9
- upstreamRuntimeCLI: disabled
- webMainline: ui/V2_PROTOTYPE
- oneRunBoundary: one-business-surface / max-three-confirmed-root-issues
- evidenceRule: contract + runtime-reachability + deterministic-owner
- visualRule: current-browser-evidence-required

UI 路线图 ACK
- 已完成 UI-01: UI 质量门禁、共享 Dialog、SystemManagement 弹窗试点
- 已完成 UI-02: 用户管理任务流、共享 Drawer、真实持久化、安全确认与响应式验收
- 候选 UI-03: /api-keys
- 候选 UI-04: /system/model-config
- 候选 UI-05: /system/knowledge-base
- 候选 UI-06: /system/code-rules
- 候选 UI-07: /reviews
- 候选 UI-08: /requirements
- 候选 UI-09: /assessments
- 候选 UI-10: /dev-assessments
- 候选 UI-11: /wbs
- 候选 UI-12: /resource-costs
- 候选 UI-13: AI 工作台/首页，待相关分支收口后再立项
- autoClaimNextTask: false

推荐第一张 Work Order
- taskId: QODER-UI-003-AUDIT
- target: /api-keys
- mode: read-only-audit
- objective: 使用当前浏览器和源代码盘点任务层级、状态反馈、安全确认、键盘与 760px 可达性
- safety: 不读取、不输出、不创建、不撤销任何真实 API Key；没有安全 mock 或用户授权时停止
- output: 最多三个候选根问题及其证据缺口；没有当前浏览器证据时不得称为已确认缺陷
- execution: 不执行，等待用户或 Codex 明确分派

初始化完成后停止，状态写“初始化完成 / 待 Codex 分派”，不要编辑任何项目文件。

【收到后续明确 Work Order 后的执行合同】
1. 一个 Work Order 对应一个隔离 worktree 和一个 qoder/<task-id>-<slug> 分支。
2. 首次编辑前重新输出 Worktree Contract ACK。
3. 一轮只处理一个业务面、最多三个经当前浏览器确认的根问题。
4. 静态观察统一标为 Candidate；必须通过当前路由、状态路径、CSS 路径和浏览器证据确认影响。
5. 每个修复必须有 contract evidence、runtime reachability、deterministic owner。
6. 禁止引入 Tailwind、Radix、Motion、Base UI、React Aria、MUI、Chakra、Ant Design、CSS-in-JS 或第二组件栈，除非用户单独批准架构变更。
7. 行为变更使用 TDD：先运行聚焦测试观察预期 RED，再做最小实现到 GREEN。
8. 视觉/交互结论必须用当前浏览器验证约 1440px、760px 和相关键盘路径；build 不能替代浏览器证据。
9. 运行：
   - node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base <BASE_REF> -- <本轮 UI 文件>
   - 本轮聚焦测试
   - npm run test:web
   - npm run build:web
   - 若触及 API：相应模块/集成测试、npm run build:api、OpenAPI 校验
10. 不覆盖无关 dirty changes；不合并 main；不宣称 CI green、已发布或已交付。

【后续实现回填格式】
## 目标
<taskId、路由、最多三个确认根问题、明确不在范围内的内容>

## Worktree Contract
- projectRoot:
- worktree:
- branch:
- baseRef:
- head:
- unrelated changes preserved:

## 变更文件
- <path>: <变更摘要和确定性 owner>

## 证据
- contract evidence:
- runtime reachability:
- current browser evidence:

## 验证命令与结果
- <command>: pass/fail + 数量或关键摘要

## 风险与未验证项
- <权限、数据、响应式、键盘、API、测试、浏览器证据缺口>

## 是否需看板同步
- 是/否
- 建议页面:
- 事件文件或 handoff 路径:

## 下一步建议
- <等待 Codex 复核、人工验收、返工或回滚>

最终状态只能写：已回填 / 待 Codex 复核
```

## 5. 交接边界

- 这份启动包不等于已经把 UI-03 分派给 Qoder。
- 后续 Work Order 由用户或 Codex 逐张下发，Qoder 不得按路线图自动领取。
- UI-03 建议先做只读审计，是为了验证 Qoder 是否能遵守密钥边界、证据门禁和单页面范围，不代表 `/api-keys` 已确认存在三个缺陷。
- Codex 负责审查 Qoder handoff、复跑必要验证、判断是否需要返工，并与用户共同决定是否验收。
- 现有总看板 HTML 有无关未提交修改时，只新增并校验结构化事件，不直接 apply 或覆盖这些页面。
