# WES Agent Phase 1G 实现提示词

> 用途：交给 KIMI/Codex 执行 Phase 1G 实现。  
> 当前状态：Phase 1F 已完成；Phase 1G 已完成正式设计，进入实现。  
> 工作区：`/Users/kevin/AI/Workload-evaluation-system-agent`。  
> 设计事实源：`docs/superpowers/specs/2026-06-22-wes-agent-phase-1g-intent-runtime-design.md`。  
> 实施计划：`docs/superpowers/plans/2026-06-23-wes-agent-phase-1g-intent-runtime.md`。

## 角色与目标

你是资深全栈工程师 + 架构审计协作者。请在当前 WES Agent 升级主线中实现 Phase 1G：**AI 工作台意图路由与任务运行时升级**。

Phase 1G 的核心产品判断：

> 文件是上下文，用户意图才触发工作流。

当前问题是：AI 工作台在存在 v1 Harness 报告后，会把用户后续普通文本默认当成“补充信息”，直接调用 `submitHarnessAnswers → generateHarnessRequirementReportV2`。这导致用户只是问“这个风险是什么意思？”、“多组织业务往来一般包含哪些模块？”时，系统却进入报告生成流水线。

本次实现目标：

1. 恢复 AI 工作台在 WES 业务边界内的自然语言推理与问答能力。
2. 上传附件后，附件作为上下文；除非用户明确要求生成报告，否则不自动进入 Harness v1/v2。
3. v1 报告后的普通追问必须走解释/问答，不再自动生成 v2。
4. 结构化卡片点击“提交补充并生成 v2”仍然生成 v2。
5. 支持“你能做什么？”能力发现。
6. 支持“我之前创建过哪些项目？”这类 owner-scoped WES 数据查询。
7. 写动作类请求只返回待确认动作；未确认前不写传统正式记录。

## 必须遵守的边界

- 当前正确工作区是 `/Users/kevin/AI/Workload-evaluation-system-agent`，不要使用 `/Users/kevin/AI/Workload-evaluation-system`。
- 当前 Web 主线：`ui/V2_PROTOTYPE`。
- 当前后端主线：`apps/api`。
- 默认 JWT 鉴权，禁止绕过 `Authorization: Bearer`。
- 禁止绕过 owner 隔离、capability、传统版本机制和人工确认链路。
- Harness 是 DB-backed 新业务域；传统 WES 记录除既有实现外不要擅自迁移数据库。
- Phase 1G 不实现低代码工作流设计器；该能力后置到 Phase 1H。
- Phase 1G 不引入向量库、Prompt Profile CRUD、标准治理 Harness 化、本地目录连接器、bash/命令执行。
- 不允许 AI 自动创建正式项目、正式需求、正式评估或正式发布记录。
- 当前 worktree 可能存在既有 dirty changes，不要执行 `git restore`、`git reset --hard`、大范围清理或提交无关文件。

## 已知实现基线

Phase 1B/1C/1D/1E/1F 已完成：

- 文件上传进入 Harness：
  - `parse-basic-info`
  - `createHarnessRun`
  - `bindHarnessFile`
  - `submitHarnessParseResult`
  - `generateHarnessReportV1`
- v1 后结构化补充可进入：
  - `submitHarnessAnswers`
  - `generateHarnessRequirementReportV2`
- v2 nextActions 可 confirm：
  - `/harness/runs/:runId/actions/:actionId/confirm`
- confirm 后创建传统 `draft_from_ai` 项目/评估草稿。
- 传统详情页人工确认 AI 草稿后，已回写 Harness 审计链。

最近已知验证基线：

- `npm run test:harness -w apps/api`：通过
- `npm run test:modules -w apps/api`：通过
- `npm run build -w apps/api`：通过
- `npm run test --prefix ui/V2_PROTOTYPE`：通过
- `npm run build --prefix ui/V2_PROTOTYPE`：通过

## 核心改动范围

### 1. 后端：意图路由

建议新增：

- `apps/api/src/services/ai/workbench-intent.service.ts`
- `apps/api/src/services/ai/workbench-intent.service.test.ts`

需要识别至少这些 intent：

```ts
type WorkbenchIntent =
  | "capability_discovery"
  | "domain_qa"
  | "attachment_summary"
  | "attachment_qa"
  | "harness_report_generation"
  | "harness_answer_submission"
  | "wes_data_query"
  | "write_action_request"
  | "unsupported_or_out_of_scope";
```

规则优先级建议：

1. 前端显式 `clientAction`，例如结构化卡片提交。
2. 能力发现关键词：`你能做什么`、`可以做什么`、`帮助`。
3. WES 数据查询关键词：`我之前创建过哪些项目`、`历史项目`、`我的项目`。
4. 写动作关键词：`创建草稿`、`生成评估草稿`、`进入正式评估`、`发布`。
5. 报告生成关键词：`生成需求解析报告`、`生成需求包`、`生成评估输入`、`生成 v2`。
6. 有附件但无明确报告意图：`attachment_qa` 或 `attachment_summary`。
7. 默认：`domain_qa`。

特别注意：

- 存在 v1 artifact 不等于自动生成 v2。
- 只有结构化卡片提交，或用户明确表达“生成 v2 / 生成补充后的报告”，才进入 `harness_answer_submission`。

### 2. 后端：上下文构建与分发

建议新增：

- `apps/api/src/services/ai/workbench-context.service.ts`
- `apps/api/src/services/ai/workbench-dispatch.service.ts`

建议修改：

- `apps/api/src/services/ai/chat.service.ts`
- `apps/api/src/modules/ai/ai.usecase.ts`
- `apps/api/src/modules/ai/ai.controller.ts`
- `apps/api/src/modules/ai/ai.module.ts`
- `apps/api/src/routes/ai.routes.ts`（仅当新增 dispatch endpoint）

推荐最小实现：

- 优先复用现有 `POST /api/v1/ai/home-workbench/chat`。
- 如新增 endpoint，可加 `POST /api/v1/ai/home-workbench/dispatch`，但必须保持旧接口兼容。
- `homeWorkbenchChat` 返回结构中增加：
  - `intent`
  - `suggestedActions`
  - `trace.intentConfidence`
  - `trace.routingRule`
  - `trace.contextRefs`

WES 数据查询必须复用现有 usecase：

- `apps/api/src/modules/project-evaluations/project-evaluations.usecase.ts`
- 函数：`listProjectEvaluationsForUser(user, query)`

禁止直接读取或拼接跨 owner 的 JSON 记录。

### 3. 前端：发送路径重构

重点文件：

- `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- `ui/V2_PROTOTYPE/src/api/ai.js`
- `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
- `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`

当前需要修正的关键逻辑：

```js
const harnessV1Context = !selectedFile && text ? findLatestHarnessV1Artifact(messages) : null

if (harnessV1Context) {
  await submitHarnessAnswers(...)
  await generateHarnessReportV2(...)
}
```

Phase 1G 要求：

- 删除或绕过“有 v1 + 普通文本 = 自动生成 v2”的隐式分支。
- 普通发送统一走 AI chat/dispatch。
- 结构化卡片的 `handleStructuredSupplement(artifact, answers)` 保持 v2 生成能力。
- 上传附件时：
  - 先解析附件并展示“附件理解摘要”。
  - 如果用户明确要求生成报告，继续走现有 Harness v1 路径。
  - 如果用户是问附件里的业务问题，则走附件问答，不自动创建 Harness v1 报告。

推荐前端辅助函数：

```js
function isExplicitReportRequest(text) {
  return /生成|输出|创建|启动/.test(text || '') && /需求解析报告|需求包|评估输入|评估草稿|报告/.test(text || '')
}
```

### 4. 前端：建议动作

后端返回 `suggestedActions` 后，前端应渲染轻量按钮。

最低要求：

- `generate_requirement_report`：显示“生成需求解析报告”。
- 点击该按钮可以：
  - 预填 composer：`请基于当前附件生成需求解析报告`；或
  - 触发现有显式 Harness v1 流程。
- 写动作类 action 必须标记 `requiresConfirm: true`，不能自动执行。

## 必测场景

### 后端自动化

至少新增/覆盖：

1. `你能做什么？` → `capability_discovery`
2. `我之前创建过哪些项目？` → `wes_data_query`
3. 上传附件 + “多组织业务往来一般包含哪些模块？” → `attachment_qa`
4. v1 后 “这个风险是什么意思？” → `domain_qa`，不进入 v2
5. “请生成需求解析报告” → `harness_report_generation`
6. 结构化卡片提交 → `harness_answer_submission`
7. 写动作请求 → `write_action_request`，只返回待确认动作
8. WES 数据查询只返回当前 owner 可见数据

### 前端自动化

至少新增/修改：

1. 上传附件 + 业务问题：
   - 调用 `/ai/parse-basic-info`
   - 调用 `/ai/home-workbench/chat` 或 dispatch
   - 不调用 `/harness/runs/:id/report-v1`
   - 显示业务回答和“生成需求解析报告”建议动作
2. 上传附件 + 明确“生成需求解析报告”：
   - 保持现有 Harness v1 流程
3. v1 后普通追问：
   - 不调用 `submitHarnessAnswers`
   - 不调用 `generateHarnessReportV2`
   - 显示普通回答
4. 结构化卡片提交：
   - 继续调用 `submitHarnessAnswers`
   - 继续调用 `generateHarnessReportV2`
5. `你能做什么？`：
   - 显示能力清单
6. `我之前创建过哪些项目？`：
   - 显示项目摘要或空态

## 验证命令

必须至少运行：

```bash
npm run test:modules -w apps/api
npm run test:harness -w apps/api
npm run build -w apps/api
npm run test --prefix ui/V2_PROTOTYPE
npm run build --prefix ui/V2_PROTOTYPE
```

如新增测试进入 `test:ai`，也运行：

```bash
npm run test:ai -w apps/api
```

如更新总看板 HTML，运行：

```bash
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/index.html
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/plan.html
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/testing.html
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html
```

## 文档同步要求

如实现完成，请同步：

- `docs/openapi.yaml`：仅当新增 endpoint 或 public response schema。
- `03_技术设计/系统演进/实现与文档对齐说明.md`
- `03_技术设计/系统架构/WES-Agent-升级总看板/index.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`

人工测试台账建议新增：

- `MT-1G-001` 上传附件 + 附件问答
- `MT-1G-002` 上传附件 + 显式报告生成
- `MT-1G-003` v1 后普通追问
- `MT-1G-004` 结构化补充生成 v2
- `MT-1G-005` 能力发现
- `MT-1G-006` WES 项目查询
- `MT-1G-007` 写动作确认边界
- `MT-1G-008` 非 owner 数据隔离

## 输出汇报格式

请最终用中文汇报：

1. 本次实现了哪些 1G 意图路由能力。
2. 哪些场景会走普通问答，哪些场景会走 Harness 报告。
3. v1 后普通追问为什么不会再自动生成 v2。
4. WES 数据查询如何保证 owner/capability 边界。
5. 写动作如何保持人工确认。
6. 修改了哪些后端文件、前端文件、测试文件、文档文件。
7. 每条验证命令的结果。
8. 未完成或建议后续进入 Phase 1H/Phase 2 的事项。

不要提交全部 dirty changes；如需要提交，只能精确 stage 本次相关文件。

