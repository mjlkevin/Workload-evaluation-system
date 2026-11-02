# WES Business Skills 分批实施计划

> **For agentic workers:** 开工使用 `executing-plans` 逐项执行。步骤使用 checkbox。若交给 Qoder，先完成 `QODER.md` 和 `skills/wes-qoder-worktree-protocol/SKILL.md` 规定的 Worktree Contract ACK。此计划不是开工、推送或部署授权，不自动创建子代理、实现 Loop 或后续批次。

**Goal:** 将已评审的 Skill 机制分成四批独立可验证的业务成果，最终完成需求到实施评估的 MVP。

**Architecture:** 新增独立 Skill/Workflow 领域与 repository，复用 PostgreSQL、工具注册/策略、结构化输出和 Harness。Skill 发布不可变，Workflow 固定 Skill 版本，运行固定执行快照；实际执行始终复核当前权限。

**Tech Stack:** 现有 TypeScript/Express/modules、PostgreSQL/Drizzle、AJV、Harness；前端沿用 Vite/React、现有共享组件和 Tailwind tokens 桥接。

设计依据：`../specs/2026-11-02-wes-business-skills-design.md`。2026-11-02 用户“评审通过”，随后授权“开始实施”，现已确认“通过，继续下一步工作”。A批界面验收通过；B候选代码、管理界面和契约已验证，待有效凭据补验真实模型发布及用户验收。主线集成仍待执行，远端未推送；C/D 未启动，完整 MVP 尚未验收。

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
- [ ] 显示生效版本、回滚原因和引用影响；保留 A 批编辑/历史交互、冲突输入和错误定位。真实浏览器验证桌面及 760px，创建到审核发布/回滚逐步保留证据。

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
| Skill真实通过→审核→发布 | 匹配当前内容与依赖，原因必填，模拟工具须确认；生效指针可见 | 真实通过仍待有效模型凭据；不得伪造 |
| 修改/过期/并发 | 保存前不运行；旧证据不能发布；冲突保留输入 | 自动检查通过；草稿保护、过期标记及输入保留浏览器通过 |
| Skill升版与回滚 | 旧版不可编辑；回滚说明与目标明确，失败不改生效指针 | 升版/历史只读浏览器通过；Skill成功发布及回滚待真实模型凭据 |
| 流程步骤与依赖 | 四类步骤可维护；只引用已发布的明确Skill版本，固定依赖可查看 | 四类步骤/固定引用自动检查通过；人工两步骤及映射浏览器通过，真实Skill依赖待凭据 |
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
