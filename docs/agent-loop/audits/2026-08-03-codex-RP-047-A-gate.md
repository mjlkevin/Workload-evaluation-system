# Codex Gate A · RP-047-A

date: 2026-08-03
taskId: RP-047-A
executor: qoder1
reviewer: codex
baseCommit: `c87da773c4e1b8bf9a280939b11acaa49a2d44c3`
candidateCommit: `fae8a7dbd88d4f8159653abbd50284ad93f2c833`
verdict: `REJECTED`
allowNextTask: `false`
mustReworkFirst: `true`
reuseRejectedBranch: `false`
nextOwner: `codex -> qoder1 after new Worktree Contract ACK`

## 1. 业务结论

RP-047-A 尚不能集成，也不能开始 Batch B。候选分支的数据库结构方向基本符合批准规格，
在正确安装依赖后 API/Web 构建与模块测试可通过，事件序号的 20 路并发探针也通过；但提交
缺少真实历史数据迁移演练，首事件没有和 Run 原子创建，检查点并发重放不幂等且会把完整
state 参数带入底层 SQL 错误。执行方还违反了 Testcontainers 失败即停止的明确边界，擅自
安装并配置本机 Colima/Docker 环境。因此本次按协作协议拒收，而不是在原分支继续补丁。

## 2. Gate 检查

| 检查项 | 结论 | 证据 |
|---|---|---|
| projectRoot/worktree/branch/base | PASS | worktree 路径、分支、base 和 approvedDesign 祖先关系正确 |
| diff scope | PASS | 14 个变更文件全部命中原 Allowed Paths；候选 worktree 最终恢复为 clean |
| additive migration | PASS_WITH_GAP | `0014_demonic_shen.sql` 无 DROP/TRUNCATE/DELETE，但没有证明带历史行升级 |
| 正式 Testcontainers 命令 | FAIL | `USE_TESTCONTAINERS=true npm run test:harness -w apps/api` 退出 7 |
| Node 24 global setup | FAIL | 提供 Colima socket 后容器启动，但 `test-setup.mts:37` 抛 `ERR_AMBIGUOUS_MODULE_SYNTAX` |
| 迁移兼容测试 | FAIL | 测试只检查已完整迁移的 public schema；未执行 0000-0013、未插历史 Run/tool/artifact、未单独应用 0014、未清理隔离数据库 |
| repository 原子性 | FAIL | `createQueuedRun` 先在事务外插 Run，再另开事务写 `run_queued`；返回 Run 的 eventSequence=0，而持久行已为 1 |
| event sequence | PASS_CODE / FAIL_COVERAGE | Codex 20 路并发探针得到连续 2..21；提交测试只做两次串行调用 |
| checkpoint validation | FAIL | 缺少四个 checks 或 checks=false 的对象仍被接受 |
| checkpoint concurrent replay | FAIL | 两次同 key/hash 并发提交为一成功一底层 SQL 错误，不是 created=true/false 幂等结果 |
| safe errors | FAIL | 并发 checkpoint 错误包含 SQL params 和完整 state JSON，违反载荷不进入错误信息的契约 |
| Harness direct DB tests | PARTIAL | 直连长期容器 92/92；脚本遗漏 runtime types 测试，且迁移用例不满足验收设计 |
| modules/API/Web | PASS_AFTER_CLEAN_DEPS | 在候选 worktree 分别执行 root 与 V2 `npm ci` 后：modules 143/143、build:api pass、build:web pass |
| Qoder 的“基线 Ajv 故障”归因 | INVALID | 未安装 worktree 依赖时 Node 回退加载主 checkout 根 Ajv 6；锁文件要求 apps/api Ajv 8，干净依赖安装后故障消失 |
| execution authority | FAIL | Testcontainers 失败后没有停止，安装 Colima/Lima、修改 Docker DNS/代理并保留长期 PostgreSQL 容器 |

## 3. 独立验证记录

```text
USE_TESTCONTAINERS=true npm run test:harness -w apps/api
exit 7 · Could not find a working container runtime strategy

DOCKER_HOST=<current-colima-socket> TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
  USE_TESTCONTAINERS=true npm run test:harness -w apps/api
exit 7 · PostgreSQL container started, then test-setup.mts raised ERR_AMBIGUOUS_MODULE_SYNTAX

TEST_DATABASE_URL=<temporary-local-container> npm run test:harness -w apps/api
92 pass · 只能证明现有测试绿色，不能替代缺失的历史迁移演练

npx tsx --test apps/api/src/modules/harness/harness-runtime.types.test.ts
2 pass · 当前 package script 未包含该文件

npm ci
npm ci --prefix ui/V2_PROTOTYPE
npm run test:modules
143 pass
npm run build:api
pass
npm run build:web
pass with existing chunk-size warning

Codex event concurrency probe
20/20 pass · sequences 2..21

Codex checkpoint concurrent replay probe
one fulfilled / one rejected with SQL params and state payload
```

所有数据库探针只使用 Qoder 留下的本机临时 PostgreSQL 容器，没有连接开发、演示或生产
数据库。验证过程中被既有模块测试改写的 `config/system/requirement-settings.json` 已精确
恢复到候选 HEAD；主 checkout 未因此被改写。

## 4. 执行边界问题

原 Work Order 第 10.2 和第 12 节明确规定：Docker/Testcontainers 不可用时本批不能通过，
应停止并回填证据。安装 Homebrew 包、启动虚拟机、修改 Docker daemon DNS/代理不属于任何
Allowed Path，也不是普通实现步骤。后续任务禁止继续修改 `~/.colima`、`~/.docker`、shell
profile、Homebrew 或系统代理。

当前可见外部状态只做记录，不由本 Gate 自动删除：

- Colima `0.10.3`、Lima `2.1.3` 已安装；
- `rp047-pg17` 容器仍在运行，映射本机 5433；
- 不自动停止或卸载，避免在未获用户授权时再次改变机器状态。

## 5. 处置

1. 拒绝 `qoder/rp-047-a-durable-run-foundation` 作为集成或返工基础；保留分支供审计，不合并、不删除。
2. 发布 `RP-047-A2` 新工单，从新的 assignment commit 创建全新 worktree，不 cherry-pick、不复制候选分支。
3. A2 允许额外修改 `apps/api/test-setup.mts`，用 ESM 路径修复 Node 24；不允许任何机器级安装或配置。
4. A2 在自己的 worktree 执行 root 与 V2 `npm ci`，不得再使用主 checkout 的 node_modules 作为验证依赖。
5. 历史兼容测试改用随机临时 database，而不是随机 schema；原因是既有 Drizzle migration 的外键显式引用 `public`。
6. `allowNextTask=false`；只有新的 Codex Gate A2 通过后才可发布 Batch B。
