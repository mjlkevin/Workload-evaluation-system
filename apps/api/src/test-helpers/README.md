# test-helpers

## 数据库测试辅助 (db.ts)

### 本地开发（默认）

不设置任何额外环境变量，直接运行：

```bash
npm run test:ai
npm run test:modules
```

测试会连接到本地 Postgres.app 的 `workload_eval_test` 数据库（连接串硬编码在 `db.ts` 中）。

### testcontainers 模式（CI / 无本地 PG）

当设置 `USE_TESTCONTAINERS=true` 或 `CI=true` 时，测试会自动通过 Docker 启动 PostgreSQL container：

```bash
USE_TESTCONTAINERS=true npm run test:ai
# 或快捷命令
npm run test:ai:cc
npm run test:modules:cc
```

全局 setup（`test-setup.mts`）负责：

1. 启动 `postgres:17-alpine` container
2. 将连接串写入 `process.env.DATABASE_URL_TEST`
3. 执行 drizzle migration
4. 测试全部结束后自动 stop container

`db.ts` 会优先读取 `DATABASE_URL_TEST`，若存在则使用 container，否则回退到本地 Postgres.app。

### 注意事项

- 首次启动 container 需要下载镜像，耗时约 30s（后续有缓存则快很多）
- 需要本地 Docker daemon 正在运行
- 共享同一个 container 给所有测试文件，避免重复起停
