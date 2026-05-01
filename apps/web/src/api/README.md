# API 调用指南

## 目录

- `client.ts` — axios 实例 + JWT 拦截器
- `types.ts` — 从 `docs/openapi.yaml` 自动生成的 TypeScript 类型

## 快速开始

```ts
import { apiClient, apiGet, apiPost } from '@/api/client'

// GET 示例
const templates = await apiGet('/templates')

// POST 示例
const result = await apiPost('/estimates/calculate', {
  templateId: 'default',
  ruleSetId: 'default',
  // ...
})
```

## 类型使用

```ts
import type { paths } from '@/api/types'

type HealthResponse = paths['/api/v1/health']['get']['responses']['200']['content']['application/json']['schema']
```

## 鉴权

`apiClient` 已配置请求拦截器，会自动从 `localStorage` 读取 `workload-auth-token-v1` 并附加到 `Authorization: Bearer <token>`。

401 响应会自动清除 token 并跳转到登录页。
