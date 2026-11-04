import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, asc } from "drizzle-orm";
import { db, pool } from "../../../db/client";
import {
  aiSessions,
  harnessRuns,
  harnessRunEvents,
  harnessSandboxArtifacts,
} from "../../../db/schema";
import {
  createTestUser,
  cleanupOneTestUser,
} from "../../../test-helpers/test-users";
import { createAiSession } from "../../ai-sessions/ai-sessions.usecase";
import { createHarnessRuntimeRepository } from "../harness-runtime.repository";
import { startHarnessRuntime } from "../harness-boot";
import { createHarnessRuntimeWorker } from "../harness-runtime.worker";
import { attachWorkbenchConversationFact } from "../workbench-conversation-fact";
import { ToolRegistry } from "../../../agent/tool-registry";
import { buildSandboxTool } from "../../../agent/tools/sandbox.tools";
import { createSandboxRepository } from "./sandbox.repository";
import { createSandboxService } from "./sandbox.service";
import { LocalSandboxArtifactStore } from "./sandbox-artifacts";
after(async () => {
  await pool.end();
});
test(
  "real Harness pauses, new worker resumes approved frozen code, and durable file survives instance release",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const user = await createTestUser("wes-sandbox-host");
    const session = await createAiSession(user, {
      title: "合成文件测试",
      workflowKey: "free_chat",
    });
    const repo = createHarnessRuntimeRepository();
    const directory = await mkdtemp(path.join(tmpdir(), "wes-sandbox-host-"));
    const store = new LocalSandboxArtifactStore(directory);
    const base = createSandboxRepository(store);
    let creations = 0,
      releases = 0;
    const connection = {
      id: "default",
      workspaceId: "llm-test",
      region: "cn-beijing",
      templateCode: "template",
      templateRevision: "ready-v1",
      aliyunUid: "123456",
      enabled: true,
    };
    const service = createSandboxService({
      repository: {
        ...base,
        connection: async () => ({
          connection,
          keyVersion: 1,
          credentialFingerprint: "fixture-A",
        }),
      },
      store,
      provider: async () => ({
        verifyTemplate: async () => {},
        create: async () => {
          creations++;
          return {
            id: "owned",
            writeFile: async () => {},
            execute: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
            readOutput: async () =>
              Buffer.from(
                "<html><head><title>合成报告</title></head><body>合成数据</body></html>",
              ),
            release: async () => {
              releases++;
            },
          };
        },
        connect: async () => {
          throw Error("not needed");
        },
      }),
    });
    const request = {
      title: "合成报告",
      language: "python",
      code: 'print("synthetic")',
      inputs: [],
      outputs: [{ path: "report.html", format: "html", title: "合成报告" }],
    };
    const queued = await repo.createQueuedRun({
      ownerUserId: user.id,
      ownerUsername: user.username,
      aiSessionId: session.sessionId,
      submissionKey: randomUUID(),
      title: "请生成HTML文件",
      workflowId: "sandbox-task-v1",
      workflowVersion: "1.0.0",
      executionConfig: attachWorkbenchConversationFact({
        content: "请生成HTML文件",
      }).executionConfig,
    });
    const id = queued.run.harnessRunId;
    async function phase() {
      let turns = 0;
      let issue: unknown;
      const runtime = startHarnessRuntime({
        repo,
        enabled: true,
        resolveApiKey: () => ({ apiKey: "fixture-only" }),
        resolveScenario: async () => ({
          model: "fixture",
          baseUrl: "https://fixture.invalid",
          credentialScope: "none",
          timeoutMs: 5000,
          modelSource: "env_default",
        }),
        createToolRegistry: () => {
          const r = new ToolRegistry();
          r.register(buildSandboxTool({ service }));
          return r;
        },
        getProvider: () =>
          ({
            name: "kimi",
            defaultModel: "fixture",
            isAvailable: () => true,
            chatCompletion: async () => {
              throw Error("not used");
            },
            streamChatCompletion: async function* () {
              turns++;
              if (turns === 1)
                yield {
                  contentDelta: "",
                  model: "fixture",
                  finishReason: "tool_calls",
                  toolCalls: [
                    {
                      id: "sandbox-call",
                      name: "sandbox_execute",
                      arguments: request,
                    },
                  ],
                };
              else
                yield {
                  contentDelta: "文件已生成。",
                  model: "fixture",
                  finishReason: "stop",
                };
            },
          }) as any,
        createModelChat: () => async () => ({
          answer: "分类不参与本测试",
          rawContent: "分类不参与本测试",
        }),
        toolCallProgressIntervalMs: 0,
        createWorker: ({ registry }) => ({
          start: async () => {
            try {
              const w = createHarnessRuntimeWorker({
                repository: repo,
                registry,
                workerId: "sandbox-phase-" + randomUUID(),
                timing: {
                  concurrency: 1,
                  leaseMs: 30000,
                  heartbeatIntervalMs: 5000,
                  claimPollIntervalMs: 10,
                },
              });
              await w.runNextAttempt();
            } catch (e) {
              issue = e;
            }
          },
          stop: async () => {},
          runNextAttempt: async () => false,
          isStopping: () => false,
        }),
      });
      await runtime.stop();
      if (issue) throw issue;
    }
    try {
      await phase();
      let snap = await repo.getRunSnapshot(id);
      assert.equal(
        snap!.run.status,
        "waiting",
        JSON.stringify(
          (
            await db
              .select()
              .from(harnessRunEvents)
              .where(eq(harnessRunEvents.harnessRunId, id))
          )
            .filter((e) => e.eventType === "tool.call.failed")
            .map((e) => (e.payload as any).error),
        ),
      );
      assert.equal(creations, 0);
      const events = await db
        .select()
        .from(harnessRunEvents)
        .where(eq(harnessRunEvents.harnessRunId, id))
        .orderBy(asc(harnessRunEvents.sequence));
      const pending = events.find(
        (e) => e.eventType === "tool.call.awaiting_approval",
      )!;
      assert.ok(pending);
      await repo.confirmRunAction({
        runId: id,
        actionId: (pending.payload as any).actionId,
        confirmedBy: user.id,
      });
      await phase();
      snap = await repo.getRunSnapshot(id);
      assert.equal(snap!.run.status, "completed");
      assert.equal(
        creations,
        1,
        JSON.stringify(
          (
            await db
              .select()
              .from(harnessRunEvents)
              .where(eq(harnessRunEvents.harnessRunId, id))
          )
            .filter((e) => e.eventType === "tool.call.failed")
            .map((e) => (e.payload as any).error),
        ),
      );
      assert.equal(releases, 1);
      const files = await db
        .select()
        .from(harnessSandboxArtifacts)
        .where(eq(harnessSandboxArtifacts.runId, id));
      assert.equal(files.length, 1);
      assert.match((await store.read(files[0].id)).toString(), /合成数据/);
      const completed = await db
        .select()
        .from(harnessRunEvents)
        .where(eq(harnessRunEvents.harnessRunId, id));
      assert.equal(
        completed.filter(
          (e) =>
            e.eventType === "tool.call.completed" &&
            (e.payload as any).artifacts?.length === 1,
        ).length,
        1,
      );
    } finally {
      await db.delete(harnessRuns).where(eq(harnessRuns.harnessRunId, id));
      await db
        .delete(aiSessions)
        .where(eq(aiSessions.sessionId, session.sessionId));
      await cleanupOneTestUser(user.username);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
