import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, type Database } from "../../../db/client";
import {
  aiSessions,
  users,
  harnessRuns,
  harnessRunAttempts,
  harnessSandboxConnections as connections,
  harnessSandboxJobs as jobs,
  harnessSandboxArtifacts as artifacts,
} from "../../../db/schema";
import { getApiKey } from "../../system/credentials.store";
import { createHarnessRuntimeRepository } from "../harness-runtime.repository";
import { buildWorkbenchToolActionId } from "../../../services/ai/workbench-tool-approval";
import { frozenFileMaterial } from "../../skills/source-documents/source-document.projection";
import {
  SandboxError,
  type SandboxRepository,
  type SandboxScope,
  type SandboxJob,
  type SandboxArtifact,
} from "./sandbox.types";
import type { SandboxConnection } from "../../../services/sandbox/sandbox-provider";
import type { LocalSandboxArtifactStore } from "./sandbox-artifacts";
const fail = (message = "任务或材料不存在或已失效", status = 404) =>
  new SandboxError("SANDBOX_ACCESS_DENIED", message, status);
const hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
const scopeName = "sandbox:aliyun:default";
export const SANDBOX_CREDENTIAL_SCOPE = scopeName;
export function createSandboxRepository(
  store: Pick<LocalSandboxArtifactStore, "read">,
  database: Database = db,
): SandboxRepository {
  const runtime = createHarnessRuntimeRepository(database);
  const assertScope = async (
    scope: SandboxScope,
    tx: Database | any = database,
  ) => {
    const [found] = await tx
      .select({ id: harnessRuns.harnessRunId })
      .from(harnessRuns)
      .innerJoin(
        harnessRunAttempts,
        eq(harnessRuns.harnessRunId, harnessRunAttempts.harnessRunId),
      )
      .innerJoin(
        aiSessions,
        and(
          eq(aiSessions.sessionId, harnessRuns.aiSessionId),
          eq(aiSessions.ownerUserId, harnessRuns.ownerUserId),
        ),
      )
      .innerJoin(users, sql`${users.userId}::text = ${harnessRuns.ownerUserId}`)
      .where(
        and(
          eq(harnessRuns.harnessRunId, scope.runId),
          eq(harnessRuns.ownerUserId, scope.ownerId),
          eq(harnessRuns.aiSessionId, scope.sessionId),
          eq(harnessRuns.status, "running"),
          eq(harnessRunAttempts.harnessRunAttemptId, scope.attemptId),
          inArray(harnessRunAttempts.status, ["claimed", "running"]),
          gt(harnessRunAttempts.leaseExpiresAt, new Date()),
          eq(users.status, "active"),
          sql`${aiSessions.status} <> 'archived'`,
          sql`${harnessRuns.cancelRequestedAt} IS NULL`,
        ),
      );
    if (!found || scope.signal?.aborted)
      throw fail("任务已取消、权限已变化或执行租约失效", 409);
  };
  return {
    async connection() {
      const [row] = await database
        .select()
        .from(connections)
        .where(eq(connections.id, "default"));
      if (!row) return null;
      const key = await getApiKey(scopeName);
      return key.apiKey
        ? {
            connection: row.configuration as SandboxConnection,
            keyVersion: key.keyVersion,
            credentialFingerprint: hash(Buffer.from(key.apiKey)),
          }
        : null;
    },
    assertScope,
    async sources(scope, inputs) {
      await assertScope(scope);
      const [session] = await database
        .select()
        .from(aiSessions)
        .where(
          and(
            eq(aiSessions.sessionId, scope.sessionId),
            eq(aiSessions.ownerUserId, scope.ownerId),
          ),
        );
      if (!session) throw fail();
      const attached = (
        Array.isArray(session.attachments) ? session.attachments : []
      ) as any[];
      const out = [];
      for (const input of inputs) {
        let bytes: Buffer | undefined;
        const a = attached.find((a) => a.attachmentId === input.sourceId);
        if (a) {
          const text = frozenFileMaterial(a)?.text ?? a.parsedSummary;
          if (typeof text !== "string" || !text.trim()) throw fail();
          bytes = Buffer.from(text, "utf8");
        } else {
          if (!/^[a-f0-9-]{36}$/i.test(input.sourceId)) throw fail();
          const [a] = await database
            .select()
            .from(artifacts)
            .where(
              and(
                eq(artifacts.id, input.sourceId),
                eq(artifacts.ownerId, scope.ownerId),
                eq(artifacts.sessionId, scope.sessionId),
                gt(artifacts.expiresAt, new Date()),
              ),
            );
          if (!a) throw fail();
          bytes = await store.read(a.id);
          if (hash(bytes) !== a.sha256) throw fail();
        }
        out.push({
          sourceId: input.sourceId,
          name: input.name,
          bytes,
          sha256: hash(bytes),
        });
      }
      return out;
    },
    async findJob(runId, ordinal) {
      const [row] = await database
        .select()
        .from(jobs)
        .where(and(eq(jobs.runId, runId), eq(jobs.ordinal, ordinal)));
      return (row as SandboxJob) ?? null;
    },
    async insertJob(job) {
      await database.insert(jobs).values(job).onConflictDoNothing();
      const [row] = await database
        .select()
        .from(jobs)
        .where(and(eq(jobs.runId, job.runId), eq(jobs.ordinal, job.ordinal)));
      if (!row) throw fail();
      return row as SandboxJob;
    },
    async approval(scope, args) {
      return (
        (await runtime.findRunToolApprovalDecision({
          runId: scope.runId,
          actionId: buildWorkbenchToolActionId({
            runId: scope.runId,
            stepKey: scope.stepKey,
            ordinal: scope.ordinal,
            toolName: "sandbox_execute",
            arguments: args,
          }),
        })) === "approved"
      );
    },
    async claim(id, scope) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(1464226562)`);
        await assertScope(scope, tx);
        const rows = await tx
          .select({ owner: jobs.ownerId })
          .from(jobs)
          .where(
            sql`(${jobs.state} IN ('provisioning','staging','executing','collecting','unknown') OR ${jobs.cleanup} = 'pending') AND ${jobs.updatedAt} > now()-interval '16 minutes'`,
          );
        if (rows.length >= 4 || rows.some((r) => r.owner === scope.ownerId))
          return false;
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(jobs)
          .where(
            and(eq(jobs.runId, scope.runId), sql`${jobs.state} <> 'planned'`),
          );
        if (count >= 3)
          throw new SandboxError(
            "SANDBOX_EXECUTION_LIMIT",
            "本任务已达到3次代码执行上限",
            429,
          );
        return (
          (
            await tx
              .update(jobs)
              .set({
                state: "provisioning",
                execution: {
                  attemptId: scope.attemptId,
                  claimedAt: new Date().toISOString(),
                },
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(jobs.id, id),
                  eq(jobs.ownerId, scope.ownerId),
                  eq(jobs.runId, scope.runId),
                  eq(jobs.state, "planned"),
                ),
              )
              .returning()
          ).length === 1
        );
      });
    },
    async patch(id, patch) {
      await database
        .update(jobs)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(jobs.id, id),
            ...(patch.state && patch.state !== "completed"
              ? [sql`${jobs.state} <> 'completed'`]
              : []),
          ),
        );
    },
    async publish(job, items, result, scope) {
      await database.transaction(async (tx) => {
        await assertScope(scope, tx);
        const [run] = await tx
          .select()
          .from(harnessRuns)
          .where(eq(harnessRuns.harnessRunId, scope.runId))
          .for("update");
        await assertScope(scope, tx);
        if (!run || run.status !== "running" || run.cancelRequestedAt)
          throw fail("任务已取消，产物未发布", 409);
        const updated = await tx
          .update(jobs)
          .set({ state: "completed", result, updatedAt: new Date() })
          .where(
            and(
              eq(jobs.id, job.id),
              eq(jobs.ownerId, scope.ownerId),
              eq(jobs.state, "collecting"),
            ),
          )
          .returning();
        if (updated.length !== 1)
          throw fail("任务执行权已变化，产物未发布", 409);
        await tx.insert(artifacts).values(items);
      });
    },
  };
}
export async function readSandboxArtifact(
  id: string,
  ownerId: string,
  database: Database = db,
): Promise<SandboxArtifact> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw fail();
  const [row] = await database
    .select({ artifact: artifacts })
    .from(artifacts)
    .innerJoin(
      aiSessions,
      and(
        eq(aiSessions.sessionId, artifacts.sessionId),
        eq(aiSessions.ownerUserId, artifacts.ownerId),
      ),
    )
    .where(
      and(
        eq(artifacts.id, id),
        eq(artifacts.ownerId, ownerId),
        gt(artifacts.expiresAt, new Date()),
        sql`${aiSessions.status} <> 'archived'`,
      ),
    );
  if (!row) throw fail();
  return row.artifact as SandboxArtifact;
}
export async function sandboxSourceCatalog(
  ownerId: string,
  sessionId: string,
  database: Database = db,
) {
  const [session] = await database
    .select()
    .from(aiSessions)
    .where(
      and(
        eq(aiSessions.sessionId, sessionId),
        eq(aiSessions.ownerUserId, ownerId),
      ),
    );
  if (!session) return [];
  const files = Array.isArray(session.attachments)
    ? (session.attachments as any[])
    : [];
  const outputs = await database
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.sessionId, sessionId),
        eq(artifacts.ownerId, ownerId),
        gt(artifacts.expiresAt, new Date()),
      ),
    )
    .limit(30);
  return [
    ...files
      .filter((f) => typeof f.parsedSummary === "string" || !!f.sourceDocument)
      .slice(-8)
      .map((f) => ({
        sourceId: f.attachmentId,
        name: f.name,
        type: "已解析文本",
      })),
    ...outputs.map((f) => ({ sourceId: f.id, name: f.name, type: f.format })),
  ];
}
