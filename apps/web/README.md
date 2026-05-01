# apps/web — 前端工程

## 技术栈

- Vue 3 + Vite + TypeScript
- Element Plus（UI 组件库）
- Pinia（状态管理）
- vue-router（路由）
- openapi-typescript（API 类型生成）
- axios（HTTP 客户端）

## 开发

```bash
# 1. 安装依赖（在 monorepo 根目录或 apps/web 目录执行均可）
npm install

# 2. 生成 API 类型（必须步骤）
npm run gen:api

# 3. 启动开发服务器
npm run dev
```

开发服务器默认运行在 http://localhost:5173，并已配置 proxy 将 `/api` 转发到后端的 http://localhost:3000。

## 项目结构

```
src/
  ├── main.ts              # 入口
  ├── App.vue              # 根组件（动态切换 layout）
  ├── router/              # 路由配置（按角色分路由 + guard）
  ├── api/                 # API client + 自动生成的类型
  ├── stores/              # Pinia stores（auth 等）
  ├── layouts/             # 页面布局
  ├── pages/               # 页面（按模块分目录）
  ├── components/          # 通用组件（W4-D 负责）
  └── styles/              # 全局样式
```

## 页面归属

| 目录 | 归属 | 说明 |
|------|------|------|
| `pages/presales/` | **W4-A** | 售前工作台 |
| `pages/pm-workbench/` | **W4-B** | PM 工作台 |
| `pages/pmo/` | 待分配 | PMO 工作台 |
| `pages/sales/` | 待分配 | 销售工作台 |
| `pages/admin/` | W4-SETUP | 系统管理（已有基础页） |
| `components/` | **W4-D** | 通用组件 |
| `layouts/` | **W4-D** | 布局优化 |

## API 调用示例

```ts
import { apiGet, apiPost } from '@/api/client'

// GET /api/v1/templates
const templates = await apiGet('/templates')

// POST /api/v1/auth/login
const { token, user } = await apiPost('/auth/login', {
  username: 'admin',
  password: '...',
})
```

类型定义：`src/api/types.ts` 由 `npm run gen:api` 从 `docs/openapi.yaml` 自动生成。
