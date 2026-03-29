# 本地模型调用指南

本文用于让本地模型（或 Agent）稳定调用本项目 API。

## 1) 调用前提

- API 地址：`http://localhost:3000`
- 规范文件：`docs/openapi.yaml`（**部分滞后**；完整端点见 `03_技术设计/系统演进/实现与文档对齐说明.md`）
- **鉴权**：多数业务接口需先 `POST /api/v1/auth/login` 获取 JWT，后续请求带 `Authorization: Bearer <token>`。**勿再依赖 `X-Role`**。
- 响应包裹格式：
  - 成功：`{ code: 0, message: "ok", data, requestId? }`
  - 失败：`{ code, message, details, requestId }`（HTTP 通常为 400）

## 2) 推荐调用顺序（模型最稳）

1. `GET /api/v1/health`
2. `POST /api/v1/auth/login`（或注册后登录）-> 保存 `accessToken`（字段名以实际响应为准）
3. `GET /api/v1/templates` -> 拿到 `templateId`
4. `GET /api/v1/rule-sets/active` -> 拿到 `ruleSetId`、可用 `difficultyFactorList`
5. `GET /api/v1/templates/{templateId}` -> 拿全量 `templateItemId`
6. `POST /api/v1/estimates/calculate`（Header 带 Bearer）

## 3) 关键约束（最容易踩坑）

- `items` 必须覆盖模板全部 `templateItemId`，否则会返回 `42201`。
- `difficultyFactor` 必须来自规则集的 `difficultyFactorList`，否则会返回 `40003`。
- `orgSimilarityFactor` 必须在 `0~1`。
- 导入类接口需要 **`admin` 账号的 JWT**；普通用户会返回 `40301`。不再使用 `X-Role`。
- 导出接口可传 `Idempotency-Key` 做幂等重放。

## 4) 最小可用样例

```bash
# 健康检查
curl -s http://localhost:3000/api/v1/health

# 模板列表（需先登录拿到 TOKEN）
curl -s http://localhost:3000/api/v1/templates \
  -H "Authorization: Bearer <YOUR_JWT>"

# 激活规则
curl -s http://localhost:3000/api/v1/rule-sets/active \
  -H "Authorization: Bearer <YOUR_JWT>"
```

计算示例（注意：`items` 仅为示例，实际需完整列表）：

```bash
curl -s -X POST http://localhost:3000/api/v1/estimates/calculate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -d '{
    "templateId":"tmpl-import-1774340190465",
    "ruleSetId":"rule-set-v1",
    "userCount":120,
    "difficultyFactor":0.2,
    "orgCount":1,
    "orgSimilarityFactor":1,
    "items":[
      {"templateItemId":"item-1","included":true}
    ]
  }'
```

## 5) 建议给模型的系统提示词

```text
你是工作量评估系统 API 调用器。
请根据 docs/openapi.yaml 与「实现与文档对齐说明」发请求；鉴权一律使用 Bearer JWT。
先读取模板与规则，再构造 calculate 请求。
如果遇到业务错误，优先根据 details 中的 field/reason 自修正重试。
任何计算请求都必须包含完整 items 列表。
```
