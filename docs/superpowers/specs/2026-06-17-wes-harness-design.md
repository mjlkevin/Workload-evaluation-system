# WES Harness 设计草案

日期：2026-06-17
分支：feat/agent-workbench
状态：待用户审阅

## 背景

WES 正在从传统工作量评估系统升级为“AI Agent 工作台 + WES 传统记录系统”的一体化产品。当前 AI 工作台已经支持会话、附件、产物、待确认动作和项目评估记录，但上传文件后的链路仍需要升级：不能由本地代码拼接结果，也不能让模型输出不可控的长篇文本。

本设计定义 WES Harness：系统与 Agent 之间的受控业务工作环境。它让 Agent 在 WES 的文件、标准、规则、权限和确认闸门内工作，并让每次运行可观察、可评分、可回放、可沉淀。

## 设计目标

1. 让 AI 工作台上传文件后进入可控 Harness flow，而不是一次性聊天回复。
2. 确保文件理解、需求解析、澄清问题、粗评假设都是真实 LLM 参与，并有 Model Run Trace。
3. 用 evidence、标准库检索和结构化 Schema 支撑高可读报告与自动评分。
4. 让高风险业务动作必须经用户确认后才写入 WES 传统记录。
5. 为 Prompt、模型、标准库和解析逻辑建立 Harness Regression 门禁。

## 核心原则

- WES Harness 是受控业务工作间，不是自由电脑。
- Phase 1 只支持 WES 上传附件，不做本地目录连接器，不开放 bash 或任意命令执行。
- Agent 通过 Typed Tools 工作，例如解析文件、搜索 evidence、搜索标准库、生成报告、创建待确认动作。
- 模型负责业务理解和结构化输出；系统负责 Schema 校验、UI 渲染、权限、审计、沉淀和执行。
- 客户需求以用户确认和客户文件 evidence 为准；评估口径以已启用标准库 evidence 和规则引擎为准。
- 不能把规则 fallback 或缓存结果伪装成新模型输出。

## 文件环境

Phase 1 遵循上传文件为主：

- 用户上传 Excel、Word、PDF、访谈纪要等附件到 AI 工作台。
- 原始附件继续文件存储，后续可替换为对象存储。
- 数据库存储附件元数据、解析结果、evidence、trace、artifact、评分和关联关系。
- Agent 不直接读取裸文件，而是通过 Harness 读取结构化摘要和可检索证据片段。

文件可见性采用“结构化摘要 + 可检索原文/表格证据片段”。报告关键结论展示轻量引用，例如：

```text
来源：3.业务需求及问题一览表 · 第 12-18 行
```

## Evidence 策略

证据切片采用 B + C 渐进式：

1. 先按工作表里的业务表格或区域形成 evidence block。
2. 对结构明确的区域进一步拆出需求条目、问题条目、模块条目等 evidence item。
3. 早期允许部分内容停留在 block 层，避免为完美结构化阻塞主流程。

每条 evidence 至少保存：

- 原始附件 ID
- 来源类型：Excel、Word、PDF、标准文件
- 来源定位：sheet、行列范围、页码、段落号等
- 片段文本或表格快照
- 解析器版本
- 文件哈希
- evidence 类型：block / item
- 业务标签：需求、模块、风险、组织范围、报表、接口等

Evidence 入库采用“定位 + 片段文本/表格快照”，不把整份裸全文直接入库。

## 标准库环境

Phase 1 标准库做到“标准文件上传 + 解析切片 + 检索”：

- 管理员上传金蝶官方制度文件、发版说明、评估口径、产品标准。
- 标准文件有版本、来源、发布日期、适用产品线、适用行业、状态。
- 标准文件启用后才允许 Agent 在正式评估中检索。
- 启用或发布标准文件版本必须管理员确认。
- 第一版不做标准知识卡片发布闭环，但架构预留。

标准检索范围采用“按项目上下文自动过滤 + 可手动调整”：

- 默认按产品线、模块、行业、版本、业务域过滤候选标准文件。
- 后续允许用户在正式评估前调整本次适用标准集。

标准库证据展示采用轻量策略：

- 客户文件 evidence 支撑“客户需求是什么”。
- 标准库 evidence 支撑“为什么判断这个模块、风险或实施影响”。
- 未命中标准库时，允许模型基于通用经验分析，但必须标记“经验判断，未命中适用标准依据”。

## 检索与 Embedding

Phase 1 使用 PostgreSQL + pgvector，不单独部署 Milvus、Qdrant 或 Pinecone。

理由：

- Harness 数据天然需要进入 PostgreSQL。
- evidence 数量在第一阶段预计为几千到几十万条，pgvector 足以支撑。
- 结构化过滤、权限、审计、备份可统一在 PostgreSQL 内完成。
- 后续 evidence 达到几十万到百万级、并发明显上升时，再评估独立向量数据库。

Embedding 采用 EmbeddingProvider 可插拔策略：

```text
EmbeddingProvider
  ├─ embedText(text)
  ├─ embedBatch(texts[])
  ├─ provider
  ├─ model
  ├─ dimension
  └─ usage / latency / error trace
```

后期实现必须确定默认 embedding 厂商、模型、维度、费用策略和合规边界，不能长期停留在“可插拔但无默认实现”。

标准文件升版采用“先全量重建，后续差异优化”。每个标准文件版本独立解析、切片、生成 evidence 和 embedding。旧版本归档保留，支持历史依据追踪。

## 历史回放与标准升版

历史项目回放默认使用最新标准版本复核历史项目，展示新口径下的差异和影响。

为避免审计失真，HarnessRun 同时记录：

```text
originalStandardSetVersion：当时实际使用的标准版本
replayStandardSetVersion：本次回放使用的标准版本，默认最新
```

标准升版回放差异展示包括：

- 原标准版本
- 最新标准版本
- 原结论
- 最新复核结论
- 差异原因
- 影响范围
- 建议动作

第一版不自动生成重新评估动作，只提示用户判断是否需要重评。

## 工作流阶段

AI 工作台上传文件后进入阶段化 Harness flow：

1. 文件理解摘要
2. 需求解析报告 v1
3. 待澄清问题清单
4. 补充信息后的需求解析报告 v2
5. 粗评假设与下一步动作

HarnessRun 阶段状态：

```text
uploaded
→ parsing
→ evidence_ready
→ analyzing
→ report_v1_ready
→ clarifying
→ report_v2_ready
→ ready_for_estimation
→ project_link_pending
→ project_linked
→ requirement_draft_pending
→ completed
```

异常状态：

```text
failed
cancelled
needs_user_input
```

标准库检索中、标准库命中不足等不作为单独阶段，记录为事件和 warning。

## 多文件处理

多文件采用“先分别理解，再合并报告”：

```text
多个文件上传
→ 每个文件独立解析、切 evidence、生成文件理解摘要
→ Harness 识别文件角色和来源
→ 合并成项目级需求解析报告 v1
→ 标记冲突、重复和缺失信息
```

文件角色自动识别，用户可修正。支持角色包括：

- 实施工作量申请表
- 业务需求差异分析表
- 调研纪要
- 招标文件
- 客户补充说明
- 历史报价 / 评估表

文件角色影响推荐值，但不自动覆盖冲突。多文件冲突必须在报告中标记并进入待澄清问题。

## 信息补充与正式评估闸门

信息补充采用双模式：

- 用户可以通过自然语言聊天补充。
- 关键缺失字段形成结构化补充项。
- Agent 解析用户回答后回填字段。
- 进入正式评估前，用户确认关键字段。

Phase 1 关键结构化字段：

1. 项目名称
2. 客户名称
3. 客户行业
4. 产品线 / 模块范围
5. 实施组织范围
6. 是否涉及接口 / 集成
7. 是否涉及数据迁移
8. 是否涉及自定义报表
9. 是否涉及二开 / 定制开发
10. 上线范围 / 批次
11. 评估目标：粗评 / 正式评估 / 报价支撑 / 内部方案

进入正式评估的最小条件：

- 项目名称已确认
- 客户名称已确认
- 至少一个产品线/模块范围已确认
- 实施组织范围已填写，或显式标记“待补”
- 接口、数据迁移、自定义报表、二开四类风险至少完成是/否/未知标记
- 已生成需求解析报告 v2，或用户确认使用 v1 进入
- 用户主动点击“进入正式评估”

## 传统记录沉淀

Phase 1D 中，用户在 v2 报告上确认 `enter_formal_estimation` 后，系统先创建或关联项目评估记录草稿，并同步创建实施评估版本草稿。两者都保持草稿状态：项目评估为 `draft`，实施评估 payload 标记 `draft_from_ai`，需要用户在传统工作台人工确认/编辑后才进入正式评估。

项目评估是上层容器，需求记录是后续细化的子产物。

需求记录草稿生成时机：

- 项目评估创建或关联后，用户点击“生成需求记录草稿”。
- Agent 展示可生成的需求条目清单。
- 用户确认后再创建传统需求记录草稿。

第一版不自动创建需求记录草稿。

## 工具动作边界

自动执行工具：

- 解析上传附件
- 切分 evidence
- 搜索附件 evidence
- 搜索标准库 evidence
- 生成需求解析报告草稿
- 生成待澄清问题
- 生成粗评假设/风险草稿

必须用户确认的工具：

- 创建/关联项目评估记录
- 创建/更新传统需求记录
- 生成正式评估输入并进入正式评估
- 发布或启用标准文件版本
- 覆盖已有评估结论
- 导出正式客户交付文档

用户取消确认动作时，记录取消事件，流程停在当前阶段，不标记为失败。用户可继续补充信息或稍后重新触发动作。

## 粗评边界

粗评工作量采用规则/模板引擎给区间，Agent 不直接自由拍人天。

正式进入粗评时：

- Harness 提供已确认模块、范围、风险因子。
- WES 规则/模板引擎计算基础工作量区间。
- Agent 解释假设、风险、缺口和建议动作。
- 规则覆盖不足时，允许生成低置信度粗评，并标记缺失规则和假设，同时生成待补标准/规则动作。

规则/模板引擎与标准库关系：

- 高影响规则必须关联标准库 evidence 或管理员发布的评估口径。
- 普通规则 Phase 1 可先无引用，但要标记来源类型。
- 后续逐步提高规则可追溯覆盖率。

粗评置信度采用“等级 + 原因”，例如：

```text
置信度：中
原因：模块范围较清楚，但接口数量、自定义报表数量、历史数据迁移范围仍待确认。
```

## LLM 输出 Schema

关键阶段要求模型输出结构化 JSON，系统校验后由 UI 渲染：

- 文件理解摘要
- 需求解析报告 v1 / v2
- 待澄清问题
- 粗评假设
- 待确认动作建议

用户看到 WES 原生报告组件，不直接展示模型原始 Markdown。这样避免 Markdown 表格错乱、回复冗长、无法评分和无法沉淀。

Schema 校验失败采用受控 Loop 修复：

```text
模型输出
→ Schema 校验
→ 通过：进入渲染/沉淀
→ 不通过：把错误原因、原始输出、目标 Schema 发回模型修复
→ 再校验
→ 继续循环
```

工程边界：

- 每个阶段配置 maxRepairAttempts，建议 3-5 次。
- 每次失败记录 schemaValidationError。
- 达到上限仍失败时，HarnessRun 标记 failed_schema_validation。
- Regression 中该 case 计入失败。

备用模型由 Prompt Profile 配置，不写死：

- primary model
- fallback model
- maxRepairAttempts
- repair prompt
- temperature
- output schema
- timeout

## Prompt 版本管理

Prompt 采用配置化 Prompt Profile，而不是散落在代码里的字符串。

字段包括：

- promptProfileId
- version
- 适用流程
- system prompt
- output schema
- 适用模型 / 推荐模型
- primary model / fallback model
- 状态：draft / active / archived
- 发布人 / 发布时间
- 变更说明

HarnessRun、ModelRun、缓存键和回归报告必须记录 promptProfileId 和 version。

Prompt 发布门禁：

```text
编辑 Prompt 草稿
→ 选择回归样本集
→ 运行 Harness Regression
→ 达到质量阈值
→ 发布为 active
```

未达阈值只能保存草稿，不能成为默认 Prompt。

## Model Run Trace 与缓存

每次 Agent 运行必须记录 Model Run Trace：

- provider / model
- runId
- prompt profile / prompt version
- 输入 evidence id 列表
- token 估算
- rawContent 摘要或哈希
- elapsedMs
- fallbackReason
- mode：model / rule_fallback / cached

普通用户看到轻量说明，例如：

```text
由 Kimi kimi-k2.5 基于 23 条文件证据生成 · 12.4s
```

管理员/研发可在 Harness 回放里查看更完整 trace。

缓存策略采用默认缓存 + 可强制重新分析。当文件哈希、prompt version、模型、标准库版本、关键上下文一致时，可复用历史结果，但必须标记 mode: cached。用户可点击“重新用 AI 分析”，回归测试可禁用缓存。

## AI 工作台交互

Harness 直接内嵌现有 AI 工作台，不新增独立页面作为第一入口。

交互形态采用“聊天流 + 右侧阶段面板”：

- 中间聊天流展示 Agent 对话、报告卡片、动作卡片。
- 右侧 Harness 状态面板展示当前阶段、当前产物、待补充信息、待确认动作、关联记录、证据与标准引用摘要、下一步建议。

长耗时阶段展示明确进度：

```text
正在解析文件
正在切分证据
正在检索标准库
正在调用 AI 理解业务
正在校验结构化结果
正在生成需求解析报告
```

模型正文不做逐字流式输出。关键阶段 JSON 必须校验后一次性渲染报告。前端展示阶段进度流，而不是半截 Markdown 或半截 JSON。

确认动作 UI：

- 聊天流出现一次动作卡片。
- 右侧待确认动作面板常驻当前动作。
- 用户确认或取消后，聊天流记录结果。
- 已处理动作从待确认面板移除，进入工具事件轨迹。

## API 与事件协议

Harness API Phase 1：

- `POST /api/harness/runs`
- `GET /api/harness/runs/:id`
- `GET /api/harness/runs/:id/events`
- `POST /api/harness/runs/:id/files`
- `POST /api/harness/runs/:id/answers`
- `POST /api/harness/runs/:id/actions/:actionId/confirm`
- `POST /api/harness/runs/:id/retry`
- `POST /api/harness/runs/:id/reanalyze`

事件协议采用 SSE：

- 用户动作走普通 POST。
- Harness 进度走 SSE 推送阶段事件。
- 第一版不引入 WebSocket。

失败恢复采用从最近成功阶段恢复：

- 已完成的文件解析不重复。
- 已切好的 evidence 可复用。
- 已生成并校验通过的 artifact 可复用。
- 失败阶段标记失败原因。
- 用户刷新后能看到状态，并点击“重试当前阶段”。
- 不做无限自动后台重试。

## 数据持久化

Harness 作为新业务域进入 PostgreSQL 主存储；传统 WES JSON 存储暂不整体迁移。AI Session 与传统记录通过 ID 引用 Harness 数据。

这与现有 AGENTS.md 的 DB 触发器一致：Harness 明显触发了“审计/统计/权限追溯需求明显增加”，并且 evidence、trace、score 的查询和增长趋势超过 JSON 文件适配范围。

核心数据对象：

1. HarnessRun：一次 Agent 工作流运行
2. HarnessEvidence：附件或标准库证据块/条目
3. HarnessArtifact：报告、问题、假设等产物
4. HarnessToolEvent：工具调用轨迹
5. HarnessModelRun：模型调用轨迹
6. HarnessCase / ExpectedAnswer：回归样本和人工标准答案
7. HarnessScore：评分结果和趋势摘要

AI Session 是用户对话容器，HarnessRun 是一次可追溯业务工作流运行。

## 权限与角色

售前顾问 / 普通用户：

- 上传项目需求文件
- 运行需求解析
- 补充信息
- 查看报告和轻量证据引用
- 确认创建/关联项目评估
- 确认生成需求记录草稿

管理员：

- 上传/启用标准文件
- 查看 Harness trace
- 查看标准库缺口
- 运行真实模型回归
- 管理样本集和 expected.json，后续 UI 化

研发/系统维护者：

- 命令行运行 regression
- 查看详细 model trace、tool trace、评分报告
- 维护 prompt version、cassette、评分器

## 安全与保留周期

敏感数据处理采用“普通用户业务视图不脱敏，研发/回归报告默认脱敏”：

- 用户在自己有权限的项目里查看真实业务数据。
- Harness Regression 报告默认脱敏客户名称、联系人、手机号、邮箱、金额、合同编号等敏感字段。
- ModelRun Trace 对普通用户隐藏 raw prompt / rawContent。
- 管理员/研发查看详细 trace 需要权限。

数据保留采用分层策略：

- 业务产物长期保存。
- 评分摘要长期保存。
- 详细 raw trace 默认短周期保存，例如 90 天。
- 到期后保留摘要、哈希、模型、promptVersion、evidenceId、评分，不再保留敏感 raw 内容。

## Harness Regression

Harness Regression 是 WES Agent 的业务回归测试。它用固定业务样本自动跑一遍 Agent 工作流，并与人工标准答案对比，判断模型、Prompt、标准库或解析逻辑有没有退化。

样本集覆盖：

1. 标准实施工作量申请表
2. 客户业务需求差异分析表
3. 访谈纪要 / 调研纪要
4. 多 Sheet 混合文件
5. 低质量样本

人工标准答案采用“先 JSON，后 UI 产品化”。每个样本至少有报告级 expected.json，重点样本维护需求条目级答案。评分根据标注深度自动启用。

Regression 运行模式采用双通道：

- 默认使用 cassette 录制/回放，保证日常回归稳定、低成本。
- 支持手动或周期性真实模型回归，用于评估模型、Prompt、标准库和解析策略升级。

第一版输出：

- JSON：机器可读，供 CI、趋势分析、后续 UI 使用。
- Markdown：人类可读，展示样本结果、标准答案对比、差异、模型/工具轨迹摘要。

Run Bundle 后置，但数据结构保留 runId、caseId、evidenceId、modelRunId、toolEventId。

评分体系：

1. 文件覆盖度
2. 证据引用率
3. 缺失信息识别
4. 业务准确性：模块/需求与人工标准答案匹配度
5. 工作流合规性
6. 动作安全性

初始阈值：

硬门禁：

- 动作安全性：100%
- 工作流合规性：100%
- 关键字段提取准确率：>= 90%
- 文件覆盖度：>= 90%

警戒线：

- 业务模块 / 需求匹配度：>= 80%
- 缺失信息识别 F1：>= 80%
- 证据引用率：>= 70%

硬门禁不过不能发布 Prompt；警戒线低于阈值需要人工确认原因。

## 运行模式

Harness 支持三种模式：

1. interactive：真实业务使用，允许缓存和用户补充，高风险写操作必须确认。
2. replay：回放历史 session，不产生新写操作，用于审计、复盘、问题定位。
3. regression：自动回归，默认禁用真实写操作，基于样本和 expected.json 输出评分报告，可选择 mock model 或真实 model。

## Phase 1 交付切片

Phase 1A：数据库与 HarnessRun 基座

- PostgreSQL schema
- HarnessRun / Evidence / Artifact / ModelRun / ToolEvent
- 文件元数据
- 阶段状态机
- 基础 API

Phase 1B：AI 工作台接入文件理解 + 报告 v1

- 上传文件进入 HarnessRun
- 文件解析 / evidence 切片
- LLM 输出 Schema
- 报告卡片渲染
- 阶段进度 SSE

Phase 1C：澄清补充 + 报告 v2 + 项目评估确认

- 待澄清问题
- 结构化补充字段
- 报告 v2
- 创建/关联项目评估确认动作

Phase 1D：Harness confirm → 传统项目/评估草稿

- `enter_formal_estimation` 仅允许从 `report_v2_ready` 确认
- URL `actionId` 必须与 body `actionType` 一致，均为 `enter_formal_estimation`
- 创建项目评估草稿与实施评估版本草稿
- 两条传统草稿记录通过一次版本库变更提交，`saveVersionsStore` 使用同目录临时文件 + rename 写入
- ToolEvent output 与 Harness Run metadata 记录草稿 ID，保证追溯
- 同一 `(runId, actionType)` 重复确认保持幂等，不重复创建草稿
- 其他已知 confirmed 动作至少需要达到 `report_v2_ready`，并按 `(runId, actionId, actionType)` 幂等记录 ToolEvent
- 草稿创建异常时写入 failed ToolEvent，保留 errorMessage 供审计与重试判断
- 不自动发布正式评估，不自动创建正式需求记录

Phase 1E：Regression CLI

- 样本目录
- expected.json
- 评分器
- JSON + Markdown 报告

## 暂不做

Phase 1 明确不做：

- 不做本地目录连接器
- 不开放 bash / 任意命令执行
- 不做独立 Harness 管理后台
- 不做历史相似项目检索
- 不做独立向量数据库
- 不做标准知识卡片发布闭环
- 不做需求记录草稿自动创建，只做用户确认触发
- 不做 WebSocket
- 不做完整 Prompt A/B 实验平台

## 待后续落实

1. 确定默认 embedding 厂商、模型、维度、成本和合规策略。
2. 设计 PostgreSQL schema 与迁移方案。
3. 定义 Phase 1 的 JSON Schema：文件理解摘要、需求解析报告、澄清问题、粗评假设。
4. 定义 SSE 事件协议和前端状态映射。
5. 定义 expected.json 格式和评分器细则。
6. 定义 Prompt Profile 数据结构与发布门禁。
7. 明确 raw trace 90 天保留策略的配置入口和清理任务。
