# WES Harness Phase 1F 实现提示词

> 用途：交给 KIMI/Codex 执行 Phase 1F 实现。  
> 当前状态：Phase 1E 已完成；Phase 1F 已激活但尚未实现。  
> 工作区：`/Users/kevin/AI/Workload-evaluation-system-agent`。

## 角色与目标

你是资深全栈工程师 + 架构审计协作者。请在当前 WES Agent 升级主线中实现 Phase 1F：**传统工作台人工确认/发布 AI 草稿后，回写 Harness 审计链**。

Phase 1F 的业务目标：

1. Phase 1E 已完成的 AI 草稿可见、可跳转、可追溯保持不变。
2. 用户在传统工作台对 AI 草稿执行人工确认、发布或进入正式评估流程时，系统把这次人工动作回写到对应 Harness run/action。
3. 回写信息必须能证明：谁确认、何时确认、确认了哪个草稿、状态如何变化、进入了哪个正式记录或流程。
4. 仍然不允许 AI 自动创建正式评估、正式需求或正式项目推进。

## 必须遵守的边界

- 当前正确工作区是 `/Users/kevin/AI/Workload-evaluation-system-agent`，不要使用 `/Users/kevin/AI/Workload-evaluation-system`。
- 前端主线：`ui/V2_PROTOTYPE`。
- 后端主线：`apps/api`。
- 默认 JWT 鉴权，禁止绕过 `Authorization: Bearer`、owner 隔离和传统权限边界。
- Harness 是 DB-backed 新业务域；传统 WES 记录除既有实现外不要擅自迁移数据库。
- Phase 1F 只做人工确认回写 Harness 审计，不引入向量库、Prompt Profile CRUD、标准治理 Harness 化、桌面连接器或更高 Agent 自治。
- 当前 worktree 可能有既有 dirty changes，不要清理、restore 或提交无关文件。

## 已知 Phase 1E 基线

后端：

- `project-evaluations` list/detail 已暴露：
  - `createdFromHarnessRunId`
  - `createdFromHarnessActionId`
  - `assessmentVersionCode`
- 已有详情接口：`GET /api/v1/project-evaluations/:projectId`
- Harness confirm 已能从 v2 nextAction 创建 `draft_from_ai` 传统草稿。

前端：

- `AssessmentList` 支持“AI 草稿”过滤与 badge。
- `AssessmentDetail` 展示 AI 来源 banner。
- `AiHomeWorkbench` confirm 成功后展示草稿跳转入口。

现有验证基线：

- `npm run test:harness -w apps/api`：62 pass
- `npm run test:modules -w apps/api`：66 pass
- `npm run build -w apps/api`：通过
- `npm run test --prefix ui/V2_PROTOTYPE`：64 pass
- `npm run build --prefix ui/V2_PROTOTYPE`：通过

## 推荐实现范围

### 1. 后端回写能力

请优先沿现有模块边界实现，不直接在业务层读写 JSON 结构。

建议检查并修改：

- `apps/api/src/modules/project-evaluations/project-evaluations.types.ts`
- `apps/api/src/modules/project-evaluations/project-evaluations.repository.ts`
- `apps/api/src/modules/project-evaluations/project-evaluations.usecase.ts`
- `apps/api/src/modules/project-evaluations/project-evaluations.controller.ts`
- `apps/api/src/routes/project-evaluations.routes.ts`
- `apps/api/src/modules/harness/harness.repository.ts`
- `apps/api/src/modules/harness/harness.usecase.ts`
- `apps/api/src/modules/harness/harness.types.ts`

建议能力：

- 在传统评估草稿的人工确认/发布/进入正式流程动作中，识别是否来自 Harness：
  - 存在 `createdFromHarnessRunId`
  - 存在 `createdFromHarnessActionId`
- 若来自 Harness，则写入回写审计记录：
  - 推荐优先写 Harness ToolEvent；如现有抽象更适合 metadata transition，也可以采用 metadata，但必须可查询、可测试、可追溯。
  - 记录字段至少包括：
    - `runId`
    - `sourceActionId`
    - `projectEvaluationId`
    - `assessmentVersionId` 或草稿版本号
    - `confirmedBy`
    - `confirmedAt`
    - `fromStatus`
    - `toStatus`
    - `formalRecordId` 或正式流程入口
    - `result`
- 回写必须幂等：
  - 同一个 run/action/草稿确认重复触发时，不重复写多条冲突审计事件。
  - 重复触发应返回既有回写结果或稳定状态。

### 2. 前端展示能力

建议检查并修改：

- `ui/V2_PROTOTYPE/src/hooks/useAssessmentDetail.js`
- `ui/V2_PROTOTYPE/src/pages/AssessmentDetail.jsx`
- `ui/V2_PROTOTYPE/src/pages/AssessmentList.jsx`（如需要）
- `ui/V2_PROTOTYPE/src/api/*` 或既有 project-evaluations API 封装
- `ui/V2_PROTOTYPE/src/__tests__/AssessmentDetail.test.jsx`
- `ui/V2_PROTOTYPE/src/__tests__/mocks/data.js`
- `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`

建议体验：

- 对 AI 草稿详情页展示回写状态：
  - `待人工确认`
  - `已回写 Harness 审计`
  - `回写失败`（如果后端能返回失败状态）
- 人工确认/发布成功后，页面应能看到 Harness 回写状态或提示。
- 不要把回写状态文案设计成“AI 已自动完成正式评估”。

### 3. API 契约与文档

如新增或调整接口字段，请同步：

- `docs/openapi.yaml`
- `03_技术设计/系统演进/实现与文档对齐说明.md`
- `03_技术设计/系统架构/WES-Agent-升级总看板/index.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/risks.html`
- `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`

Phase 1F 完成后，总看板应从“1F active / 待实现”更新为“1F delivered / 已验证”。

## 测试要求

后端至少覆盖：

- AI 草稿人工确认后写入 Harness 审计。
- 非 Harness 来源草稿不写 Harness 回写事件。
- 非 owner 或无权限用户不能触发回写。
- 重复确认不会重复创建冲突回写事件。
- 回写失败时传统业务状态不被错误标记为已审计。

前端至少覆盖：

- 详情页显示 AI 来源 + 回写状态。
- 人工确认后展示“已回写 Harness 审计”或等价状态。
- 回写失败/待回写状态有清晰提示。
- 非 AI 草稿不显示 Harness 回写状态。

建议验证命令：

```bash
npm run test:harness -w apps/api
npm run test:modules -w apps/api
npm run build -w apps/api
npm run test --prefix ui/V2_PROTOTYPE
npm run build --prefix ui/V2_PROTOTYPE
```

如涉及 agent/rules/integration 路径，也补跑：

```bash
npm run test:agent -w apps/api
npm run test:rules
npm run test:integration
```

## 输出要求

请最终汇报：

1. 后端新增/修改的回写链路。
2. 前端新增/修改的回写状态展示。
3. 幂等和权限如何保证。
4. 测试命令与结果。
5. 未实现或需要后续评审的事项。

不要提交全部 dirty changes；如需要提交，只能精确 stage 本次相关文件。
