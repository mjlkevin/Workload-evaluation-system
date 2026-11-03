# WES Business Skills 分批实施计划

> **For agentic workers:** 开工使用 `executing-plans` 逐项执行。步骤使用 checkbox。若交给 Qoder，先完成 `QODER.md` 和 `skills/wes-qoder-worktree-protocol/SKILL.md` 规定的 Worktree Contract ACK。此计划不是开工、推送或部署授权，不自动创建子代理、实现 Loop 或后续批次。

**Goal:** 将已评审的 Skill 机制分成四批独立可验证的业务成果，最终完成需求到实施评估的 MVP。

**Architecture:** 新增独立 Skill/Workflow 领域与 repository，复用 PostgreSQL、工具注册/策略、结构化输出和 Harness。Skill 发布不可变，Workflow 固定 Skill 版本，运行固定执行快照；实际执行始终复核当前权限。

**Tech Stack:** 现有 TypeScript/Express/modules、PostgreSQL/Drizzle、AJV、Harness；前端沿用 Vite/React、现有共享组件和 Tailwind tokens 桥接。

设计依据：`../specs/2026-11-02-wes-business-skills-design.md`。2026-11-02 用户“评审通过”，随后授权“开始实施”，现已确认“通过，继续下一步工作”。A批界面验收通过；B候选代码、管理界面和契约已验证，真实Kimi拆解、复核发布、升版回滚及固定Skill流程引用均已验证；用户已确认B手动验收完成。主线集成仍待执行，远端未推送；C批进入运行快照接入，D未启动，完整MVP尚未验收。

## 0. 批次划分和开工纪律

| 批次 | 可交付成果 | 前置 | 不得提前宣称 |
| --- | --- | --- | --- |
| A 定义与版本 | 管理员能维护完整定义、检出检入、查看不可变版本；发布状态受后端门槛保护 | 设计通过，独立分支/工作区预检，物理迁移方案落定 | 没有真实测试/审核证据时不能开放生产发布 |
| B 测试与发布 | 可隔离试运行、审核发布、切换生效、回滚、维护固定 Skill 依赖的流程 | A 验证完成 | 草稿模拟执行不等于真实业务验收 |
| C 工作台接入 | 选择/推荐 Skill 和启动流程；快照、澄清等待、确认、恢复可用 | B 发布与契约成立 | 后台完成或局部测试通过不等于 MVP 业务完成 |
| D MVP 收口 | 同一样本完成需求拆解、澄清、匹配、计算、签入及刷新恢复 | C 验证完成；业务样本及预期已确认 | 不能用 AI 建议数代替规则计算，不能省略业务验收 |

各批为顺序依赖，不并行改同一 Harness/工作台。UI 实现另按单表面切成小任务：Skill 管理、流程管理、工作台分别验证；不在一次 UI 提交中横跨三个表面。

每批开工时读取最新 HEAD、dirty、worktree、模块/脚本现状，精确声明文件范围。现主目录存在其他工作，禁止清理、覆盖、`git add -A` 或夹带提交。若需提交，只暂存本批明确文件；远端 push 保持用户单独授权。

存储决定：本域满足审计/版本/权限追溯触发器第 4 条，PG 独立领域原则已获评审确认。不扩充 assessment VersionType 冒充 Skill，不恢复 JSON 主存储。迁移文件通过现有 Drizzle 命令生成，执行前检查测试库、备份与恢复方案；本计划不运行迁移。

以下是分批任务、文件责任与验证门槛；每批开始先按实际代码接口形成该批精细编码工单，单个编码步骤遵循 RED → GREEN → REFACTOR。不得把本文件的文件责任表当成已有文件或现成功能。

## 1. A 批：Skill 定义、清单和版本

### A1. 独立领域与存储契约

**新增责任文件：**

- `apps/api/src/modules/skills/skills.types.ts`：稳定 Skill ID、草稿 revision、锁、发布版本 ID/hash、启停与审计类型。
- `apps/api/src/modules/skills/skills.repository.ts`、`skills-pg.repository.ts`：仓储接口与事务实现。
- `apps/api/src/db/schema/skills.ts`：定义、版本、检入修订、发布审计逻辑对象；由此生成 Drizzle 迁移。
- `apps/api/src/modules/skills/skills.repository.test.ts`：真实测试库并发与不可变性测试。

**现有接点：** `apps/api/src/db/schema/index.ts`、`apps/api/package.json` 测试枚举；若触碰测试隔离清单，按现有守卫登记，不删除隔离保护。

- [x] 先写失败测试：两个编辑者用同一 revision 保存只能一个成功；非锁持有者不能保存；发布快照后修改草稿不改变原发布 hash；事务失败不留下半条发布记录。
- [x] 使用 `bash scripts/verify-local-db-tests.sh src/modules/skills/skills.repository.test.ts` 观察预期失败；不能因数据库未配置而把 skip 当作 RED 或通过。
- [x] 按测试实现行级事务、唯一约束和 revision 比较；定义与生效指针分开，不使用整表覆盖。
- [x] 重跑同一测试，所有上述断言无条件执行；恢复/清理测试数据，不接触业务库。

### A2. 完整定义校验与版本操作

**新增：** `apps/api/src/modules/skills/skills.validation.ts`、`skills.usecase.ts`、`skills.controller.ts`、`skills.module.ts`、`skills.usecase.test.ts`；`apps/api/src/routes/skills.routes.ts`、`skills.routes.test.ts`。

**现有接点：** `apps/api/src/routes/index.ts`、`agent/tool-registry.ts`、`agent/tool-policy.ts`、`ai/contracts/structured-output.ts`、`docs/openapi.yaml`。

- [x] 先覆盖非法 Schema、远程引用、未知工具、原生工具参数不兼容、非 admin 管理、普通用户读取草稿、强制解锁审计、撤销恢复、升版及已发布不可改。
- [x] 校验参数来自动态 Registry；引用已注册工具，不维护第二份工具名白名单。输入输出契约的限制与 UI 同源。
- [x] 管理路由默认 JWT + 管理能力；所有失败保留原内容和生效指针，提供字段错误。路由测试覆盖匿名 401、普通用户 403、不存在/不可见对象及 revision 冲突。
- [x] 发布服务先以 fail-closed 门槛实现：缺少 B 批产出的同 hash 测试/审核证据不得发布；单测可注入证明对象，生产不能配置为无条件通过。
- [x] 将实际接口及错误契约同步到 OpenAPI，不复用不包含 Skill 的旧业务版本类型。

### A3. Skill 管理单表面

**新增：** `ui/V2_PROTOTYPE/src/api/skills.js`、`src/hooks/useSkillManagement.js`、`src/pages/system/SkillsSection.jsx`；对应 `src/__tests__/SkillsSection.test.jsx`。

**现有接点：** `src/config/systemManagementSections.js`、`src/pages/SystemManagement.jsx`、既有 `SystemObjectList` / `SystemObjectDialog` / Dialog。

- [x] 先执行 `npx ui-skills start` 并读取项目 UI Skill；以 `/system/ai/skills` 为本次唯一表面。
- [x] RED 覆盖 checked_in 只读、检出后可编辑、保存冲突保留输入、非法字段定位、发布门槛失败可见、强制解锁仅管理员。
- [x] 完成清单、详情分组、完整输入输出/工具配置、版本查看；工具参数行编辑使用 Dialog，复用拖拽及 tokens 约定。
- [x] 浏览器在桌面/760px 验证键盘访问、长 Schema、错误恢复；未接 B 批的生产发布保持不可用且说明缺失条件。

**A 门槛：** 新模块/路由和 UI 定向用例、`npm run test:modules`、Web/API 构建通过；数据库并发/不可变证据齐备；Schema/权限审查通过。实际样例试运行和正式发布不在本批完成声明中。

## 2. B 批：试运行、发布、回滚与流程定义

**新增责任文件：**

- `apps/api/src/modules/skills/skills.evaluation.ts`、`skills.release.ts` 及同名 `.test.ts`：样例、同 hash 验证、审核和原子发布/生效切换。
- `apps/api/src/modules/skills/skills.sandbox.ts`、`skills.sandbox.test.ts`：同款定义解析与受控工具 dry-run，明确标注模拟结果。
- `apps/api/src/modules/workflows/workflows.types.ts`、`workflows.validation.ts`、`workflows.usecase.ts`、`workflows.repository.ts`、`workflows-pg.repository.ts`、`workflows.module.ts`：步骤表、依赖解析、版本与映射校验。
- `apps/api/src/db/schema/workflows.ts`、`apps/api/src/routes/workflows.routes.ts` 及仓储/路由/用例测试。
- `ui/V2_PROTOTYPE/src/api/workflows.js`、`src/pages/system/WorkflowsSection.jsx`、`src/__tests__/WorkflowsSection.test.jsx`。

**现有接点：** A 批 Skill 管理与路由、系统管理路由配置、`apps/api/src/db/schema/index.ts`、`docs/openapi.yaml`。

- [ ] RED 覆盖草稿写工具不会写正式数据/外发；输出结构错误、业务断言失败、调用预算超限分别有失败结论；模型实测与模拟结果不能混同。
- [ ] 测试/审核证明绑定定义 hash。修改 Prompt、工具或 Schema 后旧证明失效；发布和切换同一事务失败时原生效版本不变。
- [ ] 用失效证明、并发发布、回滚不存在版本、回滚被停用版本和普通用户请求作反向用例，禁止“有一次历史测试通过就可发布”。
- [ ] Workflow 发布检查步骤映射类型与引用：仅接受明确已发布 Skill 版本，拒绝 draft、缺失引用、无限循环及任意表达式。每次发布保存依赖快照。
- [ ] Skill 发布新版不得改变旧 Workflow 的绑定；单 Skill 生效切换不改变已发布流程依赖。影响列表列出引用版本和升级途径。
- [ ] 分开完成 Skill 测试发布表面与流程管理表面，分别走 UI 前置服务、RED/GREEN、范围检查和浏览器验证。

**B 门槛：** 真实隔离试运行、发布/回滚事务、流程契约检查和引用影响有证据；普通业务用户只能发现可调用发布版本。A 批发布能力此时才能启用；不得宣称工作台已接通。

### B 批开工与任务工单（2026-11-02）

授权：用户确认 A 批“通过，继续下一步工作”。A 批基线提交 `b5853a4`；B 批工作区 `/Users/kevin/.codex/worktrees/wes-skills-b/Workload-evaluation-system`，分支 `codex/wes-skills-b`。主目录 SKU/评估改动保持原状；本轮继续独立候选，不推送。B开工时保留A预览；现已切换至B候选专用构建，沿用数据与登录，见末尾升级记录。

**数据隔离门槛已完成：** 将已验收的 `workload_eval_test` 克隆为 `workload_eval_skills_preview_20261102`，两库 2 个 Skill、4 个版本、16 条历史、4 个用户逐表内容摘要一致后，将 3004 预览 API 指向克隆库。3006 地址和已登录会话保持。自动测试只用原 `workload_eval_test`；开发库与主环境不变，禁止测试清理预览库。

按 `subagent-driven-development` 执行：实现任务串行；每项完成先独立规格复核，再五轴质量复核，通过后才进入下一项。实现与审查分别委派，新任务明确文件边界；不创建无人值守 Loop。

#### B1a：试运行与沙箱核心

- 新增 `modules/skills/skills.sandbox.ts`、`skills.evaluation.ts` 与对应测试；只按需扩展 `skills.types.ts`、`skills.validation.ts`。
- [x] RED：非法输入无模型调用、空用例不得通过、模型输出结构失败、业务断言失败、预算/超时失败、虚构工具、越界路径、写/外发执行器调用数始终为零。
- [x] GREEN：依赖注入统一模型/工具契约；所有定义及运行 Schema 验证使用请求级编译实例；限制调用、工具、输出 token、总耗时并传递取消信号。
- [x] 真实模型与纯模拟分开：模拟不满足发布资格；真实模型中使用 dry-run 的写/外发步骤单独记录，审核时必须确认其模拟边界，不宣称正式写入已验证。
- [x] 样例 `expected` 默认精确比较；可选受限字段断言支持不确定措辞，不能执行表达式，不能将期望输出喂给待测模型。
- [x] 定向测试及 modules 通过；规格复核通过后再做质量复核。

#### B1b：持久化证明、审核发布、生效回滚与管理 API

- 责任文件：`skills.release.ts`、`skills.release.repository.ts` 及测试，现有 Skill types/usecase/controller/router/repository，PG schema 与生成迁移；实际细分按职责拆开，单次审查范围不超 1000 行实现。
- [x] RED：客户端不能提交伪造测试证明；模拟/失败/旧 hash 证明不能审核发布；测试后修改、并发发布、已检出候选、被归档对象均失败且原指针不变。
- [x] 测试结果与审核使用服务器生成标识、版本 ID、内容 hash、实际模型/时间和解析依赖摘要；记录追加不可修改。实际模型与已接入工具/资料使用现有配置解析，不引入新模型客户端或任意 URL 读取。
- [x] 审核、发布与切换生效通过 root revision 和事务复核证据；同一管理员可审核发布；切回旧版本须为本 Skill 曾发布且兼容的版本，必须有原因和审计。
- [x] 新版本不改旧发布内容；启停归档不破坏引用。发布后需升版编辑；普通用户只能发现授权角色的已启用发布目录，管理和草稿试运行仍仅 admin。
- [x] 与 B1a 连接真实 Provider 场景和原生 Registry。权限与工具策略取当前值；写/外发执行器绝不接通正式操作。
- [x] 模块/路由/真实 PG 并发测试、构建、独立规格与质量审查通过。未执行的真实模型样例保持待执行，不用注入假模型冒充实测。

#### B2：流程定义、依赖验证与版本仓储

- 责任文件：独立 `modules/workflows/`、`db/schema/workflows.ts`、`routes/workflows.routes.ts` 与测试；不修改 Harness 运行逻辑。
- [x] RED：拒绝不存在/草稿 Skill 依赖、错误类型映射、越权工具、任意表达式、无界循环和无效分支；并发 revision、锁和发布快照验证。
- [x] 四类步骤使用步骤表定义；使用明确前置条件和有界分支/循环。字段路径受限，工具未提供可信输出契约时禁止用其结果驱动映射或条件。
- [x] 流程发布保存明确 Skill 版本/hash、映射和原生契约摘要；Skill 新发布/回滚不能改变旧流程依赖。影响查询列出流程、引用版本及创建新版途径。
- [x] 流程也支持检出/检入/撤销/升版/审核发布/回滚/启停归档，遵循只读和不可变规则。流程执行及等待恢复属 C 批，本批不伪造运行结果。
- [x] 定向/PG/路由测试、模块和构建通过；规格审查后再做质量审查。

#### B3：Skill 测试与发布界面（单表面）

- 责任文件：`SkillsSection.jsx`、新的测试/发布子组件、Skill API/hook 与定向测试。
- [x] UI 服务与项目 UI Skill 前置；先 RED 再实现，复用 Dialog/Tailwind tokens。
- [x] 试运行显示模式、样例断言、结构/业务/预算失败、实际模型及模拟步骤；审核发布按钮由服务器证据状态驱动，不能由浏览器自行认定通过。
- [x] 显示生效版本、回滚原因和引用影响；保留 A 批编辑/历史交互、冲突输入和错误定位。真实浏览器验证桌面及 760px，创建到审核发布/回滚逐步保留证据。

#### B4：流程管理界面（另一个单表面）

- 责任文件：`api/workflows.js`、`hooks/useWorkflowManagement.js`、`pages/system/WorkflowsSection.jsx` 及必要子组件/测试；在配置单一事实源登记导航。
- [x] UI 前置与 RED；步骤维护、指定 Skill 版本、输入输出映射、条件、限额、版本及发布控制保持分组；复杂说明使用折叠/Tooltip。
- [x] 后端字段错误与引用影响可见；历史只读、冲突保留输入，不能选择草稿为发布依赖。流程运行入口保持未接通说明，工作台不新增入口。
- [x] 浏览器创建、检出保存检入、审核发布、查看固定依赖、升版/回滚验证；不把流程配置成功写成业务流程已执行。

#### B5：整体验证、契约与回填

- [x] OpenAPI、README、实现与文档对齐说明同步实际能力、错误与迁移；独立审查模型凭据、JWT 管理边界、沙箱和发布事务。
- [x] modules、相关集成、Web 全量与双构建通过；仅在新变更/失败时重跑关联检查。记录模型实际可用性；缺凭据时明确门槛未完成，发布不能伪放行。
- [x] 总看板区分 A 用户验收、B 实现/自动验证/真实模型实测/用户验收。B 完成前不进入 C/D，不推送或覆盖主目录现场。

### B批逐步验收记录（按实际证据回填）

| 路径 | 通过口径 | 当前证据 |
|---|---|---|
| Skill模拟检查 | 显示模拟、未调用模型；不得审核发布 | 后端自动检查及3006模拟检查通过；未调用模型、发布禁用 |
| Skill真实失败 | 失败原因可见；HTTP成功不能误标测试通过 | 实际界面失败记录与刷新持久化通过；Provider401，发布禁用 |
| Skill真实通过→审核→发布 | 匹配当前内容与依赖，原因必填，模拟工具须确认；生效指针可见 | 实际Kimi VB.0与VC.1通过、复核及两次发布通过，3条发布/回滚审计已持久化 |
| 修改/过期/并发 | 保存前不运行；旧证据不能发布；冲突保留输入 | 自动检查通过；草稿保护、过期标记及输入保留浏览器通过 |
| Skill升版与回滚 | 旧版不可编辑；回滚说明与目标明确，失败不改生效指针 | 实际VB.0→VC.1发布后回滚VB.0通过；旧版hash不变，刷新后工作版VC.1/生效VB.0保留 |
| 流程步骤与依赖 | 四类步骤可维护；只引用已发布的明确Skill版本，固定依赖可查看 | 四类步骤自动检查及人工配置已验证；新增固定已发布VB.0的流程校验/复核/发布通过，Skill切换不改绑定 |
| 流程校验→审核→发布→回滚 | 标签为配置校验，不声称业务执行；发布/回滚有原因和证据门槛 | 人工流程实际校验/复核/发布/升版/回滚并刷新通过，未执行业务流程 |
| 1440px与760px | 操作可达、弹窗可拖拽、键盘可操作、无页面横向溢出 | Skill与Workflow 1440/760无页面/弹窗/步骤表横向溢出，键盘焦点及拖拽通过 |

预览切换前保留A数据备份，沿用当前登录，不重置用户密码。B浏览器检查可使用单独验收样例，避免覆盖用户的“需求拆解分析skill”。当前试运行查询仅返回当前候选版本的测试记录，历史定义/修订/发布事件及精确引用仍保留。

## 3. C 批：工作台调用与 Harness 适配

**新增责任文件：** `apps/api/src/modules/skills/skills.invocation.ts`、`skills.execution-manifest.ts` 及测试；`apps/api/src/modules/workflows/workflows.runtime-adapter.ts`、`workflows.runtime-adapter.test.ts`。

**现有接点：** `apps/api/src/modules/harness/harness-boot.ts`、`harness-runtime.types.ts`、`workbench-chat.workflow.ts`、`workbench-view.usecase.ts`；`apps/api/src/agent/default-registry.ts`；前端 `src/pages/AiHomeWorkbench/` 的 hooks、ChatArea、WorkspacePanel 及现有 API 层。

- [ ] RED 构造运行入队/发布并发：事务只能取到完整旧版或完整新版，不能混合依赖；保存 manifest 后恢复不读取 latest。
- [ ] 同一任务等待回答时发布新版：旧任务按旧 Schema 处理输入，新任务按新流程依赖运行；错误节点/错误契约的回答不推进。
- [ ] 当前权限被撤销、工具策略收紧或紧急禁用时，即使持有旧 manifest 也不能继续未授权工具执行；普通停用仅阻止新启动。
- [ ] 用户确认绑定产物 hash/参数摘要；修改内容后必须重新确认；重复确认、重试、worker 恢复不重复创建业务草稿。
- [ ] 注册同一服务入口承接手动选择、对话推荐和流程启动。推荐只来自当前用户可调用目录；虚构 ID、草稿版本与越权参数由服务端拒绝。
- [ ] 前端单工作台表面覆盖输入补齐、选择启动、等待/确认、失败重试、停止、返回页面与结果追溯；保留普通对话和既有后台任务。
- [ ] 将事件与产物接入现有统一视图，不新建独立 Run/消息库，不通过前端拼装多份执行权威状态。

**C 门槛：** Harness 定向/套件、权限与确认反向用例通过；真实离页/刷新/等待恢复通过；两个不同版本在运行中的对照证据齐备。模型非确定性不允许宣称逐字重现。

## 4. D 批：三个业务 Skill 收口 MVP

**新增责任文件：** `apps/api/src/modules/skills/fixtures/mvp-skills.json`（仅初始播种，不作为运行时主存储）；`apps/api/src/modules/skills/mvp/requirements.ts`、`assessment-matching.ts` 及测试；`apps/api/src/agent/tools/requirement.tools.ts`、`assessment-catalog.tools.ts`（仅补现有 Registry 实际缺少的原生操作）。

**现有接点：** `apps/api/src/agent/default-registry.ts`、`services/ai/extractor.service.ts` / `services/ai-workbook.ts` 的来源处理；`modules/project-evaluations/project-evaluations.usecase.ts`；`ui/V2_PROTOTYPE/src/hooks/useAssessmentDetail.js` 及当前需求/评估页面。

- [ ] 先固定一份脱敏 Excel 及文字补充样本，保存人工预期需求、模块范围、未确定项和合理人天依据；业务预期需用户确认，不能由待测模型充当标准答案。
- [ ] RED 覆盖混合长句拆成独立诉求、编号跨澄清保留、原文引用真实、未知不转已确认、冲突可见，以及纯文字和文件进入同一需求条目契约。
- [ ] 初始 Skill 内容通过 A/B 管理与发布链导入，管理员后续编辑保存在正式仓储；每次调用从发布快照解析，不再从 JSON/TS 重载方法文本。
- [ ] 匹配结果必须引用真实 templateItemId 和稳定需求 ID；未匹配需求显式保留。权威人天由 WES 规则计算；AI 增量建议单列且经过确认。
- [ ] 评估草稿写入计算所需 items/params，并关联需求、匹配、模板/规则、Skill/流程版本及运行；签入保留后端锁与保存规则。
- [ ] 用同一样本走完登录、上传/描述、拆解、澄清、匹配、范围确认、计算、签入和刷新。逐点留存需求覆盖、来源、计算依据和持久化证据。

**D 门槛：** 设计第 12 节 13 项场景有逐项证据，真实模型结果与模拟结果分开；用户完成业务验收后才标 MVP 已验收。生成报告或创建草稿不能单独关闭本批。

## 5. 每批验证与交付记录

每次业务代码改动遵循项目 RED-GREEN-REFACTOR，并运行 `npm run test:modules`。接口变更加路由/集成测试，AI/规则/Harness 按受影响范围运行，不以未运行套件补计通过数。

```bash
# 定向测试路径在该批新增并接入 package scripts 后使用；必须看到真实断言，不接受 skip。
bash scripts/verify-local-db-tests.sh src/modules/skills/skills.usecase.test.ts
npm run test:modules
npm run build:api
npm run test:web
npm run build:web

# C/D 触及运行或规则时按实际范围增加：
bash scripts/verify-local-db-tests.sh test:harness test:integration test:ai
npm run test:rules
```

含路由/鉴权/外部模型/MCP 或文件提取的批次按 `skills/wes-security-review/SKILL.md` 审查；交付按五轴代码审查及架构侧实取复核。保留已知环境失败及其来源，不把本机结果写成 CI 绿。记录用户验收与自动检查的区别。

每批 handoff 写明目标、文件、实际命令/结果、未完成项、风险、迁移、看板同步和下一步。状态最多到“已回填 / 待 Codex 复核”，不以执行者自报宣布已交付。A → B → C → D 各批独立授权/排期与复核，不无人值守调度下一批。

### 2026-11-02 A 批实施与复核记录

**状态：** A1/A2/A3 已实现并通过独立规格及代码质量复核；用户业务验收待执行。代码位于分支 `codex/wes-skills-a`，工作区 `/Users/kevin/.codex/worktrees/wes-skills-a/Workload-evaluation-system`，基线 `6a30bec`。未合入主线、未推送；B/C/D 均未启动。

实现包括独立 `modules/skills`、12 条管理路径（13 个 HTTP 操作）、完整定义编辑、动态工具契约校验、revision 并发保护、检出/检入/撤销/升版/管理员强制解锁、启停归档及版本历史。生效指针保持空；发布统一拒绝并返回 `SKILL_RELEASE_GATE_PENDING`。仓储测试使用受控 fixture 创建发布快照来验证不可变性，不代表已开放发布或模型试运行。

| 检查 | 实际结果 | 本机原始证据 |
| --- | --- | --- |
| A1 PostgreSQL 仓储 | 14/14，0 skip；并发、事务回滚、历史及直写保护 | `/tmp/wes-skills-a-review-green` |
| A2 定义校验及管理路由 | 20/20；匿名/非管理员、原生工具参数及发布拒绝 | `/tmp/wes-skills-a-api-quality-green.log` |
| A3 管理表面定向测试 | 33/33 | `/tmp/wes-skills-ui-*` |
| `CREDENTIAL_KEK='' bash scripts/verify-local-db-tests.sh test:modules` | 630/630，0 skip | `/tmp/wes-skills-a-final-backend.log` 的 modules 段 |
| 同包装器 `test:integration`（补齐测试目录后复跑） | 1/1，0 skip | `/tmp/wes-skills-a-integration-final.log` |
| `npm run test:web` | 85 文件、710/710 | `/tmp/wes-skills-ui-readiness-full.log` |
| `npm run build:api`、`npm run build:web` | 均通过 | `/tmp/wes-skills-a-build-api.log`、`/tmp/wes-skills-a-build-web.log` |
| 独立规格、五轴质量及新增路由安全复核 | A1/A2/A3 通过；发现项均修正并补 RED/GREEN | 本批测试及代码；基线依赖审计见下 |

**浏览器实际执行：** 真实登录到独立 API `127.0.0.1:3004`，Web `127.0.0.1:3006`；创建 A.0 → 检出 → 修改指令 → 保存 → 检入 A.1 → 刷新重开内容仍在 → 升版 B.0 → A.1 历史只读。非法 JSON 有字段错误，未保存关闭需确认，撤销检出恢复已检入内容。归档后默认隐藏，刷新勾选“显示归档”能重开并保留两个版本。Tab 焦点留在弹窗内，Escape 关闭后回到原列表按钮；顶部空白区拖动使位置从 (340,16) 变为 (400,31)。1440×1000 与 760×1000 检查无页面横向溢出，弹窗处于视口内；截图已重新打开检查，见 `../evidence/2026-11-02-wes-skills-a/`。这些是执行记录，不替代用户验收。

**环境与迁移：** 双 URL 只指向 `workload_eval_test`，新增 `skill_definitions`、`skill_versions`、`skill_revisions` 三表；迁移 0024 建表，0025 添加发布历史/审计修改保护。开发库与主环境 3000/3002 未迁移或替换。测试首次因本机凭据回退导致旧 `resolveKek` 用例失败，使用进程级空 `CREDENTIAL_KEK` 运行后通过，没有修改实际凭据；集成测试首次因测试库产品目录为空失败，通过既有 `seed.cli.ts` 仅导入测试库 585 行后复跑通过。失败日志保留，不将初次失败计为通过。

**迁移恢复边界：** 迁移为增量建表与触发器，未改变旧表；正式环境启用前先备份目标 PG 库并验证可恢复，再按现有迁移入口执行。不在本批运行生产迁移。回退应用时保留新表及审计，不执行 DROP/TRUNCATE；若未来确需物理回退，必须先导出 Skill 与审计并另行评审。测试清理仅限测试库三张新表，不使用 CASCADE。

**收尾检查：** OpenAPI YAML 及 658 个本地引用检查通过；UI 范围检查与 `git diff --check` 通过。主目录总看板已更新需求、实施、测试、设计、监控、风险、来源和变更，构建通过、一致性 0 错误 0 警告；资料仍为 98 行/97 个去重名称。测试管理员与私有登录文件已清理，浏览器任务及隔离服务已关闭；诊断 Skill 归档保留审计。分支和工作区保留，尚未提交或推送。

**限制和下一步：** Skill Schema 首版仅接受受控 JSON Schema 子集（本地非递归引用等），不支持的约束明确拒绝；校验按请求释放编译实例。未新增依赖；`npm audit` 的 45 项为既有基线（32 moderate、12 high、1 critical），未在本批顺带升级。下一步为 A 批主线集成与用户验收，再安排 B 批隔离试运行/审核发布/流程管理；不自动进入下一批，不将本次结果标作 MVP 验收通过。

**用户预览重新开启（2026-11-02）：** 用户询问是否可以验证界面后，已启动独立 Web `http://127.0.0.1:3006/system/ai/skills` 和 API `127.0.0.1:3004`，使用测试库及临时测试管理员；真实登录成功，管理页与新建按钮可用，浏览器页面已保留供用户操作。主环境 3000/3002 不变，无新增迁移。服务为本机当前运行的预览，用户验收尚未完成；验证期间不运行会清空 Skill 测试表的自动化套件。


**A批示例准备（2026-11-02）：** 按用户要求在当前内置浏览器3006创建“需求拆解”，Skill ID `767c8165-961a-40be-baca-b1f5029a6574`，初始版本 `SK-767c8165-VA.0`，状态 draft / checked_in。包含指令、输入输出Schema、查询与导出拆分样例，角色pre_sales、工具为空。创建成功并保留只读详情；未代用户检出或升版。用户可检出修改→保存检入A.1→升版B.0→再次修改检入B.1→查看A/B历史。样例期望由人工编写，不是LLM实测；3002主环境未改变，A批用户验收待回填。

**A批用户验收通过（2026-11-02）：** 用户明确回复“通过，继续下一步工作”，确认本批编辑、检出检入、升版和历史版本查看。关闭 A 批用户界面验收项，保留 B 批真实试运行/发布和 C/D 工作台/MVP 验收门槛。主目录有未提交的 SKU 与评估改动，本次先建立 A 批本地提交基线并在独立工作区推进 B 批，不覆盖现场，不自动推送。后续测试必须与已经验收的预览数据隔离。


**B1验证记录（2026-11-02）：** B1a内核提交 `e76536a`，新增21项反向断言及模块651/651、API构建通过；规格和质量独立复核均通过，修复安全错误码、同步超时、可变模拟来源及畸形响应。B1b提交 `17c9409`，定向35/35、模块669/669零跳过、API构建及双重独立复核通过；仅测试库迁移0026/0027，服务端证据、事务发布/回滚、当前权限目录及非敏感依赖快照已实现。真实模型请求HTTP401，仍不具备发布资格；见ISS-2026-11-02-005。当前磁盘凭据加密参数无效，主配置未改；独立预览新增私有0600/Git忽略的专用加密配置并验证roundtrip，等待用户在3006保存有效模型密钥。B2后端已复核通过，B3 Skill 界面实施中；B4流程界面及B5整体验证待执行，不宣称B整批完成。


**B2验证记录（2026-11-02）：** 本地提交 `723f95b`；模块684/684、独立流程PG17/17、API构建通过，规格与质量复核通过。固定已发布Skill版本/hash及原生工具契约，静态校验明确 `executionPerformed=false`。修复映射整体约束缺口与单连接/连接池饱和死锁：远程解析在事务外、同事务复核锁定依赖，真实生产解析器max=1并发回归通过。Skill审核/发布同步使用该事务边界，草稿旧审核不再误开发布。迁移0028/0029仅测试库应用；预览升级及B3/B4浏览器待执行。


**B3验证记录（2026-11-02）：** `398fd0b`已本地提交，通过规格及质量复核；定向34/34、先前Web721/721及构建通过。复核修复最新证据过期标识和嵌套确认框Escape/Tab冒泡。父任务在真实3006以独立样例 `729a4d0e-e428-4d44-8338-2fee5f97f2e2` 验证创建、模拟不放行、真实模型失败持久化、草稿保护、保存检入A.1、升版B.0、历史只读、Escape焦点恢复与拖拽；1440/760页面及弹窗无横向溢出。实际模型失败证明 `b2528027-82f7-4c50-8429-188b2e38a17f` 不具发布资格，未执行成功模型发布或Skill回滚。另发现正常请求期间误报冲突提示，已补RED/GREEN35/35及独立复核通过，提交4f4eedd。已发布状态提示修正1e5e0d5，定向37/37与独立复核通过。

**预览升级记录（2026-11-02）：** 升级前备份 `workload_eval_skills_preview_a_saved_20261102`，仅向专用预览库应用迁移0026–0029。A原有2Skills/4版本/16历史/4用户逐表摘要与备份一致；当前登录保持，新增验收样例独立于用户原记录。B后端3004、冻结B3前端3006，避免后续开发热更新中断验收；主环境3000/3002和主库未改。


**B4验证记录（2026-11-02）：** 本地提交 `760bf6a`；规格及质量复核通过，定向Workflow28 + 导航8 + 配置5 = 41/41。补齐正常列表刷新、旧证明已失效标记、初次GET与失败校验竞态恢复、已发布状态提示；独立反向探针均通过。父任务实际浏览器创建 `68fe2d14-53b9-4f89-9210-404316cbd5d4`，配置“补充需求→确认需求范围”及明确字段映射，校验/复核/发布A.0、检出保存检入B.1、重新校验/复核/发布B.1、回滚A.0并刷新持久化通过。当前工作版本B.1保持published/checked_in，生效为A.0，完整历史保留。确认框原生Tab/Shift+Tab循环、Escape仅关闭内层并恢复发布按钮焦点实测通过。该样例仅人工步骤、固定Skill依赖为空，不代表真实模型或业务流程已经执行。

**B5自动检查记录（2026-11-02）：** 当前Web86文件/755测试通过；模块684/684、独立流程PG17/17、AI286/286、Agent240/240、规则8/8、集成1/1，均无失败或跳过，API/Web构建通过。新代码和管理界面已本地提交，OpenAPI及说明已同步；不将这些结果等同B整批用户验收或MVP闭环。真实模型认证401，Skill真实通过→审核→发布/回滚仍待有效预览凭据，发布门禁保持关闭。C/D未启动，主线未合入、未推送。

**B5收口记录（2026-11-02）：** 最终集成复核APPROVE本地候选（不等于B业务验收）。OpenAPI覆盖19个Skill及17个Workflow路由方法，863内部引用有效、无重复key、非本批旧接口语义一致；步骤长度约束已与服务端补齐。当前最终构建含1e5e0d5。Workflow 1440/760页面/弹窗/步骤表无横向溢出，截图已打开核查；原生键盘与拖拽通过。B候选仍待有效模型凭据及用户验收，不进入C/D。

**总看板收口：** 已更新总览、需求、计划、设计、测试、监控、风险、变更及资产映射。将本批9条验证和6条变更记录移至独立短表，原历史证据保留；历史变更长表滚动约束在容器内。实际浏览器列宽与折叠检查通过，页面无横向溢出。截图wes-b-board-testing.png与wes-b-board-changes.png已打开检查，构建及一致性0错0警。

**用户后续决定（2026-11-02）：** “暂时没有可用密钥，先保持发布关闭”。沿用ISS-2026-11-02-005，真实模型成功试运行及Skill发布/回滚补验暂缓，本轮不再重试模型。保留B候选界面验证，C批不启动。只读确认预览生效Skill与已发布Skill版本均为0；未修改业务配置。

**Kimi配置后补验（2026-11-02）：** 用户确认供应商已配置。模型列表及省略temperature的K3请求均200，现有参数组装仍400；命中ISS-2026-11-02-005并派生DEF-2026-11-02-003，按B5兼容修正处理。先补K3普通/流式及验证请求失败回归，再最小修改共享采样参数解析、模块和Agent回归、实际Skill重试；保留用户配置，不执行审核发布，不进入C。

**Kimi补验完成（2026-11-02）：** 4f19ea2修正精确K3采样参数；RED三项失败复现，GREEN21/21、模块685、Agent242、AI286、API构建及独立复核通过。实际试运行c77ae071-9207-445b-9263-81bb1aee2154，kimi-k3输出查询/Excel导出两条需求，结构和业务断言通过，22输出Tokens、2366ms、0工具调用，证明已持久化。只读确认生效Skill为0，未审核未发布；既有用户模型验证状态文件保留，不纳入本次提交。密钥阻断解除，发布/回滚与固定Skill流程验收仍待用户继续，C不启动。

**B批发布闭环补验（2026-11-02）：** 用户“进入下一步”，继续3006隔离预览验收。独立Skill真实证明c77ae071复核后发布VB.0；升版并修改指令、检入VC.1，旧证明不满足新版本门禁。实际kimi-k3试运行a6f8f7ee-6ab7-4834-8417-7a051bbf5773通过（21输出Tokens、3682ms、0工具调用），新证明复核后发布VC.1，再以明确原因回滚VB.0。当前工作版VC.1、生效VB.0，三条事件与旧版hash不变，刷新持久化通过。新流程WF-2f075c2e-VA.0固定VB.0，经配置校验10984fb6及复核86465113后发布；Skill发布/回滚均未修改其依赖快照。仅静态配置，未执行流程业务。普通角色目录在只读真实预览PG服务层核对：pre_sales仅见生效VB.0，delivery不可见，不返回私有指令；JWT/发布权限定向11/11，0跳过。桌面及760px页面/弹窗无横向溢出，截图已保存。原用户Skill仍VB.1/revision8/未发布，模型配置原改动保留。B技术验证齐备，待用户最终验收；未进入C/D、未合入主线、未推送。

### B6：用户批注——独立试运行与发布弹窗（2026-11-02）

来源ISS-2026-11-02-006，分诊requirement，扩展RP-050。用户明确要求将整个试运行与发布从定义中移出；本项优先于C，B最终用户验收继续开放。

- [x] RED：定义不含发布操作或加载发布证明；清单独立入口打开专用弹窗，不能编辑定义。
- [x] GREEN：独立SkillReleaseDialog持有版本选择及未提交输入保护；复用原发布Panel与Hook，异步结果不切回定义，确认框焦点和服务器revision保持。
- [x] 验证：失败/模拟/过期门禁、复核理由、发布/回滚确认、关闭保护与历史只读定向回归，Web/模块及双构建，1440/760真实预览，保留既有数据和用户配置。

操作决策：清单“定义”与“试运行与发布”平级入口，各自独立弹窗；后者集中模型/模拟、证据、复核发布、回滚及影响/发布记录，底部负责关闭。定义保持检出检入/升版及编辑。未提交复核/回滚理由关闭时提示，版本切换不能静默丢输入。发布/回滚二次确认沿用现有Dialog，未变更API/权限/存储。

**B6验证记录（2026-11-02）：** 新交互RED为19失败/20通过（39项），原因是定义仍包含发布且缺独立入口；GREEN最终40/40，Web758/758、模块685/685、AI286/286、双构建、UI scope与独立五轴复核通过。原生浏览器发现异步加载后关闭焦点落搜索框，显式保存入口ref后实测返回原按钮；jsdom不能完整复现native dialog回焦，未将通过单测冒充该问题RED。1440/760两表面、历史只读、关闭保护、回滚确认Tab/Escape及模拟回写均已实测。样例模拟b31c33ab-3a98-40c2-ae73-61722f0e925b，未调用真实模型、未复核发布或回滚；生效VB.0与用户原Skill保持。额外test:integration失败在templates_status_not_200，安全诊断500/code50000，专用workload_eval_test活动product_templates与active assignments均0；没有为此改动业务库或扩大本次范围。当前B6待用户界面验收，B/C/D状态不代为关闭；未合入/推送。

### B7：原需求拆解示例业务断言修正（2026-11-02）

来源ISS-2026-11-02-007 / DEF-2026-11-02-004，关联RP-050。用户手动模型试运行9427d4c8已返回两条，失败为BUSINESS_ASSERTION_FAILED；原样例无assertions，默认expected整份精确比较。只修该示例配置：保留指令、输入输出Schema及expected，通过检出/保存/检入添加13项字段断言（条目数、编号、来源、查询/导出/Excel、待澄清）。离线持久化输出回放从失败转通过，6组反例仍失败；之后真实重测，不改通用比较规则、不自动发布。

**B7验证记录（2026-11-02）：** 通过3006原用户示例检出/保存/检入为SK-767c8165-VB.2，真实kimi-k3证明5591c9ae-2c76-4810-b6dd-46031d05e61e通过：1次模型、252输出Tokens、11458ms、0工具。只读PG深比较确认仅examples[0].assertions新增13项，原指令、Schema、expected均保留；revision13、checked_in、active=null、复核/发布事件均0。原9427d4c8失败证明仍在，UI标记已过期。持久化输出离线回放由失败转通过，6组错误反例仍被拒绝。配置修正不改代码或通用比较语义；未重跑无关全量代码测试，不替代B用户最终验收，C/D未启动。问题ISS-2026-11-02-007 / DEF-2026-11-02-004待用户复核。

### B批用户验收完成 / C批启动（2026-11-02）

用户原文：“手动验证完了，下一步”。按上下文确认B批独立试运行发布及示例断言修正验收完成，关闭ISS-2026-11-02-006/007及DEF-2026-11-02-003/004人工复核；RP-050整体仍实施中。该确认不执行任何Skill审核、发布或回滚，不等于MVP通过。3006继续使用B冻结构建，3004不重启，模型配置不改。C实现分支codex/wes-skills-c，复用现有隔离工作区，主目录其他改动保持；不推送。

### C批精细工单（顺序执行，各项独立复核）

1. C1 执行清单：服务端解析生效Skill/Workflow、固定依赖及资料正文，提供同事务解析接缝；本子项不接工作台或真实运行。
2. C2 Harness接入：在createQueuedRun现事务内解析/保存清单；既有Worker注册表接适配器，四类节点、等待原契约、确认内容hash、步骤幂等和实时权限/紧急禁用。使用现有Run/事件/检查点/输出。
3. C3 工作台：单表面选择/推荐/启动、字段补齐、等待回答/确认、重试/停止与版本追溯；保留普通对话，所有入口共用服务端调用服务。先执行UI技能服务和项目UI技能，分小提交。
4. C4 联调与验收：真实两版等待对照、离页/刷新恢复、权限收紧、重复确认不重复写入及旧功能回归，更新OpenAPI/说明和总看板，用户验收前不进入D。

#### C1责任、接口与验证

新增execution-manifest.types.ts、execution-manifest.ts、execution-manifest-pg.repository.ts及对应纯/真实PG测试、test-helpers/execution-database-guard.ts纯测试连接守卫，目录apps/api/src/modules/skills；仅修改skills.module.ts导出、workflows.module.ts导出既有校验器以遵守跨域边界、apps/api/package.json测试枚举及test-helpers/single-doc-serial-scope.drift.test.ts共享写表测试登记。生产和测试合计超过1000行则拆分C1a/C1b。暂不修改Harness/API/UI/DB schema。

```ts
type ExecutionRequest =
  | { kind: 'skill'; skillId: string; input: unknown; sources?: SourceReference[] }
  | { kind: 'workflow'; workflowId: string; input: unknown; sources?: SourceReference[] };
interface PreparedExecution {
  resolveInTransaction(tx: ExecutionDbExecutor): Promise<ExecutionManifest>;
}
// 服务端依赖注入：发布定义、当前身份/工具/模型/资料解析；客户端不得传定义、版本或清单。
prepareExecution(request: unknown, user: AuthUser): Promise<PreparedExecution>;
```

清单含schemaVersion、kind、目标id/version/hash、完整定义、各步骤准确Skill定义/版本/hash、初始输入和来源、服务端资料正文/version/digest、非敏感模型配置、原生工具与策略摘要、manifestHash。template/rule实际绑定尚无解析入口，assetBindings显式空数组，不声称已冻结业务资产。清单只含受限JSON，拒绝危险属性、凭据键、超限正文；原输入作为业务数据必须按既有JSON安全边界处理，不得随意删合法字段。恢复读函数验证清单形状/hash/内部版本对应且不访问latest；清单hash只防意外篡改，不能作为外部提交的授权凭证。

- [x] RED：拒绝额外definition/version/hash/manifest和伪造ID、草稿/未发布/停用/归档，当前业务角色不满足Workflow或任一Skill时拒绝，输入不符合冻结Schema时拒绝。
- [x] GREEN：事务外prepare完成模型/工具/资料读取；resolveInTransaction仅使用传入executor，Workflow根SHARE后按ID排序Skill根SHARE，完整复核版本/hash/依赖及authority fence，不嵌套DB/外部I/O。准备后切版返回明确冲突供重试，不返回混合清单。
- [x] 真实PG：并发切换Skill/Workflow指针及依赖；成功值完整旧或新版，停用竞争明确拒绝或先前完整快照；调用方事务回滚不留下额外记录；max=1连接池不死锁。测试双URL只到workload_eval_test，串行执行，0skip。
- [x] 恢复：原清单脱离当前仓储仍可读取，原Schema与资料正文保留；篡改hash、内部依赖不一致和未知schemaVersion拒绝。普通停用不改变旧清单；实时执行授权属于C2，不能因此宣称已可运行。
- [x] 定向GREEN、test:modules、build:api通过；先规格审查后五轴质量审查，总看板回填。真实模型未调用、运行入队/等待/确认/UI仍待C2/C3，不用纯解析结果冒充C批完成。

#### C2接入前实取与执行约束（2026-11-02）

- createQueuedRun当前写死workbench_chat，继续保留同会话活动唯一约束；业务目标使用固定适配器workflowId/version，实际Skill/流程版本由executionConfig.executionManifest承载，不增加第二Run库或通过新增runKind绕开约束。
- submitRunInput当前只检查waiting/JSON，confirmRunAction只按actionId查重；C2必须在同一Run锁事务内验证待答节点/occurrence/原契约/manifestHash及产物、参数hash，错误回答和旧确认不得推进。暂停时检查点和waiting事实同事务保存。
- Worker的recordToolEffectOnce为execute后记账；retryRun又新建Run且不继承检查点。稳定业务operation key必须沿重试血缘/节点/迭代保留；本地写工具未补持久幂等适配时拒绝自动执行，不以外层effect记录冒充恰好一次。远端写工具结果不确定则等待人工核对，不自动重放；首版不扩展所有MCP写工具恢复能力。
- 现Skill/Workflow没有紧急禁用字段/API。按已批准设计补独立管理员动作与原因/时间审计；解除后需要人工重试，不自动恢复写操作。普通enabled=false仅阻止新启动，已入队任务继续受当前权限约束。
- 当前manifest模型仅保存baseUrlDigest；执行前核对provider/endpoint与冻结快照一致后取当前凭据，不重解析scenario替换原model。配置不一致进入明确等待/失败，不能静默换模型。
- C1来源ID只做形状与冻结，不代表访问授权；C2启动必须校验file/conversation来源属于当前用户可访问会话/附件。模板/规则业务绑定属于D的真实解析，不把assetBindings=[]描述成已固定。

C2拆为独立审查单元：a.1统一调用服务与同tx入队（skills.invocation、Harness仓储/usecase）；a.2固定适配器注册与存量清单恢复（business-skills.workflow、harness-boot）；b.1纯四类节点解释器（workflows.runtime-adapter）；b.2单次生产Skill执行与预算（skills.execution，不复用遍历样例的evaluateSkill）；c.1原契约等待/确认（business-skills.wait）；c.2实时授权与紧急禁用（skills.execution-authority及独立API/迁移）；c.3本地写工具持久幂等；c.4统一视图从既有Run事件/输出派生。各单元代码与测试目标500–850行，超过999行先再拆。C1仅是前置能力，不代替上述子项。

**C1复核中记录：** 基线modules685/685；新增行为RED先5失败，恢复契约与资料对应、Workflow工具快照及CI可达性继续补充反例。首轮候选父代理实跑31/31、modules708/708、serial-store194/194及API构建通过；独立质量复核随后发现CI连接串硬编码/凭据断言和Workflow工具恢复完整性、跨域导出边界，正在按RED/GREEN修正，前述本机通过不等于最终候选或CI通过。依赖审计仍45项既有基线（32moderate/12high/1critical），本批未改依赖或lockfile。

**B验收后只读实取：** 原需求拆解Skill当前VB.2 / published / checked_in / revision15，生效指针为3af83d1d-b0cf-47b0-87f0-f599d5d4fa1e；与上次复测时的未发布状态不同。B验收样例仍工作VC.1/生效VB.0；另有用户新增第三个草稿Skill。此次仅查询，不修改任一记录或服务；不将先前“未发布”快照当作当前状态。

**C1最终回填（2026-11-02）：** 运行清单组件已实现，独立规格与五轴质量复核均APPROVE。固定生效Skill或Workflow及精确Skill依赖、输入Schema、初始输入/来源、准确资料正文/version/digest、非敏感模型/工具/策略快照；事务回调只使用传入executor，当前身份/发布状态/authority fence复核，恢复只读存量清单并验证完整shape与内部对应。没有接通Harness入队/Worker/HTTP/UI，也未调用模型或业务工具；来源ID尚需C2验证所属会话，assetBindings=[]不代表模板/规则版本已固定。

父代理最终实跑：test:execution-manifest 44/44、test:modules 721/721，0fail/0skip（/tmp/wes-skills-c-delivery）；串行test:modules:serial-store 194/194，0fail/0skip（/tmp/wes-skills-c-final-reviewed/test:modules:serial-store.log），API构建通过，定向secret-scan零命中。最后只将3处静态假凭据测试值改为本地randomUUID，未弱化断言/扫描；重跑44与721通过，质量复核确认原APPROVE保持。CI未执行，不将本机通过写为远端CI绿。C1 PG已接CI可达serial-store与守卫16项，测试库纯guard兼容本机/CI/容器且错误不含env值，不读取KEK。六个新增文件约665行，未新增依赖或迁移。

复核发现及闭合：整份hash不能代替内部契约一致性，已补模型字段缺失、未知工具、资料A/A替代A/B、非文本正文、Workflow工具缺字段/假依赖/坏hash的RED和明确拒绝；CI路径首轮695/696因PG测试零引用失败，已登记修复；本机固定URL/KEK断言问题亦修正。旧失败证据保留。下一项C2a.1将resolveInTransaction接入createQueuedRun同事务，随后按C2工单完成等待/确认、真实执行与持久幂等，再开放C3界面验证；D未启动。

### C2a.1 精细工单：快照与任务原子入队（2026-11-02）

用户“继续”授权按C2顺序推进，基线0b12a7a / codex/wes-skills-c；保留config/system/model-verify-status.json用户改动及3006/3004冻结预览。本审查单元只完成内部调用服务和真实队列持久化，不挂HTTP/UI，避免在通用Worker尚未注册前开放无法执行的任务；公开入口在C2a.2及后续运行适配完成后接通。C2a.1包含下列两段顺序实施，代码和测试合计超过999行先拆提交。

责任文件：新增modules/skills/skills.invocation.ts、skills.invocation-pg.repository.ts及对应纯/真实PG测试；窄改modules/harness/harness-runtime.repository.ts队列端口与createQueuedRun、skills.module.ts导出、package.json CI可达测试登记。源材料归属使用当前会话已保存attachmentId/messageId；数据层在传入executor下锁定并核对ai_sessions/user，业务层不直接读表。跨域生产导入经module出口。

```ts
// 服务端内部端口；未挂到HTTP。
submitInvocation(user: AuthUser, sessionId: string, body: {
  submissionKey: string;
  content: string;
  execution: ExecutionRequest;
}): Promise<AiRunsSubmitResult>;
// Harness新增可信回调（不能由JSON/body传入）；事务内只解析已有准备结果。
resolveExecutionConfig?: (tx: QueueDbExecutor) => Promise<Record<string, unknown>>;
```

- [x] RED：当前createQueuedRun忽略解析回调；补回调结果与Run/首事件/user-message同提交、异常及超限全部回滚、max=1无嵌套连接、发布竞争只得到完整旧/新版或冲突。
- [x] GREEN：事务外C1 prepare，队列原事务内resolveInTransaction；保留workbench_chat runKind及同会话活动唯一约束。对业务调用owner+submissionKey用稳定数据库事务锁串行化；在调用回调前识别已存在请求，不重复解析/写事件。不得把事务包住网络/模型或另造Run表。
- [x] 内部调用严格只接受submissionKey/content/execution，execution由C1校验稳定id/input/sources，拒绝客户端owner/version/definition/manifest等额外字段。当前用户active、系统/业务角色与会话owner在短事务内复核；不存在/非owner会话统一404，来源ID必须属于该会话且能读取。来源内容变化于prepare与commit之间明确拒绝，不能只相信客户端ID。
- [x] 指纹绑定sessionId、业务kind/target/input/sources和原始规范化content，排除新生成的消息信封ID。相同key相同请求重放原Run/manifest，不因新发布或普通停用而换版；同key换session/content/target/input/sources或业务/普通对话相互碰撞必须409，普通对话旧幂等行为保持。
- [x] 失败映射只保留固定业务错误码与安全文本，不把pg/SQL/资料/配置内容放入错误。返回只含runId/sessionId/status/eventCursor，不返回私有manifest、指令、资料或策略；本子项不改现有snapshot HTTP读端口，尚无公开Skill入队入口。
- [x] 真实PG证明同key并发只一Run、一份manifest、两条首事件；两key同会话和普通聊天竞争仍只有一个active；owner/角色/来源变化及用户消息事件失败均不落半记录；Workflow固定旧Skill绑定；回滚、max=1及提交后重放保留原版本。真实PG双URL只到workload_eval_test，测试读取env守卫，不钉本机账号、不读取或输出KEK，串行且CI可达。
- [x] 定向GREEN、modules、API build、受影响Harness回归；先独立规格再质量/安全复核，更新说明及总看板。没有执行模型/工具，没有等待/确认/恢复/UI运行完成声明。

**C2a.1必要接缝补充：** 当前历史已使用Harness事件事实和整会话legacy回落，conversation来源复用resolveSessionHistory，不另造消息权威源。允许conversation-event-history.ts最小扩展Pick<Database,'select'>、可选owner过滤与事件SHARE锁；经harness.module和ai-sessions.module导出现有读取/类型供同executor复用。C1请求形状解析可最小导出供重放前严格校验，避免重放再次读取latest或复制校验规则。队列严格重放检查同时覆盖pre-read和ON CONFLICT fallback；业务指纹还要核对session/adapter身份，legacy两侧无业务指纹维持原语义。

**后续公开入口门槛：** getRunSnapshot当前返回原Run含executionConfig；C2a.2/公开接线前必须白名单投影版本/来源摘要，不能向普通调用者返回包含私有指令/资料/策略的完整manifest。代码检查另发现现有deleteAiSession为activeRunChecker与deleteSession两步，存在先查后删竞态风险；当前会话SHARE锁只证明提交时归属有效，不能代替完整删除并发保护。此风险在C2c/公开接线前做确定性并发复测并关闭，不将本次原子入队声明扩大为删除竞态已修复。 质量复核另指出retryRun复制原executionConfig/metadata且不经过submitInvocation；C2执行器/公开接线前必须覆盖重试血缘的实时授权和恢复校验，不能以首次提交检查代替重试检查。本项未开放业务Run创建入口，不宣称该后续路径已验证。


**C2a.1最终回填（2026-11-02）：** 内部submitInvocation已实现并经独立规格、五轴质量/安全复核APPROVE。C1事务外prepare、既有Harness createQueuedRun事务内resolve；同事务保存完整manifest、Run及run_queued/user-message两首事件，异常或超限整笔回滚，max=1无嵌套连接。当前用户状态/系统与业务角色、会话归属、已保存附件/对话来源在同executor复核并锁定；事件权威历史与整会话legacy回落复用既有规则，来源内容变化明确拒绝。同owner+key事务锁、两条strict replay路径与准备失败后的并发回查共同保证重复调用回放原Run/版本，异请求、跨会话、普通聊天碰撞拒绝；返回仅runId/sessionId/status/eventCursor，错误固定脱敏。

父代理最终候选实跑：test:skill-invocation **27/27**、test:modules **728/728**、test:harness **330/330**，全部0fail/0skip（/tmp/wes-c2a1-parent-final）；API构建通过（/tmp/wes-c2a1-parent-final-build.log），定向secret-scan零命中、diff-check通过。独立复审分别实跑纯7/7；未以读取报告代替父代理PG实跑。测试接入test:harness/CI，使用既有双URL测试库守卫；未新增依赖/迁移、未改公共路由/OpenAPI/UI，未执行模型或业务工具，未重启3006/3004，用户模型状态文件保留。

保留失败证据：初轮队列RED4fail/1pass；来源digest删除探针12项中2fail；规格复核发现“首次查空后另一个请求提交且Skill停用，prepare先失败导致未进入严格重放”的P2，确定性新增纯3+PG1先RED4项，最小修复后27项GREEN（/tmp/wes-c2a1-race-red、/tmp/wes-c2a1-race-green）。首轮父模块725项中既有20ms总预算用例1fail，耗时已在进入首case前越限，测试读取空cases触发TypeError；相关评价器、sandbox和测试无C2改动，独立19/19、最终全量728/728通过。未放宽时间预算或断言、未改既有测试；首次失败日志/tmp/wes-c2a1-parent保留，不称CI已执行。

本单元仅完成可审查的内部入队接缝，adapter business_skills_v1/1.0.0尚未注册，未开放可创建业务Run的HTTP入口。下一单元C2a.2接存量快照恢复和固定适配器；后续四类节点、真实Skill执行、等待/确认、实时授权/紧急禁用与持久幂等完成后才接C3工作台。公开接线前保留snapshot私有清单投影、会话删除并发保护、retryRun实时授权/恢复三个门槛；不把本单元通过写为C2整体或MVP完成，不合main、不推送。

总看板同步：已窄改主目录index、requirements、plan、testing、monitoring、risks、changes、runtime、design九页及两侧事件JSON，未改其他用户工作；board-build与一致性校验0错误0警告。浏览器目视确认RP-050仍C实施中、下一步为执行/确认与工作台，截图c2a1-board-requirements.png留存于本会话visualizations。存量台账列宽和ID折行仍在，本轮未更改共享表格样式，不宣称完成视觉优化。

补充跨域检查：AI回归286/286、Web构建通过；通用integration为0/1，仍在templates_status_not_200失败。只读核对workload_eval_test活动product_templates=0、active product_sku_module_assignments=0，与B6已记录测试库缺模板相同；未为通过测试改动预览或填充业务数据。日志/tmp/wes-c2a1-cross-check及/tmp/wes-c2a1-web-build.log保留，不将定向通过表述为通用集成或远端CI通过。


### C2a.2 精细工单：固定执行适配器与存量快照恢复（2026-11-02）

用户“继续”，基线4e0cc98 / codex/wes-skills-c。沿用已批准C2分解，本审查单元只把business_skills_v1/1.0.0登记到现有Worker并建立纯恢复/执行端口；真正四类节点解释、生产LLM/工具调用、等待确认、实时授权/紧急禁用与幂等仍按C2b/c后续接入。没有新增HTTP/UI，3006/3004保持B冻结预览，保留用户模型状态文件，不合main、不推送。

架构实取：Worker在executeStep之前选择检查点，resume_next且nextStepKey=null会直接进入完成。因此不能仅在executeStep内部恢复manifest；增加可选preflight（run与已读checkpoints）并await在检查点选择/恢复事件/步骤/终态之前执行，旧流程无钩子保持原行为。业务适配器每次attempt用C1 readPersistedExecutionManifest读取run.executionConfig，不查latest/定义仓储/模型/工具/资料，核对workflow身份、runKind、owner/caller、会话与C2a.1提交指纹绑定。

责任文件：新增harness/business-skills.identity.ts、business-skills.workflow.ts及纯/真实PG测试（必要时测试fixture拆文件）；窄改harness-boot.ts注册及可信executor注入、harness-runtime.worker.ts可选preflight、harness.module.ts身份常量导出、skills.invocation.ts复用常量、apps/api/package.json CI可达枚举。不改存储结构/迁移/既有HTTP读写，不复制Harness队列或检查点库。新增代码与测试目标500–850行，超过999行先拆。

端口约定：固定一个Harness步骤execute，业务cursor和状态交给后续解释器；服务端可信execute回调接收已校验manifest、上次业务state和既有步骤context，不接受客户端函数。业务state在checkpoint中使用schemaVersion=1、runId、manifestHash与state对象信封；不重复保存完整manifest。适配器封装每次结果statePatch、只允许execute或null后继，要求显式checkpoint，拒绝畸形结果/不一致输出hash并按冻结最终outputSchema验证最终输出，不能无输出假完成。恢复逐一验证checkpoint信封、当前run/hash绑定和固定步骤/后继；坏/未知信封或篡改不能被terminal checkpoint绕过，错误固定脱敏。复制的临时manifest与state不应允许executor改写已保存run。

默认boot注册适配器但不注入生产executor，业务Run以固定安全原因明确失败，零模型/工具/业务写入；不冒充节点执行已实现。可信executor仅供后续生产接线及当前测试注入。业务Run不进入普通对话的记忆蒸馏钩子，不意外调用LLM。当前身份/来源的实时授权仍是C2c门槛；本单元owner绑定只验证已保存数据内部对应，checksum不是授权凭据。

- [x] RED→GREEN：boot启用时同时登记普通聊天与精确业务id/version，停用零start/副作用；默认缺executor失败，普通聊天不受影响。
- [x] 纯恢复：单Skill与Workflow精确旧依赖/原Schema/资料保留；manifest缺失/损坏/未知schema、owner/session/adapter或指纹不对应、未知step、checkpoint错误run/hash/schema/后继均拒绝且不调用executor；取消/异常不泄露私有内容。
- [x] 执行端口：独立快照/状态副本、state结果受限、checkpoint绑定、同一execute步骤可继续/完成，完成需冻结Schema正确的显式final output；无生产模型/工具注册。
- [x] 真实PG：C2a.1入队→Worker真实claim/commit→模拟重启从checkpoint恢复原快照；发布新版本/普通停用不替换旧定义，哈希/owner坏数据及terminal checkpoint篡改在执行前失败，无模型/工具调用，max=1可用；测试双URL守卫、串行且CI可达，禁止预览库写入。
- [x] 父独立定向、modules、受影响Harness回归、API/Web构建与所需跨域检查；先规格再五轴质量/安全复审。回填README、对齐说明与总看板；通用集成已知模板夹具缺失单列，不声称C2/C3或MVP完成。

后续门槛保持：公开Run snapshot白名单投影、会话删除并发保护、retryRun实时授权与恢复校验；本子项不借注册适配器开放公共创建入口。

**C2a.2实取后的最小收敛：** 允许skills.module窄导出现有compileSkillPayloadSchema及skillDefinitionHash，避免跨域深路径依赖，不改实现。Worker当前先commitCheckpoint后upsertRunOutput，故业务检查点一律restart_step、固定execute；preflight与返回结果均拒绝resume_next/manual等策略，包含nextStepKey=null也必须重进adapter/执行端口，不能跳过产物验证直接完成。默认executor缺失在preflight即拒绝。后续解释器负责从cursor/缓存结果恢复，持久写幂等仍C2c门槛；本单元不改通用CP/Output提交语义，也不宣称两者已原子提交。

**C2a.2测试隔离补充：** 真实PG测试创建的Skill/Workflow历史受不可变trigger保护，直接按ID删除会被WORKFLOW_HISTORY_IMMUTABLE等拒绝。按正常领域操作将本套跟踪根停用+归档并断言，不删除版本/审计、不用session_replication_role或绕过trigger，不新增CI超级用户权限要求。保留已归档fixture历史属于领域契约，不能称测试资产物理清零；仅清理本套精确IDs的Run/session/user，不能动预览或其他测试资产。

**C2a.2首候选复核记录：** 首候选新增6文件478行，定向57/57、模块777/777、Harness338/338及API构建通过；独立规格实跑纯49/49。规格复核REQUEST_CHANGES：Workflow PG用例只有切版/停用后的首次执行，没有保存CP、崩溃及重建恢复；纯夹具亦只有Skill。属于验证缺口，未声称生产代码已坏。补纯Workflow CP恢复和真实PG流程故障恢复，新旧Skill指令/model/Schema与Workflow精确依赖须不同，完整原manifest/资料/cursor/输出与不再读取依赖均直接断言；不把两条不同场景测试的组合推论称为Workflow恢复实测。补充测试若直接GREEN如实记录，先补证据再规格复审与质量复核。


**C2a.2最终回填（2026-11-02）：** 固定business_skills_v1/1.0.0适配器已与普通聊天并列注册；C2a.1调用复用同一身份常量。Worker在读取检查点后、选择/恢复事件/执行/终态前await可选preflight，业务适配器只读C1保存manifest，检查owner/session/runKind/adapter与提交指纹。业务checkpoint以schemaVersion/runId/manifestHash/state信封绑定，全为restart_step/execute，拒绝坏hash/未知信封/错误后继和伪terminal绕过。executor收到独立事实副本、原样函数/AbortSignal；结果复用copyTrialJson边界，完成需显式、hash吻合且通过冻结Schema的final output。错误固定脱敏、取消保持；业务Run不进入普通聊天记忆蒸馏。默认生产executor未接线时前置安全失败，没有假产物或模型/工具调用。

父代理独立最终实跑：test:business-skills-runtime **58/58**、test:modules **778/778**、test:harness **338/338**、test:ai **286/286**，全部0fail/0skip（/tmp/wes-c2a2-parent-final）；API/Web构建均通过（/tmp/wes-c2a2-parent-build-api.log、/tmp/wes-c2a2-parent-build-web.log），定向secret-scan零命中、diff-check通过。通用test:integration **0/1**，仍在templates_status_not_200失败；只读确认workload_eval_test活动模板0、active分配0，templates模块/集成测试/路由与基线4e0cc98无改动。保留B6/C2a.1已记录的夹具缺口，不填预览或业务数据来放绿，不称全部集成或远端CI通过。

独立规格复审与五轴质量/安全复审均APPROVE，两位分别实跑纯**50/50**，0skip；父PG实跑承担实际数据库证据。先前Workflow首次执行≠检查点恢复的P2验证缺口已补齐：纯Workflow保存完整manifest/CP后恢复；PG真实CP/fault后正常检出/保存/检入并发布不同Skill指令、.7参数、minLength40新Schema，Workflow改绑新Skill版本并发布、普通停用两根；重建Worker/RecoveryCoordinator恢复完整原manifest、旧Schema/model/material/cursor/final，旧输出长度<新Schema40、dependencyReads不增及两份CP均无条件断言。此次仅补测试，原生产实现直接GREEN，未制造产品RED；第一次新增纯fixture漏import的ReferenceError已修正，不计为产品失败证据。

有效RED保留：首轮36项因适配器尚缺preflight/行为失败（/tmp/wes-c2a2-red-behavior）；JSON安全边界44项中6fail→复用既有copyTrialJson后GREEN（/tmp/wes-c2a2-json-red）。新增6文件547行，含既有文件窄接线合计567增/7删（不含文档），未增加依赖/迁移/HTTP/UI；现有依赖audit仍45项（32moderate/12high/1critical），未在本单元处理。PG max=1、双URL守卫、串行CI可达；测试根按跟踪ID正常停用归档并断言，保留不可变版本/审计，没有绕过trigger。

边界与下一步：CP与output仍分步持久化，强制恢复再进入executor仅防无产物假完成，不代替持久写幂等。下一单元C2b.1实现四类节点解释与受限映射，随后C2b.2接单次生产Skill/预算；C2c继续等待/确认、实时授权/紧急禁用、持久幂等和统一视图，C3后才开放工作台。公开snapshot私有清单投影、会话删除并发保护、retryRun实时授权三项门槛保持。本轮未调用真实LLM/工具、未更新3006/3004或用户模型配置，未合main/推送；C2整体和MVP尚未完成。

C2a.2总看板回填：主目录总览、需求、计划、测试、监控、风险、变更、运行、设计九页已更新；board-build与21页一致性检查0错误0警告。浏览器确认RP-050仍C实施中、C2a.2已验证、节点/真实执行与工作台/D待完成，截图c2a2-board-requirements.png保存于本会话visualizations。存量台账ID折行和列宽未改，不声称UI视觉优化；关闭自建验证页/3008临时服务，保留用户3006/3004与模型配置。


### C2b.1 精细工单：四类节点纯解释器与受限映射（2026-11-03）

用户“继续下一步”，基线abf5a64 / codex/wes-skills-c；继续原RP-050，不新增需求/Loop。本单元实现可恢复、无外部副作用的流程解释规则，输入为C1保存的Workflow manifest及服务端executionId。默认生产executor仍不接线，不挂HTTP/UI，不运行LLM或工具、不做持久等待/批准授权，3006/3004与用户模型状态文件保持。真正执行和等待门槛继续C2b.2/C2c。

责任文件：新增modules/harness/workflows.runtime.types.ts（状态/命令）、workflows.runtime-values.ts（映射与条件）、workflows.runtime-adapter.ts（有限状态推进）、workflows.runtime.test.ts与必要的workflows.runtime.fixture.ts；窄改skills.module.ts导出现有skillPathParts、apps/api/package.json登记纯测试和test:workflow-runtime。解释器是Harness内部组件，不在harness.module或workflows.module新增聚合出口；后续同域executor直接组装，避免workflows.module→解释器→skills.module→C1→workflows.module的新barrel环。不得改既有已发布定义Shape/语义、Harness/boot、DB结构/依赖或工具注册。代码+测试目标500–850行；超过999先拆单元。既有字段映射只支持literal/path/fallback，本单元不扩展隐式类型转换、脚本、JSONPath表达式。

```ts
// 内部纯服务，不接受来自HTTP的runtime state或函数；命名可保持项目约定。
createWorkflowRuntime(manifest: ExecutionManifest, executionId: string): {
  next(state?: unknown): WorkflowDecision;
  settle(state: unknown, receipt: { operationId: string; output: unknown }): WorkflowDecision;
  fail(state: unknown, receipt: { operationId: string; code: WorkflowFailureCode }): WorkflowDecision;
};
// Decision: ready（四类节点命令）, waiting（失败/次数上限）, failed, completed（冻结Schema合法输出）。
```

确定性语义：create先用readPersistedExecutionManifest验证并独立复制，只接受kind=workflow。executionId为服务端稳定执行身份（当前Run/将来重试血缘由调用层选择），operationId=hash(executionId/manifestHash/stepId/iteration)，无时间/随机数；这只是节点身份，不代表工具恰好一次或用户授权。状态schemaVersion=1、executionId、manifestHash、receipts数组，使用有序回执重放推导cursor/分支/次数，不能相信客户端或存储里单独给出的cursor。回执按当前推导operationId匹配、结构/原输出Schema验证；拒绝跨实例/跨manifest/未知版本/额外字段/未来或乱序回执、终态后额外记录。全状态既有copyTrialJson 1MiB/32深度/危险属性约束，回执最多500，四类节点总访问亦受已发布50步/每步最多10次的既有定义约束。next/settle/fail和返回值均不修改调用者输入或内部冻结定义。

字段映射：复用skillPathParts，只可读取$.input.<field>或$.steps.<id>.output.<field>自有属性；目标沿用单层已声明字段。literal和fallback独立JSON复制，fallback仅缺字段时用，null/false/0/空串不是缺失；组装整份节点输入及最终output后按冻结Schema校验。条件数组为AND，exists区分字段存在与值为null；eq/neq/in用JSON结构相等，不做JS隐式类型比较；数值比较只接受有限数字。非法/缺少必需源、原生工具缺输出契约不得凭空发明字段或偷偷跳过。

推进顺序：prerequisite为false时跳过该节点，既不执行branch也不执行repeat；成功回执验证后更新该节点最新输出，再判断repeat.while（do-while，maxIterations包含第一次），仍为true且到上限按onLimit产生waiting/failed且绝不多发一次命令；未重复则按声明顺序取第一个匹配branch（严格向前/$end），无匹配取下一节点。跳过节点的输出按既有fallback规则处理。失败回执仅接受固定安全枚举码，按onFailure返回waiting/failed，不自动重试/推进。waiting为纯决策且保持不变，不代表已持久挂起，也不提供未经授权的继续/覆盖接口。

四类命令：skill带精确skillId/version和原输入输出契约；userInput带原prompt/input/output契约；confirmation输出沿用{approved:boolean}原契约，true/false都是可分支的业务数据，绝不作为后续工具调用的授权凭据（实际拒绝/批准动作由C2c核验后选择settle/fail）；tool带冻结原生参数契约与更严格requiresConfirmation，结果仅受安全JSON约束、作为opaque回执保留，不暴露为可映射的$.steps.tool.output。所有命令只描述动作，纯解释器不执行。工具写入和外发仍需独立的当前权限/参数hash确认与持久幂等。

重复回执：同operationId及同内容的settle/fail只返回当前推导状态，不追加、不重复进入下一步；不同内容/成功失败碰撞或错误operationId明确拒绝。终结状态保存原产物证据并可由有序回执重新推导，JSON往返恢复不重新要求已完成步骤，不取latest。

- [x] RED→GREEN：四节点顺序、原Schema/精确依赖、literal/path/fallback/null等、原生工具不可映射输出；最小失败后实现，纯命令不触发I/O。
- [x] 控制流：skip、首匹配分支/$end、深结构比较/exists/数值严格类型、重复0/1/10界限及onLimit/onFailure wait/fail，不能多发命令或自动绕过人工处理。
- [x] 恢复/幂等：JSON往返中途和完成恢复、原manifest被外部修改不影响实例、同回执重放/冲突、两实例及manifest隔离、坏/越序/超500/超限/危险字段状态拒绝，错误固定脱敏。
- [x] 组合测试：用已存在BusinessSkills适配器的可信测试端口保存解释器state/原产物，在中途/终态重进后仍同版本且不重做已回执节点。只测试接缝，不改生产boot、不宣称真实Worker/模型业务运行通过。
- [x] 父独立定向、modules、既有适配器回归、API/Web构建与必要跨域检查；先规格后质量/安全复核，回填README/对齐说明及总看板。既有通用集成模板夹具缺口仍单列，不以局部通过关闭C2/C3/MVP。

**C2b.1契约实取纠正：** 存储策略枚举TOOL_POLICY_APPROVAL_STRATEGIES只有default/user-confirm（types/index.ts:595），ask是resolveWorkbenchToolDecisionSlot的运行时分流结果，不是可持久化策略值。纯工具命令保守OR冻结policy.approvalStrategy=user-confirm，不引入无效ask兼容分支；新增合法策略反例65项中1fail（false!==true）后修正转65/65，证据/tmp/wes-c2b1-policy-red与/tmp/wes-c2b1-policy-green。以当前类型和生产函数实取为准，不沿用口头术语。

**C2b.1首候选规格复核：** 实现者首候选定向67/67、modules845/845及API构建通过；父独立首候选67/845/既有适配器58通过。规格独立纯67通过后以合法大结果探针发现P2：output600011B、完整state600269B均符合1MiB边界，但返回decision重复携带state中的output及顶层output，整体再次copyTrialJson误将合法state缩额，首次settle/恢复next均INVALID_STATE。规格REQUEST_CHANGES，正在按RED/GREEN修正独立逻辑对象的验证/复制边界；完整state、映射后的整份input、最终output仍各受原1MiB/深度/危险属性限制，返回组合信封不再重复算配额。不扩大共享helper限额、不将原67项绿色当完成。

**C2b.1返修复审记录：** 合法600k输出/600269B状态的首次settle、独立state.next、JSON恢复、重复回执与副本隔离已修复；完整state、每轮重放映射后的整input和最终output分别保留1MiB/深度/unsafe界限，不将组合信封的重复数据算成更低额度。新增修前72项中3fail、旧步骤重放聚合input反例72项中1fail，最终纯72/72。规格复审独立探针及72/72后APPROVE；fresh质量/安全亦独立纯72/72后APPROVE，依赖audit仍45既有基线。最终父套件正在串行复跑。

返修modules首轮850中849pass/1fail，唯一为原skills.evaluation.test.ts:87的20ms预算用例读取空cases；隔离19/19、实现者一次安静全量850/850通过。相关生产域/旧测试/预算未改，先前C2a.1同类证据继续保留。本轮失败日志/tmp/wes-c2b1-return-final/test:modules.log、隔离/tmp/wes-c2b1-budget-isolated、一次复核/tmp/wes-c2b1-modules-confirm，不覆盖或删去失败历史。


**C2b.1最终回填（2026-11-03）：** Harness内部纯Workflow解释器已实现并经独立规格/质量安全APPROVE。C1保存manifest只读验证，四类节点生成纯命令；literal/path/fallback沿用原契约、falsey/null不误回落、自有安全字段、严格结构/数字条件、前置跳过/首匹配向前分支/$end、do-while上限含首次及onFailure/onLimit均按已发布配置解释。有序回执从原输入推导cursor，拒绝乱序/未来/跨实例/错manifest/终态追加；同ID同内容不追加/不跳步，冲突拒绝。工具保留opaque回执且不能凭空映射其output，确认策略保守OR真实user-confirm；确认业务数据不作为后续工具授权。

大小/恢复约束：完整state、每次历史重放映射后的整input及最终output分别保留既有1MiB/32深度/unsafe限制；组合返回不再重复缩额。合法600k输出首次完成、独立保存状态恢复、重复回执与副本隔离已实证；真正超大聚合input/output/state仍拒绝，最多500回执与50步/每步10次控制保持。通过既有BusinessSkills适配器可信测试端口组合中途/终态state及原产物，已回执节点不重发；该组合仅纯接缝，不冒充真实Worker业务或LLM调用验收。

父独立最终候选：test:workflow-runtime **72/72**、test:modules **850/850**（29 suites）、test:business-skills-runtime **58/58**、test:ai **286/286**，均0fail/0skip（/tmp/wes-c2b1-parent-reviewed）；API/Web构建通过（/tmp/wes-c2b1-parent-build-api.log、/tmp/wes-c2b1-parent-build-web.log），定向secret-scan零命中、diff-check通过。规格复审与fresh五轴质量安全分别独立纯72/72后APPROVE，质量未做性能压测；npm audit实取45项既有基线（32moderate/12high/1critical），依赖及lockfile无改动。本单元没有改Worker/boot，已复跑原适配器58项；前单元完整Harness338是其原记录，不冒充本轮重新执行。

通用集成test:integration **0/1**，仍在templates_status_not_200失败；只读核对workload_eval_test活动模板/分配均0，相关模板域、路由、集成测试与abf5a64无变更。夹具缺口继续保留，不填业务/预览数据放绿；远端CI未执行。返修前旧20ms预算用例一次850中1fail、隔离19/19、实现者一次850/850及父最终850/850均保留，未改评估器、旧测试或预算，也未删除初次失败证据。

完整审查史：58项首次行为RED→GREEN；user-confirm合法策略反例65中1fail→修复；首候选67/845/适配器58/AI286通过但规格探针600011B输出/600269B状态被重复信封误拒，REQUEST_CHANGES。补大结果及聚合限额RED72中3fail、旧步骤重放input额度RED72中1fail后最小修复，并经同规格复审。日志/tmp/wes-c2b1-red、/tmp/wes-c2b1-policy-red、/tmp/wes-c2b1-return-boundary-red-guards、/tmp/wes-c2b1-input-replay-red和各GREEN保留，先前绿色不冒充最终候选。新5文件577行，另仅skills.module窄出口与API测试脚本；无新聚合入口/DB/schema/依赖/路由/UI，没有改用户模型状态文件。

下一步与边界：C2b.2接单次生产Skill与调用预算，C2c接持久等待/确认、实时授权/紧急禁用、写入幂等与统一视图，C3后开放工作台。当前waiting只是纯决策，operationId/checksum不是授权或业务恰好一次；服务端executionId的重试血缘由后续调用层绑定。公开snapshot投影、会话删除并发保护、retry授权门槛仍开放。未运行真实模型/工具、未接生产executor/更新3006或3004、未合main/推送，C2/C3/D及MVP均未被关闭。


**C2b.1总看板复验（2026-11-03）：** 九个相关页面已同步，board-build与board-consistency-check通过（21页、0错误/0警告）；浏览器展开完整台账后实读RP-050仍为C实施中，下一步为生产Skill/预算。截图：/Users/kevin/.codex/visualizations/2026/11/02/01a19a18-92f8-7bf1-b70c-df3fd911608f/c2b1-2026-11-03-board-requirements.png。新增状态可读，表格原有窄列换行保留，未声称完成视觉优化。本次临时3008服务与自建验证页已关闭，用户3006页未操作。


### C2b.2 精细工单：单次生产Skill与调用预算（2026-11-03）

用户“下一步”授权继续原RP-050，基线4458439/codex/wes-skills-c。沿用已批准受控执行设计，不重新开展需求评审。本单元实现独立单Skill执行服务，使用真实业务input而非examples；不复用evaluateSkill的样例遍历，也不复用sandbox.runTool的模拟分支。模型适配器具有生产默认实现，本轮验证只使用可信端口替身，不调用真实外部模型。当前无HTTP/UI/Worker接线，不更新3006/3004、不写预览库或用户模型状态文件。

责任文件：skills.execution.ts（执行循环、校验、预算、取消）、skills.execution-model.ts（固定模型与凭据准备）、skills.execution.test.ts和必要的模型专项测试；窄改skills.module.ts出口、apps/api/package.json登记test:skill-execution与modules。沿用既有SkillModelRequest/Response和安全JSON/Schema/path helper，不新增依赖、DB迁移或工具目录。目标代码测试500–850行，超过999行先拆单元。父代理维护文档与总看板；执行方不自行提交，完成后先独立规格、再五轴质量/安全复核。

```ts
createSkillExecutionService(trustedPorts?).execute({
  manifest, stepId, input, signal, budgets
}): Promise<{
  status: 'succeeded' | 'failed' | 'cancelled'; code?: string; output?: unknown;
  usage: { modelAttempts: number; toolCalls: number; outputTokens: number; elapsedMs: number };
  // 模型身份记录冻结providerId/model及实际transportProvider，不能互相冒充。
}>;
```

内部契约：manifest由C1原读器重新验证复制，stepId只选择原固定依赖；输入整份安全JSON和冻结Schema校验，输出同样验证。独立Skill/流程内依赖共用服务，例子/期望值/测试断言不得当生产输入或验收条件。冻结instructions/model参数、资料正文按原绑定顺序进入提示，不重读latest知识或scenario。模型响应不合结构直接失败，不自动修复重试。

生产准备：按冻结providerId查当前目录，核对启用、协议、原model存在、credentialScope和baseUrlDigest；缺项或漂移明确失败，不切供应商/模型。只在内存闭包取得该scope当前凭据，允许同scope轮换；原场景改绑不改本运行模型。复用createSkillModelAdapter的兼容传输，返回prepareModel.complete及预期实际transportProvider=kimi；响应provider按真实传输核对，model必须原精确值。证据分开保存冻结供应商与实际传输标识，不能假称providerId是模型响应。凭据/端点/原始异常不进入结果/日志。

工具：只向模型声明原白名单和原生参数Schema。整批请求先验证callId唯一、toolName真实绑定、参数安全JSON+原生Schema+原inputMapping完全相等；拒绝output混合toolCalls。执行端口接收冻结caller/native/policy/binding/call/input和AbortSignal，只能由服务端装配。默认无端口时TOOL_GATE_UNAVAILABLE，绝不模拟成功或直接写入/外发。真实授权、人工确认、紧急禁用、幂等仍由C2c提供，快照/confirmation布尔值不是授权。工具结果安全JSON后才能反馈下一轮。

预算：单次服务调用累计modelAttempts/toolCalls/outputTokens/elapsedMs；沿用原评估器上限60/60/128000/300000，允许收紧而不扩大。模型每次maxTokens取剩余额度和冻结定义较小值；耗尽前禁止下一次调用，工具批量预算不足时不执行部分批次。总截止从入口开始含prepare/model/gate，每次模型额外受原timeoutMs限制；父取消同时中止并通过race结束忽略signal的端口，清理定时器/监听器，迟到结果不能触发下一轮或工具。错误与失败消耗返回固定安全字段，跨节点/跨Run持久预算和恢复不属于本单次函数承诺。

- [x] RED：真实input/无样例运行、原Skill/Workflow依赖、Schema与JSON、冻结资料/模型、目录变化/缺凭据/端点漂移、同scope轮换与scenario改绑；留存行为失败日志。
- [x] GREEN：最小单次生产执行及默认准备，模型/工具响应、批次预检、精确映射与安全错误；不接真实工具端口或Worker。
- [x] RED→GREEN：尝试/工具/tokens/timeout预算，准备阶段超时、父取消、忽略signal和迟到响应；确认无超限后的额外副作用。
- [x] 独立规格复核通过后再五轴质量/安全复核；父实跑新测试、modules、原解释器/适配器、AI及双构建，通用集成缺模板继续单列。
- [x] 更新README/对齐说明、总看板计划/需求进度/设计/运行/测试/监控/风险/变更；精确文件本地提交，未合main/推送，C2/C3/D和MVP不关闭。


**C2b.2实现前契约修订：** 实取KimiProvider发现温度兼容重试可在maxAttempts=1之外再次请求，且通用适配器会丢弃混合toolCalls/content及坏JSON的usage。为保证本次预算真实约束网络次数，复用既有Provider传输，新增内部可选frozenExecution标记：非流式固定一次请求，显式原model与温度，不做兼容重试或参数改写；冻结supportedParams不允许temperature时由执行准备省略该字段。普通调用默认行为保持，流式带此标记明确拒绝。本单元可窄改ai/provider/model-provider.ts、kimi-provider.ts及新增冻结模式协议测试；执行专用消息适配器保留usage后校验坏JSON/混合响应，不另建HTTP传输。Provider原响应model字段由请求派生，不把该字段称为上游独立证明。总量超过999行先拆单元。


**C2b.2输入追溯补充：** 单独Skill运行的input必须与manifest.initialInput结构相等（或直接取该值），不允许覆写已冻结的根输入；流程内Skill接受解释器映射后的input并验证原Schema，映射来源由C2b.1负责。新增根输入不一致反例须在模型准备前拒绝。


**C2b.2规格澄清（既有参数语义）：** model-providers.ts已规定supportedParams非空为白名单、空数组为未声明约束（不限制，向后兼容）。因此空数组允许发送冻结temperature，只有非空白名单排除temperature时才省略。本工单“不允许temperature”的表述按该既有契约解释，不另造空数组等同禁止的新语义。规格复核以独立空数组探针发现歧义，现明确采用当前事实源，无需改变生产实现。


**C2b.2首候选规格复核：** 新定向56/56、执行方modules906/906、父定向56/56及原解释器72/72、API/Web构建通过；独立规格复核以实际KimiProvider和拦截fetch构造非function原生调用，实得succeeded/gates1/modelAttempts2/outputTokens6，发现P2：严格解析丢弃原call.type。已REQUEST_CHANGES，新增全链反例要求错误类型在gate前拒绝、保留收到的usage；默认旧解析不改。首候选通过证据保留，不冒充返修后结果。


**C2b.2最终回填（2026-11-03）：** 单次生产Skill服务与独立模型准备已实现，经规格及fresh五轴质量/安全APPROVE。实际业务input与样例执行分离，C1原manifest复验、精确依赖与根输入一致、冻结Schema/JSON及资料正文/顺序保持。当前供应商目录按原providerId/model/protocol/scope/endpointDigest核对，仅在内存取当前同scope凭据；不重解析scenario、不重读latest资料。保留目录供应商与实际kimi传输两种身份；响应model仍为既有Provider从请求派生的字段，不声称上游独立证明。

预算与取消：单次调用统计模型尝试、实际门禁调用、收到的合法输出token和耗时；额度只收紧，发送maxTokens受剩余额度限制。准备、模型、工具均纳入总截止，模型另受原单次timeout；父取消及超时race忽略signal端口，阶段后守卫防迟到结果再触发下一轮。不能撤销已发出的I/O，也不能让不合作的可信工具端口收回自行造成的副作用；生产工具端口当前未装配。该预算不是跨节点/Run/重试持久预算，后续宿主接线仍须补持久约束。

原生工具整批校验白名单、ID、原Schema与精确映射后才进入可信门禁；结果安全JSON后才能给下一轮。默认无门禁为TOOL_GATE_UNAVAILABLE，无模拟成功/真实写入外发。冻结Provider模式复用现有HTTP实现，强制单次且不做温度兼容重试/参数改写；普通/试运行默认行为不变，冻结流式明确拒绝。严格原生解析不修复坏参数或ID，不丢弃显式非法调用类型，收到的usage先于业务结构失败统计。非空supportedParams白名单与空数组未声明约束语义均保持。

父最终独立候选：专项 **58/58**（/tmp/wes-c2b2-parent-final-target）、modules **908/908**（29 suites）、原Provider协议 **17/17**（/tmp/wes-c2b2-parent-final），均0fail/0skip；最终API构建通过（/tmp/wes-c2b2-parent-build-api-final.log）、Web构建通过（/tmp/wes-c2b2-parent-build-web.log），范围secret-scan零命中、diff-check通过。规格与质量各独立专项58/58后APPROVE；质量无新增具体可利用漏洞，未做负载测试，npm audit仍45既有基线（32moderate/12high/1critical），未改依赖/lockfile。

本轮首候选906/906后、严格类型小修前的跨域回归：原解释器72/72、真实适配器58/58、AI286/286、Agent242/242通过（/tmp/wes-c2b2-parent-target、/tmp/wes-c2b2-parent-reviewed）；返修只影响新增冻结解析路径，最终908及17已覆盖该路径与旧协议默认行为，不冒充重新执行全部跨域套件。通用集成仍 **0/1 templates_status_not_200**，只读核对测试库活动模板/分配均0；模板域/路由/旧集成测试未改，不向预览或主库填数据放绿，远端CI未执行。

完整审查史保留：首次行为RED48中40fail；严格解析RED8中7fail；根输入/预算形状/原生类型等RED56中4fail；首候选56/906绿色后，规格独立实际Provider探针发现P2（非function类型被丢弃，工具端口调用1次），REQUEST_CHANGES。补全链RED58中1fail后最小修复，最终实际探针为failed/门禁0/模型1/token3，规格复审通过。日志/tmp/wes-c2b2-red、/tmp/wes-c2b2-red-parser、/tmp/wes-c2b2-provenance-red、/tmp/wes-c2b2-native-type-red及GREEN、/tmp/wes-c2b2-spec-native-type-before.log与after.log均保留。新增四文件467行及Provider/module窄改，无新HTTP传输、DB迁移或依赖。

边界与下一步：C2c.1接原契约持久等待/确认，随后C2c.2实时权限/紧急禁用、C2c.3写入幂等及跨调用预算、C2c.4统一视图，满足公开snapshot投影/会话删除并发/retry授权门槛后再接宿主执行与C3工作台。未开放HTTP、未接生产Worker、未调用真实模型或业务工具，不声称真实业务验收。未读取/改动用户model-verify-status文件、未更新3006/3004或预览数据，未合main/推送；C2整体/C3/D与MVP继续保持未完成。


**C2b.2总看板复验：** 九页已同步，board-build与21页一致性检查0错0警告；浏览器展开RP-050台账实读仍C实施中，下一步等待/确认授权/幂等。截图/Users/kevin/.codex/visualizations/2026/11/02/01a19a18-92f8-7bf1-b70c-df3fd911608f/c2b2-2026-11-03-board-requirements.png。既有窄列/P2换行保持，不声称完成视觉优化。已关闭本次临时3008服务及自建页，未操作用户3006页。


### C2c.1 精细工单：流程原契约持久等待与确认（2026-11-03）

用户“继续下一步”，基线4ac3bde/codex/wes-skills-c，继续原RP-050及已批准设计。目标是在现有Harness上完成真实PG持久的userInput/confirmation等待、匹配回答、重启恢复与幂等推进；不是内存Promise或纯决策模拟。生产Skill/工具仍不接宿主，内部等待专用executor只接受这两类节点及已完成结果，其他命令安全拒绝。无新HTTP/UI/生产boot接线，无DB迁移、依赖或真实模型/工具调用；保护用户模型状态、3006/3004、预览库与主目录既有改动。

复用方案：既有pauseRunForToolWait事务内持有Run锁，新增仅服务端beforeWait(tx,run)钩子，在同笔事务写检查点、等待事件、释放当前attempt并置waiting；抽取commitCheckpoint原事务体为同域共享函数，旧入口保留验证与行为。不得先提交检查点后单独调用pause，也不得嵌套获取连接。仅新业务等待额外锁定并核对真实当前attempt归属、运行状态和有效租约，陈旧/错run attempt在写入前拒绝。取消优先：不得把取消中的运行留成waiting。

责任文件：新modules/harness/business-skills.wait.ts（内部等待仓储/服务及有限executor，可按职责窄拆同前缀文件）、business-skills.wait.persistence.test.ts；窄改harness-runtime.repository.ts/worker.ts/types.ts、business-skills.workflow.ts/usecase.ts及必要module出口。parent只维护package脚本/文档/总看板，不与实现者并改业务文件。代码和测试目标750–900行，连同已有代码搬移的实际diff若超过999，先收敛或拆审查单元，不以文件净增隐藏规模。

```ts
createBusinessSkillsWaitService(database).pause({runId, attemptId});
createBusinessSkillsWaitService(database).answer({
  runId, sessionId, requestedBy, actionId, kind, stepId, contentHash, value
});
createBusinessWorkflowWaitExecutor(service); // 内部服务器装配，仅userInput/confirmation/completed
```

契约：用C1保存manifest和C2b.1有序回执重新推导当前命令；不信客户端传入Schema/指令/游标/批准身份。actionId绑定run/owner/session/manifestHash/operationId/kind/stepId/原契约及prompt+displayInput的contentHash。私有businessSkills检查点保存原runtimeState，等待事件只放待答提示/原输出结构/显示数据和必要标识，禁止复制完整manifest、Skill私有指令、引用知识正文或工具策略。以既有事件白名单增量登记workflow.awaiting_input、workflow.awaiting_confirmation、workflow.answer_recorded，不新增等待状态或表。新恢复路径对owner/session/runKind/adapter、快照hash和最新CP完整性逐项复验。

回答事务持有同一Run锁：当前owner/session匹配，actionId/kind/stepId/contentHash必须对应本次等待；整份value安全JSON及原Schema通过才可追加回执。非法回答保持waiting，先前已完成节点不重新执行。相同绑定+相同答案返回首个记录，不重复事件/检查点/入队；冲突、旧内容、跨run/错owner/错节点拒绝；并发不同回答至多一个写入，同答并发只接受一次。confirmation原契约{approved:boolean}保持，false是显式记录的业务数据，沿已发布false分支推进，不冒充写工具执行授权。回答后原子提交新检查点+回答事件+queued；终态/取消不被旧回答重新打开。

通道隔离：既有submitRunInput/confirmRunAction/rejectRunAction对business_skills_v1运行明确拒绝，防通用接口绕过本契约。针对已知snapshot私有清单门槛，getRunSnapshot的业务Run采用窄安全投影去除executionConfig和checkpoint.state；其他返回完整Run的公开读取也需核对，未覆盖者列为门槛。等待专用executor事务成功后抛HarnessWorkflowWaitingError，business适配器与Worker保留该控制流，不把已持久等待写成失败。正常启动仍无生产executor，不提前开放业务创建入口。

- [x] RED：真实PG等待事务包含CP/事件/attempt释放；原manifest、Schema、原输入/显示内容绑定，错attempt/过期lease在写入前拒绝。
- [x] GREEN：复用同事务helper、内部pause/answer与有限executor，新事件/控制流；max>=2真实并发回答验证一次推进，失败事务完整回滚。
- [x] 新service/repository/Worker实例恢复原userInput→confirmation→final；invalid值不推进，同答重放/冲突/旧hash/跨run/错owner-session-kind-step拒绝，false分支、取消优先及取消/回答竞态。
- [x] 泛用输入/确认/拒绝接口不可绕过；业务snapshot不返回私有manifest/state，旧聊天等待语义与既有Harness回归保持。
- [x] 规格独立复核后fresh质量/安全复核；父独立专项/模块/Harness及受影响回归/双构建，集成缺模板继续如实记录；精确文件本地提交并同步九页看板，不合main/推送，不关闭C2/C3/D/MVP。


**C2c.1实现前收敛：** pause只接受runId/attemptId，在同一持锁事务中读取原manifest和最新私有检查点，再由解释器推导等待命令；不接受调用方传入runtimeState、Schema、指令或显示内容。初次无CP从原输入开始，恢复CP复用业务适配器原验证器。测试直接用真实队列保存合法冻结清单，不为等待测试建立无关发布资产。


**C2c.1契约同步补充：** 公共既有snapshot的业务Run变体去除executionConfig及私有checkpoint.state/aiMilestone；现有inputs/confirm/reject对业务Run返回409 BUSINESS_SKILLS_WAIT_CHANNEL_REQUIRED，不转成通用500。OpenAPI同步描述上述既有端点变化，无新增业务等待HTTP入口；用例/路由测试验证owner与冲突响应。活动Run列表原本已是摘要投影。版本/来源统一展示、retry实时授权及会话删除并发仍是后续门槛。


**C2c.1开发中实取修正：** 父代码检查提出合法大答案在业务适配器完成结果中被state/output重复包装计入1MiB的风险，实现者以真实等待→回答→确认→最终结果复现13/14中的失败（/tmp/wes-c2c1-red-large）。本单元允许窄改同一business-skills.workflow.ts完成结果复制边界：metadata、完整state、output内容各保留原安全JSON限制，不提高共享限额，不让组合信封重复缩额；必须以600k真实恢复反例转绿。通用回答错误需映射为409的RED3失败与GREEN13通过、max1单连接路径已有证据（/tmp/wes-c2c1-red-http、/tmp/wes-c2c1-green-http），最终候选仍待独立复核。新PG套件登记test:business-skills-wait与现有串行test:harness，避免在modules并行组与Harness争用表。


**C2c.1首候选独立规格复核：** 父真实等待22/22、modules908/908通过，规格独立22/22及8个大小/危险属性/未知字段探针通过，但锁竞争探针发现P2：businesspause以now()（事务开始时间）校验lease，等待Run锁后实际已过期仍写waiting与CP。独立实得xact_start .113Z/lease .123Z/actual_now .124Z、accepted=true/CP1，REQUEST_CHANGES；证据/tmp/wes-c2c1-spec/independent-probe.mts及.log。返修仅在新业务pause取得Run与Attempt两锁后用实时clock_timestamp校验租约，补锁等待反例；不改旧通用租约语义。同时取消/回答竞态独立12轮均cancelled，原允许cancelling的断言须收紧。首候选绿色保留，不冒充最终复审通过。


**C2c.1租约返修与规格复审：** 实现者真实Run锁与Attempt锁竞争反例均先红（24中2fail，/tmp/wes-c2c1-lease-red）；新业务pause先锁两行，再单独SQL按clock_timestamp和DB原精度判断lease，旧通用时钟与租约逻辑不改。最终专项24/24及API构建通过。规格独立重跑24/24、两种自建锁争用均拒绝过期租约且CP0、取消竞态12轮均cancelled、8个大小/危险属性/未知字段探针通过后APPROVE，证据/tmp/wes-c2c1-spec-final。父专项24/24和模块908/908也通过，质量/完整Harness及跨域回归仍在进行，不先宣布全部通过。


**C2c.1首轮完整回归记录：** 父最终等待24/24、modules908/908通过，但首次完整Harness362中355pass/7fail，均为原事件词汇25类/历批additive差集断言未登记本批3类，日志/tmp/wes-c2c1-parent-final/test:harness.log。允许窄改harness-runtime.types.test.ts：保留旧25词汇顺序与全部历史校验，把3类新事件追加尾部并单独冻结28总量/准确名称/去重，不删除旧防线或放宽任意事件。补完后须重新做完整Harness与独立复核；本轮旧失败保留，不宣称全绿。


**C2c.1最终回填（2026-11-03）：** 内部原契约等待服务、回答及有限executor已实现，规格和fresh五轴质量/安全APPROVE。既有Harness同事务原语保存检查点/等待事件/attempt释放/waiting；回答持Run锁，绑定owner/session/原manifest/节点/原Schema/待显示内容hash，校验后原子写回执检查点、回答记录并queued。非法回答零推进；并发同答仅一次，冲突拒绝；新service/repository/Worker实例恢复原流程，false确认沿发布分支跳过实际后继节点。确认数据不作为工具写入授权。

锁后租约修复：先按Run→Attempt顺序锁定，再独立SQL按clock_timestamp与数据库原时间精度检查有效租约；两种实际锁争用在租约过期后都拒绝且CP0，不改旧通用时钟。取消/回答竞态12轮均cancelled，终态不被旧回答重开。故障注入在实际CP插入后失败时整笔回滚；坏hash/policy/next/unsafe/manifest/pointer均拒绝。合法600k答案经真实等待→回答→确认→最终结果通过，组合返回不再重复缩额；真正超大/危险属性/过深状态输出仍拒绝。

通道与隐私：普通inputs/confirm/reject事务内拒绝业务Run，经usecase映射409 BUSINESS_SKILLS_WAIT_CHANNEL_REQUIRED；getSnapshot业务变体去除executionConfig及私有CPstate/aiMilestone，原owner404保持；活动列表沿用摘要。OpenAPI同步既有端点描述，无新增等待HTTP接口。新增3类事件追加尾部，旧25类顺序及全部历史保护保持；新契约冻结28总量/准确名称/去重，并验证移除/改名/重复/未知事件都会触发失败。

父最终独立验证：完整Harness **364/364**、modules **908/908**（29 suites），0fail/0skip（/tmp/wes-c2c1-parent-rereviewed）；父真实等待专项 **24/24**（/tmp/wes-c2c1-parent-final）及API/Web构建通过（/tmp/wes-c2c1-parent-build-api-final.log、/tmp/wes-c2c1-parent-build-web.log），YAML解析/diff检查通过、范围秘密扫描0命中。规格独立24/24、两种租约争用/12取消竞态/8边界探针后APPROVE（/tmp/wes-c2c1-spec-final）；fresh质量独立纯逻辑118、边界8、事件契约13、PG24均通过后APPROVE（/tmp/wes-c2c1-quality-pg）。质量首次直接启动因测试库变量未对齐被守卫拒绝连接，保留/tmp/wes-c2c1-quality-pg.log，随后统一包装通过，无生产库访问。

本轮AI **286/286** 在事件词汇顺序/测试登记调整前通过，末次只重跑完整Harness及模块，不冒充再次运行全部AI。通用集成仍 **0/1 templates_status_not_200**（/tmp/wes-c2c1-parent-final）；末次只读查询workload_eval_test活动模板/分配均0，模板域/路由/集成测试未改，不填主库或预览数据放绿。远端CI及真实模型/工具验收未执行。依赖audit实取仍45既有基线（32moderate/12high/1critical），无依赖/lock变更；质量无本scope新增具体可利用漏洞，未做负载测试，事务重复解析/重放仅按1MiB/32深度/500回执约束，不承诺吞吐量。

审查失败与修复证据全部保留：初始guards4fail/core4pass5fail、409映射RED3fail、600k结果RED13/14；首候选独立22及父22/908绿色后规格租约探针REQUEST_CHANGES，Run/Attempt争用RED24中2fail→修复；首轮完整Harness362中7项旧词汇断言失败，原puretypes4pass7fail/新guard12pass1fail后追加顺序及契约修复，最终puretypes13与完整364通过。日志/tmp/wes-c2c1-red-core-behavior、red-http、red-large、lease-red/green、types-original-red.log、types-newguard-red.log、types-green.log及父首轮日志保留；没有删除或弱化旧防线。

边界/下一步：C2c.2接当前权限、紧急禁用与retry实时授权、会话删除并发保护；C2c.3持久写入幂等/跨调用预算，C2c.4版本来源及等待统一投影，最后接生产宿主与C3工作台。当前只有内部等待专用executor（其他Skill/tool命令安全不可用），未更新生产boot或3006/3004、未读取/修改用户模型状态、未写预览数据，未合main/推送。快照直接私有配置暴露已收窄，统一视图与公开入口其他门槛仍保留；C2整体/C3/D/MVP未关闭。


**C2c.1总看板复验：** 九页已同步，board-build及21页一致性0错0警告。浏览器展开RP-050实读仍C实施中，下一步实时权限/紧急禁用/幂等；截图/Users/kevin/.codex/visualizations/2026/11/02/01a19a18-92f8-7bf1-b70c-df3fd911608f/c2c1-2026-11-03-board-requirements.png。原表格窄列/P2换行未改，不声称视觉优化通过。本次自建页及临时3008服务已关闭，用户3006页未操作。

### C2c.2a 精细工单：持久紧急控制与真实任务准入（2026-11-03）

用户“继续下一步”，基线66a8039/codex/wes-skills-c，继续原RP-050。C2c.2整体拆为a持久紧急控制/提交与Run准入，b强制逐次用户/Registry/策略交集校验，c retry授权/会话删除并发；不把可选guard或解析hash称授权。本批先交付管理员真实JWT紧停/解除API及不可变审计、原子提交epoch绑定、按持久runId校验的内部准入，禁止提前宣称模型/工具调用前实时保护已接通。

DB与存储决策：已批准Skill/Workflow领域的PG扩展，不引入新存储主线。新增0030增量迁移及journal：Skill/Workflow根各增emergencyStopped=false、emergencyEpoch=0、emergencyRevision=0，独立于普通enabled/archive与内容revision；另execution_emergency_audits追加审计表，恰好一个Skill/Workflow根FK，action/reason/actor/epoch/revision/DB时间，UPDATE/DELETE触发器拒绝。默认值兼容旧行，发布内容/hash/version完全不动，旧metadata writer不得覆盖紧停列。只通过测试库守卫应用到workload_eval_test，禁止主库/预览库迁移；生产/预览应用及UI独立后续。

语义：stop增加epoch与紧停revision；release只增加紧停revision，不重写旧Run绑定。当前停止拒绝新提交、同submissionKey旧重放及准入；解除后旧epoch仍失败EXECUTION_MANUAL_RETRY_REQUIRED，只有新的显式提交捕获当前epoch。旧或伪造缺失绑定失败关闭。普通停用只影响新启动，已排队原Run不因enabled/archive切换被误杀。工作流目标及全部固定Skill依赖均在紧停作用域；不只检查当前生效版本或latest。

执行配置：C1 manifest shape/hash不扩展，服务端executionConfig.executionAuthority同级保存按kind/id排序且去重的epoch绑定；绑定在队列同事务、同连接解析并保存。validateSubmission在重放之前校验当前身份/来源并读取既有持久Run核验epoch，resolveExecutionConfig只为新Run捕获当前epoch。内部assertRunAdmission(runId,ownerUserId)读取实际持久Run、原manifest/提交指纹/owner及epoch，不接受调用者提供manifest作为权限；当前用户active与业务角色、会话归属应复核，逐工具当前Registry/policy权限仍b批。

事务约束：管理员变更在事务内重验当前active/admin，强制reason与乐观emergencyRevision，伪造actor/time/额外字段拒绝。提交与准入按既有Workflow根→排序Skill根锁定，与stop行锁串行化，无连接跨模型/MCP I/O；明确准入是有限边界检查，紧停不能撤回已经发出的I/O。若epoch/控制状态在准备后变化，事务内失败而不是返回混合绑定。并发stop先提交则新准入失败，准入先提交只代表该边界已获准，不构成可重用授权票据。

API（沿用原JWT/system:manage/实际admin）：GET /api/v1/skills/:skillId/emergency-control，POST .../emergency-stop 与 .../emergency-release；Workflow同样三条。POST仅{revision,reason}，revision是独立紧停revision；返回{code,message,data}内control与追加审计，无凭据/私有执行清单。普通停用API保持原含义；工作台/UI未接，本批不新增调用方可传入执行回调的接口。OpenAPI由parent同步精确字段、错误码与路由。

责任文件：根schema两处、新审计schema/index、0030 SQL/journal、emergency repository/controller及纯类型、两条现有路由、invocation事务接缝与必要module窄出口、真实PG/路由测试。父只维护脚本/文档/看板，不并改业务文件。实际代码测试/迁移diff目标720–880行，超过999先收敛或拆审查单元，不能以净增行数隐藏搬移量。

- [x] RED：真实JWT请求紧停缺口，401/普通用户403/admin成功及事务内旧admin撤权；reason/revision/actor/time校验，stop/release并发与revision冲突。
- [x] GREEN：增量schema/迁移默认值、根控制独立字段及追加不可变审计；仅测试库守卫落库，真实UPDATE/DELETE审计反例拒绝，普通版本内容与锁不变。
- [x] 真实PG新Run/同key重放/Workflow依赖紧停、解除后旧epoch拒绝、新显式提交准入；普通停用旧Run仍通过；错owner/坏manifest/伪造或缺失绑定失败。
- [x] 同事务创建与epoch保存、stop对提交/准入的锁竞争、当前用户禁用/业务角色变化及管理员降权，单连接路径证明不嵌套；无真实模型/工具调用。
- [x] 先独立规格再fresh五轴质量安全复核，父独立专项/模块/相关PG/双构建及契约检查；保留旧集成缺模板事实，回填README/对齐说明/OpenAPI/九页看板并精确本地提交，未合main/推送。

后续门槛：b批将准入与当前用户/能力/Registry/策略检查强制接到每次模型、工具执行前以及等待恢复，禁止无guard的默认生产路径；c批完成显式retry重新授权/epoch绑定与会话删除并发。现有retry复制旧epoch时仍失败关闭，不把新显式提交称现有重试按钮已改造。C2c.3写入幂等/跨调用预算、C2c.4统一视图、宿主生产接线与C3/D/MVP仍待完成。


**C2c.2a迁移与审查拆分：** C8守卫要求db:generate同时产出0030 SQL/journal/完整0030_snapshot.json，禁止手写/豁免快照。工具生成快照可能大于1000行，必须单列全量行数并按与0029的规范化语义差异核验（只允许根控制列及审计表/约束），不得隐藏为净增或混入无关schema变动。交付分schema/生成元数据与运行准入/API两组审查和本地提交；手写业务/测试/SQL实际diff仍受999行上限。先完整验证最终候选，再精确保存两个提交，不拆坏迁移链；不重写旧快照或弱化C8。


**C2c.2a开发中验证记录：** 真实JWT紧停请求首RED404与200不符后实现；队列/epoch最初18/22通过、prepare期间stop与release反例失败后补外部准备前捕获和入队事务复核。父独立规范化0030快照差异：仅两根各3列和1审计表，旧表其余完全一致，无移除，prevId链正确；生成文件git行数8823、wc换行8822。新增路由已加入modules和test:execution-emergency显式Node脚本，曾误写journal路径未执行，现正确路径及模块C8补验，不把遗漏项算通过。

首次modules907/910有3项失败：既有两处TRUNCATE清单漏新FK审计表、路由未登记；仅显式补新表和脚本引用，不CASCADE、不禁用trigger、不弱化守卫。随后一轮模块911/914，app-async-errors四断言通过却子进程115秒不退出（无TCP连接），仅终止该测试子进程并保留失败；另外两项原skills.execution短预算用例未进入预期阶段即读取signal而失败，不把负载猜测当确定根因。专用紧停套件42/42通过；隔离app自然退出4/4、10.9秒，无旧测试修改。一次无build并行的安静模块复跑另记，日志/tmp/wes-c2c2-final、/tmp/wes-c2c2-app-isolated。


**C2c.2a独立规格复核与隔离修正：** 独立紧停专项42/42、0skip，18项补充业务/安全检查通过（审计insert故障真实UPDATE回滚、约束、严格输入、trim及重复状态）；另1项探针实证并发modules中的旧仓储全表清理能把新HTTP夹具由200变404。接受P2，新增test-file-reference.drift隔离断言先RED3/4，路由文件迁入既有CI可达串行Harness、移出modules后GREEN4/4；规格独立复跑4/4，最终APPROVE。未加测试豁免、未禁用约束或更改旧timeout。父初始913+42均通过，修正隔离后的最终modules910/910（移出4路由+加1守卫），其他跨域回归继续串行；旧计数仅保留历史证据，不混称最终910等于少测。双构建exit0。


**C2c.2a跨域回归发现的旧夹具隔离修正：** 父按workflows→serial-store串行运行后，后者193/194，knowledge空表断言读到workflow-pool-reference-d2d84bc4-0c9d-4d24-9274-4073149623ce与workflow-authority-df27f635-6b0c-4c04-8af0-c1dd1d9f3e22两行。源码workflows.pool.test.ts两处insert只有关闭连接、无删除；本批业务实现不写knowledge。在原测试finally精确按生成id清理，失败路径也执行，保持max=1及原权限/连接断言不变。只在受守卫测试库移除这两条已核实旧夹具，再重跑相同workflows→serial-store顺序；不改空表断言、不补业务数据、不清其他记录。此测试卫生修正纳入本批独立规格/质量复核。


**C2c.2a夹具复验与看板表格证据：** 修正后父modules910/910、workflows17/17、紧接serial-store194/194均0skip，知识空表及降级断言通过，日志/tmp/wes-c2c2a-fixture-fix；旧193/194记录保留。RP-050仅下一步单元格更新，浏览器展开完整台账实读C实施中和逐次权限后续，截图/Users/kevin/.codex/visualizations/2026/11/02/01a19a18-92f8-7bf1-b70c-df3fd911608f/c2c2a-2026-11-03-board-requirements.png。原表格窄列/P2换行与大空列保留，不宣称视觉优化通过。


**C2c.2a最终回填（2026-11-03）：** 规格与fresh五轴质量安全复核均APPROVE。父最终模块910、Harness376、流程17、串行存储194、AI286通过，均0skip；独立专项42通过，API/Web双构建exit0，OpenAPI新增6路径/5schema引用解析通过。日志/tmp/wes-c2c2a-parent-final（含旧serial193/194失败）、/tmp/wes-c2c2a-fixture-fix（modules/workflows/serial最终复验）、/tmp/wes-c2c2a-quality、/tmp/wes-c2c2a-build-{api,web}.log。通用集成0/1仍templates_status_not_200，测试库活动模板与分配均0，不补造业务数据。npm audit仍45项基线（32moderate/12high/1critical），本批无依赖变化，不宣称安全基线已清零。历史RED/回归失败与隔离修正保留；受守卫实查旧两条夹具已由后续测试清理（本次精确清理实际删除0），仍以修正后workflow再次创建/清理、紧接serial空表断言通过为闭环。

管理员6条紧停/解除/读审计API及独立控制存储、提交与持久Run准入已实现；旧epoch不随解除复活，现有retry复制旧权限仍失败关闭。生产逐次调用权限检查（.2b）、显式retry授权与会话删除并发（.2c）、持久幂等/跨调用预算、统一视图、宿主及工作台/MVP后续。仅workload_eval_test迁移，3006/3004与模型配置未操作，本主线未合入/未推送；schema生成元数据和runtime/API分两组精确本地提交。九页总看板同步，构建/一致性和RP-050截图另记。


**C2c.2a复核与收尾证据：** fresh质量独立专项42/42、0skip及8项事务/安全探针通过，探针外层回滚后users/root/audit自身夹具均0残留，无DDL变化；规格及质量均APPROVE。schema组7文件含8823行完整生成快照，与runtime/API/tests/docs组21文件分别审查，后者最终diff低于999行。九页总看板新状态与后续门槛已同步，build及21页一致性0错0警；浏览器实读最终标题及RP-050下一步，临时页和自建3008服务已关闭，用户3006页未操作。

### C2c.2b 精细工单：逐次执行权限与恢复复核（2026-11-03）

用户“继续下一步”，基线1309fe9/codex/wes-skills-c；沿用已评审RP-050设计和.2a后续门槛，不新增需求或自动Loop。本单元实施必须默认生效的真实Run权限检查，接到每轮模型、每个Skill工具调用，以及Worker重新进入流程（含等待回答后的恢复）。继续留在既有隔离worktree，禁止读取/修改/扫描config/system/model-verify-status.json，禁止主库/预览操作、3006/3004重启或真实LLM/工具业务写入；无新DB迁移、无新增HTTP/UI。retry重新授权/会话删除并发留.2c，写确认/持久幂等/跨调用预算及生产宿主继续后续。

架构：新增skills/execution-authority.ts，默认依赖真实PG紧停准入、当前用户角色、当前工具Registry/生效策略。检查只绑定持久runId+ownerUserId+manifestHash及原stepId/toolName；调用者manifest/hash不是授权。每次先核验实际Run/session/user/epoch，再解析当前inventory，最后重新核验DB准入/当前身份，避免库存解析期间撤权/stop被忽略。无连接跨MCP/模型I/O。原生参数/来源/能力位/副作用契约必须与原快照相容；当前能力与原允许范围取交集，策略只做减法，不新增原白名单外工具；MCP当前人工角色名单必查。原普通停用不追溯旧Run，原epoch release不复活。

内部契约（具体名称可由实现方收敛，但语义和默认门禁不能改变）：
```ts
type ExecutionAction = { runId: string; ownerUserId: string; manifestHash: string;
  phase: 'model' | 'tool' | 'resume'; stepId?: string; toolName?: string };
interface ExecutionAuthority { check(action: ExecutionAction): Promise<void> }
// createExecutionAuthority(database?, inventory?) uses real persisted admission by default.
// SkillExecutionRequest adds trusted runId/ownerUserId; absent/incorrect context fails before any I/O.
```
权限检查结果不可保存为后续调用的通行证，服务端依赖注入仅供测试/可信装配，HTTP不可传checker/port。现有SkillExecutionService每轮模型请求前与prepare后再次检查（避免异步准备期间撤权），每个批内工具逐个重查；每轮重新验证原provider/model/endpoint/scope并取当前凭据，不复用失效模型配置。检查异常只映射固定安全错误码，取消/总预算覆盖异步检查，迟到的检查结果不能触发后续调用。

工具确认边界：模型可声明原允许工具，但执行时必须同时满足原绑定、原权限与当前capability/Registry/策略；原/当前requiresConfirmation或ask、写入、外发（包括MCP）均不得凭confirmation布尔值/参数hash/operationId通过。由于持久工具确认与幂等未接，本批这些实际执行保持失败关闭，不调用toolGate；原先无生产toolGate的默认行为继续关闭。本批可验证有明确可信端口的只读调用，但不把模拟端口当真实业务工具验收。

恢复边界：BusinessSkillsWorkflow在每次executeStep调用可信executor前强制用真实Run做resume权限检查，因此等待恢复/重启/旧CP同样受保护；default boot仍无生产executor，不开放业务入口。普通回答的已保存幂等回放不变，回答记录是业务数据而非工具授权。恢复检查在Worker重新执行前完成；不是声称等待回答写入事务已与外部策略存储原子化。若为此需要修改WaitService，必须保持max=1不嵌套连接、终态同答幂等与既有锁/租约语义；优先不改该服务。

责任文件：新增execution-authority.ts及对应真实PG测试；必要窄改execution-emergency.ts返回当前身份供内部使用、skills.module.ts出口；skills.execution.ts/.test.ts、skills.execution-model.ts（若需要每次complete刷新）及BusinessSkillsWorkflow.ts与其unit/PG/wait fixture测试。旧单元/有限等待夹具可显式注入可信checker，保留原语义断言，并必须另有真实默认PG检查覆盖，不能将新默认安全路径都mock掉。父负责package脚本引用、计划/README/对齐说明/OpenAPI说明及九页看板；实现方不改这些文件。手写代码+测试尽量≤800，达到900预警，超过999先拆，不以净增隐藏搬移。无新增生成快照。

- [x] RED：无run上下文/默认checker不可用时零模型准备、零工具调用；真实PG任务被禁用用户/角色能力撤销/停用根/stop+release/会话失效/错owner或manifest/step拒绝。记录失败原因而非仅编译错误。
- [x] GREEN：默认真实Run checker，原白名单∩当前Registry/能力/策略；模型每轮刷新，批内工具逐次检查，原/当前ask与写外发保持关闭；错误不泄露凭据。
- [x] 在模型准备中、第一工具之后、第一模型轮之后改变权限或停用，后续dispatch计数不增加；inventory期间变化必须被最后DB重验拦截，取消/超时后迟到checker不调模型/工具。
- [x] 等待回答后，重建Worker/service/checker恢复前再核实；紧停或撤权后零executor调用；原.2a/等待/预算/旧版本恢复语义保持。真实PG单连接守卫、归属/manifest不伪造；无真实外部模型/业务工具验收声明。
- [x] 规格APPROVE后fresh五轴质量安全复核；所有PG套件串行，modules期间不并行build。父独立专项/模块/Harness/AI/双构建，保留通用集成缺模板事实，文档/九页总看板回填，不合main/推送；本地提交在收尾实取记录。

方案自检：已批准方向中的逐次门禁与原清单交集可落实；不新增可选unchecked默认通道；等待恢复边界明确为Worker重入，不扩大成回答事务与外部MCP原子授权。新功能不改变原manifest shape/hash，也不补造真实业务或模型通过证据。


**C2c.2b原权限证据裁决：** 实读Workflow顶层tool contract有能力位/原生契约，但未保存原调用者V2角色集合（Skill子节点context.roles有）。本批不从businessRole发明第二套RBAC映射、不扩C1清单shape/hash；缺原角色证据的顶层tool执行及含该节点恢复保守拒绝，不能把capability元数据或hash当原授权。现无该生产宿主，不冒充直连Workflow工具已可执行；未来宿主/清单版本接入须补原权限证据后再开放。Skill子节点按原roles与当前权限交集继续实施。


**C2c.2b默认门禁与旧夹具调整：** 首轮modules发现workflows.runtime.test.ts及business-skills.boot.test.ts旧fake Run夹具不含真实持久权限绑定。纯状态机测试显式注入可信checker并保留原断言；boot不增加可绕过checker的装配开关，改验证默认真实门禁拒绝fake Run且executor计数0，固定身份/注册仍验证。正向executor路径保留在adapter与真实PG测试。新增两文件纳入本单元窄改责任范围，原失败日志/计数保留。


**C2c.2b开发证据：** 首RED缺Run请求原succeeded而期望failed（49中48pass/1fail，/tmp/wes-c2c2b-impl/red）。真实PG首轮7/7、0skip（check3），覆盖缺省service权限与fresh Worker回答后stop/revoke零executor。首modules926中924pass/2fail，确为boot和纯Harness两处旧fake夹具未带新门禁；按上条责任范围调整，不改生产boot装配，不弱化原预算/守卫。后续最终计数独立实取。


**C2c.2b单次执行身份边界裁决：** 真实PG新增prepare期间admin→user但businessRole不变且无工具的反例为10/11（原会继续complete，red-prepare-downgrade）。允许checker在一次execute/executeStep实例内记录首次成功身份摘要，后续任何身份变化保守拒绝；摘要仅作约束，每次仍查真实DB/库存，不是可复用grant。每次调用新建实例，同一service的不同合法Run不互相污染；不可将首次owner缓存于全局/service工厂或建无界Map。跨调用/Worker重建仍按原范围与当前权限重验，紧停epoch旧绑定规则保留。


**C2c.2b冻结与规格复核：** 实现方14个code/test文件gross519行（tracked155增46删+新318），modules931、紧停42、专项154均0fail/0skip，最后将late-hook测试无界while改为setImmediate后assert检查已进入并补66/66，fresh API build exit0（/tmp/wes-c2c2b-impl/regression-final及build-api-final.log）。规格方独立专项154/154、0skip后SPEC APPROVE（/tmp/wes-c2c2b-spec），未把实现方日志冒充本人复跑。父独立modules931/931已通过，质量/其他跨域检查继续进行；无真实模型/业务工具/工作台验收声明。


**C2c.2b测试数据边界（质量非阻断观察）：** 新真实PG套件沿用既有invocation模式，after清Run/session/user，随机Skill/Workflow根、版本与不可变紧停审计仍留在workload_eval_test；不宣称该suite或全库零残留。为保留审计不可删除约束，本批不关trigger、不改DDL或全表TRUNCATE来做选择性清理；受守卫modules清理链承担后续套件隔离。质量额外probe需外层事务回滚不留下自身新增数据。预览/主库无写入，这些随机测试夹具不作为业务验收数据。


**C2c.2b本机预览实查：** 交付前只读lsof检查3006/3004均无LISTEN记录（exit1/空输出）。本批未启动/重启或更新这两个预览，B代码基线保留；不将浏览器旧页面视为当前服务正在运行，也不宣称C批已部署到3006。


**C2c.2b看板表格回归：** RP-050保持C实施中，下一步已更新为重试授权/会话删除并发及幂等，浏览器展开完整台账实读通过。截图/Users/kevin/.codex/visualizations/2026/11/02/01a19a18-92f8-7bf1-b70c-df3fd911608f/c2c2b-2026-11-03-board-requirements.png；原窄列/P2换行与大空列保持，不宣称共享样式或视觉优化通过。


**C2c.2b最终回填（2026-11-03）：** 逐次默认真实checker及每次execute身份变化边界、模型发送前可信钩子/每complete配置凭据刷新、逐个工具交集核验及Worker恢复前检查已实现。父独立专项154、紧停42、模块931、Harness391、串行存储194、AI286及API/Web双构建通过，均0skip；规格与fresh五轴质量安全APPROVE。日志/tmp/wes-c2c2b-parent-final、/tmp/wes-c2c2b-spec、/tmp/wes-c2c2b-quality及/tmp/wes-c2c2b-build-{api,web}.log。通用集成0/1仍templates_status_not_200，活动模板/分配缺失，不补造业务数据；npm audit仍45项既有风险（32moderate/12high/1critical），未改依赖，不冒充风险清零。两份RED、首modules旧夹具2失败、TS中间失败保留；最终不是从报告推导计数。

本批未改WaitService回答事务或boot的生产装配开关，旧终态同答幂等保留；Worker重新进入executor才是恢复检查边界，非跨MCP原子授权。Workflow顶层tool原角色证据、持久工具确认和幂等未接前均保守拒绝；不把布尔确认或hash当grant。无新HTTP/UI/DB迁移/真实LLM或业务工具验收，3006/3004及用户模型状态文件未操作，主线未合入/未推送。下一步C2c.2c显式retry重新授权与会话删除并发保护，再做持久确认/幂等/跨调用预算、统一视图、生产宿主/C3/D。


**C2c.2b收尾证据：** fresh五轴质量安全独立154/154、纯测125/125、0skip后APPROVE，无新增阻断finding；根/audit测试保留披露，未声称零残留。父最终计数与两份OpenAPI六控制路径解析核验通过；九页总看板build/21页一致性0错0警，浏览器实读最终标题、C实施中及后续门槛。自建3008服务和临时看板页已关闭；3006/3004未启动、未更新。质量文档快核指出的预览状态与中间review进行中文字已收口；源代码未改。

### C2c.2c 精细工单：手动重试重新授权与会话删除并发（2026-11-03）

用户“继续”，基线b5ff77f/codex/wes-skills-c，继续已评审RP-050范围。实现两条相连保护：原任务failed后明确手动重试时保留原版本/输入/来源及重试血缘，重新核验当前权限并同事务保存新epoch；会话删除与生产提交/重试共用行锁，消除先查后删窗口。旧普通对话链路保留；业务Skill公开retry不提前开放，内部专用手动命令与通用HTTP路径隔离。无DB迁移、无新UI/业务启动入口、无真实LLM/业务工具调用，不启动或改3006/3004，不读/改/扫描config/system/model-verify-status.json及凭据。只写guarded workload_eval_test；本地保存、不合main/推送。

语义裁决：重试是新Run（仅failed），原Run/manifest/CP/output原样保留；新Run固定原manifest而不是重解析latest，checkpoint/已确认布尔值不复制，conversationFact及消息身份重新mint。因为它是显式新启动，当前根enabled且非archived，原固定版本仍为已发布可引用版本；当前紧停一律拒绝。解除后可由新的明确手动命令捕获新epoch，但旧Run绑定永不重写。缺失/伪造旧绑定、原清单/指纹/owner/session不符、无效状态或当前用户/角色/工具权限不符均失败关闭；普通停用仍不影响已入队原Run，但新retry不得绕过停用。

内部命令建议（名字可收敛，不接受客户端执行配置或grant）：
```ts
// Service-only; no public business retry HTTP channel is opened.
retryInvocation(user: AuthUser, sourceRunId: string,
  body: { submissionKey: string; reason: string }): Promise<AiRunsSubmitResult>;
// key 1..160; trimmed reason 1..1000; unknown fields rejected.
```
真正的执行依据来自实际持久failed Run。服务先读取并验证原Run与旧epoch绑定结构，记录当前身份/根epoch基线，再在事务外解析当前工具Registry/策略和模型配置可用性（只预检，不请求LLM）；当前用户权限、原角色/白名单与原/现策略交集复用.2b规则，直接Workflow工具缺原V2角色证据仍拒绝，写外发/确认工具不因retry获得执行grant。来源至少重新验证会话归属及原来源ID可访问，输入/资料正文保持原快照，不更新为latest内容。原模型provider/model/scope/endpoint身份必须仍可用；预检不冒充供应商认证健康或真实执行证据。服务端可信测试端口可注入库存/模型准备，默认真实权限/DB路径必须可实测，HTTP不能传端口。

在队列已有同事务回调内重新读取原failed Run、当前身份、当前根可用性/固定版本与epoch；与准备基线不符（含prepare期间stop+release或降权）整笔回滚。新Run/config/epoch/metadata（retryOf/actor/reason）及run_queued/user-message同事务落库，无数据库连接跨MCP/模型准备。重复submissionKey同一retry意图只返回原新Run，不追加消息/事件，不刷新旧epoch；换父Run/会话/原输入或reason等意图冲突拒绝，不能与原提交key或普通chat混淆。并发不同key同Session仍由既有活动唯一约束保证至多一个活动Run；原Run必须保持不变，未完成持久写幂等前仍不开放实际写/外发工具。

公开门槛：现有POST /ai-runs/:id/retry对business_skills_v1必须返回409 BUSINESS_SKILLS_RETRY_CHANNEL_REQUIRED（或等价固定码），不能继续无脑复制executionConfig。普通chat retry维持既有API形状/新消息信封与血缘，同时必须在创建事务核验当前Session归属/存在，不能在删除后制造孤儿Run；错owner/不存在保持404。内部业务重试验收不等于公开业务入口已可用。

删除保护：AiSessions PG repository在同一事务SELECT owner Session FOR UPDATE → SELECT真实active Run → DELETE；非owner/无Session先返回false，不泄漏Run存在性。active状态复用HARNESS_RUN_ACTIVE_STATUSES全部5项（queued/running/waiting/recovering/cancelling），不能硬写4项或锁Run后再锁Session形成反向依赖。存在active抛稳定store code，经usecase转原409 SESSION_HAS_ACTIVE_RUN。外部可选checker只可更早拒绝，false/未注入不能绕过仓储真实检查；无active仍保持boolean返回。所有生产会话提交/普通retry在createQueuedRun同tx回调内SELECT owner Session FOR SHARE；业务submit已有source.verify的SHARE，业务retry同样要有。低层队列可供既有内部/测试无绑定夹具使用，但已注册生产usecase不得遗漏真实Session事务回调，也不能接受客户端覆盖它。推荐在ai-sessions仓储提供窄的lockOwnedSessionForRun(tx,owner,id)内部出口、usecase默认调用；不引入可由请求传入的绕过选项。锁顺序和阻塞由真实PG latches+pg_stat_activity证明，不用sleep猜锁。

责任文件：新增skills/skills.retry.ts及真实PG测试；必要小改execution-emergency.ts（严格failed专用读取/新epoch捕获，不能给普通admission放宽模式参数）、execution-authority.ts（提取/复用原/现交集校验）、skills.module.ts；harness-runtime.usecase.ts（关闭generic business retry、普通submit/retry事务Session校验）、必要repo输入type/错误allowlist或精确重放意图区分；ai-sessions PG repo/usecase/module及小型锁helper、API controller错误映射（若需要）；对应module/route/PG回归。父负责package、README/OpenAPI/对齐说明、计划与九页看板。实现方不改这些父文件，不stage/commit；新测试文件及时报父登记CI，不能用测试豁免。手写code/tests目标≤800，900预警，达到999前先报告拆分，不以净增隐藏移动。无关已有dirty保留。

- [x] RED：普通business retry当前会复制旧绑定、失败任务跨紧停解除仍旧epoch；DELETE先查后删与同时入队的真实PG反例，日志保存实际错误/计数。
- [x] GREEN：内部严格手动retry，当前权限/模型预检与原版本输入固定，新epoch同队列事务，旧Run/旧epoch/CP/确认记录不变；generic public business retry关闭，普通对话重试不回归。
- [x] 重试同key幂等/冲突、不同key竞争、错owner/坏绑定/Session删除/模型工具失效/根停用/prepare中撤权或stop+release/事务故障回滚，确认新Run首消息与血缘，不运行LLM或真实业务工具。
- [x] DELETE与submit、business submit、retry、等待回答/Worker恢复的确定性并发：入队先提交则DELETE409；删除先提交则入队404/安全拒绝；拒绝的请求零孤儿Run/消息/事件，跨owner404，所有5 active态保护，单连接不嵌套；false或缺checker不绕过。
- [x] SPEC通过后fresh五轴质量安全复核，父独立专项/模块/Harness/存储/AI与双构建；保留通用集成缺模板与审计45基线，回填契约/九页看板，本地提交事实单独实取，不提前称生产宿主/公开业务/MVP已验收。

方案自检：默认业务执行仍经.2b每次检查；手动retry仅新建并绑定当前权限，不扩大原工具范围/版本/输入，不复制旧确认或产物。删除是实际DB事务保护，外层checker不构成原子性证明。当前生产入口逐一登记Session SHARE检查，避免只补business路径而漏普通chat。


**C2c.2c首RED：** 两项真实PG反例0/2：公开generic business retry仍复制旧授权；DELETE在business submit的Session SHARE锁后等待，但入队提交后仍删除Session。日志/tmp/wes-c2c2c-impl/red，父实读断言失败记录。新skills.retry.persistence.test.ts登记CI可达串行Harness，并新增test:execution-retry显式五文件回归，不以未引用测试充当验证。


**C2c.2c开发验证：** 扩展真实PG首轮14/14、0skip（/tmp/wes-c2c2c-impl/green-more），包括已注册router真实JWT的business retry409与DELETE flag开/关映射、false checker不能绕过DB；内部retry当前权限与新epoch、旧Run不改及事务锁路径已具备。继续补same-key在普通disabled/archived后的合法重放、四入口DELETE双顺序真实锁等待与draft固定版本反例；该阶段不先宣布最终复核通过。


**C2c.2c验证命令纠正：** 实现方曾主动中断一次未完成的默认modules运行，并临时尝试注入--test-concurrency=1。父明确拒绝以改并发配置替代在役CI命令；两次中断日志均保留，不计作通过。随后未修改命令的test:modules完成931/931、0skip（/tmp/wes-c2c2c-impl/modules-default）。PG串行约束指不同套件/执行者间互斥，并不改写modules内部既有并发配置。旧ai-runs路由首次38/39，唯一失败为随机未落库Session夹具被新事务校验正确拒绝，窄改为真实makeSession，不改生产门禁/原断言；中间API编译类型错误也保留，最终计数待冻结复验。


**C2c.2c规格覆盖补齐：** 首次冻结10个代码/测试文件gross620，新增22项真实PG测试，原命令modules931、专项95、路由39及API构建通过；fresh规格独立专项95/95、0skip（/tmp/wes-c2c2c-spec）且静态未发现功能偏差。规格方指出第四项“等待回答/Worker恢复与删除”只有全部5态保护和旧等待恢复回归，尚无独立确定性竞态。父不以理论等价勾选，要求补真实WaitService.answer和fresh Worker重入与真实仓储DELETE的Session锁门闩测试，无生产代码或授权绕过。该项补测及最终规格结论仍待收口。


**C2c.2c等待/恢复实并发补测：** 仅测试新增两项，冻结gross726。真实answer走原生tx.execute锁Run而非select.for；首版门闩匹配错误的挂起运行已停止并保留/wait-delete，属于夹具错误，不计业务RED。修正后通过PgDialect匹配真实Run FOR UPDATE已完成再暂停，独立SHARE探针和pg_blocking_pids证明确持锁；DELETE仍409且不反向等待Run。另一条真实DELETE持Session UPDATE时fresh Worker被实锁阻塞，DELETE409后Worker依原答案完成，答案事件仅一条、终态同答仍幂等。门闩进入有5秒界限，finally释放。24/24、0skip及API build通过（/tmp/wes-c2c2c-impl/wait-delete-corrected、build-api-wait-final.log），生产零新增改动；最终独立复验随后收口。


**C2c.2c父首轮回归与诊断：** 原默认modules929/931，两项未改动旧夹具分别50ms CPU超时在case入列前耗尽、30ms取消用例先被总超时抢先；已核对相关测试和生产evaluation/execution文件相对基线无diff，不更改默认并发参数。随后重试96/97、逐次权限144/154、Harness409/415，真实测试库仅元数据查询定位到本次被中止wait-delete夹具43个Run及其事件，Worker误领遗留任务且恢复扫描多出2项，旧全局CHECK注入亦被遗留run_queued事件阻断。证据/tmp/wes-c2c2c-aborted-fixture-before.json；待当前runner正常完成其afterhooks后，只补执行该中止夹具原after清理（精确owner+随机username+43条数+workload_eval_test双护栏），不清无关数据/根/不可变审计，不改DDL使测试变绿。所有首轮日志保留/tmp/wes-c2c2c-parent-final，受影响套件另存parent-recheck复验。


**C2c.2c残留核实与质量发现：** 父首轮正常运行至存储194/194、AI286/286通过，通用集成仍0/1模板缺口。后续套件正常结束后，精确中止夹具owner的Run/Session/user均实查0；原计划额外清理的43条数护栏发现已变化而整事务回滚，没有提交任何额外手工删除。证据/tmp/wes-c2c2c-aborted-fixture-precleanup.json及cleanup.json；不将根/审计残留和中止任务残留混为一谈。fresh质量静态发现有效大写UUID重复重试会在PG返回小写parent后误判意图冲突，且影响普通停用后的合法重放；质量REQUEST CHANGES。仅同批内部命令边界新增真实PG反例后统一UUID规范，规格/质量对该小修复复核，受影响四套件重新原命令运行，不以报告替代验证。


**C2c.2c UUID修复复核：** 真实PG新反例25中24pass/1fail，失败为首次uppercase成功后同uppercase重放SUBMISSION_KEY_CONFLICT（/tmp/wes-c2c2c-impl/uuid-red）；仅校验通过后sourceRunId统一小写一行修复，GREEN25/25、0skip及API build通过（uuid-green、build-api-uuid-final.log）。规格独立25/25、0skip后PATCH APPROVE（/tmp/wes-c2c2c-spec-uuid），未扩大业务权限/输入范围。质量提出随机UUID字母夹具while的非阻断维护点，已改为总≤8次并明确assert，所有业务断言不变；最终gross747，父四套件和质量独立测试覆盖该最终夹具。父原默认modules已931/931、重试98/98、逐次权限154/154通过，完整Harness继续实取，首轮失败不覆盖。


**C2c.2c最终回填：** 内部手动重试已保留原版本和输入并重新授权；会话删除与提交、重试及等待恢复的并发保护通过。公开业务重试、生产宿主和工作台仍待后续。父独立重试98、逐次权限154、紧停42、模块931、Harness416、存储194、AI286及双构建通过，均0skip。规格先审后fresh五轴质量安全APPROVE；新增等待回答/Worker并发证据单独复核，未以全5态理论等价替代。原RED0/2、路由38/39随机Session夹具失败、编译中间失败、门闩夹具挂起及中止日志均保留。父首modules929/931两旧计时用例失败，首重试96/97、逐次权限144/154及Harness409/415受挂起测试遗留任务干扰；后续正常套件结束后精确实查本次中止fixture为0，再以原命令复验，日志不覆盖。默认modules命令未改并发配置。通用集成0/1缺模板、audit45、测试根/审计残留与未更新预览如上，均不冒充已清零或业务验收。OpenAPI只更新原3路径/冲突码，不公开内部命令请求体。九页总看板同步，RP-050仍C实施中；sources无新文档资产、无需增计数。下一步完成持久工具确认、写入幂等与跨调用预算（C2c.3），再接统一视图、生产宿主、工作台及D验收。本地提交与看板目视证据在收尾后实取补记。


**C2c.2c最终独立实取：** 父原命令复验931/98/154/416四套件全部exit0、0fail/0skip（/tmp/wes-c2c2c-parent-recheck），紧停42/存储194/AI286先前无关路径绿色结果保留；最终API/Web构建均exit0（/tmp/wes-c2c2c-build-{api,web}.log）。fresh质量独立PG25及权限/执行/评估/模型/Workflow纯测216均exit0、0skip后五轴安全APPROVE（/tmp/wes-c2c2c-quality-final-pg、-pure），UUID P2已关闭。通用集成实取templates_status_not_200，活动模板及分配均0；audit45既有风险保留。交付前再次lsof，3006/3004仍无LISTEN，本批未操作预览。九页看板与契约已收口，目视与实际提交信息随后登记。


**C2c.2c看板与文档快核：** 九页同步后board build及21页一致性校验0错0警，浏览器展开完整台账实读RP-050仍C实施中、下一步持久确认/幂等/预算；截图/Users/kevin/.codex/visualizations/2026/11/02/01a19a18-92f8-7bf1-b70c-df3fd911608f/c2c2c-2026-11-03-board-requirements.png。原窄列/P2换行及大空列保持，未改共享CSS。fresh文档快核指出event原parent-final指针不应配最终绿色计数，已改为首轮真实失败与无关绿色计数；最终四项绿色另指parent-recheck，避免把失败目录当通过证据。OpenAPI三条现有路径无私有retry请求体。


**C2c.2c收尾检查：** fresh文档快核修正证据目录后DOC APPROVE；两份OpenAPI与event解析通过，三条既有受保护路径及9页映射一致，无内部retry请求体外露。自建3008服务和临时看板页已关闭，用户3006页未操作。暂存仅本批16个文件（最终代码/测试gross747，总变更约930行），原模型状态文件未读取或暂存；实际本地提交号在提交后单独实取回填主看板，不伪造自引用。


### C2c.3 分批与 C2c.3a 精细工单：待确认操作持久登记与稳定重试身份（2026-11-03）

用户“继续下一步”，基线8dba8a7/codex/wes-skills-c。沿用已评审设计§8及C2工单的稳定步骤幂等/确认/累计预算范围，不重开产品审批。使用writing-plans把大项分为独立可验收单元：3a待确认操作登记及重试稳定身份；3b持久确认决策/当前内容与权限绑定；3c明确本地工具的同事务写入幂等，远端不确定结果人工核对；3d跨调用累计预算及宿主强制接线。每单元目标500–850手写行、999前拆分，C2c.3整体不随3a关闭。前置方案已获用户评审并多次授权继续，拆批是实现粒度，不新增业务范围。

选择复用Harness现有harness_tool_events及(rootRunId,effectKey)唯一约束，记录eventType=business_operation_prepared/status=pending；不新增表或迁移，不依赖内存Set，不把Worker“执行后记账”当同事务业务幂等。登记行绑定原始业务Run，另存首次发起runId；不更新原Run行、事件序号、检查点或产物。原Run链缺失则安全拒绝，不能重建一个新身份洗掉历史。该登记只表达待确认意图，不表达工具执行、用户批准或可复用grant。3a无confirm/execute入口，不松开.2b写/外发/MCP门禁，无新业务HTTP/UI/生产boot，无LLM或真实业务工具调用；3006/3004、主库/预览库和凭据不动，config/system/model-verify-status.json禁止读/扫描/写/暂存；保留其原dirty。只写guarded workload_eval_test、本地保存不合main/推送。

本单元只支持根Skill（manifest.kind=skill）的原生工具意图；Workflow直接工具缺原V2角色证据仍拒绝，流程内Skill的实际发生位置绑定和接线留后续宿主。接口只供服务端可信装配，位置ordinal由执行器给出，不接受模型callId、operationKey、manifest、approved等客户端凭据或派生定义；本单元不把ordinal当授权证明，也不对外暴露该命令。

```ts
// apps/api/src/modules/skills/skills.operations.ts
createSkillOperationService(options?: { database?: Database; inventory?: typeof resolveCurrentSkillTools });
// AuthUser来自服务端登录上下文，真实身份仍从DB复核。
prepareOperation(user: AuthUser, body: {
  runId: string; stepId: string; ordinal: number; toolName: string; parameters: unknown;
}): Promise<{ operationId: string; operationKey: string; payloadHash: string; rootRunId: string; status: 'pending' }>;
// ordinal 0..59：同一根Skill执行中的工具逻辑位置，非累计预算也非模型callId。
```

输入与权限：body只允许上述五字段，run UUID先校验并规范小写；step/tool有界非空，ordinal整数0..59，parameters沿copyTrialJson安全JSON/1MiB/32层约束。实际persisted owned active业务Run是唯一依据，必须有有效manifest/指纹/精确epoch绑定、Session归属/可用、当前用户与业务角色。stepId须等于唯一根Skill步骤，tool须原白名单与snapshot绑定，原native Schema校验成功且parameters完全等于由冻结initialInput按原binding.inputMapping生成的参数；不能仅凭hash或自行声明参数。只有写/外发/MCP或原绑定/策略需确认的工具才登记；普通无需确认的只读动作拒绝登记。当前Registry/capability/原角色/原现策略交集复用validateFrozenExecutionTools的resume语义（仅允许意图准备，不给实际工具调用授权），保留未知工具、契约变化、禁用、降权等失败关闭。

事务边界：先用真实默认Run准入取得before manifest/identity，事务外通过prepareSkillAuthority包裹库存解析并校验，期间不占连接。最终短事务复用同tx的默认准入检查（新增narrow assertRunAdmissionInTransaction，不暴露放宽epoch或状态的选项），复查before identity/hash并verify配置fence；无嵌套连接。准备期间stop+release/撤权/会话失效或配置变化都拒绝，零半行。默认authority不能由body或可选checker替换。当前工具库存外部变化仍由将来每次真正dispatch重查，本单元不宣称DB与MCP原子授权。

稳定身份：从当前真实Run沿retryOfRunId读取至原Run，最多64个节点，cycle/缺父/跨owner/session/非business adapter/不同完整manifestHash或invocationFingerprint/非failed祖先/坏旧epoch绑定结构都拒绝。所有祖先由服务端readBusinessSkillsRun和共享绑定结构校验器核实；旧epoch可不同（显式retry已重新授权），但不能缺失或多根/坏形状。祖先正常停用不改变已入队语义；当前Run仍必须通过当前epoch与权限校验。各Run FOR SHARE防删除，不升级root UPDATE，避免双请求SHARE升级死锁。操作key=hash({schemaVersion:1,rootRunId,stepId,ordinal})加独立business-op:v1:前缀；toolName/参数/版本等进入payloadHash，不进入位置key，确保同位置改工具/改内容报冲突而非再造一次动作。payloadHash绑定完整manifestHash、目标Skill/version/hash、step/ordinal、toolName、原binding/native/policy及规范参数。不可从模型callId或新retryRunId生成位置key。

登记：harnessToolEvents.harnessRunId=rootRunId，effectKey=operationKey，actionId=operationKey，toolName真实原名，input保存严格schemaVersion1意图（包含rootRunId、首次sourceRunId、manifestHash、step/ordinal、参数与payloadHash等），output/error/resolvedAt空，状态仅pending。依现有唯一约束ON CONFLICT返回同一登记；同key不同payload、误撞legacy effect、状态/内容/绑定被改坏都409安全拒绝，不覆盖或伪装已执行。existing行须按严格schema与原manifest完整重验，不只对比其中一个hash；重复与并发不追加额外Run事件/模型记录/工具effects。当前运行的权限即使重放仍核实；新retry跨紧停解除可以在新epoch准备同一pending意图，但旧Run不能恢复授权，登记不是审批记录。

责任：新skills.operations.ts、skills.operations.persistence.test.ts（可按职责拆小型纯helper/test但先登记CI）；窄改execution-emergency.ts提取共享epoch绑定形状校验和同tx准入，既有准入默认行为/错误保持；skills.module.ts出口；若复用readBusinessSkillsRun需harness.module.ts仅窄导出，验证无barrel初始化回归。不改skills.execution工具门禁、skills.retry既有重试语义、Worker生产装配、schema或业务写仓储。父负责package CI引用/专项、README/对齐说明/本计划与九页看板；实现方不stage/commit。现有根/不可变审计测试夹具按原边界保留，Run/Session/user after清理；若中断需核实专属夹具不再活动后再跑全局Worker测试，不全表truncate改绿。

- [x] RED：重复/重建service/手动retry同逻辑位置没有稳定持久登记的反例，保存真实失败，不以编译错误代替行为RED。
- [x] GREEN：默认真实Run/owner/Session/epoch与原现工具权限核验，冻结参数校验，稳定root+slot key及唯一pending行，读回深拷贝，登记非执行/批准；单连接无嵌套。
- [x] 实PG：同连接/独立连接并发同位置同payload只一行，真锁门闩+pg_stat_activity证明等待；改工具/内容冲突，legacy撞key/坏ledger行、祖先缺失/循环/跨归属/不同清单和坏绑定、UUID大小写均拒绝或同意图重放；不复制新位置洗历史。
- [x] 时序：prepare库存期间禁用用户/角色变化/stop+release/配置变化/会话失效拒绝；旧Run拒绝、新显式retry准备同pending；故障回滚无行，原Run/CP/output/eventSequence不变，模型/真实工具dispatch计数0。
- [x] 先SPEC后fresh五轴质量安全复核，父独立专项/原modules/Harness/AI及API/Web构建；仅新服务相关源码/测试变更后扩大必要检查，保留通用集成缺模板与audit45事实。更新契约说明但无新HTTP body、九页总看板和本地提交实取，3a完成不冒充本地写幂等/持久确认/累计预算或MVP完成。

自检：此分解复用现有表/唯一约束，不引第二执行系统；已发布内容和Run记录保持，位置key不依赖模型的不稳定callId；外部I/O与DB短事务分离。登记行只待确认，真正批准/执行仍有后续强制门槛，因此没有以内部待办行开放业务写工具。公开业务retry、生产宿主/C3/D继续未开放。


**C2c.3a血缘完整性补充（实现前/早期收敛）：** root的retryOfRunId为空时不得保留retryRequestHash/retryActorId/retryReason；每条真实retry边同时核对.2c metadata：actor等于owner、trimmed reason1..1000、retryRequestHash=hash({sourceRunId:canonicalParentId,sessionId,fingerprint:invocationFingerprint,reason})。防止仅改parent到另一同清单/同输入根或清空parent洗掉原操作身份。旧缺证据链保守拒绝，不升级为新根；有效链用真实.2c内部retry构造，哈希仍是完整性校验而非授权。首RED0/2为真实PG重复/重试身份与缺持久登记失败，非编译或导入错误（/tmp/wes-c2c3a-impl/red）；父基线154/154、0skip已完成。


**C2c.3a开发冻结证据：** 首RED0/2（重复/重建/跨retry身份），血缘清空parent反例15/16，再补composed payload反例22/24（超限未拒绝+MCP夹具遗漏ADMIN手动allow被既有权限正确拒绝）。前者加完整意图safeJSON边界、后者仅补测试真实授权元数据，未松实际工具门禁。最终新PG25/25、0skip且after核实专属Run/Session/user0（/tmp/wes-c2c3a-impl/target-compat-final）；原默认modules931/931、0skip后API首编译暴露Object.hasOwn不在目标lib及fixture状态字面量类型，已等价ownproperty兼容写法+asconst修正，最终buildexit0（build-api-final.log），失败日志保留。代码/测试gross583，父最终原modules会覆盖最后等价表达式。

登记payloadHash特意不含首次sourceRunId以维持重试稳定性，source须是相同实际owner/session/完整清单/血缘根的规范UUID。它是审计线索，不能单靠DB行证明哪一个合法同根sibling最先写入，也不是授权grant；无额外不可变来源锚点，不承诺防数据库管理者整体篡改。实际首次source只在INSERT写一次，合法重放不覆写；其他根、假source或结构损坏均拒绝。当前audit仍45既有风险（32moderate/12high/1critical），依赖未变。


**C2c.3a父回归中的测试选行修正：** 父默认modules931/931、0skip；登记专项首110/111，唯一失败为测试先创建ordinal0及59后，以无ORDERBY查询首行当作ordinal0，实际读到59。生产稳定key无新偏差；规格和fresh质量均静态确认，应按operationId选择并assert存在、明确校验ordinal0。为避免同一命令中途换候选，待当前Harness/AI/集成正常结束再窄改测试并单独复验，首日志/tmp/wes-c2c3a-parent-final保留；完整Harness随后已441/441、0skip，其他测试after均正常清理，不需要额外手工清库。


**C2c.3a最终回填：** 待确认操作现已持久登记：重复准备、服务重建及明确手动重试沿用同一逻辑身份，同位置变更内容报冲突。登记仍是pending意图，批准和真实工具执行继续后续。父独立登记专项111、模块931、Harness441、AI286及API/Web双构建通过，均0skip。规格历史25/25和修正后静态复核通过、fresh质量PG25/纯测155均0skip后APPROVE。首RED0/2、血缘RED15/16、组合边界RED22/24含MCP夹具遗漏手动allow、首API编译目标lib/状态字面量类型失败，以及父首专项110/111无序行选择失败均保留，不以改并发或弱化断言改绿。最终按operationId精确检查ordinal0，生产源码未因夹具问题调整。通用集成0/1缺模板，audit45基线保留；Run/Session/userafter0，不宣称根/审计清空。无新文档资产，sources计数不变；九页总看板同步，RP-050保持C实施中，C2c.3整体及MVP未关闭。下一步绑定持久确认决定与当前参数/权限（C2c.3b），随后完成本地同事务写幂等和跨调用预算（3c/3d）、统一视图、生产宿主和工作台。本地提交/浏览器目视在收尾实取补记。


**C2c.3a收尾实查：** 最终代码/测试gross586（5文件），无新schema或迁移。父最后模块931/专项111（parent-recheck）、Harness441/AI286（parent-final）均0skip，API/Web实际exit0，fresh质量PG25/纯测155覆盖最终PK选行夹具后APPROVE。新event回归证据ref已补实际build-api/web日志，避免只指向套件目录却包含构建结论；文档范围、历史SPEC25+静态复核及最终质量证据区分保留。九页board build和21页一致性0错0警，浏览器实读RP-050仍C实施中及后续确认/写幂等/预算；截图/Users/kevin/.codex/visualizations/2026/11/02/01a19a18-92f8-7bf1-b70c-df3fd911608f/c2c3a-2026-11-03-board-requirements.png。原窄列/P2换行与大空列不改，不宣称视觉优化。


**C2c.3a预览与提交边界：** 自建3008看板服务及临时tab已关闭，未操作用户3006页；交付前lsof3006/3004均无LISTEN，本批未启动或更新预览。仅本批文件精确暂存，原模型状态文件仅dirty状态保留、不读/不扫描/不暂存；本地提交后另将实际sha回填主看板，未合主线/推送。


### C2c.3b 精细工单：持久确认决定与当前内容/权限绑定（2026-11-03）

用户“继续”，基线d490238/codex/wes-skills-c。按已批准设计§8及3a拆分实施3b：读取可供人工复核的当前操作内容与确认摘要，明确approve/reject命令持久保存为单独事实；同一有效上下文重复决定幂等、相反决定冲突，重试/撤权/策略变化不得复用旧确认。原pending意图行保持pending不覆写。确认事实本身仍不是可复用执行grant；实际本地写幂等/原子消费属3c，累计预算属3d，宿主/工作台/UI继续后续。不要求用户重审已批准方向，当前是内部实现细化。使用既有隔离worktree与先RED/后GREEN/规格后fresh质量工作法。

不新增schema/迁移/依赖/HTTP/UI/生产boot，不动.2b实际写/外发/MCP/user-confirm dispatch门禁、不改旧WaitService终态同答幂等。禁止读取/扫描/修改/暂存config/system/model-verify-status.json、任何真实凭据、主库/预览库，不启动或更新3006/3004。只用guarded workload_eval_test；本地保存，不合main/推送。旧通用业务retry仍409，不能用确认服务开放它。

接口（独立factory，保留3a service仅prepareOperation的既有表面）：
```ts
// apps/api/src/modules/skills/skills.operation-decisions.ts
createSkillOperationDecisionService(options?: { database?: Database; inventory?: typeof resolveCurrentSkillTools });
readForConfirmation(user: AuthUser, body: { runId: string; operationId: string }): Promise<ConfirmationView>;
decideOperation(user: AuthUser, body: {
  runId: string; operationId: string; confirmationHash: string; decision: 'approve' | 'reject';
}): Promise<ConfirmationView>;
// View包含实际runId/operationId/rootRunId/payloadHash/confirmationHash/toolName/parameters；
// status只为pending|approved|rejected；有已保存决定才含decisionId/decision。
// 不返回权限快照、配置行、凭据digest或任何可执行回调/授权票据。
```

严格边界：read只允许runId/operationId，decide只允许上列4字段；拒绝approved/parameters/owner/manifest/epoch/key等额外字段及坏JSON。UUID/十六进制摘要先校验并规范小写，decision字面量严格。AuthUser来自服务端登录上下文，真实owner/用户状态/角色/业务角色必须从DB核实，不能只信token快照。两方法默认真实权限，不能用客户端checker或grant替换。只支持3a实际登记的根Skill；未知/外来operation同404，无意图时不创建它；旧ledger误撞、坏状态/内容/来源/指纹/血缘都拒绝。

复用3a完整意图校验：窄提取readPreparedOperationInTransaction（名字可等价），从当前真实Run沿原64节点、same owner/session/manifest/fingerprint/.2c metadata血缘找到root后读精确operationId+root行，按原Schema/映射重新计算key/payloadHash并严格核对整行及source同根来源。仅抽取数据读取/核验，不新增放宽准入模式；3a prepare的API/存储/错误语义保持。不要在read或decide中调用会INSERT的prepare来“读取”，也不能只凭传来的operationId/hash认定授权。full composed/stored JSON沿1MiB/32层与危险字段规则，返回parameters为独立拷贝。

确认上下文：实际当前Run/owner/session、原operationId/root/key、manifestHash/payloadHash、当前Run的精确executionAuthority绑定（非祖先旧epoch）、当前DB身份，以及原/现工具交集核验后的当前原生契约/capability/source/sandboxReadSafe/MCP人工allow角色/有效toolPolicy摘要均进入确认basis。MCP/toolPolicy配置的非敏感revision戳也绑定：按configKey排序选择system_configs的configKey/version/updatedAt/effectiveAt（仅toolPolicy/mcpConfig，缺行显式表示）；不读取/暴露秘密字段生成客户端摘要，不用全credential digest充当凭据。confirmationHash=hash(严格schemaVersion1 basis)，只作乐观内容/权限版本匹配，绝不是安全token。basis内可存这些非敏感快照或单项摘要，禁止原凭据/模型密钥。用户/策略配置经既有写入路径变更戳，旧hash失效；不承诺防数据库管理者同时伪造配置元数据或远端MCP行为。

时序：短tx先真实默认admission+精确pending读取+配置revision戳，释放连接；外部inventory用prepareSkillAuthority包裹、validateFrozenExecutionTools的resume交集及仍需确认条件，与3a一致；最终短tx重新真实admission/意图/配置戳并verify配置fence，与before的内容/身份/绑定一致后才返回view或保存决定。DB连接不跨外部I/O，不嵌套（max1实际测试）。正常Run queued→running等仍active变化不应让同内容摘要每次变；不把now/eventSequence/临时模型callId放摘要。撤权、取消/终态、会话归档/删除、紧停或stop+release、配置/契约变化都安全拒绝或需新hash，零决定半行。普通enabled停用仍沿旧Run语义，不作紧停；新的明确retry即使复用同一pending行，因新Run/epoch而需新确认，旧决定只保留历史。当前调用始终真实有效才允许幂等回放；已失效/terminal/revoked请求拒绝不删旧事实，旧WaitService末态同答行为不受影响。

持久化复用harness_tool_events及(rootRunId,effectKey)唯一约束，独立eventType=business_operation_decision，status=approved|rejected；harnessRunId仍root，toolName真实原名，effectKey/actionId使用独立business-op-decision:v1:前缀+hash({operationId,runId,confirmationHash})。input严格含schemaVersion1、basis、confirmationHash、decision、actorId（若basis已有actor可去重但须严格校验）；output/error/risk为空，createdAt/resolvedAt均为同一readDbNow(tx)时刻。首次INSERT赢；同scope同decision返回同decisionId，不追加其他Run事件/模型/工具效果，不覆写原pending；相反选择409 OPERATION_DECISION_CONFLICT，不后写覆盖。既有decision行必须重验专有eventType、key、完整JSON、actor、basis/hash、状态/choice/时间及空输出等，不可把legacy confirmation/confirmed或伪造approved布尔当本服务事实。

readForConfirmation不写任何状态；当前basis对应无决定时仅pending，已有严格匹配事实才显示approved/rejected。配置/身份或Run变更后basis变新，不把旧basis已批准当当前批准；decide使用旧hash时409且不写新记录，新read+明确新选择才可保存新scope。接口只给明确人工操作的未来服务端入口调用，绝不注册为模型可用NativeTool，不从聊天“好的”推断决定。两方法均不执行工具、不修改Run状态/CP/output/eventSequence，也不将确认变成通用Workflow boolean授权。

责任：新skills.operation-decisions.ts及skills.operation-decisions.persistence.test.ts；skills.operations.ts仅窄提取共享读取/验证/需确认判断，必要小型internal helper防重复（新增文件立即登记CI，物理移动也计gross）；skills.module.ts导出新factory。原则上不改execution-emergency/authority、3a唯一约束/schema、WaitService、Worker或业务写仓储。父负责package专项/CI、README/OpenAPI说明/对齐/本计划和9页看板。实现方不stage/commit；目标500–850手写行，900预警，999前先拆，不用净增隐藏搬移。测试依实际before/after清理专属Run/Session/user，根/不可变审计残留按既有披露，不全表truncate或改DDL来绿。

- [x] RED：服务重建后决定丢失/重复同意多记录或相反选择覆盖、旧hash/旧Run或旧epoch可误用等真实PG反例，记录行为失败而非导入/编译错误。
- [x] GREEN：read无写、明确决定持久且严格当前basis；pending原行不改、同scope同choice幂等、相反冲突，新retry新确认，返回参数深拷贝，真实工具/model dispatch0。
- [x] 实PG并发：同意/同意与同意/拒绝独立连接，真实INSERT后门闩+pg_stat_activity/blocking_pids证明确等待，至多一事实；事务异常回滚无半行；同连接池max1在inventory查询正常，所有门闩有界finally释放，不靠sleep猜顺序。
- [x] 边界：未知/跨owner/跨root/坏ledger/坏血缘/额外字段/UUID和摘要大小写/坏hash/legacy碰撞/损坏决定完整验证；read→decide间参数或策略stamp/角色/epoch变化拒绝旧hash；prepare中撤权/配置变化/stop+release/会话失效拒绝；有效普通停用、same-scope重读、历史保留语义明确。
- [x] 规格先审后fresh五轴质量安全独立验证；父原modules/确认专项/Harness/AI/双构建及已知通用集成缺模板实取，保持audit45边界。3a专项兼容、原确认/默认dispatch安全门禁不回归，文档/9页看板回填；本地实际sha提交后再记录，不提前声称公开入口/真实写工具/预算或MVP完成。

自检：3a pending是固定意图，3b decision是针对当前上下文的用户事实，3c消费时仍须同事务重新授权与幂等控制；本单元不直接调用任何写端口。配置戳仅非敏感版本元数据，实际权限仍默认真实重验；来源/哈希不是授权。沿已批准方向实现，没有新用户确认UI或第二运行库。


**C2c.3b确认摘要的时间戳规范：** config revision戳必须是安全JSON标量，禁止把Date对象直接传给skillDefinitionHash（canonical对Date会丢失枚举字段）。建议SQL选择EXTRACT(EPOCH FROM updated_at/effective_at)::text，保留PG微秒且时区无关，避免JS Date毫秒截断使同version的快速配置更新漏失。只读取configKey/version及两个非敏感时间戳，不把store或credential数据放确认basis；prepareSkillAuthority的既有私有fence保持，未对客户端暴露。合法配置变化经正常仓储更新戳；无DB管理者篡改防护声明。


**C2c.3b首RED与基础GREEN：** 父基线登记专项111/111、0skip（/tmp/wes-c2c3b-baseline）。真实PG行为RED2/2失败：明确approve仍pending，retry复用同一confirmationHash（/tmp/wes-c2c3b-impl/red-behavior）；更早red目录是临时view缺parameters导致TypeError，保留但不作为有效业务RED。基础实现2/2 GREEN，随后扩并发/损坏/权限与时序用例。新skills.operation-decisions.persistence.test.ts已登记原串行Harness及test:execution-operation-decisions专项（同时覆盖3a登记/旧逐次权限/重试）；不以零引用测试验收。audit实取仍45既有项，未改依赖。


**C2c.3b最终回填：** 明确批准/拒绝决定现已持久保存并绑定当前操作内容、Run与权限。同一有效上下文重复决定幂等，相反选择冲突；重试或配置权限变化需要新确认。真实工具执行仍关闭。父独立确认专项86、模块931、Harness462、AI286及API/Web双构建通过，均0skip。规格独立21、fresh质量PG21/纯测41均0skip后APPROVE。原pending及Run/CP/output/eventSequence/model记录不变，3a兼容；真实INSERT锁竞争/首写赢、max1无外部I/O持锁、回滚、严格旧行、legacy隔离、角色/重试/epoch/微秒配置失效均有实际无条件断言。readDbNow仅改为共享db/now等价import，父最终命令覆盖。保留所有RED、无序快照夹具PK排序及首次TS编译失败；通用集成0/1与audit45不造绿。九页总看板同步，RP-050仍C实施中；无独立新文档资产，sources计数不变。下一步将获准操作与本地业务写入纳入同一事务，完成实际写入幂等（C2c.3c）；再做跨调用预算（3d）、统一视图、生产宿主和工作台。本地提交和看板目视随后实取记录，不提前称MVP已验收。

**C2c.3b收尾实取：** 规格与fresh五轴安全复核均APPROVE；四源码/测试改动gross618行（含窄提取搬移），无>1000行整批审查。父原命令modules931/931、确认专项86/86、Harness462/462、AI286/286均fail/cancel/skip0，双构建exit0。integration0/1保留templates_status_not_200；guarded测试库只读核实活动模板0、有效分配0，不填造业务数据。有效RED0/2；PG微秒决定损坏反例15/17含无序快照夹具问题，PK排序修正保留说明；最终配置fence戳顺序RED20/21；首TS编译失败与修正记录均保留。

九页总看板build/check覆盖21页，0错误/0警告；OpenAPI YAML解析193条路径，未新增确认HTTP入口。IAB独立3008只读台账核验RP-050仍C实施中，next为事务写幂等/预算/生产宿主/工作台/D；截图 /Users/kevin/.codex/visualizations/2026/11/02/01a19a18-92f8-7bf1-b70c-df3fd911608f/c2c3b-2026-11-03-board-requirements.png。沿用表格短列换行/长行留白未改，不作视觉优化验收声明；sources无新资产且53唯一需求/54台账行未改。仅自建3008服务/标签，收尾关闭；3006/3004未启动或更新。下一步3c尚未实施，本次不自动进入下一单元。

### C2c.3c.1 精细工单：本地事务消费与写入幂等底座（2026-11-03）

用户继续，基线2d0d3e3/codex/wes-skills-c。沿已评审设计§8和C2c.3拆批：3c.1先建立可信本地事务端口消费确认与完成账的原子保护；3c.2再接具体生产业务工具/仓储，远端不确定结果人工核对。不是扩范围、不是第三运行库，不重开产品审批。此单元可用测试库真实version_records业务行证明同事务；不把测试端口等同生产工具已接入。跨调用预算3d、统一视图/生产宿主/工作台继续后续。保持已批准单次实施，不开启Loop。

独立内部factory createSkillOperationExecutionService(options?: {database, inventory, adapters})，唯一executeOperation(user,{runId,operationId,confirmationHash})；body严格仅3字段，UUID/hash规范小写，不能接受approved、decisionId、toolName、parameters、adapter等。返回{operationId,executionId,rootRunId,status:'succeeded',result}安全JSON拷贝。adapters为服务端可信ReadonlyMap，复制映射/执行函数以隔离调用中变更，端口kind='local-transaction'，execute(tx, {operationId,ownerId,sessionId,parameters})，必须仅经传入tx做本地DB写入，不能使用全局连接、网络、文件、外发/MCP或NativeTool.execute。默认无adapter，失败关闭；此kind是可信装配契约，不能在运行时证明任意JavaScript没有外部副作用，文档须明示。只支持当前原生source=code、mutates=true、非exfiltrates、非simulationOnly的根Skill；只读ask/MCP/远端/文件写/未装配不执行。

窄提取3b既有上下文准备与最终验证事务helper，保留原read/decide公开表面/错误语义。两个短tx之间外部inventory不占连接；最终实际默认admission/精确pending→private配置fence→新微秒revision→当前basis一致→当前scope严格批准事实验证，才可处理receipt和适配器。所有replay同样先真实有效准入、同hash和当前approve，拒绝/无决定/旧hash/撤权/终态/会话失效/紧停都不能消费或回放。既有.2b ToolGate写/外发/MCP/ask默认deny不改；确认仍不是通用grant。3a/3b意图和决定不改写。

执行账复用harness_tool_events和(root,effectKey)唯一约束，无schema/迁移。effectKey/actionId独立business-op-execution:v1:hash({operationId})，跨retry/epoch/确认scope稳定；eventType=business_operation_executed。input严格schema1含operationId/rootRunId/operationKey/payloadHash/manifestHash/ownerId/sessionId/toolName以及实际首次sourceRunId/decisionId/confirmationHash，后者只能来自当前重验批准事实。首次INSERT status=executing、output/resolvedAt/error/risk空，唯一冲突等待后读已有完整成功账，只有实际INSERT赢者调用adapter。adapter(tx)写入和结果safe JSON校验、receipt更新status=succeeded/output={schemaVersion:1,result}/resolvedAt在同一事务。任何异常全部回滚，不能提交半条executing，不能在业务写后另开tx记成功。读损坏/未知状态/legacy碰撞失败关闭，不直接重试副作用。时间用readDbNow，PG精确核对resolved>=created；既有created/resolved合法有限，null风险/错误。结果同1MiB/32层/危险字段安全约束，无原生函数/Date/undefined失真。

重放receipt严格验证完整input/output/envelope，固定内容与当前真实pending完全一致，sourceRun/decisionId/hash小写合法，旧source真实owned同根血缘（可failed，不通过旧admission授予当前权限）；读取其严格3b批准事实，hash/key/actor/时间/原source executionAuthority及basis固定字段均核对。旧basis可仅在明确的run/identity/currentToolsHash/configRevisions/authority绑定部分与当前不同，其他键/固定参数摘要一致；不能仅信stored approved布尔。当前scope已独立真实批准才可返回过去已完成结果。retry获得新确认后复用已完成receipt，绝不再次调用adapter；旧receipt不是新Run权限凭据。不承诺防DB管理员一起伪造所有历史。

文件责任：新增skills.operation-execution.ts与skills.operation-execution.persistence.test.ts；skills.operation-decisions.ts仅窄提取复用上下文/严格决定验证helper，必要共享内部helper可增加但马上登记CI；skills.module.ts导factory/type。父负责package测试脚本/CI、README/OpenAPI既有描述/对齐/计划和九页总板。目标500–850手写行，900预警999前拆分（含物理移动，不净增掩盖）。源冻结后SPEC先审再fresh五轴/安全复验。无新增HTTP/UI/boot/生产adapter；不得动默认ToolGate/WaitService/Worker、凭据、主库/预览库/3006/3004；config/system/model-verify-status.json禁止读/扫描/写/暂存。仅guarded workload_eval_test，测试独占串行，不改原modules并发或旧预算/断言造绿，本地保存不合main/推送。

- [x] RED：真实PG适配器写version_records后异常仍残留/重复调用重复写等行为反例，观察业务行与receipt，不用缺导入/编译当RED。
- [x] GREEN：当前明确approve才可消费；真实业务行与receipt一次提交，重复/服务重建/新retry新批准后只返回原结果，pending/decision/Run/CP/output/events/model不改，无NativeTool/model调度。
- [x] 实际PG并发同操作INSERT后门闩+pg_stat_activity证实唯一冲突等待，恰一adapter和一业务行/receipt；异常/坏输出/完成账更新失败全部回滚，重试可再成功。max1库存查库不死锁；有界门闩finally释放。
- [x] 边界：默认/未知/不安全adapter关闭，read-only/MCP/exfil/simulation工具拒绝；无approve/reject/旧scope/参数篡改/坏receipt/legacy碰撞/source/decision损坏拒绝，当前撤权/epoch/配置微秒/会话失效在调用前或inventory间隙拦截且业务行0；已有成功receipt不能绕过这些。互相交错的撤权/写事务线性化按实际锁提交次序解释，不承诺倒转已先提交写入。
- [x] 先SPEC后fresh质量独立实测；父原模块/执行专项/Harness/AI及API/Web构建，保留通用integration缺模板0/1与audit45基线；专属version_records/Run/Session/user按owner清理并assert0，不全库truncate/DDL；九板/文档事实同步，3c整体仍待生产工具适配。

**C2c.3c.1首RED实取：** 父基线确认专项86/86、0skip。/tmp/wes-c2c3c1-impl/red-semantic两个真实PG行为反例均失败（0/2，0skip）：重复/重建service创建不同version_records记录ID，Infinity结果未拒绝。更早red因sandboxReadSafe夹具标记导致准入拒绝，保留但不计有效业务RED。正在实现同事务消费；audit实取45（32moderate/12high/1critical），依赖未改。

**C2c.3c.1实现冻结：** 四源码/测试gross586（含3b窄提取39），/tmp/wes-c2c3c1-impl/final-contract新增PG20/20、0skip、exit0，tsc --noEmit exit0。版本夹具改为在役assessment/checked_in/drafting/A/0并断言合法新建契约；测试真实version_records而非仅内存计数。保留green-expanded 11/12的来源/MCP夹具早拒绝，以及首次TS unknown/optional adapter收窄失败输出，未弱化生产准入。新JSON结果检查拒绝Date/Map/getter/自定义数组继承toJSON，写后坏结果完整回滚。独立规格与fresh质量尚待完成，生产具体adapter仍未接线。

**C2c.3c.1 JSON配额口径：** 沿3a/3b完整JSON边界原则，adapter结果、持久output信封与最终返回信封分别满足1MiB/32层和危险字段检查；包装自身占用字节/深度，不承诺原始result吃满限额后再给予额外包装配额。超限整笔事务回滚，不提交业务或receipt半成品。

**C2c.3c.1独立规格实取：** /tmp/wes-c2c3c1-spec新增PG20/20，fail/cancel/skip0、exit0，SPEC APPROVE。核实真实SQL等待/首赢家回滚后接管/撤权锁次序/重新approve后的旧结果复用及四类专属行清零断言；未修改源码。fresh五轴质量静态阶段等待父PG租约，父现运行原modules/执行专项/Harness/AI/通用集成，不并发PG或构建，不改原modules并发。

**C2c.3c.1最终回填：** 本地业务写入与成功回执现可同事务提交：重复、并发和明确重试只写一次，失败整笔回滚；重放也须当前权限与新确认有效。默认没有生产工具适配器。父独立执行专项106、模块931、Harness482、AI286及API/Web双构建通过，测试均0skip。SPEC20后fresh质量PG20/纯测41APPROVE；全阶段0skip。保留专属有效RED0/2、来源/MCP夹具失败和首次TS收窄失败；没有改原modules并发、弱化旧断言/预算或seed模板造绿。真实SQL唯一冲突等待/赢家rollback接管/写与撤权两种锁序、坏JSON和完成更新失败整笔rollback、retry重新approve后只复用、微秒fence与历史source/decision完整性均有无条件断言。完整JSON配额以每个包装边界为准，可信adapter不是自动网络沙箱。仅测试库真实业务记录证明底座，生产工具仍待3c.2；3c整体与C/D/MVP未关闭。九页看板同步，RP-050保持C实施中，sources无新文档资产/计数不变。下一步接具体生产业务工具的事务适配（C2c.3c.2），再做跨调用累计预算（3d）、统一视图、生产宿主、工作台和D验收。实际本地sha和板检截图随后实取补记。

**C2c.3c.1板检实取：** canonical九页build/check覆盖21页，0错误/0警告（/tmp/wes-c2c3c1-board-build-final.log与board-check-final.log）；OpenAPI YAML解析193条path未增公开入口。IAB只读核验RP-050仍C实施中，next明确具体生产工具/预算/宿主/工作台/D；53唯一需求/54数据行不变。截图 /Users/kevin/.codex/visualizations/2026/11/02/01a19a18-92f8-7bf1-b70c-df3fd911608f/c2c3c1-2026-11-03-board-requirements.png；沿用既有短列换行和长行留白，不作UI优化声明。自建3008服务/标签已关闭，不动3006/3004。源码gross586（含搬移），本地提交sha随后实取回填；3c.2具体生产工具未在本次实施。
