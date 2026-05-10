# PB-R3 Parallel · 后端 API 对齐审计

范围：只读审计 `apps/api/src/routes/*.ts`、`apps/api/src/types/index.ts`、`ui/V2_PROTOTYPE/src/mock/*.js` 与 `ui/V2_PROTOTYPE/src/pages/*.jsx` 中的内嵌 mock。目标是给 Phase B 从 mock 切真实后端提供 cutover 清单。

## 0. 结论先行

1. 后端已经有完整的基础能力：auth/user、versions/VCS、templates/rules/estimates、presales requirement-pack、PM deliverables/reviews/seal、dev-assessments、history、team reviews、wbs。
2. React V2_PROTOTYPE 当前 UI 的实体命名更偏页面语义：`projectName/globalVersion/assessmentVersion/resourceVersion/totalDays/status`；后端偏领域/版本语义：`VersionRecord.versionCode/type/payload/checkoutStatus`、`RequirementPack`、`DevAssessmentRow`、`HistoryProjectRow`。
3. 最大切换风险不是“没有接口”，而是字段层适配与聚合接口：列表页需要扁平行数据，后端多数数据分散在 `/versions`、`/presales`、`/pm`、`/history`、`/team`。
4. 建议先做前端 API adapter 层，禁止页面直接绑 route response；用 adapter 把后端 `snake/camel + domain row` 统一转成页面 ViewModel。

## 1. 后端 endpoint 全量清点

统一挂载前缀来自 `apps/api/src/routes/index.ts`，业务接口位于 `/api/v1/*` 下。入参/返回为静态审计推断：`params` 表示 path params，`query` 表示 `req.query`，`body` 表示 `req.body` 或 controller DTO。

| Routes 文件 | mount | endpoint 数 |
|---|---:|---:|
| ai.routes.ts | `/ai` | 5 |
| auth.routes.ts | `/auth` | 9 |
| change.routes.ts | `/change` | 5 |
| collab.routes.ts | `/collab` | 14 |
| dev-assessment.routes.ts | `/dev-assessments` | 7 |
| estimates.routes.ts | `/estimates` | 5 |
| exports.routes.ts | `/exports` | 1 |
| health.routes.ts | root | 3 |
| history.routes.ts | `/history` | 7 |
| metrics.routes.ts | root | 1 |
| pm.routes.ts | `/pm` | 21 |
| presales.routes.ts | `/presales` | 14 |
| rules.routes.ts | `/rule-sets` | 3 |
| sales-briefing.routes.ts | `/sales` | 7 |
| sessions.routes.ts | `/sessions` | 2 |
| system.routes.ts | `/system` | 11 |
| team.routes.ts | `/teams` | 12 |
| templates.routes.ts | `/templates` | 4 |
| versions.routes.ts | `/versions` | 10 |
| wbs.routes.ts | `/wbs` | 1 |

### ai.routes.ts · 5

| Method | Path | 入参 | 返回字段/shape |
|---|---|---|---|
| POST | `/api/v1/ai/parse-basic-info` | multipart `file` | controller result，基础信息结构化 |
| POST | `/api/v1/ai/company-profile-summary` | body: company/profile text | controller result，企业简介摘要 |
| POST | `/api/v1/ai/kimi-assessment/preview` | body: `KimiAssessmentPreviewInput` | assessment draft/snapshot |
| POST | `/api/v1/ai/kimi-api-key/test` | body: api key/config | `{ success, data }` 连通性结果 |
| POST | `/api/v1/ai/chat` | body: prompt/context | chat response |

### auth.routes.ts · 9

| Method | Path | 入参 | 返回字段/shape |
|---|---|---|---|
| POST | `/api/v1/auth/register` | body: username/password/invite code | auth user/token |
| POST | `/api/v1/auth/login` | body: username/password | auth user/token |
| GET | `/api/v1/auth/me` | token | `PublicUser` |
| POST | `/api/v1/auth/logout` | token | `{ success }` |
| GET | `/api/v1/auth/users` | token/capability | `PublicUser[]` |
| PATCH | `/api/v1/auth/users/:userId/role` | params + body role | `PublicUser` |
| PATCH | `/api/v1/auth/users/:userId/status` | params + body status | `PublicUser` |
| GET | `/api/v1/auth/invite-codes` | token/capability | `InviteCodeRecord[]` |
| POST | `/api/v1/auth/invite-codes/generate` | body optional | `InviteCodeRecord` |

### versions.routes.ts · 10

| Method | Path | 入参 | 返回字段/shape |
|---|---|---|---|
| GET | `/api/v1/versions` | query: type/status/owner 等 | `VersionRecord[]` |
| POST | `/api/v1/versions` | body: type/versionCode/templateId/payload | `VersionRecord` |
| PATCH | `/api/v1/versions/:recordId/status` | params + body status | `VersionRecord` |
| DELETE | `/api/v1/versions/:type/:versionCode` | params | `{ success }` |
| POST | `/api/v1/versions/:id/checkout` | params | `VersionRecord` |
| PATCH | `/api/v1/versions/:id/save-draft` | params + body payload | `VersionRecord` |
| POST | `/api/v1/versions/:id/checkin` | params + body payload/message | `VersionRecord` |
| POST | `/api/v1/versions/:id/undo-checkout` | params | `VersionRecord` |
| POST | `/api/v1/versions/:id/promote` | params | `VersionRecord` |
| PATCH | `/api/v1/versions/:id/force-unlock` | params | `VersionRecord` |

### templates / rules / estimates / sessions / exports · 15

| Method | Path | 入参 | 返回字段/shape |
|---|---|---|---|
| GET | `/api/v1/templates` | query optional | `Template[]` |
| GET | `/api/v1/templates/:templateId` | params | `Template` |
| POST | `/api/v1/templates/import-json` | body template json | `Template` |
| POST | `/api/v1/templates/import-excel` | multipart file | `Template` |
| GET | `/api/v1/rule-sets/active` | none | `RuleSet` |
| GET | `/api/v1/rule-sets/meta` | none | `RuleSetMeta` |
| POST | `/api/v1/rule-sets/import-json` | body rule json | `RuleSet` |
| POST | `/api/v1/estimates/calculate` | body `CalculateRequest` | `EstimateResult` |
| POST | `/api/v1/estimates/calculate-and-export` | body `CalculateRequest` | result + download |
| POST | `/api/v1/estimates/export/excel` | body estimate/export payload | file/download |
| POST | `/api/v1/estimates/export/pdf` | body estimate/export payload | file/download |
| GET | `/api/v1/estimates/dependency-rules/active` | none | active dependency rules |
| POST | `/api/v1/sessions/start` | body estimate context | session id/context |
| POST | `/api/v1/sessions/:sessionId/calculate` | params + body | `EstimateResult` |
| GET | `/api/v1/exports/history` | query optional | `ExportHistoryItem[]` |

### presales.routes.ts · 14

| Method | Path | 入参 | 返回字段/shape |
|---|---|---|---|
| POST | `/api/v1/presales/requirement-packs` | body: `sourceExtractionId/extractionId` | `RequirementPack` |
| GET | `/api/v1/presales/requirement-packs` | query: `status` | `RequirementPack[]` |
| GET | `/api/v1/presales/requirement-packs/:id` | params | `RequirementPack` |
| PATCH | `/api/v1/presales/requirement-packs/:id` | params + `UpdateRequirementPackInput` | `RequirementPack` |
| DELETE | `/api/v1/presales/requirement-packs/:id` | params | `{ success }` |
| POST | `/api/v1/presales/requirement-packs/:id/review` | params | `ReviewResult` with violations/inquiries/confidence |
| GET | `/api/v1/presales/requirement-packs/:id/confidences` | params | `FieldConfidence[]` |
| POST | `/api/v1/presales/requirement-packs/:id/initial-estimate` | params | `InitialEstimate` |
| GET | `/api/v1/presales/initial-estimates/:id` | params | `InitialEstimate` |
| PATCH | `/api/v1/presales/initial-estimates/:id` | params + `UpdateEstimateInput` | `InitialEstimate` |
| POST | `/api/v1/presales/requirement-packs/:id/sow` | params + `cloudProduct` | `SowDocument[]` |
| GET | `/api/v1/presales/sow-documents/:id` | params | `SowDocument` |
| PATCH | `/api/v1/presales/sow-documents/:id` | params + `UpdateSowInput` | `SowDocument` |
| GET | `/api/v1/presales/requirement-packs/:id/sow` | params | `SowDocument[]` |

### pm.routes.ts · 21

| Method | Path | 入参 | 返回字段/shape |
|---|---|---|---|
| POST | `/api/v1/pm/handoffs` | `CreateHandoffInput` | `AssessmentHandoffRow` |
| GET | `/api/v1/pm/handoffs` | query: version/toRole/status | handoff list |
| GET | `/api/v1/pm/handoffs/:id` | params | handoff detail |
| PATCH | `/api/v1/pm/handoffs/:id` | `UpdateHandoffInput` | handoff detail |
| POST | `/api/v1/pm/narratives` | `CreateNarrativeInput` | narrative |
| POST | `/api/v1/pm/narratives/generate` | version/context body | narrative |
| GET | `/api/v1/pm/narratives/:id` | params | narrative |
| GET | `/api/v1/pm/versions/:versionId/narrative` | params | narrative |
| PATCH | `/api/v1/pm/narratives/:id` | `UpdateNarrativeInput` | narrative |
| POST | `/api/v1/pm/deliverables/generate` | `GenerateDeliverablesInput` | 4 deliverables |
| GET | `/api/v1/pm/deliverables/:id` | params | deliverable |
| GET | `/api/v1/pm/versions/:versionId/deliverables` | params | deliverable list |
| PATCH | `/api/v1/pm/deliverables/:id/status` | body status | deliverable |
| POST | `/api/v1/pm/reviews` | `CreateReviewInput` | quality gate review |
| POST | `/api/v1/pm/reviews/auto` | body auto review params | review |
| GET | `/api/v1/pm/reviews/:id` | params | review |
| GET | `/api/v1/pm/versions/:versionId/review` | params | review |
| PATCH | `/api/v1/pm/reviews/:id` | `UpdateReviewInput` | review |
| POST | `/api/v1/pm/seal` | `SealInput` | sealed baseline |
| GET | `/api/v1/pm/seal/:id` | params | sealed baseline |
| GET | `/api/v1/pm/versions/:versionId/seal` | params | sealed baseline |

### dev-assessment / change / history / team / wbs · 32

| Method | Path | 入参 | 返回字段/shape |
|---|---|---|---|
| POST | `/api/v1/dev-assessments` | `CreateDevAssessmentInput` | dev assessment |
| GET | `/api/v1/dev-assessments` | query optional | dev assessment list |
| GET | `/api/v1/dev-assessments/:id` | params | dev assessment |
| PATCH | `/api/v1/dev-assessments/:id` | `UpdateDevAssessmentInput` | dev assessment |
| POST | `/api/v1/dev-assessments/:id/generate` | params + AI body | generated draft |
| POST | `/api/v1/dev-assessments/:id/merge` | `MergeToVersionInput` | merge result |
| GET | `/api/v1/dev-assessments/versions/:versionId/dev-assessment` | params | dev assessment |
| POST | `/api/v1/change/change-submissions` | `SubmitChangeInput` | change submission |
| GET | `/api/v1/change/change-submissions/:id` | params | change detail |
| GET | `/api/v1/change/change-submissions` | query filters | change list |
| POST | `/api/v1/change/change-submissions/:id/merge` | params | merged change |
| POST | `/api/v1/change/change-submissions/:id/reject` | `RejectInput` | rejected change |
| POST | `/api/v1/history/projects` | `CreateHistoryProjectInput` | history project |
| GET | `/api/v1/history/projects` | query `industry/scale/limit/offset` | history project list |
| GET | `/api/v1/history/projects/:id` | params | history project |
| PATCH | `/api/v1/history/projects/:id` | `UpdateHistoryProjectInput` | history project |
| DELETE | `/api/v1/history/projects/:id` | params | `{ success }` |
| POST | `/api/v1/history/projects/:id/close-from-baseline` | params/body baseline | history project |
| GET | `/api/v1/history/similar` | query `industry/scale/modules` | `SimilarProjectResult[]` |
| POST | `/api/v1/teams` | body team | team |
| GET | `/api/v1/teams/:teamId` | params | team detail |
| POST | `/api/v1/teams/:teamId/members` | params + body member | member |
| PATCH | `/api/v1/teams/:teamId/members/:userId` | role body | member |
| DELETE | `/api/v1/teams/:teamId/members/:userId` | params | `{ success }` |
| GET | `/api/v1/teams/:teamId/plans` | params/query | plan list |
| PATCH | `/api/v1/teams/:teamId/plans/:globalVersionCode/binding` | params + binding body | plan |
| POST | `/api/v1/teams/:teamId/reviews` | body review | review |
| GET | `/api/v1/teams/:teamId/reviews` | query | review list |
| PATCH | `/api/v1/teams/:teamId/reviews/:reviewId/status` | status body | review |
| GET | `/api/v1/teams/:teamId/reviews/:reviewId/comments` | params | comments |
| POST | `/api/v1/teams/:teamId/reviews/:reviewId/comments` | body comment | comment |
| GET | `/api/v1/wbs` | query optional | WBS rows |

### collab / sales / system / health · 44

| Method | Path | 入参 | 返回字段/shape |
|---|---|---|---|
| POST | `/api/v1/collab/workspaces` | body workspace | workspace |
| GET | `/api/v1/collab/workspaces` | query | workspace list |
| GET | `/api/v1/collab/workspaces/:id` | params | workspace |
| PATCH | `/api/v1/collab/workspaces/:id` | body | workspace |
| DELETE | `/api/v1/collab/workspaces/:id` | params | `{ success }` |
| POST | `/api/v1/collab/workspaces/:id/members` | body member | workspace |
| DELETE | `/api/v1/collab/workspaces/:id/members/:userId` | params | workspace |
| POST | `/api/v1/collab/workspaces/:id/messages` | body message | message |
| GET | `/api/v1/collab/workspaces/:id/messages` | params/query | messages |
| GET | `/api/v1/collab/messages/:messageId` | params | message |
| PATCH | `/api/v1/collab/messages/:messageId` | body | message |
| DELETE | `/api/v1/collab/messages/:messageId` | params | `{ success }` |
| GET | `/api/v1/collab/messages/:messageId/thread` | params | thread |
| GET | `/api/v1/collab/workspaces/:id/stats` | params | stats |
| POST | `/api/v1/sales/briefs` | `CreateBriefInput` | opportunity brief |
| GET | `/api/v1/sales/briefs` | query | brief list |
| GET | `/api/v1/sales/briefs/:id` | params | brief |
| PATCH | `/api/v1/sales/briefs/:id` | `UpdateBriefInput` | brief |
| DELETE | `/api/v1/sales/briefs/:id` | params | `{ success }` |
| POST | `/api/v1/sales/briefs/:id/quote` | `GenerateQuoteInput` | quote |
| POST | `/api/v1/sales/briefs/:id/recalculate` | `RecalculateInput` | quote |
| GET | `/api/v1/system/version-code-rules` | none | `VersionCodeRule[]` |
| PATCH | `/api/v1/system/version-code-rules/:ruleId/config` | body config | rule |
| POST | `/api/v1/system/version-code-rules/:ruleId/activate` | params | rule |
| POST | `/api/v1/system/version-code-rules/:ruleId/disable` | params | rule |
| GET | `/api/v1/system/requirement-settings` | none | `RequirementSystemConfigPublic` |
| PATCH | `/api/v1/system/requirement-settings/draft` | config draft body | config |
| POST | `/api/v1/system/requirement-settings/activate` | none/body | config |
| POST | `/api/v1/system/requirement-settings/kimi-api-key/test` | body key | test result |
| GET | `/api/v1/system/implementation-dependency-rules` | none | dependency rule config |
| PATCH | `/api/v1/system/implementation-dependency-rules/draft` | body config | config |
| POST | `/api/v1/system/implementation-dependency-rules/activate` | none | config |
| GET | `/api/v1/health` | none | health |
| GET | `/api/v1/health/ready` | none | readiness |
| GET | `/api/v1/health/info` | none | version/info |
| GET | `/api/v1/metrics` | none | metrics |

## 2. V2_PROTOTYPE mock 全量清点

| 数据集 | 字段（类型/示例） | 使用页面 |
|---|---|---|
| `assessment` | `id:string ASM-018`, `projectName`, `status/statusLabel`, `versionCode/versionLabel`, `model`, `productLines[]`, `requirementSource{code,version,title}`, `vcs{checkedOutBy,checkedOutAt,isReadonly,hasLocalChanges}`, `params{userCount,difficultyFactor,orgCount,orgSimilarity}`, `context{template,ruleSet,globalVersion}`, `dsl{passed,issues[]}`, `kpi{totalDays,...}`, `path`, `skuGroups[]`, `multiOrg`, `exportHistory`, `aiCopilot`, `summary` | `AssessmentDetail.jsx` + 12 assessment components |
| `assessments` | `id:number`, `projectName`, `productLine`, `globalVersion`, `assessmentVersion`, `quoteMode`, `totalDays:number`, `orgCount:number`, `difficultyFactor:number`, `status`, `owner`, `updatedAt` | `AssessmentList.jsx` |
| `requirements` | `id`, `globalVersion`, `versionCode`, `projectName`, `productLine`, `customer`, `status`, `creator`, `updater`, `updatedAt` | `RequirementList.jsx` |
| `devAssessments` | `id`, `projectName`, `globalVersion`, `devVersion`, `assessor`, `totalDays`, `status`, `owner`, `updatedAt` | `DevAssessmentList.jsx` |
| `resourceCosts` | `id`, `projectName`, `globalVersion`, `resourceVersion`, `quoteMode`, `totalDays`, `orgCount`, `status`, `owner`, `updatedAt` | `ResourceCostList.jsx` |
| `reviews` | `id`, `projectName`, `version`, `reviewers`, `deadline`, `status`, `updatedAt` | `ReviewList.jsx` |
| `wbsItems` | `id`, `name`, `assignee`, `start`, `end`, `progress`, `status` | `WbsList.jsx` |
| `historyItems` | `id`, `projectName`, `customer`, `industry`, `scale`, `version`, `similarity`, `totalDays`, `totalAmount`, `year`, `status`, `updatedAt` | `HistoryList.jsx` |
| `HomePage.PLANS` | `id`, `projectName`, `globalVersion`, `status`, `checkedOut:boolean`, `mandays` | `HomePage.jsx` |
| `RequirementDetail` inline | `basicInfo[]`, `valueProps[]`, `scopeItems[]` | `RequirementDetail.jsx` |
| `DevAssessmentDetail.INITIAL_ITEMS` | `group`, `name`, `base`, `diff`, `factor`, `status` | `DevAssessmentDetail.jsx` |
| `ResourceCostDetail.groups` | `group`, `role`, `subtotal{days,amount}`, `rows{name,unitPrice,plannedDays,travelCost,months[]}` | `ResourceCostDetail.jsx` |
| `ReviewDetail` inline | `SEALS[]`, `deliverables{id,name,type,status,generatedAt,sealName}`, `checklist[]`, `comments[]` | `ReviewDetail.jsx` |
| `SystemManagement` inline | `rules`, `models`, `dslRules`, `templates`, `prompts` | `SystemManagement.jsx` |
| `UserManagement.INITIAL_USERS` | `id`, `username`, `role`, `status`, `lastLoginAt`, `locked` | `UserManagement.jsx` |
| `ApiKeys.INITIAL_KEYS` | `id`, `name`, `key`, `status`, `scope`, `createdAt`; `catalog{method,path,desc}` | `ApiKeys.jsx` |

## 3. 实体维度对照分析

| 实体 | mock 字段 | 后端字段/endpoint | 对齐情况 | 切换动作 |
|---|---|---|---|---|
| Plan / 总方案 | `projectName/globalVersion/status/checkedOut/mandays` | `/teams/:teamId/plans`, `/versions` 的 `VersionRecord{type,versionCode,payload,checkoutStatus}` | ⚠ 字段名和聚合来源不一致 | 建 `PlanVM` adapter：`globalVersion ← versionCode/baseCode`，`checkedOut ← checkoutStatus`，`mandays ← payload.totalDays` |
| Requirement | `versionCode/projectName/productLine/customer/status/creator/updater` + 详情 6+1 区 | `/presales/requirement-packs*`，types 中 `RequirementImportData` | ⚠ 列表字段不直出，详情结构更丰富 | 用 `RequirementPack` + `VersionRecord(type=requirementImport)` 聚合；详情区映射 `RequirementImportData` |
| Assessment | `assessment` 深层结构、SKU、DSL、KPI、VCS | `/versions`, `/estimates/calculate`, `/templates`, `/rule-sets`, `/ai/kimi-assessment/preview` | ⚠ 后端是计算/版本组合，没有 `/assessments/:id` 聚合接口 | 前端 adapter 先组合多接口；后端可增 BFF `/assessments/:id/view` 降低页面复杂度 |
| ResourceCost | `resourceVersion/quoteMode/totalDays/orgCount`，详情 `groups/months/cost` | `/versions(type=resource)`, `/pm/deliverables`, `/estimates/export/*` | ⚠ ResourceCost 页面 ViewModel 无直接接口 | 使用 `VersionRecord.payload` 承载资源成本；或补 `/resource-costs` BFF |
| Review | `reviews[]`, `checklist/comments/deliverables/seal` | `/pm/reviews*`, `/pm/deliverables*`, `/pm/seal*`, `/teams/:teamId/reviews*` | ⚠ 能力覆盖，但 list/detail 字段分散 | ReviewDetail 聚合 PM 三类接口；ReviewList 用 team/pm review 列表 adapter |
| User | `id/username/role/status/lastLoginAt/locked` | `/auth/users`, `/auth/users/:id/role`, `/auth/users/:id/status`, `PublicUser` | ✓ 基本对齐，`locked` 为前端策略字段 | `locked ← username==='admin' || role==='admin' && policy`；降权保护在前端保留二次确认 |
| ApiKey | `id/name/key/status/scope/createdAt` | 仅 `/auth/invite-codes*`、`/system/requirement-settings/kimi-api-key/test` | ✗ mock 有 api 无 | 补 API Key CRUD 或明确页面只管理 invite/API catalog；当前 catalog 路径也需改成真实 `/api/v1/*` |
| HistoryProject | `customer/projectName/version/similarity/totalDays/totalAmount/year` | `/history/projects*`, `/history/similar`, `HistoryProjectRow{industry,scale,modules,estimatedDays,actualDays,estimatedCost,actualCost}` | ⚠ 字段名不一致，mock 有 `customer/projectName/version/year` | adapter：`totalDays ← actualDays ?? estimatedDays`，`totalAmount ← actualCost ?? estimatedCost`，`similarity ← similarityScore` |
| WbsItem | `name/assignee/start/end/progress/status` | `/wbs` | ⚠ route 存在但 shape 未从 route 文件显式确认 | 建 WbsVM adapter；若后端返回 PM deliverable WBS，需要从 `deliverable.content` 展开 |
| DevAssessment | `devVersion/assessor/totalDays/status`，详情 `group/name/base/diff/factor` | `/dev-assessments*`, service `DevAssessmentItemInput{domain,module,description,devType,codingDays,totalDays}` | ⚠ 语义相近但字段名不同 | `base ← codingDays`，`group ← domain`，`name ← module/description`；保留 `diff/factor` 为前端计算或扩展字段 |

## 4. 后端缺口（mock 用到但 apps/api 没有的 endpoint）

| 调用位置（page） | 期望 endpoint | 当前 mock 字段 | 优先级 |
|---|---|---|---|
| `AssessmentList.jsx` | `GET /api/v1/assessments` 或 BFF `GET /api/v1/assessment-views` | `projectName/productLine/globalVersion/assessmentVersion/quoteMode/totalDays/orgCount/difficultyFactor/status` | P0 |
| `AssessmentDetail.jsx` | `GET /api/v1/assessments/:id/view` | `assessment` 深层 SKU/KPI/DSL/VCS/path/multiOrg | P0 |
| `ResourceCostList.jsx` | `GET /api/v1/resource-costs` | `resourceVersion/quoteMode/totalDays/orgCount/status` | P1 |
| `ResourceCostDetail.jsx` | `GET /api/v1/resource-costs/:id/view` | role/month allocation, travel cost, KPI 三联 | P1 |
| `ApiKeys.jsx` | `GET/POST/PATCH /api/v1/api-keys` | `name/key/status/scope/createdAt` | P1 |
| `HomePage.jsx` | `GET /api/v1/dashboard/home` | 4 KPI、方案列表、动态 feed | P2 |
| `RequirementDetail.jsx` | `GET /api/v1/requirements/:id/view` | 6+1 区、Kimi dialog、DSL 审阅 | P1 |

## 5. Mock 缺口（apps/api 已有但 V2_PROTOTYPE mock 未覆盖）

| 后端 endpoint | 数据用途 | 应补到哪个 page | 优先级 |
|---|---|---|---|
| `/api/v1/presales/requirement-packs/:id/confidences` | 字段级置信度 | `RequirementDetail` Kimi-help / 解析弹窗 | P1 |
| `/api/v1/change/change-submissions*` | 变更提交、合并、驳回 | `AssessmentDetail` 变更对比 Tab | P1 |
| `/api/v1/collab/workspaces*` | 协同空间、消息、线程 | `AssessmentDetail`/后续协作面板 | P2 |
| `/api/v1/sales/briefs*` | 商机 briefing、报价 | `HomePage` 新建方案向导前置 | P2 |
| `/api/v1/pm/handoffs*` | IMPL → PM → PMO 接力 | `ReviewDetail` PM 接力 | P1 |
| `/api/v1/pm/narratives*` | 五段叙事 | `AssessmentDetail` 五段叙事 Tab | P1 |
| `/api/v1/exports/history` | 导出历史 | `AssessmentDetail` 附件/SOW Tab | P2 |
| `/api/v1/sessions/*` | 会话式估算 | `AssessmentDetail` 参数/计算流程 | P2 |

## 6. Cutover 建议：适配层与分批 prompt 草稿

```text
你是 WES Phase B cutover engineer。目标：把 ui/V2_PROTOTYPE 从 mock 切到 apps/api。

边界：
1. 不直接在页面里写 fetch，先建 api client + ViewModel adapter。
2. 保持 React 页面现有 UI，不做视觉重构。
3. 每批最多 3 个页面，先只读，后写操作。

批 1 · API client 基座
- 新建 apiClient，统一 baseUrl=/api/v1、auth token、错误包装。
- 定义 ViewModel：PlanVM、AssessmentListVM、RequirementVM、ReviewVM、HistoryProjectVM。
- 加 mock fallback 开关，便于 dev server 无后端时仍可验收。

批 2 · 只读 list 页
- 切 /auth/users → UserManagement。
- 切 /history/projects + /history/similar → HistoryList/HistoryDetail。
- 切 /dev-assessments → DevAssessmentList。
- 对 ListPage 保持单/Cmd/Shift 选择逻辑不变。

批 3 · 版本/VCS 列表
- 切 /versions?type=assessment/resource/dev/global。
- 建 versionsAdapter：status、checkoutStatus、owner、updatedAt、payload.totalDays。
- AssessmentList / ResourceCostList / HomePage 方案列表共用 adapter。

批 4 · AssessmentDetail 读模型
- 组合 /versions/:id payload、/templates、/rule-sets、/estimates/calculate。
- 若组合过重，提出后端 BFF /assessments/:id/view。
- 保持 v3 §2-§5 14 项视觉验收不回退。

批 5 · RequirementDetail
- 切 /presales/requirement-packs/:id。
- 接 /review、/confidences、/sow。
- Kimi-help dialog 使用 /ai/parse-basic-info 与 /ai/kimi-assessment/preview。

批 6 · PM/Review/Deliverables
- 切 /pm/reviews、/pm/deliverables、/pm/seal、/pm/handoffs。
- ReviewDetail 的驳回、印章、PM 接力从 mock state 改为 API mutation。

批 7 · ResourceCost/WBS
- ResourceCost 优先读 VersionRecord payload 或新增 /resource-costs BFF。
- WBS 从 /wbs 或 /pm/deliverables(type=wbs) 展开。

批 8 · 写操作与 VCS
- 检出/检入/撤销/升版/强解锁统一调用 /versions/:id/*。
- 所有 mutation 后 invalidate 当前 list/detail。

批 9 · 系统管理/API Keys
- SystemManagement 切 /system/version-code-rules、/requirement-settings、/implementation-dependency-rules。
- ApiKeys 若后端未补 CRUD，页面保留 mock 并标注 blocked。

批 10 · 验收
- 跑 18 路由 smoke checklist。
- DevTools console 0 warning/error。
- /api-keys 200。
- 禁用 token grep 0。
```

## 7. 完成标志

审计完成：apps/api routes 20 个文件 · 共 142 个 endpoint  
对照 V2_PROTOTYPE mock：2 个完全对齐 · 8 个需重命名 · 6 个需补 endpoint  
切后端工作量预估：2-3 周
