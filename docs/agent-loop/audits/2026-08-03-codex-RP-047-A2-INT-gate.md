# Codex Gate · RP-047-A2-INT

date: 2026-08-03
taskId: RP-047-A2-INT
requirement: RP-047
executor: qoder1
reviewer: codex
baseCommit: `1cc297d79b3af476c33a418ee73dbbcc7a922df3`
sourceCommit: `d9790fe08e62964e0dacfe103b06647af02de81e`
candidateCommit: `35fee259380a46220a1677b11a94b7c5f3d19f22`
implementationHead: `521bbd2b7555322fd7b3536d2a3c01b065f09487`
verdict: `ACCEPTED_FOR_MAINLINE_INTEGRATION`
allowNextTask: `false`
mustReworkFirst: `false`
mainMergeAllowed: `false`
nextOwner: `user-owner -> codex integrator after explicit integration instruction`

## 1. 业务结论

Qoder 已把通过上一轮 Gate 的 A2 持久运行数据基础，按固定八个提交移植到最新业务主线基线，
没有带入 A1、运行态 JSON、密钥、lockfile 或其他无关文件。Codex 已在隔离 worktree 独立复核
提交链、17 个文件边界、数据库迁移、owner 查询、JSON 输入门禁、事件/checkpoint/output 并发、
错误脱敏和完整回归矩阵，未发现阻断主线集成的问题。

因此候选 `35fee25` 可以进入业务主线集成。这个结论只代表 Batch A2 集成候选审计通过：

- 尚未合并 `codex/role-driven-ai-home-workbench`；
- 尚未提供 Worker、异步 Run API、SSE 回放或多会话前端能力；
- RP-047 仍未交付，Batch B 仍保持锁定；
- 需要用户明确下达集成指令后，由 Codex 执行最小主线集成和集成后复验。

## 2. 身份、来源与范围审计

| 检查项 | 结论 | 证据 |
|---|---|---|
| worktree / branch | PASS | `/Users/kevin/AI/Workload-evaluation-system/.claude/worktrees/rp-047-a2-integration`；`qoder/rp-047-a2-integration`；worktree clean |
| base / final HEAD | PASS | merge base 精确为 `1cc297d`；candidate HEAD 为 `35fee25`；handoff 前实现 HEAD 为 `521bbd2` |
| source identity | PASS | `qoder/rp-047-a2-durable-run-foundation` 仍指向 `d9790fe`；A1 `fae8a7d` 未进入候选 |
| fixed source order | PASS | 8 个来源提交按工单顺序映射为 `7f03e48 → a4eb5e7 → 162c6eb → 21c4fa0 → e2d30ff → ebbd8b9 → 58566fd → 521bbd2` |
| range-diff | PASS | 7 个提交 patch 等价；`748af1a → e2d30ff` 仅在 `apps/api/package.json` 保留主线新增的 modules/RAG 测试脚本，同时加入 A2 Harness 脚本 |
| Allowed Paths | PASS | `1cc297d..35fee25` 精确 17 个文件：A2 16 个文件 + 集成 handoff；无额外路径 |
| unrelated runtime data | PASS | `config/auth/users.json`、`config/versions/records.json`、`config/system/requirement-settings.json` 均未进入候选 diff |
| lockfile | PASS | 根目录与 V2 两个 lockfile 无差异 |

## 3. 实现边界审计

| 边界 | 结论 | 证据 |
|---|---|---|
| additive migration | PASS | `0014_talented_deathstrike.sql` 只创建表/索引并增加列/约束；无 DROP、TRUNCATE、DELETE 或列重命名 |
| 历史数据兼容 | PASS | 0000-0013 后插入历史 Run、ToolEvent、Artifact，再执行 0014；默认值、空兼容键、新表和索引均通过 |
| owner 边界 | PASS | `findRunForOwner` 同时限定 runId 与 ownerUserId；跨 owner 返回 null；后续用户 API 的 404 隔离仍由 Batch C 实现 |
| 原子创建 | PASS | Run、`run_queued` 和持久行读取在同一事务；事件失败注入后无残留 Run |
| claim / lease | PASS | `FOR UPDATE SKIP LOCKED` 防止重复认领；worker、状态、未过期 lease 和 1-300 秒范围均有约束 |
| JSON 普通对象 | PASS | state/event payload/output content 只接受 `Object.prototype` 或 null 原型；Date、Map、Set、类实例、数组、循环引用、BigInt 与超限对象按固定安全 code 拒绝 |
| event 并发 | PASS | 20 路并发事件序号连续、无重复、无缺口，Run counter 一致 |
| checkpoint 并发 | PASS | 同 key/hash 并发重放只产生一行一事件；不同 key 序号连续；Runtime validation 五项必须精确为 true |
| output 并发 | PASS | 10 路不同 hash 并发得到单行、版本 1..10、事件序号连续，final 不可降级为 partial |
| outbox 幂等 | PASS | 同 session/deduplicationKey 重放返回原行；不同 key 共存；Run 与 Session 不匹配被拒绝 |
| 错误脱敏 | PASS | Drizzle/pg 原始错误不穿透；冲突和超限错误不回显 SQL、state 或测试 sentinel |

## 4. Codex 独立验证

```text
DOCKER_HOST=<current-colima-context> \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
USE_TESTCONTAINERS=true npm run test:harness -w apps/api
=> 95 pass / 0 fail / 0 skip；随机 PostgreSQL 容器启动、迁移完成并停止

npm run test:modules
=> 227 pass / 0 fail / 0 skip

npm run test:ai
=> 190 pass / 0 fail / 0 skip

npm run test:integration
=> 1 pass / 0 fail / 0 skip

npm run test:web
=> 29 files / 206 tests pass

npm run build:api
npm run build:web
=> pass / pass；Web 仅既有 chunk-size warning

npm run test:security
=> secret scan 与知识库 URL policy 全部通过；tracked secret fields = 0

git diff --check 1cc297d..35fee25
git diff --exit-code 1cc297d..35fee25 -- package-lock.json ui/V2_PROTOTYPE/package-lock.json
git status --short --untracked-files=all
docker ps --format '{{.Names}}'
=> diff clean；lockfile 无变化；worktree clean；仅既有 rp047-pg17，无本轮残留容器
```

## 5. 非阻断边界与后续约束

1. `0014` 已在随机 Testcontainers 数据库证明从历史迁移向前兼容，但尚未做真实生产数据库演练；
   该演练属于 Batch E，当前不得把结果描述为生产迁移完成。
2. Batch A2 只提供数据库结构与 repository 原语，没有用户可见行为。Worker、恢复协调器、终态
   output/event 编排、payload 递归脱敏、异步 API、SSE 和前端恢复必须在 B-E 各自 Gate 中补齐。
3. 主 checkout 当前存在与本候选无关的运行态 JSON和其他看板草稿修改。集成时必须继续保留，
   只移植候选的最小验证 patch，不能用 reset、restore 或整分支 merge 清理用户工作。

## 6. Gate 决定

- verdict: `ACCEPTED_FOR_MAINLINE_INTEGRATION`。
- `mustReworkFirst=false`：本候选无需回 Qoder 返工。
- `allowNextTask=false`：Batch B 仍未授权，不发布下一工单。
- `mainMergeAllowed=false`：等待用户明确下达主线集成指令。
- 用户授权后，Codex 只集成 `1cc297d..521bbd2` 的 16 个 A2 文件；Qoder handoff 与本 Gate
  作为过程证据单独进入主线，并在主线复跑相同验证矩阵后再更新为“Batch A2 已集成”。
