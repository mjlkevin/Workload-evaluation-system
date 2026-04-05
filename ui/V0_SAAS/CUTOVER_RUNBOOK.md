# V0 前端切换与回滚手册

## 切换

1. 启动 API：
   - `npm run dev:api`
2. 启动新前端（默认脚本已切换）：
   - `npm run dev:web`
3. 构建验证：
   - `npm run build:web`

## 回滚

【历史说明，已下线】前端 `apps/web` 已删除，不再提供 legacy 回滚入口。  
如需回滚，请基于 Git 提交回退 `ui/V0_SAAS` 变更，并继续使用：

- `npm run dev:web`
- `npm run build:web`

## 验收点

- 主页：`/dashboard`
- 需求：`/dashboard/requirement-import`
- 实施评估：`/dashboard/assessment`
- 资源人天及成本：`/dashboard/resource-cost`
- 开发评估：`/dashboard/dev-assessment`
- WBS：`/dashboard/wbs`
- 评审：`/dashboard/review`
- 团队协同：`/dashboard/team-collaboration`
- 用户管理：`/dashboard/user-management`
- API：`/dashboard/api-keys`
