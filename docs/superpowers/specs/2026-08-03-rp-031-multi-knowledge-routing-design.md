# RP-031 多知识库意图路由设计规格

**日期：** 2026-08-03
**范围：** 同一智谱账号下配置多个知识库，由 WES 根据用户意图选择一个主知识库检索，并在主库明确空结果时最多回退一次。
**业务表面：** `/system/knowledge-base` 与 AI 工作台 `knowledge_query` 调用链。
**关联：** ISS-2026-08-03-001，RP-031 C2 / M1。

## 1. 目标与边界

本次交付解决三个根问题：

1. 系统配置只能保存一个 Knowledge ID，无法管理“金蝶解决方案知识库、实施方法论库、项目案例库”等多个业务知识域。
2. AI 工作台只判断“是否需要查知识库”，不能判断“应该查哪个知识库”，检索空结果容易被误认为资料不存在。
3. 运行时没有知识库级角色范围、路由理由和回退轨迹，管理员无法解释或审计一次检索为何访问某个知识库。

本期明确不做：

- 不支持多个供应商或每个知识库独立 API Key；所有知识库共享同一智谱账号、API Base URL、模型和检索参数。
- 不并行查询全部知识库，不把多个库的结果直接混合生成答案。
- 不新增数据库；沿用 system repository 的 JSON 存储边界并提供旧结构迁移。
- 不做文档级 ACL；本期权限粒度为知识库档案级业务角色范围。
- 不自动学习路由规则；路由关键词由管理员维护，AI 仅处理规则无法确定的请求。

## 2. 业务模型

一个生效配置由“共享接入参数”和“知识库档案”组成。

### 2.1 共享接入参数

- `apiKey`：同一智谱账号的密钥，仍按现有规则掩码返回、禁止出现在 trace 和文档中。
- `model`、`apiBaseUrl`：沿用现有安全 URL 白名单。
- `retrievalParams`、`promptProfile`：本期所有知识库共享，避免一次引入每库独立调优矩阵。

### 2.2 KnowledgeBaseProfile

每个知识库档案包含：

- `id`：WES 内部稳定标识，不等同供应商 Knowledge ID。
- `name`、`description`：管理员和路由器可理解的业务语义。
- `knowledgeId`：智谱实际 Knowledge ID。
- `routingKeywords`：确定性路由词，如“资金计划、银企、网银、实施边界”。
- `allowedBusinessRoles`：允许访问的 WES 业务角色；空数组表示所有已认证业务角色。
- `enabled`：是否进入生效配置和运行时候选集。
- `isDefault`：低置信度时的安全默认库；全局最多一个。
- `priority`：规则同分和回退候选排序，数值越小优先级越高。

旧版 `credentials.knowledgeId` 在读取时迁移为一个 `legacy-default` 档案。旧配置可继续服务；下一次保存后落为新结构。环境变量 `ZHIPU_KNOWLEDGE_ID` 仍可形成只读的默认档案，保持部署兼容。

## 3. 草稿、连通性与生效门禁

知识库配置继续使用 `draft / active / version` 模型。

- 管理员可新增、编辑、停用知识库档案；档案编辑在 Dialog 中完成。
- 每个启用档案必须独立执行连通性测试。
- 连通性记录按 `profileId` 保存，绑定该档案与共享参数的配置哈希。
- 生效配置时，所有启用档案都必须在 24 小时内有成功且哈希一致的测试记录。
- 草稿中不允许重复内部 ID、重复 Knowledge ID、超过一个默认库、启用但缺少名称或 Knowledge ID。
- 保存草稿不会中断正在使用的 active 配置；只有门禁通过后才整体切换。

这保证“新增第二个库失败”不会破坏当前已生效的金蝶解决方案知识库。

## 4. 运行时路由

路由顺序固定如下：

1. **权限过滤**：先移除当前 `businessRole` 无权访问的档案；未授权档案不得进入规则提示、模型提示或回退候选。
2. **显式指定**：用户文本明确包含知识库名称或内部 ID 时直接选择。
3. **确定性规则**：按 `routingKeywords`、名称和描述计算命中分；唯一高分候选直接选择，不调用路由模型。
4. **AI 分类**：无命中或候选分数接近时，复用当前工作台模型，在“已授权候选目录”中返回一个档案 ID、置信度和简短理由。置信度低于 0.65或返回越权/未知 ID 均视为无效。
5. **安全默认**：AI 无法确定时，仅选择当前角色可访问且 `isDefault=true` 的档案；没有安全默认库则返回可解释的未解析状态，并进入现有通用模型降级，不盲查任何库。

路由结果包含 `mode = explicit | rule | model | default | unresolved`、置信度、理由、主档案和一个可选回退档案。

## 5. 受控回退

- 每次请求只查询一个主知识库。
- 只有主查询的 `fallbackReason` 为 `retrieval_empty` 时，才允许查询第二个档案。
- 鉴权失败、限流、供应商故障、URL 安全拒绝、答案生成失败均不跨库回退，避免放大故障或越权风险。
- 回退优先选择当前角色可访问的默认库；主库本身是默认库时，选择路由排序中的下一候选。
- 最多一次回退，禁止循环和全库扫描。
- 最终回答显示实际命中的知识库名称；trace 同时记录主库、回退库、每次结果和路由理由。

## 6. API 契约

沿用现有四个系统管理端点，不新增第二套配置 API：

- `GET /api/v1/system/knowledge-base-config`：返回共享参数、草稿/生效档案列表、按档案归集的 probe；API Key 始终为空且仅返回掩码。
- `PATCH /api/v1/system/knowledge-base-config/draft`：接受共享参数和完整 `knowledgeBases` 数组；服务端规范化与校验。
- `POST /api/v1/system/knowledge-base-config/test`：请求体增加 `profileId`，只测试一个草稿档案。
- `POST /api/v1/system/knowledge-base-config/activate`：校验全部启用档案后整体生效。

响应仍使用 `{ code, message, data }` 兼容包装；旧调用未传 `profileId` 时选择旧默认/唯一档案。

## 7. 可解释性与审计

`ZhipuKnowledgeToolTrace` 增加脱敏路由元数据：

- `knowledgeBaseProfileId`、`knowledgeBaseName`
- `route.mode`、`route.confidence`、`route.reason`
- `route.primaryProfileId`、可选 `fallbackProfileId`
- `route.attempts[]`：仅记录内部档案 ID、结果原因、片段数和最高分，不记录 API Key。

统一 trace 的 knowledge span 持久化上述字段。管理员可从 trace 判断“为什么查这个库、是否回退、回退原因是什么”。供应商 Knowledge ID 继续用于现有 context ref，但不会暴露凭证。

## 8. UI 设计

`/system/knowledge-base` 保持现有 Phase B 视觉与组件系统，拆为三个层次：

1. 顶部状态和保存/生效反馈：展示“已生效知识库数量、默认库、待重测数量”。
2. 共享接入配置：API Key、模型、API Base URL、检索参数。
3. 知识库档案列表：名称、Knowledge ID、路由关键词、角色范围、默认/启用状态、测试状态及编辑/测试操作。

新增/编辑使用共享 `Dialog`，避免在列表上方插入临时表单。窄屏下档案表改为卡片式纵向信息，不引入水平页面滚动。异步保存、测试和生效反馈继续使用 `role=status/alert`。

## 9. 验收标准

- 旧单知识库 JSON 加载后自动得到一个可用档案，不丢失 Knowledge ID。
- 管理员可保存至少两个知识库档案；重复 ID、重复 Knowledge ID、多默认库被拒绝。
- 启用档案未逐一通过有效测试时不能生效。
- “资金计划实施边界”可按关键词路由到配置了相应路由词的知识库；强规则命中不调用 AI 路由。
- 模糊问题可由模型在已授权候选中选择；无效或低置信度结果回到安全默认库。
- 当前业务角色无权访问的知识库不会被选择、不会作为回退、不会出现在模型候选目录。
- 主库空结果时最多查询一个回退库；其他错误不回退。
- 回答与 trace 能说明最终使用的知识库及路由/回退原因。
- API、AI、Web 全量测试和构建通过；1440px 与 760px 浏览器验收通过。
