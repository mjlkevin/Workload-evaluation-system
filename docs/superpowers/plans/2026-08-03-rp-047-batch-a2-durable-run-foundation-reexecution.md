# RP-047 Batch A2 Durable Run Foundation Re-execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在全新隔离 worktree 中重新实现 RP-047 Batch A，并补齐历史迁移、原子创建、并发幂等、运行时校验、安全错误和可复现 Testcontainers 门禁。

**Architecture:** 继续采用已批准的 PostgreSQL-backed Harness Run 设计，不改变表模型、owner 边界或后续 Batch 划分。A2 不复用被拒分支；以原 Batch A 计划为功能基线，本计划只增加被 Gate 证明缺失的原子性、并发、安全和验证约束。迁移演练使用同一 Testcontainer 内的随机临时 database，确保原始 migration 中显式 `public` 外键仍指向隔离数据库自己的 public schema。

**Tech Stack:** TypeScript 5.8、Node.js 24 test runner、Drizzle ORM 0.45、PostgreSQL 17 Testcontainers、npm worktree-local dependencies。

---

## 0. 文件边界

在原 Batch A Allowed Paths 基础上只增加：

- Modify: `apps/api/test-setup.mts`

不得修改 UI 源码、AI Session、routes、dispatch、OpenAPI、真实配置、package-lock 或系统环境。
依赖准备只允许在新 worktree 运行：

```bash
npm ci
npm ci --prefix ui/V2_PROTOTYPE
```

两条命令必须保持两个 lockfile 无 diff。

## Task 1: 从批准计划重建类型与 additive schema

**Files:**

- Modify: `apps/api/src/modules/harness/harness.types.ts`
- Modify: `apps/api/src/modules/harness/harness.module.ts`
- Create: `apps/api/src/modules/harness/harness-runtime.types.ts`
- Create: `apps/api/src/modules/harness/harness-runtime.types.test.ts`
- Modify: `apps/api/src/db/schema/harness.ts`
- Modify: `apps/api/src/modules/harness/harness.usecase.test.ts`
- Modify: `apps/api/src/routes/harness.routes.test.ts`
- Create: `apps/api/drizzle/0014_*.sql`
- Create: `apps/api/drizzle/meta/0014_snapshot.json`
- Modify: `apps/api/drizzle/meta/_journal.json`

- [ ] **Step 1:** 按原计划 Task 1 先写状态、词汇和 effectKey 失败测试，运行并保存缺模块/缺状态的 RED。
- [ ] **Step 2:** 实现八态 Run、四种 runKind、Attempt/Checkpoint/Output/Outbox 状态和确定性 effectKey，运行 focused GREEN。
- [ ] **Step 3:** 先给两个 legacy fixture 加入精确默认值，使 schema 未扩展前产生类型 RED。
- [ ] **Step 4:** 按原批准计划精确增加 13 个 Run 字段、5 张运行时表和稳定唯一索引，不增加 Worker/API/UI。
- [ ] **Step 5:** 运行 `npm run db:generate -w apps/api`，确认只生成一个 `0014_*.sql` 且无破坏性 SQL。
- [ ] **Step 6:** 运行 runtime types 测试和 `npm run build:api`；提交类型与 schema 两个独立 commit。

## Task 2: 原子 Run 创建、认领和 lease

**Files:**

- Create: `apps/api/src/modules/harness/harness-runtime.repository.ts`
- Create: `apps/api/src/modules/harness/harness-runtime.repository.test.ts`
- Modify: `apps/api/src/modules/harness/harness.module.ts`

- [ ] **Step 1: 先写失败测试**

测试除原计划四个 owner/claim 场景外，必须加入：

```ts
test("createQueuedRun returns the persisted eventSequence", async () => {
  const created = await repo.createQueuedRun(makeQueuedRunInput());
  const persisted = await repo.findRunForOwner(created.run.harnessRunId, created.run.ownerUserId);
  assert.equal(created.run.eventSequence, 1);
  assert.equal(persisted?.eventSequence, 1);
});

test("createQueuedRun rolls back the run when run_queued event insert fails", async () => {
  // 在 test-concurrency=1 下临时增加只拒绝 run_queued 的 CHECK constraint，finally 删除。
  // repository 调用必须失败，并按 owner + submissionKey 查询不到残留 Run。
});

test("heartbeat rejects expired lease", async () => {
  const result = await repo.heartbeatAttempt({
    attemptId,
    workerId,
    leaseMs: 30_000,
    now: new Date(expiredAt.getTime() + 1),
  });
  assert.equal(result, null);
});
```

- [ ] **Step 2: 实现同事务创建**

`createQueuedRun` 的 insert、`run_queued` 事件和最终 Run select 必须在同一个
`dbInstance.transaction` 中。新 Run 返回事务内重新读取的持久行；owner/submission 重放返回
原 Run 且不追加事件。活动会话唯一冲突只映射为安全的 `ACTIVE_WORKBENCH_RUN_EXISTS`。

- [ ] **Step 3: 实现安全错误边界**

增加 repository 自有错误类型，外部只返回固定 code 和安全摘要。任何 Drizzle/pg 错误不得
原样穿透，因为它可能包含 SQL params、state、prompt 或凭据。

- [ ] **Step 4:** 按原计划实现 owner SQL where、`FOR UPDATE SKIP LOCKED`、单活动 Attempt 和 worker/未过期 lease 绑定；claim 与 heartbeat 的 leaseMs 都限制 1,000..300,000。
- [ ] **Step 5:** 运行 focused GREEN，并用 SQL 查询确认失败注入后没有半提交 Run/事件。

## Task 3: 事件、检查点、输出和 outbox 并发幂等

**Files:**

- Modify: `apps/api/src/modules/harness/harness-runtime.repository.ts`
- Modify: `apps/api/src/modules/harness/harness-runtime.repository.test.ts`

- [ ] **Step 1: 写 20 路事件并发测试**

读取 start sequence，并发 20 次 `appendRunEvent`；排序后必须精确等于
`start+1..start+20`，数据库无重复、无缺口。

- [ ] **Step 2: 写严格 Runtime validation 测试**

分别传入 null、数组、无效日期、缺少任一 check、任一 check=false；全部拒绝。只有五个
check 都精确为 true、validatedAt 可解析且 validatorVersion 非空时允许写入。

- [ ] **Step 3: 写 checkpoint 并发重放测试**

同一 Run/key/hash 并发两次必须都 resolve，结果恰为一个 `created=true`、一个
`created=false`，且 checkpoint/event 各只有一条。不同 key 并发写入必须得到连续 sequence。

- [ ] **Step 4: 写安全错误测试**

在 state 中放入只用于测试的 sentinel，制造 key/hash 冲突；错误只含
`CHECKPOINT_KEY_CONFLICT`，不得包含 sentinel、SQL、params 或 JSON state。

- [ ] **Step 5: 串行化同 Run 原语**

`commitCheckpoint`、`upsertRunOutput` 在事务开始先锁定对应 Run 行。锁内完成幂等查询、
sequence/version 计算、写入、Run 指针和事件，避免 `MAX+1` 或 read-modify-write 并发冲突。

- [ ] **Step 6: 校验 JSON 对象**

state/payload/content 必须是可 JSON 序列化的普通对象，不接受数组、循环引用、BigInt 或
undefined 序列化结果；UTF-8 JSON 超过 1 MiB 返回固定
`HARNESS_RUNTIME_PAYLOAD_TOO_LARGE`，错误不回显载荷。

- [ ] **Step 7:** 补齐 checkpoint 指针、不同 outbox key 共存、output 并发版本、final 不可降级测试，运行 focused GREEN。

## Task 4: 修复 Testcontainers setup 并证明历史迁移

**Files:**

- Modify: `apps/api/test-setup.mts`
- Create: `apps/api/src/modules/harness/harness-runtime.migration.test.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: 修复 Node 24 ESM 路径**

把 `__dirname` 改为 ESM-safe 路径，不改变容器/迁移语义：

```ts
import { fileURLToPath } from "node:url";

const migrationsFolder = fileURLToPath(new URL("./drizzle/", import.meta.url));
```

- [ ] **Step 2: 用随机 database 写迁移 RED/GREEN**

测试只读取 `TEST_DATABASE_URL`。连接同一 Testcontainer 的 admin database，创建只含小写
字母、数字和下划线的随机数据库；在该数据库按文件顺序和 statement-breakpoint 执行
0000..0013，插入一条 legacy Run、一条 tool event 和一条 artifact，再执行唯一 0014。

必须断言：

- legacy Run 自动得到 `file_analysis / legacy_file_analysis / v1 / 0 / 0`；
- legacy tool effectKey 与 artifactKey 均为 null；
- 5 张新表、13 个新列和全部新唯一索引存在；
- finally 先终止该随机数据库连接，再 `DROP DATABASE`；
- 测试不读取 `DATABASE_URL`，不连接长期数据库。

- [ ] **Step 3: 精确修复 test:harness script**

```json
"test:harness": "tsx --test --test-global-setup=./test-setup.mts --test-concurrency=1 src/modules/harness/harness-runtime.types.test.ts src/modules/harness/harness-runtime.migration.test.ts src/modules/harness/harness-runtime.repository.test.ts src/modules/harness/harness.usecase.test.ts src/routes/harness.routes.test.ts"
```

- [ ] **Step 4:** 运行 Testcontainers 命令，确认 migration test 没有 skip，进程结束后没有新增残留容器。

## Task 5: 最终验证与 handoff

- [ ] **Step 1:** 确认 root/API/V2 依赖来自当前 worktree，不从主 checkout 回退加载。
- [ ] **Step 2:** 运行 `USE_TESTCONTAINERS=true npm run test:harness -w apps/api`；Colima 只允许在命令进程中设置当前 context 的 socket 环境变量，禁止修改 daemon/profile。
- [ ] **Step 3:** 运行 `npm run test:modules`、`npm run build:api`、`npm run build:web`、`git diff --check`。
- [ ] **Step 4:** 若 modules 测试只产生已知配置模型迁移 side effect，先核对 diff 仅为四个 model 字段，再精确恢复该文件；出现任何其他 diff 立即停止。
- [ ] **Step 5:** 确认两个 lockfile无变化、只有 Allowed Paths、worktree clean、没有新增长期容器。
- [ ] **Step 6:** 提交结构化 handoff，状态仍为“已回填 / 待 Codex 复核”，等待 Codex Gate A2。

## Self-review

- 原批准规格的 schema、owner、queue、lease、event、checkpoint、output、outbox 和 migration 均有对应任务。
- A1 Gate 的事务缺口、20 路并发、Runtime validation、并发重放、安全错误、Node 24、历史迁移和依赖隔离均有失败测试与验收命令。
- 本计划不包含 Worker、API、AI Session、UI、真实模型、真实数据库或 Batch B。
