# WES Agent Phase 1G 意图路由与任务运行时升级设计

日期：2026-06-22
状态：设计中
适用范围：`apps/api`、`ui/V2_PROTOTYPE`、WES Harness Runtime

## 背景

Phase 1B 到 Phase 1F 已把“上传文件后进入 Harness、生成 v1/v2 报告、确认后创建传统 AI 草稿、人工确认后回写 Harness 审计链”打通。这个闭环解决了“AI 产物如何进入传统 WES 记录系统”的问题。

但人工测试中暴露出一个新的产品边界问题：AI 工作台不应把所有上传附件后的用户输入都收敛成“补充信息并生成 v2 报告”。用户上传客户问题清单后，可能只是想问其中某个业务问题；用户只输入一句“购买存货核算模块必须购买哪些相关模块”，也应该得到模型在业务边界内的推理回复。当前如果已有 v1 artifact，前端会把后续文本默认送入 `submitHarnessAnswers → generateHarnessRequirementReportV2`，使 AI 工作台退化为过窄的固定评估流水线。

Phase 1G 的核心判断是：

> 文件是上下文，用户意图才触发工作流。

Harness 不是只服务“需求评估报告”的管道，而是 WES AI 工作台的任务运行时与审计底座。Chat 负责输入，Intent Router 负责判断下一步是业务问答、附件问答、WES 数据查询、报告生成，还是写动作确认。

## 目标

1. 恢复 AI 工作台在 WES 业务边界内的自然语言推理与问答能力。
2. 将“上传附件”从自动触发评估改为建立任务上下文，除非用户明确要求生成报告。
3. 建立意图路由：根据用户输入、附件、当前 Harness artifact 和会话状态决定执行路径。
4. 让 v1 之后的普通追问走解释/问答路径，不再自动生成 v2。
5. 仅在用户点击结构化卡片提交或明确表达“生成需求包/评估草稿/进入评估”时进入 Harness report 或写动作链路。
6. 支持 WES 数据查询类问题，并保留 JWT、capability、owner 隔离。
7. 为后续 Phase 1H 低代码 AI 工作流设计器预留能力注册与编排边界。

## 非目标

- 不在 Phase 1G 实现低代码工作流设计器；该能力后置为 Phase 1H。
- 不引入向量库、Prompt Profile CRUD 或标准治理 Harness 化。
- 不开放本地目录、命令执行或桌面连接器。
- 不让 AI 自动创建正式项目、正式需求或正式评估记录。
- 不绕过 JWT、owner、capability、版本机制或人工确认链路。

## 用户场景

| 场景 | 用户输入 | 期望行为 |
| --- | --- | --- |
| 能力发现 | “你能做什么？” | 返回面向当前角色的能力清单、可用工作流和限制边界。 |
| 产品咨询 | “购买存货核算模块，必须购买哪些相关模块？” | 调用模型结合内置产品知识/规则/可用知识源回复，不创建 Harness 报告。 |
| 附件问答 | 上传“客户A问题清单.xlsx”并问“多组织业务往来一般包含哪些模块？” | 解析附件作为上下文，回答该问题，可给出“生成需求解析报告”的建议动作。 |
| 附件摘要 | 上传文件但未明确要求评估 | 先给附件理解摘要；是否进入评估由用户下一步意图决定。 |
| 报告生成 | “请基于这个文件生成需求解析报告” | 进入 Harness `parse-basic-info → report_v1` 链路。 |
| v1 后追问 | “这个风险是什么意思？” | 基于 v1 artifact 解释，不自动走 `submitHarnessAnswers` 或生成 v2。 |
| v1 后补充 | 用户在结构化卡片中补字段并点击提交 | 提交 answers，进入 `clarifying → report_v2_ready`。 |
| 数据查询 | “我之前创建过哪些项目？” | 调用 WES 查询工具，按 owner/capability 返回可见项目摘要。 |
| 写动作 | “帮我创建评估草稿” | 先给确认动作；确认后才能写传统记录，并记录 Harness ToolEvent。 |

## 意图分类

| Intent | 说明 | 是否需要模型 | 是否需要 Harness | 是否允许写传统记录 |
| --- | --- | --- | --- | --- |
| `capability_discovery` | 用户询问 AI 工作台能力、边界、可做事项 | 可选 | 否 | 否 |
| `domain_qa` | WES/ERP/金蝶业务咨询、模块关系、评估口径解释 | 是 | 可选记录 session event | 否 |
| `attachment_summary` | 对上传附件做简短结构化摘要 | 是 | 是，作为 context artifact | 否 |
| `attachment_qa` | 基于附件内容回答具体问题 | 是 | 是，读取附件摘要/evidence | 否 |
| `harness_report_generation` | 明确要求生成需求解析报告、需求包、评估输入 | 是 | 是，走阶段机 | 否 |
| `harness_answer_submission` | 用户提交结构化补充信息生成 v2 | 是 | 是，要求 v1/clarifying 边界 | 否 |
| `wes_data_query` | 查询用户可见项目、需求、评估、历史记录 | 可选 | 可记录 toolEvent/session event | 否 |
| `write_action_request` | 创建/更新草稿、确认动作、进入正式流程 | 可选 | 是，必须审计 | 仅确认后 |
| `unsupported_or_out_of_scope` | 超出 WES 边界的请求 | 可选 | 可记录 | 否 |

## 运行时架构

```text
User Message + Attachments + Current Session + Harness Artifacts
  ↓
Context Builder
  - 当前用户、角色、capability
  - 最近会话消息
  - 上传文件摘要 / evidence / v1/v2 artifact
  - 传统 WES 可查询范围
  ↓
Intent Router
  - 规则优先：显式按钮、命令词、阶段边界
  - 模型兜底：用户自然语言意图分类
  ↓
Tool Planner
  - domain_qa: model answer
  - attachment_qa: retrieve attachment context + model answer
  - report_generation: Harness stage machine
  - wes_data_query: owner-scoped query tool
  - write_action_request: confirmation action
  ↓
Responder
  - answer
  - artifacts
  - suggestedActions
  - trace / warnings
  ↓
Runtime Recorder
  - session event
  - artifact
  - modelRun
  - toolEvent
  - optional confirm action
```

## 前端设计

### 1. 消息发送不再被 v1 artifact 强行接管

当前逻辑在无附件但有文本时，如果最近消息存在 v1 artifact，就直接把文本当作补充信息生成 v2。Phase 1G 应调整为：

- 普通发送：进入意图路由。
- 卡片内“提交补充并生成 v2”：才进入 `submitHarnessAnswers → generateHarnessRequirementReportV2`。
- 明确表达“生成 v2 / 生成补充后的需求报告”：可由意图路由触发 v2，但必须检查阶段和 answers。

### 2. 上传附件后的默认反馈

上传附件后，优先展示“附件理解摘要”：

- 文件名、类型、大小、工作表/页数/段落等结构信息。
- 疑似客户、疑似项目、行业线索、业务线索。
- 模型已理解内容和仍缺少的信息。
- 建议动作：`询问附件内容`、`生成需求解析报告`、`补充客户信息`。

这让用户先感知模型理解了什么，而不是直接看到一张待补充卡片。

### 3. 当前上下文提示

AI 工作台应展示当前消息将基于什么上下文回答：

- 当前附件
- 当前 Harness Run
- 最近 report_v1/report_v2
- 当前项目/评估草稿

但上下文提示不要占据大面积说明文案，可放在右侧产物区或消息卡片顶部的小型 context chip。

### 4. 建议动作与显式触发

模型回答后可以给出建议动作，例如：

- `生成需求解析报告`
- `补充关键字段`
- `创建 AI 草稿`
- `查看相关项目`

建议动作只是下一步入口，不等于自动执行写动作。

## 后端设计

### 推荐接口

优先升级现有 `POST /api/v1/ai/home-workbench/chat`，或新增更明确的：

```http
POST /api/v1/ai/workbench/dispatch
```

请求：

```json
{
  "message": "客户提到多组织业务往来的问题，一般需要包含哪几个功能模块？",
  "sessionId": "session_1",
  "fileIds": ["hfile_1"],
  "harnessRunId": "hrun_1",
  "clientAction": "send_message"
}
```

响应：

```json
{
  "intent": "attachment_qa",
  "answer": {
    "format": "markdown",
    "content": "多组织业务往来通常需要关注组织架构、组织间结算、内部交易、存货核算、应收应付和权限隔离等模块..."
  },
  "artifacts": [],
  "suggestedActions": [
    {
      "id": "generate_requirement_report",
      "label": "生成需求解析报告",
      "actionType": "harness_report_generation",
      "requiresConfirm": false
    }
  ],
  "trace": {
    "intentConfidence": 0.82,
    "contextRefs": ["hfile_1", "artifact_report_v1_1"]
  }
}
```

### Context Builder

Context Builder 负责收敛可用上下文，不让业务处理层直接读取前端状态：

- 用户与权限：userId、role、capabilities。
- 会话上下文：sessionId、最近消息、当前模式。
- 附件上下文：file metadata、file_understanding artifact、evidence 摘要。
- Harness 上下文：run stage、status、v1/v2 artifact、pending actions。
- 传统 WES 上下文：owner 可见项目、需求、评估草稿摘要。

### Intent Router

路由优先级：

1. 前端显式 `clientAction`：按钮点击、卡片提交、确认动作。
2. 阶段硬边界：v2 只能从 clarifying 且存在 answers 生成。
3. 规则识别：能力询问、数据查询、报告生成关键词、写动作关键词。
4. 模型分类：对模糊业务问法和附件问答进行分类。
5. 兜底：普通 `domain_qa`，但标记低置信度并可反问。

### Tool Planner

工具规划只选择系统允许的工具：

- `answerDomainQuestion`
- `answerWithAttachmentContext`
- `summarizeAttachment`
- `listUserProjects`
- `listUserAssessments`
- `generateHarnessReportV1`
- `submitHarnessAnswersAndGenerateV2`
- `createConfirmAction`

所有 WES 数据查询工具必须在 repository/usecase 层执行 owner 和 capability 校验。

## Harness 边界

Phase 1G 不否定 1B 到 1F 的 Harness 阶段机，而是把它从唯一主路径调整为可被意图触发的任务路径：

- 附件摘要可以作为轻量 artifact，进入 Run 或 Session artifact。
- 附件问答可以记录 modelRun 与 context refs，但不必推进到 `report_v1_ready`。
- 报告生成仍使用现有阶段边界。
- 写动作仍必须通过 confirm action 和 ToolEvent。
- v1/v2 报告 schema、stage guard、metadata.answers 约束继续有效。

## 低代码工作流的预留边界

Phase 1G 只沉淀能力注册，不实现可视化编排：

```text
Capability Registry
  intent
  requiredContext
  requiredCapabilities
  allowedTools
  outputSchema
  confirmPolicy
```

Phase 1H 可在此基础上实现工作流低代码模块，让管理员配置“触发条件 → 工具节点 → 模型节点 → 人工确认 → 产物节点”。

## 验收标准

1. 上传附件并附带问题“多组织业务往来一般包含哪些模块？”时，系统回答问题，不自动生成需求解析报告。
2. 上传附件并明确说“生成需求解析报告”时，系统进入 Harness v1 链路。
3. v1 报告后输入“这个风险是什么意思？”时，系统解释风险，不自动生成 v2。
4. v1 报告卡片内双击补字段并点击“提交补充并生成 v2”时，系统生成 v2。
5. 输入“你能做什么？”时，系统返回当前 AI 工作台能力、限制和可用动作。
6. 输入“我之前创建过哪些项目？”时，系统只返回当前用户有权限访问的项目摘要。
7. 写动作类请求必须返回确认动作；未确认前不写传统记录。
8. 所有模型回答应保留可追踪的 session/model trace，关键工具调用保留 toolEvent 或等价审计记录。

## 测试计划

后端测试：

- Intent Router 单元测试：覆盖能力发现、业务问答、附件问答、报告生成、v1 后追问、v2 提交、WES 数据查询、写动作。
- Context Builder 单元测试：覆盖无文件、有文件、有 v1、有 v2、有草稿、有非 owner 数据。
- Route 测试：验证 JWT、capability、owner 边界。
- Harness 回归测试：确认现有 v1/v2 stage guard 不被破坏。

前端测试：

- 上传附件 + 文本问题：断言调用 dispatch/chat，展示回答和建议动作，不调用 v2。
- v1 后普通追问：断言不调用 `submitHarnessAnswers`。
- 卡片提交补充：断言仍调用 v2 链路。
- 能力发现：断言渲染能力卡片。
- WES 数据查询：断言渲染项目列表/空态。

人工测试：

- 复用总看板 `testing.html`，新增 MT-1G-001 到 MT-1G-008。
- 每条记录执行人、浏览器、账号角色、输入材料、Harness Run ID、截图、期望/实际结果。

## 风险与控制

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| 意图误判导致该评估时只聊天 | 用户路径变慢 | 模型回答中给明确建议动作，用户可一键生成报告。 |
| 意图误判导致普通追问生成 v2 | 破坏用户预期 | v2 必须来自显式按钮或高置信“生成报告”意图，并通过 stage guard。 |
| 数据查询越权 | 泄露项目/评估信息 | 所有查询走 usecase/repository owner/capability 校验。 |
| Chat 和 Harness 审计割裂 | 结果不可复盘 | 关键回答记录 modelRun/contextRefs，工具动作记录 toolEvent。 |
| 能力范围过大 | Phase 1G 失焦 | 低代码工作流、向量库、标准治理后置。 |

## 待后续确认

1. `dispatch` 是否作为新接口上线，还是复用 `home-workbench/chat` 并扩展响应结构。
2. 附件问答是否必须创建 Harness Run，还是允许先作为 AI session artifact，用户选择生成报告时再绑定 Harness。
3. WES 数据查询第一期覆盖项目列表、评估列表，还是同时覆盖需求列表。
4. 业务知识问答第一期只依赖模型内知识和现有规则，还是接入轻量模块依赖表。

