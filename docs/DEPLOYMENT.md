# Workload Evaluation System — Docker 部署指南

## 快速启动（生产模式）

```bash
# 1. 准备环境变量
cp .env.example .env
# 编辑 .env，至少填上 KIMI_API_KEY

# 2. 一键启动
docker compose up -d --build

# 3. 等待 PG ready（约 10-20 秒）后执行 migration
docker compose exec api npm run db:migrate

# 4. 验证
curl http://localhost:3000/health   # {"status":"ok"}
curl -I http://localhost:5173/     # HTTP/1.1 200 OK
```

## 开发模式

```bash
# 使用 dev override 启动（api 热重载 + web Vite dev server）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# 开发模式下：
# - API  挂载源码，tsx watch 自动重载：http://localhost:3000
# - Web  Vite dev server：http://localhost:5173
# - DB   PostgreSQL：localhost:5432
```

## 常用命令

| 操作 | 命令 |
|---|---|
| 查看日志 | `docker compose logs -f api` |
| 运行测试 | `docker compose exec api npm run test:ai` |
| 运行 migration | `docker compose exec api npm run db:migrate` |
| 进入 API 容器 | `docker compose exec api sh` |
| 停止并删除 | `docker compose down` |
| 完全重置（含数据） | `docker compose down -v` |

## 数据库 Migration

首次启动或 schema 变更后必须执行：

```bash
docker compose exec api npm run db:migrate
```

若需回滚或查看 migration 状态，可进入容器手动操作：

```bash
docker compose exec api sh
npx drizzle-kit studio   # 可视化浏览数据库
```

## 多副本部署约束（阶段 2 存储切换相关，2026-08-19）

> **当前部署形态：单副本。多副本部署前请读完本节。**

users 域切 PG 后采用**进程级写穿缓存 + 60s 有界 TTL**（`WES_STORE_USERS_PG=true` 时生效，见 `apps/api/src/modules/auth/users-pg.repository.ts`）：

- 写副本落库后立即写穿，本副本内零失效窗口。
- 副本间无主动失效：副本 B 注册/修改的用户，副本 A 最长滞后一个 TTL（≤60s）后回源自愈。无 TTL 的旧实现是**永久分歧**（副本 B 注册的用户在副本 A 永远查不到，该用户无法从副本 A 登录，直至重启）——TTL 已把失效模式降级为「短暂陈旧」，但多副本下仍可能出现 ≤60s 的登录/权限陈旧窗口。
- 后续各域切 PG 时，缓存策略逐域评估（不照搬 users 全表填充）；凡进程级缓存均须有界失效（TTL 或等价机制）。

**结论：多副本上线前须评估登录陈旧窗口的业务可接受性，或补 LISTEN/NOTIFY 主动失效；在此之前本服务按单副本部署。**

## 常见故障排查

### 1. `docker compose up` 后 API 不断重启

- **原因**：API 在 PG 就绪前启动，或 DATABASE_URL 配置错误。
- **解决**：检查 `docker compose logs db` 确认 PG 是否健康；确认 `.env` 中的 `DATABASE_URL` 指向正确。

### 2. 前端 502 / 无法访问 API

- **原因**：nginx 反代配置中 `api:3000` 无法解析。
- **解决**：确认 api 容器已正常启动（`docker compose ps`）；检查 `docker compose logs api`。

### 3. `npm run test:ai` 失败

- **原因**：KIMI_API_KEY 未设置或已过期。
- **解决**：在 `.env` 中填入有效的 `KIMI_API_KEY`，然后 `docker compose up -d` 重新加载环境变量。

### 4. 端口冲突（5432 / 3000 / 5173 已被占用）

- **解决**：修改 `docker-compose.yml` 中的 `ports` 映射，例如 `"5433:5432"`。

### 5. 构建缓存导致旧代码

```bash
# 强制无缓存重新构建
docker compose build --no-cache
docker compose up -d
```
