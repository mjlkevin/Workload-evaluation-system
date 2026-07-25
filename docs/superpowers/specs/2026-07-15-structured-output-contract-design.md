# WES AI 结构化输出契约治理设计

## 背景与目标

WES 当前 Provider 已支持 Kimi `json_schema` 透传，但生产结构化输出仍以 `json_object` 和分散的 `JSON.parse` / `parseXxx` 为主。此次实施在不改变现有业务路由与人工确认边界的前提下，建立一套可版本化、可校验、可修复、可观测的结构化输出契约，并关闭企业画像事实伪造与 Harness V2 错误恢复两项 S2 缺陷。

## 设计决策

1. JSON Schema 是模型侧与服务端侧的单一契约源；服务端直接依赖 Ajv 8 和 ajv-formats，不再为同一输出额外维护 Zod 定义。
2. `json_schema` 只约束模型输出，服务端仍必须执行 JSON 解析、Ajv 结构校验和业务语义校验。
3. Provider 的超时、限流和 5xx 重试保持不变；结构化输出 runner 只负责输出修复重试。鉴权、余额和安全拒绝不进入结构修复。
4. 只有 Provider 明确返回 `response_format/json_schema` 不支持错误时，runner 才回退 `json_object`；其他错误原样上抛。
5. 混合文本与 `formBlock` 不强制改为纯 JSON 对象；保留现有协议，但抽取后的 formBlock 必须经过统一契约校验与白名单归一化。

## 核心组件

### StructuredOutputContract

每个契约包含 `id`、`version`、`name`、`riskTier`、JSON Schema 和可选业务语义校验器。`id + version` 是观测、回放和兼容判断的稳定键。

### StructuredCompletionRunner

统一流程：

1. 以 strict `json_schema` 调用 Provider。
2. 解析 JSON 并执行 Ajv 校验。
3. 执行业务语义校验。
4. 若失败且仍有修复机会，把精简后的字段路径和原因回注给模型，再尝试一次。
5. 返回结构化数据及 `contractId/schemaVersion/responseFormat/outputAttempts/repairAttempts/fallbackReason`。
6. 通过 Prometheus Counter 记录 success、repaired、validation_failed、format_fallback 和 provider_error。

### 风险分级

- R0：信息回答，可退化为文本。
- R1：草稿/预填，未知字段保持空，必须提供字段来源或待补充状态。
- R2：评估/diff，只能形成草稿并进入人工复核。
- R3：写动作继续走类型化工具参数、JWT/RBAC、显式确认和幂等 ToolEvent；本次不改变该边界。

## 业务迁移

1. 企业画像、附件分析/合并：启用统一契约和 runner；行业缺失返回空字符串，不再填固定行业；响应增加字段来源和结构化输出元数据。
2. Harness V1/V2：使用统一 Schema 做完整结构校验，保留两次输出尝试；失败记录原阶段和契约信息。interactive 运行进入 `needs_user_input`，replay/regression 保持 `failed_schema_validation`。重试分别恢复 V1 的 `evidence_ready` 或 V2 的 `clarifying`。
3. 实施评估、开发评估、变更 diff、需求抽取：启用统一契约；原有规则 fallback 和人工复核边界保留。
4. 流式需求抽取：模型侧使用同一 `json_schema`，流结束后用同一 Ajv 契约验证。
5. 兼容 Evidence `confidence` 字段，但不再写固定 0.8；使用可解释的结构完整度质量分，并在 `aiMeta` 标记 `confidenceSource=schema_completeness`。

## 验收标准

- 生产代码不再存在 `responseFormat: "json_object"` 字面量；允许 runner 内的显式兼容回退。
- 每个生产结构化输出契约都有有效/无效 fixture 和 Provider 请求断言。
- 企业画像缺少行业时返回空值和 `needs_user_input` 来源，不生成具体行业分类。
- Harness V2 Schema 失败后能恢复到 `clarifying`，交互运行可进入 `needs_user_input`。
- 鉴权/余额错误不做输出修复；结构校验失败最多修复一次。
- `build:api`、`test:modules`、`test:ai`、`test:harness`、`test:integration`、看板测试与一致性校验全部通过。
