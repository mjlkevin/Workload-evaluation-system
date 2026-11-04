import { opendir, lstat, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, gt, lt, sql, inArray } from "drizzle-orm";
import { db } from "../../../db/client";
import {
  harnessRuns,
  harnessRunOutputs,
  harnessSandboxJobs as jobs,
  harnessSandboxArtifacts as artifacts,
  aiSessions,
  users,
} from "../../../db/schema";
import {
  createHarnessRuntimeRepository,
  attachWorkbenchConversationFact,
} from "../harness.module";
import { HarnessRuntimeError } from "../harness-runtime.repository";
import {
  sandboxProvider,
  sandboxStore,
  sandboxStoreRoot,
} from "./sandbox.module";
import {
  SANDBOX_WORKFLOW_ID,
  SANDBOX_WORKFLOW_VERSION,
} from "./sandbox.conversation";
const MAX_CONTINUATION_BYTES = 160 * 1024;
const upstreamOmission = {
  omitted: true,
  reason: "SANDBOX_UPSTREAM_RESULT_TOO_LARGE",
  message: "上一步结果过长，未自动带入。请先向用户说明这一限制；可以使用已有材料，材料不足时请用户缩小范围或补充材料，不要猜测上一步结果。",
};
async function recordDispatch(runId: string, status: "blocked" | "retry", reason: string) {
  const now = new Date();
  await db.update(harnessRuns).set({
    executionConfig: sql`jsonb_set(${harnessRuns.executionConfig}, '{sandboxFollowUpDispatch}', ${JSON.stringify({ status, reason, at: now.toISOString() })}::jsonb)`,
    updatedAt: now,
  }).where(eq(harnessRuns.harnessRunId, runId));
}
/** Durable intent is the parent executionConfig. Queue submissionKey is the exactly-once handoff identity. */
export async function enqueueSandboxContinuations() {
  // Correlated SQL is fixed, identifiers are code-owned; no model strings enter SQL text.
  const parents = await db
    .select({ run: harnessRuns, output: harnessRunOutputs.content })
    .from(harnessRuns)
    .innerJoin(
      harnessRunOutputs,
      eq(harnessRunOutputs.harnessRunId, harnessRuns.harnessRunId),
    )
    .where(
      and(
        eq(harnessRuns.status, "completed"),
        sql`${harnessRuns.executionConfig} ? 'sandboxFollowUp'`,
        sql`COALESCE(${harnessRuns.executionConfig}->'sandboxFollowUpDispatch'->>'status', '') <> 'blocked'`,
        sql`NOT EXISTS (SELECT 1 FROM harness_runs child WHERE child.owner_user_id = ${harnessRuns.ownerUserId} AND child.submission_key = 'sandbox-followup:' || ${harnessRuns.harnessRunId}::text)`,
      ),
    )
    .orderBy(asc(harnessRuns.updatedAt), asc(harnessRuns.harnessRunId))
    .limit(20);
  for (const { run, output } of parents) {
    try {
      const config = run.executionConfig as any,
        follow = config.sandboxFollowUp;
      if (
        !run.aiSessionId ||
        typeof follow?.content !== "string" ||
        Buffer.byteLength(follow.content) > 64 * 1024
      ) {
        await recordDispatch(run.harnessRunId, "blocked", "SANDBOX_FOLLOWUP_INVALID");
        continue;
      }
      const { executionConfig } = attachWorkbenchConversationFact({
        content: follow.content,
      });
      const childConfig = {
        ...executionConfig,
        content: follow.content as string,
        sourceRunId: run.harnessRunId,
        sandboxContext: {
          selection: follow.selection,
          sourceRunId: run.harnessRunId,
          upstreamResult: output,
        },
      };
      if (Buffer.byteLength(JSON.stringify(childConfig)) > MAX_CONTINUATION_BYTES) {
        childConfig.sandboxContext.upstreamResult = upstreamOmission;
        childConfig.content = `${follow.content}\n\n${upstreamOmission.message}`;
      }
      if (Buffer.byteLength(JSON.stringify(childConfig)) > MAX_CONTINUATION_BYTES) {
        await recordDispatch(run.harnessRunId, "blocked", "SANDBOX_FOLLOWUP_INVALID");
        continue;
      }
      await createHarnessRuntimeRepository().createQueuedRun({
        ownerUserId: run.ownerUserId,
        ownerUsername: run.ownerUsername,
        aiSessionId: run.aiSessionId,
        submissionKey: "sandbox-followup:" + run.harnessRunId,
        title: "生成文件：" + run.title.slice(0, 70),
        workflowId: SANDBOX_WORKFLOW_ID,
        workflowVersion: SANDBOX_WORKFLOW_VERSION,
        executionConfig: childConfig,
        validateSubmission: async (tx) => {
          const [s] = await tx
            .select({ id: aiSessions.sessionId })
            .from(aiSessions)
            .innerJoin(
              users,
              sql`${users.userId}::text = ${aiSessions.ownerUserId}`,
            )
            .where(
              and(
                eq(aiSessions.sessionId, run.aiSessionId!),
                eq(aiSessions.ownerUserId, run.ownerUserId),
                eq(users.status, "active"),
                sql`${aiSessions.status} <> 'archived'`,
              ),
            )
            .for("update");
          if (!s) throw new HarnessRuntimeError("AI_RUN_SESSION_NOT_FOUND");
        },
      });
    } catch (error) {
      const code = error instanceof HarnessRuntimeError ? error.code : "HARNESS_RUNTIME_INTERNAL";
      if (code === "AI_RUN_SESSION_NOT_FOUND")
        await recordDispatch(run.harnessRunId, "blocked", "SANDBOX_SOURCE_UNAVAILABLE");
      else if (code === "SUBMISSION_KEY_CONFLICT")
        await recordDispatch(run.harnessRunId, "blocked", "SANDBOX_SUBMISSION_CONFLICT");
      else
        // Rotate temporary failures behind older intents; retain a bounded audit without raw errors.
        await recordDispatch(run.harnessRunId, "retry", code === "ACTIVE_WORKBENCH_RUN_EXISTS" ? code : "SANDBOX_DISPATCH_UNAVAILABLE");
    }
  }
}
let orphanCursor = 0;
// Failed physical deletions remain durable rows. Move past each bounded page,
// then wrap so a permanently unreadable file cannot starve every later artifact.
let expiredArtifactCursor: string | undefined;
async function sweepOrphanFiles(root: string) {
  let directory;
  try {
    const info = await lstat(root);
    // Refuse both a symlink root and symlink ancestors. Never scan a redirected directory.
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== path.resolve(root)) return;
    directory = await opendir(root);
  } catch {
    return;
  }
  const files: { name: string; id: string | null }[] = [];
  let seen = 0,
    finished = true;
  for await (const entry of directory) {
    seen++;
    if (seen <= orphanCursor) continue;
    if (
      entry.isFile() &&
      (/^[a-f0-9-]{36}$/i.test(entry.name) || /\.tmp$/.test(entry.name))
    )
      files.push({
        name: entry.name,
        id: /^[a-f0-9-]{36}$/i.test(entry.name) ? entry.name : null,
      });
    if (files.length >= 100 || seen - orphanCursor >= 1000) {
      orphanCursor = seen;
      finished = false;
      break;
    }
  }
  if (finished) orphanCursor = 0;
  const ids = files.flatMap((f) => (f.id ? [f.id] : []));
  const known = new Set(
    ids.length
      ? (
          await db
            .select({ id: artifacts.id })
            .from(artifacts)
            .where(inArray(artifacts.id, ids))
        ).map((a) => a.id)
      : [],
  );
  for (const file of files) {
    if (file.id && known.has(file.id)) continue;
    const absolute = path.join(root, file.name);
    try {
      const rootInfo = await lstat(root);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== path.resolve(root)) return;
      const info = await lstat(absolute);
      if (
        info.isFile() &&
        info.nlink === 1 &&
        info.mtimeMs < Date.now() - 86400000
      )
        await unlink(absolute);
    } catch {}
  }
}
export async function sweepSandboxResources(dependencies = {
  provider: sandboxProvider,
  store: sandboxStore,
  root: sandboxStoreRoot,
}) {
  const pending = await db
    .select({ job: jobs, run: harnessRuns })
    .from(jobs)
    .innerJoin(harnessRuns, eq(jobs.runId, harnessRuns.harnessRunId))
    .where(
      and(
        eq(jobs.cleanup, "pending"),
        sql`(${harnessRuns.status} IN ('completed','cancelled','failed') OR ${jobs.updatedAt} < now()-interval '16 minutes')`,
      ),
    )
    .orderBy(asc(jobs.updatedAt), asc(jobs.id))
    .limit(20);
  for (const { job } of pending) {
    if (!job.sandboxId) {
      await db.update(jobs).set({ updatedAt: new Date() }).where(eq(jobs.id, job.id));
      continue;
    }
    try {
      const instance = await (await dependencies.provider()).connect(job.sandboxId);
      await instance.release();
      await db
        .update(jobs)
        .set({
          cleanup: "cleaned",
          state: job.state === "completed" ? "completed" : "unknown",
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
    } catch {
      /* Keep the durable compensation and TTL backstop; never claim cleanup succeeded. */
      await db.update(jobs).set({ updatedAt: new Date() }).where(eq(jobs.id, job.id));
    }
  }
  const expiryCutoff = new Date();
  const expiredPage = (afterId?: string) => db
    .select().from(artifacts)
    .where(and(lt(artifacts.expiresAt, expiryCutoff), afterId ? gt(artifacts.id, afterId) : undefined))
    .orderBy(asc(artifacts.id)).limit(50);
  let expired = await expiredPage(expiredArtifactCursor);
  if (!expired.length && expiredArtifactCursor) {
    expiredArtifactCursor = undefined;
    expired = await expiredPage();
  }
  expiredArtifactCursor = expired.length === 50 ? expired[expired.length - 1].id : undefined;
  for (const a of expired) {
    try {
      await dependencies.store.remove(a.id);
      await db.delete(artifacts).where(eq(artifacts.id, a.id));
    } catch {
      /* Expiry denies reads regardless of asynchronous physical deletion. */
    }
  }
  await sweepOrphanFiles(dependencies.root);
}
export function startSandboxMaintenance() {
  let stopped = false,
    running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await enqueueSandboxContinuations();
      await sweepSandboxResources();
    } catch {
      console.warn(
        "[sandbox] maintenance unavailable; durable pending records retained",
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 15000);
  timer.unref();
  void tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
