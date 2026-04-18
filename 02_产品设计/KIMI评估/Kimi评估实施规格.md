# Kimi 智能评估实施规格（需求 -> 实施评估预览）

## 1. 目标与边界

### 1.1 目标
- 在 `需求` 页面 `Kimi-help` 下新增 `Kimi评估` 按钮。
- 基于当前需求页完整数据，调用 Kimi 生成“实施评估草稿”。
- 先展示“实施评估预览弹窗”，由用户确认后再进入实施评估页面。

### 1.2 边界
- 本阶段不直接覆盖正式实施评估版本。
- 本阶段不新增数据库，沿用文件存储与现有模块边界。
- AI 结果必须可编辑、可放弃、可追溯。

---

## 2. 用户流程

1. 用户在 `需求` 页面完成信息录入。
2. 点击 `Kimi-help -> Kimi评估`。
3. 前端收集当前页面数据并调用后端 AI 评估接口。
4. 后端组装规则与提示词，调用 Kimi。
5. 后端返回结构化评估结果。
6. 前端弹出“实施评估预览”弹窗（不落库）。
7. 用户可选：
   - `关闭`：不落库；
   - `应用到实施评估`：跳转实施评估页并回填草稿；
   - `重新生成`：再次调用接口（可选，二期）。

---

## 3. 前端改造点

## 3.1 页面入口（需求页）
- 位置：`ui/V0_SAAS/app/dashboard/requirement-import/page.tsx`
- 在 `Kimi-help` Popover 增加按钮 `Kimi评估`。
- 触发时校验：
  - 至少要求：`项目名称` 不为空；
  - 建议要求：`总方案版本号`、`业务需求及问题一览` 至少 1 行有效内容。

## 3.2 预览弹窗
- 建议新增组件：`ui/V0_SAAS/components/workload/kimi-assessment-preview-dialog.tsx`
- 展示区块：
  - 元信息：模型名、生成时间、置信度、规则版本；
  - 评估信息：用户数、组织数、组织相似度、难度系数、报价模式、产品线；
  - 模块估算明细：模块、标准人天、建议人天、调整原因；
  - 风险与说明：风险清单、假设前提、建议下一步。
- 操作按钮：
  - `关闭`
  - `应用到实施评估`
  - `重新生成`（可后续迭代）

## 3.3 前端服务层
- 文件：`ui/V0_SAAS/lib/workload-service.ts`
- 新增方法（建议）：
  - `generateKimiAssessmentPreview(payload)`
  - `buildAssessmentPrefillFromKimi(result)`（映射辅助函数）

---

## 4. 后端改造点

## 4.1 路由与模块
- 路由建议：`POST /api/v1/ai/kimi-assessment/preview`
- 路由挂载：`apps/api/src/routes/*` 并在 `routes/index.ts` 聚合。
- 业务层建议：`apps/api/src/modules/ai/*`（或现有 ai 模块扩展）。

## 4.2 请求体（建议）
```json
{
  "source": {
    "globalVersionCode": "GL-xxx",
    "requirementVersionCode": "RI-xxx"
  },
  "requirementSnapshot": {
    "basicInfo": {},
    "valuePropositionRows": [],
    "businessNeedRows": [],
    "devOverviewRows": [],
    "productModuleRows": [],
    "implementationScopeRows": [],
    "meetingNotes": "",
    "keyPointRows": []
  },
  "ruleContext": {
    "versionEncodingRules": [],
    "assessmentRules": [],
    "promptProfile": "assessment_default_v1"
  }
}
```

## 4.3 响应体（建议）
- 统一结构：`{ code, message, data }`
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "meta": {
      "model": "kimi-k2.5",
      "generatedAt": "2026-04-06T12:00:00.000Z",
      "confidence": 0.78,
      "promptVersion": "kimi_assessment_v1",
      "ruleSetId": "assessment-rules-v1"
    },
    "assessmentDraft": {
      "quoteMode": "模块报价",
      "productLines": ["金蝶AI星空"],
      "userCount": 300,
      "orgCount": 1,
      "orgSimilarity": 0,
      "difficultyFactor": 0.4,
      "moduleItems": [
        {
          "moduleName": "总账",
          "standardDays": 2,
          "suggestedDays": 3,
          "reason": "多组织核算场景复杂"
        }
      ],
      "risks": ["主数据口径未统一"],
      "assumptions": ["按一期范围估算，不含历史数据治理"]
    }
  }
}
```

## 4.4 异常码建议
- `42201`：输入信息不足（缺少关键字段）
- `42202`：Kimi 返回结构不合法（schema 校验失败）
- `42901`：调用频率限制
- `50201`：上游模型服务失败
- `50401`：模型调用超时

---

## 5. 提示词与规则注入规范

## 5.1 组合策略
- System Prompt：角色、输出约束、禁止项、JSON schema。
- User Prompt：当前需求快照 + 规则上下文 + 评估目标。
- Rule Context：系统管理里生效规则 + 评估模块规则。

## 5.2 输出硬约束
- 必须返回 JSON，不得混入说明性自然语言。
- 必须包含：
  - `assessmentDraft.quoteMode`
  - `assessmentDraft.userCount/orgCount/orgSimilarity/difficultyFactor`
  - `assessmentDraft.moduleItems[].suggestedDays/reason`
- 数值范围要求：
  - `difficultyFactor`：`0` 到 `1`
  - `orgSimilarity`：`0` 到 `1`
  - 人天相关字段：`>= 0`

---

## 6. 需求 -> 实施评估回填映射

## 6.1 直接映射
- `assessmentDraft.productLines` -> 实施评估 `form.productLines`
- `assessmentDraft.quoteMode` -> 实施评估 `selectedPresetMode/selectedSheet`
- `assessmentDraft.userCount` -> `form.userCount`
- `assessmentDraft.orgCount` -> `form.orgCount`
- `assessmentDraft.orgSimilarity` -> `form.orgSimilarity`
- `assessmentDraft.difficultyFactor` -> `form.difficultyFactor`

## 6.2 明细映射
- `assessmentDraft.moduleItems[]` 按 `moduleName` 与实施评估模块行对齐：
  - `standardDays` 对应标准人天展示；
  - `suggestedDays` 回填自定义人天；
  - `reason` 回填“调整原因”。

## 6.3 不覆盖策略
- 用户已有手工修改字段默认不强制覆盖（弹窗提供覆盖选项，二期可加）。
- 无法对齐的模块项放入“未匹配项”提示区。

## 6.4 Excel 解析口径补充（产品及模块信息）

- 产品领域命名兼容：
  - `星空旗舰版` 统一归一为 `金蝶AI星空`，并据此推断产品线。
- 合并单元格口径：
  - `模块` 列存在合并单元格时，默认向下继承到子模块行（SKU 行）。
  - `财务云` 合并行默认覆盖其对应子模块明细（如 1-9 行子模块）。
- 用户数口径：
  - `财务云` 与 `供应链云` 的用户数视为共享业务用户规模（如示例中的 10）。
  - `流程服务云` 用户规模独立，不继承业务模块用户数（如示例中的 50）。

---

## 7. 安全、审计与可追溯

- 鉴权：JWT（沿用现有登录态）。
- 记录：最少记录 requestId、用户、时间、模型、promptVersion、ruleSetId、摘要哈希。
- 不回传敏感信息到前端日志。
- 弹窗中明确标识：AI 草稿仅供参考，需人工确认。

---

## 8. 验收标准（DoD）

- 入口可见：需求页可触发 `Kimi评估`。
- 接口可用：后端返回结构化 draft，前端正确解析。
- 预览可用：弹窗完整展示、可关闭、可应用。
- 回填可用：跳转实施评估后关键字段正确回填。
- 异常可用：超时/失败/结构异常有明确提示，不影响原页面数据。
- 质量门禁：`npm run build:web`、`npm run build:api` 通过。

---

## 9. 迭代建议（拆分）

- P0：单次生成 + 预览 + 应用回填（本次）
- P1：重新生成、覆盖策略、未匹配项人工映射
- P2：质量看板（成功率、耗时、补问次数）与提示词版本治理
