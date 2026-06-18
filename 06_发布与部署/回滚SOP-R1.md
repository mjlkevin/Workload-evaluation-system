# 回滚 SOP — R1

> **用途**: 当生产/预发环境部署后出现严重问题时，快速回退到上一个已知良好版本。
> **适用范围**: Docker Compose 部署模式（API + PostgreSQL）。
> **前提**: Git tag 或 commit SHA 标记了上一个稳定版本；配置文件已按部署指南备份。

---

## 1. 回滚决策标准

满足以下任一条件即触发回滚：

| 条件 | 严重等级 | 响应时间 |
|------|----------|----------|
| 冒烟测试 FAIL ≥ 1 项 | P0 | 立即 |
| API 5xx 错误率 > 5% 持续 5 分钟 | P0 | 立即 |
| 数据库迁移失败或数据损坏 | P0 | 立即 |
| 关键功能不可用（登录、版本检出、导出） | P1 | 15 分钟内 |
| 非关键 UI 异常或性能下降 | P2 | 评估后决定 |

---

## 2. 回滚前准备

### 2.1 确认目标版本

```bash
# 查看当前版本
cd /Users/kevin/AI/Workload-evaluation-system
git log --oneline -5

# 确认要回退到的 tag 或 commit
git tag -l 'v*' --sort=-v:refname | head -10
```

### 2.2 备份当前状态（可选但推荐）

```bash
# 备份当前容器配置
docker compose ps > rollback_backup_containers_$(date +%Y%m%d_%H%M%S).txt

# 备份当前数据库（如需保留问题期间的数据）
docker compose exec db pg_dump -U kevin workload_eval > rollback_db_backup_$(date +%Y%m%d_%H%M%S).sql
```

---

## 3. 回滚执行步骤

### Step 1: 切换到目标版本

```bash
cd /Users/kevin/AI/Workload-evaluation-system

# 方式 A: 按 tag 回退
git checkout v1.0.0          # 替换为实际 tag

# 方式 B: 按 commit SHA 回退
git checkout abc1234         # 替换为实际 SHA
```

### Step 2: 停止并移除当前容器

```bash
docker compose down
```

> 此命令会停止 API 和 PostgreSQL 容器并移除网络。**不会**删除持久化卷数据。

### Step 3: 重新构建并启动

```bash
docker compose up -d --build
```

### Step 4: 等待服务就绪

```bash
# 等待约 10-15 秒后检查
docker compose ps
docker compose logs --tail=20 api
```

### Step 5: 执行冒烟测试

```bash
./scripts/smoke-test-deploy.sh http://localhost:3000 <username> <password>
```

确认所有检查项通过。

---

## 4. 数据库回滚（仅在必要时）

如果回滚涉及数据库 schema 变更不兼容：

### 4.1 恢复数据库备份

```bash
# 先停止 API 避免写入
docker compose stop api

# 恢复数据库
docker compose exec -T db psql -U kevin workload_eval < rollback_db_backup_YYYYMMDD_HHMMSS.sql

# 重启 API
docker compose start api
```

### 4.2 确认数据完整性

```bash
docker compose exec db psql -U kevin -d workload_eval -c "SELECT count(*) FROM versions;"
docker compose exec db psql -U kevin -d workload_eval -c "SELECT count(*) FROM users;"
```

---

## 5. 配置文件回滚

如果 `.env.local` 或其他配置文件发生变更：

```bash
# 从备份恢复（假设按部署指南命名）
cp config/.env.local.backup_YYYYMMDD config/.env.local

# 重启服务使配置生效
docker compose restart api
```

---

## 6. 回滚验证清单

回滚完成后，逐项确认：

| 检查项 | 命令/方法 | 预期结果 |
|--------|-----------|----------|
| 容器运行状态 | `docker compose ps` | 全部 Up |
| API 健康检查 | `curl http://localhost:3000/api/v1/health` | 200 OK |
| 冒烟测试 | `./scripts/smoke-test-deploy.sh` | 全部 PASS |
| 数据库连接 | 日志无连接错误 | 无 ERROR |
| 版本号确认 | `git describe --tags` | 与目标版本一致 |
| 日志无异常 | `docker compose logs --tail=50 api` | 无 5xx / panic |

---

## 7. 回滚后沟通

1. 在相关 GitHub Issue/PR 中注明回滚操作及原因
2. 通知团队成员当前版本状态
3. 记录回滚根因（如果已知）到问题跟踪系统
4. 安排修复后的重新部署窗口

---

## 8. 常见问题排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 容器启动后立即退出 | `.env.local` 缺少必要变量 | 检查 `JWT_SECRET`, `DATABASE_URL` |
| 数据库连接拒绝 | PostgreSQL 未就绪 | 等 10 秒重试，或 `docker compose restart db` |
| 端口冲突 | 旧进程未释放 3000 端口 | `lsof -i :3000` → kill 残留进程 |
| 迁移脚本失败 | 目标版本无迁移文件 | 确认 git checkout 正确，必要时手动修复 DB |

---

## 9. 回滚记录模板

每次回滚后填写：

```
回滚时间: YYYY-MM-DD HH:MM
触发原因: [冒烟失败 / 5xx 告警 / 数据异常 / 其他]
源版本: v1.x.x (commit: abc1234)
目标版本: v1.y.y (commit: def5678)
回滚耗时: X 分钟
验证结果: 冒烟测试 PASS/FAIL (FAIL 项: ___)
根因分析: [简述]
后续行动: [修复计划 / 预防措施]
操作人: ___
```
