// ============================================================
// 批次 1a · 判据④的子进程：一个从未参与过原请求的全新 OS 进程
// ============================================================
// 用法：npx tsx src/test-helpers/b1a-approval-restart-child.ts <runId> <confirmedBy>
// 它只带 TEST_DATABASE_URL 进来，不继承父进程任何内存对象——因此它能把
// 「等待审批」读回来并完成确认，本身就是可持久性的证据。
// 阻塞式回调（orchestrator.ts:64 的 await confirm(...)）在本进程里必然失败：
// 那个 Promise 随父进程销毁，库里也没有任何一行说明它存在过。
//
// 输出：一行 JSON（供父进程断言），无其它副作用。

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import { createHarnessRuntimeRepository } from "../modules/harness/harness-runtime.repository";

const runId = process.argv[2] ?? "";
const confirmedBy = process.argv[3] ?? "";
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

if (!runId || !url) {
  console.error("usage: tsx b1a-approval-restart-child.ts <runId> <confirmedBy> (TEST_DATABASE_URL required)");
  process.exit(2);
}

async function main(): Promise<void> {
const pool = new Pool({ connectionString: url, max: 2 });
try {
  const repo = createHarnessRuntimeRepository(drizzle(pool) as never);
  const events = await pool.query(
    "SELECT payload FROM harness_run_events WHERE harness_run_id = $1 AND event_type = 'tool.call.awaiting_approval' ORDER BY sequence",
    [runId],
  );
  const runs = await pool.query("SELECT status FROM harness_runs WHERE harness_run_id = $1", [runId]);
  const statusBefore = String(runs.rows[0]?.status ?? "missing");
  const actionId = String((events.rows[0]?.payload as { actionId?: unknown } | undefined)?.actionId ?? "");

  const confirmed = actionId
    ? await repo.confirmRunAction({ runId, actionId, confirmedBy })
    : { created: false, run: { status: statusBefore } as never };

  console.log(
    JSON.stringify({
      childPid: process.pid,
      statusBefore,
      awaitingEvents: events.rows.length,
      actionId,
      created: confirmed.created,
      statusAfter: String((confirmed.run as { status?: unknown }).status ?? ""),
    }),
  );
} finally {
  await pool.end();
  }
}

void main();
