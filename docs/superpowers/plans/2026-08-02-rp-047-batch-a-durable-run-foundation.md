# RP-047 Batch A Durable Run Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 RP-047 建立 PostgreSQL-backed Harness 持久运行基础，使后续 Worker、检查点恢复、异步 API 和前端多会话可以基于稳定的 Run、Attempt、Checkpoint、Event、Output 与 Outbox 契约继续开发。

**Architecture:** 扩展现有 `harness_runs`，新增五类运行时表和一组幂等索引；以独立 `harness-runtime.repository.ts` 封装 owner 查询、队列认领、心跳、事件序号、检查点追加、输出更新与 outbox 入队。Batch A 不启动 Worker、不调用模型、不投影 Session 消息、不修改前端，也不切换现有同步发送入口。

**Tech Stack:** TypeScript 5.8、Node.js test runner、Express 4、Drizzle ORM 0.45、PostgreSQL 17 Testcontainers、现有 Harness module 三层结构。

---

## 0. 批次定位与冻结边界

批准规格：`docs/superpowers/specs/2026-08-02-rp-047-durable-multichannel-checkpoint-runtime-design.md`，设计提交 `e1c8961`。

五批交付顺序已经固定：

| 批次 | 交付物 | 进入下一批的 Codex Gate |
|---|---|---|
| A | schema、migration、runtime repository、领域与真实 PostgreSQL 测试 | 迁移兼容、并发认领、序号与幂等约束全部有证据 |
| B | Worker、lease/heartbeat、混合检查点、恢复协调器、消息 projector | 故障注入证明不重复副作用 |
| C | 异步 Run API、owner 隔离、取消、SSE replay、OpenAPI | 路由与权限集成测试通过 |
| D | 前端多会话运行态、离页/刷新/重新登录恢复、明确停止 | A/B 会话并行与页面人工验收通过 |
| E | 全链路韧性、灰度、回滚、监控与运维说明 | 自动化、迁移演练、故障演练和人工验收齐全 |

本计划只执行 Batch A。以下行为不属于本批：

- 不调用真实或 fake 模型；
- 不创建常驻 Worker 进程；
- 不修改 `ui/V2_PROTOTYPE`；
- 不修改 AI Session controller/usecase/routes；
- 不新增 `/ai-runs` 或 `/ai-sessions/:sessionId/runs` 路由；
- 不运行非测试数据库迁移；
- 不删除或替换旧同步接口；
- 不修改总看板最终状态；Qoder 只在 handoff 中给同步建议。

## 1. Batch A 数据契约

### 1.1 Run 状态

`harness_runs.status` 扩为：

```ts
export const HARNESS_RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "recovering",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
] as const;
```

活动态固定为 `queued | running | waiting | recovering | cancelling`。终态固定为 `completed | failed | cancelled`。

### 1.2 新增运行时实体

- `harness_run_attempts`：一次 Worker 所有权和 lease；同一 Run 同时最多一个 `claimed/running` Attempt。
- `harness_run_checkpoints`：Runtime 校验通过后追加的恢复旗标；同一 Run 的序号与 checkpointKey 均唯一。
- `harness_run_events`：单 Run 严格递增事件流；`runId + sequence` 唯一。
- `harness_run_outputs`：当前可恢复输出快照；同一 Run 一行，版本递增。
- `harness_session_outbox`：向 AI Session 投影的可靠事件；`aiSessionId + deduplicationKey` 唯一。

### 1.3 既有表补强

- `harness_tool_events.effect_key`：同一 Run 的工具副作用唯一。
- `harness_artifacts.artifact_key`：同一 Run 的逻辑产物唯一。
- 旧 Harness Run 由数据库默认值补齐：`runKind=file_analysis`、`workflowId=legacy_file_analysis`、`workflowVersion=v1`。
- 活动 Run 单会话唯一约束只作用于 `runKind=workbench_chat`，不能阻断历史 file-analysis 数据。

## 2. 文件清单

### 新建

- `apps/api/src/modules/harness/harness-runtime.types.ts`
- `apps/api/src/modules/harness/harness-runtime.types.test.ts`
- `apps/api/src/modules/harness/harness-runtime.repository.ts`
- `apps/api/src/modules/harness/harness-runtime.repository.test.ts`
- `apps/api/src/modules/harness/harness-runtime.migration.test.ts`
- `apps/api/drizzle/0014_*.sql`，由 Drizzle 生成且只能有一个文件
- `apps/api/drizzle/meta/0014_snapshot.json`，由 Drizzle 生成

### 修改

- `apps/api/src/db/schema/harness.ts`
- `apps/api/src/modules/harness/harness.types.ts`
- `apps/api/src/modules/harness/harness.module.ts`
- `apps/api/src/modules/harness/harness.usecase.test.ts`
- `apps/api/src/routes/harness.routes.test.ts`
- `apps/api/package.json`
- `apps/api/drizzle/meta/_journal.json`，由 Drizzle 生成

除上述路径外不得修改。无新依赖，因此 `package-lock.json` 不应变化。

## Task 1: 冻结 Runtime 类型与状态语义

**Files:**

- Create: `apps/api/src/modules/harness/harness-runtime.types.test.ts`
- Create: `apps/api/src/modules/harness/harness-runtime.types.ts`
- Modify: `apps/api/src/modules/harness/harness.types.ts`
- Modify: `apps/api/src/modules/harness/harness.module.ts`

- [ ] **Step 1: 先写状态和稳定键失败测试**

创建 `harness-runtime.types.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  HARNESS_CHECKPOINT_KINDS,
  HARNESS_RUN_KINDS,
  HARNESS_RUN_TERMINAL_STATUSES,
  createHarnessEffectKey,
  isActiveHarnessRunStatus,
} from "./harness-runtime.types";
import { HARNESS_RUN_STATUSES } from "./harness.types";

test("durable run states distinguish active and terminal lifecycles", () => {
  assert.deepEqual(HARNESS_RUN_STATUSES, [
    "queued",
    "running",
    "waiting",
    "recovering",
    "cancelling",
    "completed",
    "failed",
    "cancelled",
  ]);
  assert.equal(isActiveHarnessRunStatus("queued"), true);
  assert.equal(isActiveHarnessRunStatus("cancelling"), true);
  assert.equal(isActiveHarnessRunStatus("completed"), false);
  assert.deepEqual(HARNESS_RUN_TERMINAL_STATUSES, ["completed", "failed", "cancelled"]);
});

test("runtime vocabularies and effect keys are deterministic", () => {
  assert.deepEqual(HARNESS_RUN_KINDS, ["workbench_chat", "file_analysis", "replay", "regression"]);
  assert.deepEqual(HARNESS_CHECKPOINT_KINDS, ["structural", "semantic", "combined"]);
  assert.equal(
    createHarnessEffectKey({ runId: "run-1", stepKey: "tool.search", effectName: "knowledge.lookup", ordinal: 1 }),
    "run-1:tool.search:knowledge.lookup:1",
  );
});
```

- [ ] **Step 2: 运行 RED 测试并保存失败证据**

Run:

```bash
cd /Users/kevin/AI/Workload-evaluation-system
npx tsx --test apps/api/src/modules/harness/harness-runtime.types.test.ts
```

Expected: FAIL，错误明确指向 `harness-runtime.types` 尚不存在或新状态未导出。若测试意外通过，停止并检查基线是否已经包含其他实现。

- [ ] **Step 3: 实现精确 Runtime 类型**

创建 `harness-runtime.types.ts`：

```ts
import type { HarnessRunStatus } from "./harness.types";

export const HARNESS_RUN_KINDS = ["workbench_chat", "file_analysis", "replay", "regression"] as const;
export type HarnessRunKind = (typeof HARNESS_RUN_KINDS)[number];

export const HARNESS_RUN_ACTIVE_STATUSES = ["queued", "running", "waiting", "recovering", "cancelling"] as const;
export const HARNESS_RUN_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

export const HARNESS_ATTEMPT_STATUSES = ["claimed", "running", "succeeded", "failed", "orphaned", "cancelled"] as const;
export type HarnessAttemptStatus = (typeof HARNESS_ATTEMPT_STATUSES)[number];

export const HARNESS_CHECKPOINT_KINDS = ["structural", "semantic", "combined"] as const;
export type HarnessCheckpointKind = (typeof HARNESS_CHECKPOINT_KINDS)[number];

export const HARNESS_RESUME_POLICIES = ["resume_next", "restart_step", "manual"] as const;
export type HarnessResumePolicy = (typeof HARNESS_RESUME_POLICIES)[number];

export const HARNESS_OUTPUT_STATUSES = ["partial", "final"] as const;
export type HarnessOutputStatus = (typeof HARNESS_OUTPUT_STATUSES)[number];

export const HARNESS_OUTBOX_STATUSES = ["pending", "processing", "published", "failed"] as const;
export type HarnessOutboxStatus = (typeof HARNESS_OUTBOX_STATUSES)[number];

export const HARNESS_RUN_EVENT_TYPES = [
  "run_queued",
  "run_claimed",
  "run_status_changed",
  "checkpoint_committed",
  "output_updated",
  "outbox_enqueued",
  "cancel_requested",
  "run_completed",
  "run_failed",
] as const;
export type HarnessRunEventType = (typeof HARNESS_RUN_EVENT_TYPES)[number];

export type HarnessEffectKeyInput = {
  runId: string;
  stepKey: string;
  effectName: string;
  ordinal: number;
};

export function isActiveHarnessRunStatus(status: HarnessRunStatus): boolean {
  return (HARNESS_RUN_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function createHarnessEffectKey(input: HarnessEffectKeyInput): string {
  return `${input.runId}:${input.stepKey}:${input.effectName}:${input.ordinal}`;
}
```

在 `harness.types.ts` 将 `HARNESS_RUN_STATUSES` 替换为 1.1 的八态数组；既有 `STAGE_STATUS` 不改变，旧 file-analysis 状态机继续使用其原有五态子集。

在 `harness.module.ts` 增加：

```ts
export * from "./harness-runtime.types";
```

- [ ] **Step 4: 运行 GREEN 测试**

Run:

```bash
npx tsx --test apps/api/src/modules/harness/harness-runtime.types.test.ts
```

Expected: 2 tests pass, 0 fail。

- [ ] **Step 5: 提交 Task 1**

```bash
git add apps/api/src/modules/harness/harness-runtime.types.ts \
  apps/api/src/modules/harness/harness-runtime.types.test.ts \
  apps/api/src/modules/harness/harness.types.ts \
  apps/api/src/modules/harness/harness.module.ts
git commit -m "feat(WES Agent): RP-047-A · 冻结持久运行状态契约"
```

## Task 2: 扩展 Harness Schema 并生成 additive migration

**Files:**

- Modify: `apps/api/src/db/schema/harness.ts`
- Modify: `apps/api/src/modules/harness/harness.usecase.test.ts`
- Modify: `apps/api/src/routes/harness.routes.test.ts`
- Create: `apps/api/drizzle/0014_*.sql`
- Create: `apps/api/drizzle/meta/0014_snapshot.json`
- Modify: `apps/api/drizzle/meta/_journal.json`

- [ ] **Step 1: 先在两个内存仓储 fixture 中声明预期新 Run 默认值**

在 `harness.usecase.test.ts` 和 `harness.routes.test.ts` 的 `HarnessRunRow` fixture 中，紧接 `harnessRunId` 和既有链接字段补入：

```ts
runKind: "file_analysis",
workflowId: "legacy_file_analysis",
workflowVersion: "v1",
currentStepKey: null,
submissionKey: null,
eventSequence: 0,
availableAt: now,
recoveryCount: 0,
cancelRequestedAt: null,
cancelRequestedBy: null,
lastCheckpointId: null,
executionConfig: {},
retryOfRunId: null,
```

这一步应暂时产生类型错误，因为 schema 尚未声明这些字段。

- [ ] **Step 2: 扩展 `harness_runs` 和既有幂等字段**

在 `harness.ts`：

1. 从 `drizzle-orm` 导入 `sql`；
2. 从 `drizzle-orm/pg-core` 增加 `uniqueIndex`；
3. 将 `harness_runs.status` enum 改为八态；
4. 在 `harness_runs` 增加以下精确字段：

```ts
runKind: text("run_kind", { enum: ["workbench_chat", "file_analysis", "replay", "regression"] })
  .default("file_analysis")
  .notNull(),
workflowId: text("workflow_id").default("legacy_file_analysis").notNull(),
workflowVersion: text("workflow_version").default("v1").notNull(),
currentStepKey: text("current_step_key"),
submissionKey: text("submission_key"),
eventSequence: integer("event_sequence").default(0).notNull(),
availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
recoveryCount: integer("recovery_count").default(0).notNull(),
cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
cancelRequestedBy: text("cancel_requested_by"),
lastCheckpointId: uuid("last_checkpoint_id"),
executionConfig: jsonb("execution_config").default({}).notNull(),
retryOfRunId: uuid("retry_of_run_id"),
```

在 `harness_runs` index callback 增加：

```ts
queueIdx: index("harness_runs_queue_idx").on(table.status, table.availableAt, table.createdAt),
ownerSubmissionUnique: uniqueIndex("harness_runs_owner_submission_unique")
  .on(table.ownerUserId, table.submissionKey),
activeWorkbenchSessionUnique: uniqueIndex("harness_runs_active_workbench_session_unique")
  .on(table.aiSessionId)
  .where(sql`${table.aiSessionId} is not null and ${table.runKind} = 'workbench_chat' and ${table.status} in ('queued', 'running', 'waiting', 'recovering', 'cancelling')`),
```

在 `harnessToolEvents` 增加：

```ts
effectKey: text("effect_key"),
```

及索引：

```ts
runEffectUnique: uniqueIndex("harness_tool_events_run_effect_unique")
  .on(table.harnessRunId, table.effectKey),
```

在 `harnessArtifacts` 增加：

```ts
artifactKey: text("artifact_key"),
```

及索引：

```ts
runArtifactUnique: uniqueIndex("harness_artifacts_run_artifact_unique")
  .on(table.harnessRunId, table.artifactKey),
```

两个 nullable 唯一键允许旧记录保持 `NULL`，只对新 durable workflow 写入的稳定键生效。

- [ ] **Step 3: 声明五张运行时表**

将以下表放在 `harnessRuns` 之后、`harnessFiles` 之前；外键全部 `onDelete: "cascade"`，除明确的 Attempt/Checkpoint 交叉引用外不建立循环外键：

```ts
export const harnessRunAttempts = pgTable(
  "harness_run_attempts",
  {
    harnessRunAttemptId: uuid("harness_run_attempt_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").notNull().references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(),
    workerId: text("worker_id").notNull(),
    status: text("status", { enum: ["claimed", "running", "succeeded", "failed", "orphaned", "cancelled"] }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull(),
    resumeCheckpointId: uuid("resume_checkpoint_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").default({}).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runAttemptUnique: uniqueIndex("harness_run_attempts_run_attempt_unique").on(table.harnessRunId, table.attemptNo),
    activeRunUnique: uniqueIndex("harness_run_attempts_active_run_unique")
      .on(table.harnessRunId)
      .where(sql`${table.status} in ('claimed', 'running')`),
    leaseIdx: index("harness_run_attempts_lease_idx").on(table.status, table.leaseExpiresAt),
  }),
);

export const harnessRunCheckpoints = pgTable(
  "harness_run_checkpoints",
  {
    harnessRunCheckpointId: uuid("harness_run_checkpoint_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").notNull().references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    harnessRunAttemptId: uuid("harness_run_attempt_id").references(() => harnessRunAttempts.harnessRunAttemptId, { onDelete: "set null" }),
    sequence: integer("sequence").notNull(),
    checkpointKey: text("checkpoint_key").notNull(),
    checkpointKind: text("checkpoint_kind", { enum: ["structural", "semantic", "combined"] }).notNull(),
    workflowId: text("workflow_id").notNull(),
    workflowVersion: text("workflow_version").notNull(),
    stepKey: text("step_key").notNull(),
    resumePolicy: text("resume_policy", { enum: ["resume_next", "restart_step", "manual"] }).notNull(),
    state: jsonb("state").notNull(),
    stateHash: text("state_hash").notNull(),
    inputHash: text("input_hash"),
    effectKeys: jsonb("effect_keys").default([]).notNull(),
    aiMilestone: jsonb("ai_milestone"),
    runtimeValidation: jsonb("runtime_validation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runSequenceUnique: uniqueIndex("harness_run_checkpoints_run_sequence_unique").on(table.harnessRunId, table.sequence),
    runKeyUnique: uniqueIndex("harness_run_checkpoints_run_key_unique").on(table.harnessRunId, table.checkpointKey),
    runCreatedIdx: index("harness_run_checkpoints_run_created_idx").on(table.harnessRunId, table.createdAt),
  }),
);

export const harnessRunEvents = pgTable(
  "harness_run_events",
  {
    harnessRunEventId: uuid("harness_run_event_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").notNull().references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runSequenceUnique: uniqueIndex("harness_run_events_run_sequence_unique").on(table.harnessRunId, table.sequence),
    runCreatedIdx: index("harness_run_events_run_created_idx").on(table.harnessRunId, table.createdAt),
  }),
);

export const harnessRunOutputs = pgTable(
  "harness_run_outputs",
  {
    harnessRunOutputId: uuid("harness_run_output_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").notNull().references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    harnessRunAttemptId: uuid("harness_run_attempt_id").references(() => harnessRunAttempts.harnessRunAttemptId, { onDelete: "set null" }),
    status: text("status", { enum: ["partial", "final"] }).notNull(),
    version: integer("version").default(1).notNull(),
    content: jsonb("content").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runUnique: uniqueIndex("harness_run_outputs_run_unique").on(table.harnessRunId),
  }),
);

export const harnessSessionOutbox = pgTable(
  "harness_session_outbox",
  {
    harnessSessionOutboxId: uuid("harness_session_outbox_id").primaryKey(),
    harnessRunId: uuid("harness_run_id").notNull().references(() => harnessRuns.harnessRunId, { onDelete: "cascade" }),
    aiSessionId: text("ai_session_id").notNull(),
    eventType: text("event_type").notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["pending", "processing", "published", "failed"] }).default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionDedupeUnique: uniqueIndex("harness_session_outbox_session_dedupe_unique")
      .on(table.aiSessionId, table.deduplicationKey),
    pendingIdx: index("harness_session_outbox_pending_idx").on(table.status, table.availableAt),
    runIdx: index("harness_session_outbox_run_idx").on(table.harnessRunId),
  }),
);
```

在文件末尾导出所有新表的 `$inferSelect/$inferInsert` 类型。

- [ ] **Step 4: 生成迁移并检查它是 additive**

Run:

```bash
npm run db:generate -w apps/api
ls apps/api/drizzle/0014_*.sql
git diff -- apps/api/drizzle/meta/_journal.json apps/api/drizzle/meta/0014_snapshot.json apps/api/drizzle/0014_*.sql
```

Expected:

- 恰好生成一个 `0014_*.sql`；
- SQL 只包含 `ALTER TABLE ... ADD COLUMN`、`CREATE TABLE`、`CREATE INDEX`、`CREATE UNIQUE INDEX` 和所需外键；
- 不包含 `DROP TABLE`、`DROP COLUMN`、`TRUNCATE`、数据删除或其他业务域表修改；
- migration 保留数据库默认值，使历史 `harness_runs` 行可自动补齐。

- [ ] **Step 5: 构建以暴露所有 fixture 兼容问题**

Run:

```bash
npm run build:api
```

Expected: PASS。若 `HarnessRunRow` fixture、artifact 或 tool event fixture 因 nullable 新字段报错，只补充 `null`，不得用全局 `as unknown as` 绕开类型。

- [ ] **Step 6: 提交 Task 2**

```bash
git add apps/api/src/db/schema/harness.ts \
  apps/api/src/modules/harness/harness.usecase.test.ts \
  apps/api/src/routes/harness.routes.test.ts \
  apps/api/drizzle/0014_*.sql \
  apps/api/drizzle/meta/0014_snapshot.json \
  apps/api/drizzle/meta/_journal.json
git commit -m "feat(WES Agent): RP-047-A · 建立持久运行数据库结构"
```

## Task 3: 实现 owner-safe 队列与 Attempt lease 仓储

**Files:**

- Create: `apps/api/src/modules/harness/harness-runtime.repository.test.ts`
- Create: `apps/api/src/modules/harness/harness-runtime.repository.ts`
- Modify: `apps/api/src/modules/harness/harness.module.ts`

- [ ] **Step 1: 写 owner、提交幂等与并发认领失败测试**

测试文件必须使用 `testDb`，每个测试创建随机 owner/session/submissionKey，并在 `afterEach` 通过创建的 Run ID 精确删除，不调用全表 `TRUNCATE`。

至少先写四个测试：

```ts
test("createQueuedRun returns the same run for one owner and submission key", async () => {
  const first = await repo.createQueuedRun(makeQueuedRunInput());
  const second = await repo.createQueuedRun(makeQueuedRunInput());
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.run.harnessRunId, first.run.harnessRunId);
});

test("one workbench session cannot hold two active runs", async () => {
  await repo.createQueuedRun(makeQueuedRunInput({ submissionKey: "submit-a" }));
  await assert.rejects(
    repo.createQueuedRun(makeQueuedRunInput({ submissionKey: "submit-b" })),
    /active workbench run/i,
  );
});

test("findRunForOwner never returns another owner's run", async () => {
  const created = await repo.createQueuedRun(makeQueuedRunInput());
  assert.equal(await repo.findRunForOwner(created.run.harnessRunId, "other-owner"), null);
  assert.equal((await repo.findRunForOwner(created.run.harnessRunId, ownerUserId))?.ownerUserId, ownerUserId);
});

test("two claimers cannot claim the same queued run", async () => {
  const created = await repo.createQueuedRun(makeQueuedRunInput());
  const [left, right] = await Promise.all([
    repo.claimNextQueuedRun({ workerId: "worker-a", leaseMs: 30_000 }),
    repo.claimNextQueuedRun({ workerId: "worker-b", leaseMs: 30_000 }),
  ]);
  const claimed = [left, right].filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.run.harnessRunId, created.run.harnessRunId);
  assert.equal(claimed[0]?.attempt.attemptNo, 1);
});
```

再写心跳测试：正确 worker 延长 lease；错误 worker 或已结束 Attempt 返回 `null`，不能夺取所有权。

- [ ] **Step 2: 运行 RED 测试**

Run:

```bash
USE_TESTCONTAINERS=true npx tsx --test \
  --test-global-setup=./apps/api/test-setup.mts \
  --test-concurrency=1 \
  apps/api/src/modules/harness/harness-runtime.repository.test.ts
```

Expected: FAIL，缺少 runtime repository 或方法实现。

- [ ] **Step 3: 定义 repository 接口与输入类型**

`harness-runtime.repository.ts` 必须导出：

```ts
export type CreateQueuedHarnessRunInput = {
  ownerUserId: string;
  ownerUsername: string;
  aiSessionId: string;
  submissionKey: string;
  title: string;
  workflowId: string;
  workflowVersion: string;
  executionConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type ClaimNextHarnessRunInput = {
  workerId: string;
  leaseMs: number;
  now?: Date;
};

export interface HarnessRuntimeRepository {
  createQueuedRun(input: CreateQueuedHarnessRunInput): Promise<{ run: HarnessRunRow; created: boolean }>;
  findRunForOwner(runId: string, ownerUserId: string): Promise<HarnessRunRow | null>;
  claimNextQueuedRun(input: ClaimNextHarnessRunInput): Promise<{ run: HarnessRunRow; attempt: HarnessRunAttemptRow } | null>;
  heartbeatAttempt(input: { attemptId: string; workerId: string; leaseMs: number; now?: Date }): Promise<HarnessRunAttemptRow | null>;
}
```

工厂固定为：

```ts
export function createHarnessRuntimeRepository(dbInstance: Database = db): HarnessRuntimeRepository
```

并从 `harness.module.ts` 导出 repository。

- [ ] **Step 4: 实现提交幂等和 owner-safe 查询**

`createQueuedRun` 必须：

1. 生成 UUID；
2. 写 `runKind=workbench_chat`、`mode=interactive`、`stage=uploaded`、`status=queued`；
3. 用 `(ownerUserId, submissionKey)` 冲突目标 `onConflictDoNothing()`；
4. 插入未返回行时按 owner + submissionKey 查询原 Run 并返回 `created=false`；
5. 若命中同会话活动唯一约束但 submissionKey 不同，抛出带稳定 code `ACTIVE_WORKBENCH_RUN_EXISTS` 的领域错误；
6. 先实现私有 `appendRunEventInTransaction` 原语，用 Run 行原子递增序号；同一事务追加 `run_queued` 事件，重复 submission 不追加第二条事件。Task 4 再将该原语暴露为 public repository method 并补齐并发测试。

`findRunForOwner` 的 SQL 条件必须同时包含 `runId` 与 `ownerUserId`，不能先按 ID 查出再在内存过滤。

- [ ] **Step 5: 用行锁和 SKIP LOCKED 实现单次认领**

`claimNextQueuedRun` 必须在一个事务中：

1. 选取 `status=queued AND availableAt <= now` 的最早 Run；
2. 使用 `FOR UPDATE SKIP LOCKED`；
3. 计算该 Run 下一 `attemptNo`；
4. 插入 `claimed` Attempt，设置 `workerId/heartbeatAt/leaseExpiresAt`；
5. 将 Run 更新为 `running`；
6. 以该 Run 的原子事件序号追加 `run_claimed`；
7. 返回 Run 与 Attempt；没有可认领项返回 `null`。

`leaseMs` 小于 1,000 或大于 300,000 时直接拒绝，避免零 lease 和无限占有。

- [ ] **Step 6: 实现 worker 绑定心跳**

`heartbeatAttempt` 的 `UPDATE` 条件必须同时包含：

- `attemptId`；
- `workerId`；
- `status IN ('claimed', 'running')`；
- `leaseExpiresAt > now`。

成功时将状态推进到 `running` 并更新 `heartbeatAt/leaseExpiresAt/updatedAt`；不满足条件返回 `null`。

- [ ] **Step 7: 运行 GREEN 并提交 Task 3**

```bash
USE_TESTCONTAINERS=true npx tsx --test \
  --test-global-setup=./apps/api/test-setup.mts \
  --test-concurrency=1 \
  apps/api/src/modules/harness/harness-runtime.repository.test.ts
git add apps/api/src/modules/harness/harness-runtime.repository.ts \
  apps/api/src/modules/harness/harness-runtime.repository.test.ts \
  apps/api/src/modules/harness/harness.module.ts
git commit -m "feat(WES Agent): RP-047-A · 实现持久队列与租约认领"
```

Expected: owner、幂等、同会话 single-flight、并发认领和心跳测试全部通过。

## Task 4: 实现事件、检查点、输出与 Outbox 原子原语

**Files:**

- Modify: `apps/api/src/modules/harness/harness-runtime.repository.test.ts`
- Modify: `apps/api/src/modules/harness/harness-runtime.repository.ts`

- [ ] **Step 1: 写事件严格递增和并发测试**

对同一 Run 先读取当前 `eventSequence`，再并发调用 20 次 `appendRunEvent`；排序后的序号必须精确等于 `start+1..start+20`，数据库中无重复、无缺口。事件序号分配必须由：

```sql
UPDATE harness_runs
SET event_sequence = event_sequence + 1, updated_at = now()
WHERE harness_run_id = $1
RETURNING event_sequence
```

和事件 INSERT 在同一事务完成。不存在的 Run 抛出稳定 code `HARNESS_RUN_NOT_FOUND`。

- [ ] **Step 2: 写 checkpoint 追加与幂等测试**

测试以下契约：

- 第一次写 checkpointKey 返回 `created=true`；
- 相同 Run + checkpointKey + 相同 stateHash 重放返回原 checkpoint 且 `created=false`；
- 相同 key 但不同 stateHash 抛出 `CHECKPOINT_KEY_CONFLICT`；
- 新 checkpoint 的 sequence 连续递增；
- 成功提交后 `harness_runs.lastCheckpointId/currentStepKey` 指向新旗标；
- `runtimeValidation` 为 `null`、数组或缺少 `validatedAt/validatorVersion/checks` 时拒绝写入；
- `stateHash`、workflow version、stepKey、resumePolicy 和 state 必填。

Runtime validation 的最小结构固定为：

```ts
export type HarnessRuntimeValidation = {
  validatedAt: string;
  validatorVersion: string;
  checks: {
    ownerBound: true;
    workflowVersionMatched: true;
    stateHashMatched: true;
    nextStepKnown: true;
    effectsStable: true;
  };
};
```

- [ ] **Step 3: 写 output upsert 测试**

同一 Run 第一次写入版本为 1；第二次写入更新同一行且版本为 2；相同 `contentHash` 重放返回原版本，不增加版本；`partial -> final` 允许，`final -> partial` 拒绝并抛出 `FINAL_OUTPUT_IMMUTABLE`。

- [ ] **Step 4: 写 outbox 幂等测试**

相同 `aiSessionId + deduplicationKey` 两次入队只保留一行并返回 `created=false`；不同 deduplicationKey 可共存；传入的 aiSessionId 必须等于 Run 上的 aiSessionId，否则抛出 `RUN_SESSION_MISMATCH`。

- [ ] **Step 5: 运行 RED 测试**

```bash
USE_TESTCONTAINERS=true npx tsx --test \
  --test-global-setup=./apps/api/test-setup.mts \
  --test-concurrency=1 \
  apps/api/src/modules/harness/harness-runtime.repository.test.ts
```

Expected: 新增事件、checkpoint、output 和 outbox 测试失败。

- [ ] **Step 6: 实现四组原子原语**

先增加以下精确 input types：

```ts
export type AppendHarnessRunEventInput = {
  runId: string;
  eventType: HarnessRunEventType;
  payload?: Record<string, unknown>;
};

export type CommitHarnessCheckpointInput = {
  runId: string;
  attemptId?: string;
  checkpointKey: string;
  checkpointKind: HarnessCheckpointKind;
  workflowId: string;
  workflowVersion: string;
  stepKey: string;
  resumePolicy: HarnessResumePolicy;
  state: Record<string, unknown>;
  stateHash: string;
  inputHash?: string;
  effectKeys?: string[];
  aiMilestone?: Record<string, unknown>;
  runtimeValidation: HarnessRuntimeValidation;
};

export type UpsertHarnessRunOutputInput = {
  runId: string;
  attemptId?: string;
  status: HarnessOutputStatus;
  content: Record<string, unknown>;
  contentHash: string;
};

export type EnqueueHarnessSessionOutboxInput = {
  runId: string;
  aiSessionId: string;
  eventType: string;
  deduplicationKey: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
};
```

再为 `HarnessRuntimeRepository` 增加以下四个 public method，不增加执行器、HTTP 或 Session 写入语义：

```ts
appendRunEvent(input: AppendHarnessRunEventInput): Promise<HarnessRunEventRow>;
commitCheckpoint(input: CommitHarnessCheckpointInput): Promise<{ checkpoint: HarnessRunCheckpointRow; created: boolean }>;
upsertRunOutput(input: UpsertHarnessRunOutputInput): Promise<HarnessRunOutputRow>;
enqueueSessionOutbox(input: EnqueueHarnessSessionOutboxInput): Promise<{ outbox: HarnessSessionOutboxRow; created: boolean }>;
```

必须遵守：

- `appendRunEvent` 用 Run 行原子递增序号，不能使用 `MAX(sequence)+1`；
- `commitCheckpoint` 在一个事务中完成幂等检查、checkpoint 插入、Run 指针更新和 `checkpoint_committed` 事件追加；
- `upsertRunOutput` 使用 Run 唯一约束，contentHash 相同不加版本，最终输出不可降级；
- `enqueueSessionOutbox` 在一个事务中校验 Run/Session 绑定、幂等入队并追加 `outbox_enqueued` 事件；
- JSON payload 只接受可序列化对象，单个 `state/payload/content` 的 UTF-8 JSON 大小上限为 1 MiB，超限抛出 `HARNESS_RUNTIME_PAYLOAD_TOO_LARGE`；
- 所有错误只包含 ID、code 和安全摘要，不打印 prompt、附件原文、JWT 或 provider 凭据。

- [ ] **Step 7: 运行 GREEN 并提交 Task 4**

```bash
USE_TESTCONTAINERS=true npx tsx --test \
  --test-global-setup=./apps/api/test-setup.mts \
  --test-concurrency=1 \
  apps/api/src/modules/harness/harness-runtime.repository.test.ts
git add apps/api/src/modules/harness/harness-runtime.repository.ts \
  apps/api/src/modules/harness/harness-runtime.repository.test.ts
git commit -m "feat(WES Agent): RP-047-A · 固化检查点与事件幂等原语"
```

Expected: repository focused tests 全部通过。

## Task 5: 证明迁移兼容并完成 Batch A 验证

**Files:**

- Create: `apps/api/src/modules/harness/harness-runtime.migration.test.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: 写干净库与已有 Harness 数据迁移演练**

`harness-runtime.migration.test.ts` 仅在 `TEST_DATABASE_URL` 存在时运行；测试必须：

1. 创建随机 schema，设置 `search_path`；
2. 按文件名顺序执行 `0000` 至 `0013` SQL；以 `--> statement-breakpoint` 分隔语句；
3. 插入一条只含 0013 字段的历史 `harness_runs` 行和一条历史 tool event/artifact；
4. 执行唯一的 `0014_*.sql`；
5. 断言历史 Run 被补齐为 `file_analysis / legacy_file_analysis / v1 / eventSequence=0 / recoveryCount=0`；
6. 断言历史 tool event/artifact 的新稳定键为 `NULL`；
7. 断言新表和所有唯一索引存在；
8. 在 `finally` 删除随机 schema。

迁移测试严禁连接 `DATABASE_URL`；只读取 `TEST_DATABASE_URL`，缺少时明确 skip。真实验收必须使用 Testcontainers 命令，使该测试不被 skip。

- [ ] **Step 2: 将新测试纳入 Harness 脚本**

将 `apps/api/package.json` 中 `test:harness` 精确改为：

```json
"test:harness": "tsx --test --test-global-setup=./test-setup.mts --test-concurrency=1 src/modules/harness/harness-runtime.types.test.ts src/modules/harness/harness-runtime.migration.test.ts src/modules/harness/harness-runtime.repository.test.ts src/modules/harness/harness.usecase.test.ts src/routes/harness.routes.test.ts"
```

- [ ] **Step 3: 运行 Batch A 必选验证矩阵**

Run from repository root:

```bash
USE_TESTCONTAINERS=true npm run test:harness -w apps/api
npm run test:modules
npm run build:api
npm run build:web
git diff --check
git status --short
```

Expected:

- Harness 全部通过，migration test 没有 skip；
- module tests 通过；
- API build 通过；
- Web build 通过，证明共享契约没有造成前端回归；
- `git diff --check` 无输出；
- 只出现本计划允许的文件。

- [ ] **Step 4: 检查迁移与占位符门禁**

```bash
rg -n "DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM" apps/api/drizzle/0014_*.sql
rg -n "TODO|TBD|FIXME|placeholder|not implemented" \
  apps/api/src/modules/harness/harness-runtime.types.ts \
  apps/api/src/modules/harness/harness-runtime.repository.ts \
  apps/api/src/modules/harness/harness-runtime.types.test.ts \
  apps/api/src/modules/harness/harness-runtime.repository.test.ts \
  apps/api/src/modules/harness/harness-runtime.migration.test.ts
```

Expected: 两条命令均无输出。若 migration 出现破坏性语句，停止并请求 Codex Gate，不得手工掩盖。

- [ ] **Step 5: 提交验证入口与最终 Batch A commit**

```bash
git add apps/api/src/modules/harness/harness-runtime.migration.test.ts apps/api/package.json
git commit -m "test(WES Agent): RP-047-A · 验证持久运行迁移兼容"
```

项目提交规范没有独立 `test` 前缀时，改用：

```bash
git commit -m "chore(WES Agent): RP-047-A · 验证持久运行迁移兼容"
```

只执行其中符合仓库提交规范的一条；本项目采用后一条。

- [ ] **Step 6: 形成结构化 Qoder handoff**

handoff 必须包含：

- `taskId: RP-047-A`；
- worktree/branch/baseCommit/finalCommit；
- 逐文件变更与原因；
- RED 失败命令和失败摘要；
- GREEN、Testcontainers migration、module、API/Web build 的逐条命令/退出码/测试数量；
- migration 文件名和 additive 审计结论；
- 并发认领、事件序号、checkpoint、outbox 幂等测试证据；
- 未运行项和原因；
- 风险、残余问题和总看板同步建议；
- 明确状态 `已回填 / 待 Codex 复核`；
- 明确 `allowNextTask=false`，不得领取 Batch B。

## 3. Codex Gate A 验收清单

Codex 复核时必须逐项确认：

- [ ] Qoder 使用了正确项目根目录、专属 worktree 和 `qoder/rp-047-a-durable-run-foundation` 分支；
- [ ] diff 只命中允许路径，没有覆盖用户现有 dirty changes；
- [ ] migration 为 additive，历史 Harness 行默认补齐；
- [ ] 同 owner submission 幂等、同 workbench session 单活动 Run 有数据库约束；
- [ ] queue claim 使用 `FOR UPDATE SKIP LOCKED`，无双认领；
- [ ] Attempt heartbeat 绑定 worker 且拒绝过期 lease；
- [ ] event sequence 由 Run 行原子递增，不使用 `MAX+1`；
- [ ] checkpoint key/stateHash 冲突明确失败，Runtime validation 必填；
- [ ] tool effect、artifact、output 与 outbox 具有稳定幂等键；
- [ ] owner 查询在 SQL 层隔离；
- [ ] Testcontainers 干净库和已有 Harness 数据迁移演练通过；
- [ ] Harness、modules、API/Web build 和 diff check 通过；
- [ ] Qoder 没有运行真实数据库迁移、没有接模型/Worker/API/UI；
- [ ] handoff 状态没有越过“已回填 / 待 Codex 复核”。

Gate A 通过后，由 Codex 单独发布 Batch B 计划与 Work Order；本计划不授权 Qoder继续执行。
