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

## 6) Agent-Friendly MVP（推荐优先）

当你不想自己拼完整 `calculate` 参数时，可直接使用高层接口：

- `POST /api/v1/agent/estimate`
- `POST /api/v1/agent/session/start`
- `POST /api/v1/agent/session/{sessionId}/continue`

### 6.1 响应语义

- `status=success`：已完成估算，`estimate.totalDays` 可直接使用。
- `status=needs_clarification`：参数仍有缺失，请按 `nextQuestions` 继续追问用户。
- `status=failed`：不可恢复失败，查看 `errorCode` 与 `suggestedFixes`。

所有返回都包含可解释字段（按场景出现）：

- `normalizedRequest`
- `missingFields`
- `missingFieldsCount`
- `assumptions`
- `nextQuestions`
- `intentCandidates`（P1-MVP：topK 候选，含 `score` 与 `reason`）

### 6.2 P1 增强：意图候选（topK + 置信度）

- 当你只给自然语言（例如“评估财务云和供应链云”）时，接口会返回：
  - `intentCandidates[]`：`kind=sheet|item`，并给 `score`（0~1）和 `reason`
- 建议调用方策略：
  - `score >= 0.9`：可直接采用
  - `0.7 <= score < 0.9`：给用户一次确认
  - `< 0.7`：进入澄清提问路径
### 6.3 最小调用示例

```bash
# 1) 首次调用（可能返回 needs_clarification）
curl -s -X POST http://localhost:3000/api/v1/agent/estimate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -d '{
    "userMessage": "帮我评估实施工作量"
  }'

# 2) 建会话 + 继续补参（多轮）
curl -s -X POST http://localhost:3000/api/v1/agent/session/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -d '{
    "userMessage": "先开始会话",
    "hints": { "userCount": 80, "difficultyFactor": 0.1 }
  }'

curl -s -X POST http://localhost:3000/api/v1/agent/session/<SESSION_ID>/continue \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -d '{
    "userMessage": "补充其余参数",
    "hints": { "orgCount": 2, "orgSimilarityFactor": 0.8 }
  }'
```

### 6.4 本地冒烟

仓库已提供 Agent 高层 API 冒烟脚本：

```bash
npm run test:api:agent
```

### 6.5 访问日志窗口统计（近 10 分钟 / 1 小时）

```bash
# 默认输出 10m / 1h / all
npm run logs:api:report

# 指定窗口
npm run logs:api:report -- --window=10m
npm run logs:api:report -- --window=1h
```

## 7) 团队协同 P0（当前实现说明）

- 已有接口骨架：`/api/v1/teams/*`（团队、成员、方案、评审、评论）。
- 鉴权失败返回 401（凭证缺失或失效）。
- 业务校验与权限拒绝在当前实现中统一返回 400，结合 `code` 识别：
  - `40301`：权限不足
  - `40401`：对象不存在（团队/成员/评审/总方案）
  - `42201`：参数错误
  - `40909`：并发写入冲突（建议重试）

### 7.0 并发冲突重试建议

- 当返回 `code=40909` 时，说明同一时刻有其他写操作已更新团队数据版本。
- 建议调用方采用“短退避重试”策略：
  - 首次等待 `100~200ms` 后重试
  - 最多重试 `2~3` 次
  - 超过重试次数后提示“数据已变更，请刷新后重试”

### 7.1 最小联调清单（curl 全链路）

> 说明：以下示例按当前 P0 骨架接口编写，建议先准备两个有效账号：
> - 账号A（负责人 / manager）
> - 账号B（成员 / implementer 或 sales）

#### Step 0) 登录并获取 TOKEN

```bash
# 负责人登录
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<MANAGER_USERNAME>","password":"<PASSWORD>"}'

# 成员登录
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<MEMBER_USERNAME>","password":"<PASSWORD>"}'
```

从响应里取：

- `MANAGER_TOKEN`
- `MEMBER_TOKEN`

#### Step 1) 创建团队（负责人）

```bash
curl -s -X POST http://localhost:3000/api/v1/teams \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MANAGER_TOKEN>" \
  -d '{"name":"售前实施协同组-UT"}'
```

从响应 `data` 里取 `TEAM_ID`。

#### Step 2) 添加团队成员（负责人）

```bash
curl -s -X POST "http://localhost:3000/api/v1/teams/<TEAM_ID>/members" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MANAGER_TOKEN>" \
  -d '{"userId":"<MEMBER_USER_ID>","role":"implementer"}'
```

#### Step 3) 创建评审（成员或负责人）

```bash
curl -s -X POST "http://localhost:3000/api/v1/teams/<TEAM_ID>/reviews" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MEMBER_TOKEN>" \
  -d '{"globalVersionCode":"GL-UT-001","title":"首次评审"}'
```

从响应 `data` 里取 `REVIEW_ID`。

#### Step 4) 发表评论（成员）

```bash
curl -s -X POST "http://localhost:3000/api/v1/teams/<TEAM_ID>/reviews/<REVIEW_ID>/comments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MEMBER_TOKEN>" \
  -d '{"content":"实施侧建议先完成主数据范围确认。"}'
```

#### Step 5) 查询评论列表（负责人）

```bash
curl -s "http://localhost:3000/api/v1/teams/<TEAM_ID>/reviews/<REVIEW_ID>/comments" \
  -H "Authorization: Bearer <MANAGER_TOKEN>"
```

#### Step 6) 关闭评审（仅负责人）

```bash
curl -s -X PATCH "http://localhost:3000/api/v1/teams/<TEAM_ID>/reviews/<REVIEW_ID>/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MANAGER_TOKEN>" \
  -d '{"status":"closed"}'
```

#### Step 7) 负向校验（成员关闭应失败）

```bash
curl -s -X PATCH "http://localhost:3000/api/v1/teams/<TEAM_ID>/reviews/<REVIEW_ID>/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MEMBER_TOKEN>" \
  -d '{"status":"closed"}'
```

期望：HTTP 400 且 `code=40301`。

### 7.2 自动化冒烟（团队协同）

仓库已提供团队协同链路冒烟脚本：

```bash
npm run test:api:team
```

脚本覆盖：

- 创建团队
- 添加成员
- 添加成员非法角色校验（`code=42201`）
- 成员创建评审
- 成员发表评论 + 负责人查询评论
- 负责人关闭评审
- 成员关闭评审失败（`code=40301`）
- 评审不存在校验（`code=40401`）
- 团队详情读取（成员可读）与未知团队不存在校验（`code=40401`）
