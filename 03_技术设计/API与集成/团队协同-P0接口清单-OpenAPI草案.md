# 团队协同（P0）接口清单（OpenAPI 草案）

> 目标：提供后端开工前的最小接口契约草案，后续再并入 `docs/openapi.yaml`。

## 1. 团队管理

### `POST /api/v1/teams`

- 用途：创建团队
- 权限：`manager`
- 请求体：
  - `name: string`
- 响应：
  - `teamId`
  - `name`
  - `ownerUserId`
  - `createdAt`

### `GET /api/v1/teams/{teamId}`

- 用途：查看团队详情
- 权限：团队成员
- 响应：
  - `teamId`
  - `name`
  - `ownerUserId`
  - `members[]`

### `POST /api/v1/teams/{teamId}/members`

- 用途：添加成员
- 权限：`manager`
- 请求体：
  - `userId: string`
  - `role: "manager" | "implementer" | "presale" | "sales"`

### `PATCH /api/v1/teams/{teamId}/members/{userId}`

- 用途：调整成员角色
- 权限：`manager`
- 请求体：
  - `role: "manager" | "implementer" | "presale" | "sales"`

### `DELETE /api/v1/teams/{teamId}/members/{userId}`

- 用途：移除成员
- 权限：`manager`

## 2. 团队方案总览（GL 级）

### `GET /api/v1/teams/{teamId}/plans`

- 用途：查看团队下总方案列表
- 权限：团队成员
- 响应字段建议：
  - `globalVersionCode`
  - `projectName`
  - `status`
  - `ownerUserId`
  - `updatedAt`
  - `reviewStatus`

### `PATCH /api/v1/teams/{teamId}/plans/{globalVersionCode}/binding`

- 用途：变更总方案归属团队（手动关联策略）
- 权限：`manager`
- 请求体：
  - `targetTeamId: string`

## 3. 评审与评论

### `POST /api/v1/teams/{teamId}/reviews`

- 用途：在指定总方案上创建评审
- 权限：团队成员
- 请求体：
  - `globalVersionCode: string`
  - `title?: string`

### `PATCH /api/v1/teams/{teamId}/reviews/{reviewId}/status`

- 用途：变更评审状态（open/closed）
- 权限：`manager`
- 请求体：
  - `status: "open" | "closed"`

### `GET /api/v1/teams/{teamId}/reviews/{reviewId}/comments`

- 用途：获取评论列表
- 权限：团队成员

### `POST /api/v1/teams/{teamId}/reviews/{reviewId}/comments`

- 用途：发表评论
- 权限：团队成员
- 请求体：
  - `content: string`

## 4. 标准响应约定

沿用现有响应包裹：

- 成功：`{ code: 0, message: "ok", data, requestId }`
- 失败：`{ code, message, details, requestId }`

常用错误码建议：

- `40101`：未认证
- `40301`：无权限/非团队成员
- `40401`：团队或评审不存在
- `42201`：请求参数无效

## 5. 最小测试场景（接口级）

1. manager 创建团队 -> 添加成员 -> member 可见团队详情。
2. 非团队成员访问团队方案返回 `40301`。
3. member 可创建评审与评论，不能关闭评审。
4. manager 可关闭评审，状态变更可查询。
