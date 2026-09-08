// ============================================================
// 批次 2b-1 · 对话正文事件 —— 过线判据①端到端实取（两轮真实对话）
// ============================================================
// 判据①要求：走一条真实对话（含至少两轮）→ 每轮各有一条 user/message 与一条
// assistant/message，且载荷正文与 ai_sessions.messages 里对应消息**逐字节相同**。
//
// 刻意不 mock 的部分（mock 了就等于验自己）：
//  · 提交口用真实 usecase `createAiRunsUsecase.submitRun`（HTTP POST /runs 的同一落库口），
//    所以 user/message 是在**真入队事务**里落的，不是测试替身补的；
//  · 会话读写用真实 ai-sessions（createAiSession / appendAiSessionMessageIdempotent）；
//  · 执行用真实 boot 装配 + 真实 worker + 真实 repository（真库 postgres）。
// 只替换最外层的模型 provider（fake 流式），否则判据依赖外部模型服务、不可重跑。
//
// 判据④（text.delta 条数与内容零变化）在本文件顺带实取：delta 拼接与条数都打印，
// 收工时与基线 commit 上跑同一用例的输出逐字比对。

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq } from "drizzle-orm";

import { aiSessions, harnessRunEvents, harnessRuns } from "../../db/schema";
import { createHarnessRuntimeRepository, type HarnessRuntimeRepository } from "./harness-runtime.repository";
import { createHarnessRuntimeWorker, type HarnessWorkflowRegistry } from "./harness-runtime.worker";
import { startHarnessRuntime } from "./harness-boot";
import { createAiRunsUsecase } from "./harness-runtime.usecase";
import { createAiSession, getAiSession } from "../ai-sessions/ai-sessions.usecase";
import { cleanupTestUsers, createTestUser } from "../../test-helpers/test-users";
import type { AuthUser } from "../../types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

type EventRow = { sequence: number; eventType: string; payload: Record<string, unknown> };
type SessionMessage = {
  role: string;
  content: string;
  metadata?: { projectionSource?: { deduplicationKey?: string } };
};

let pool: Pool | null = null;
let q: ReturnType<typeof drizzle> | null = null;
let repo: HarnessRuntimeRepository | null = null;
let alice: AuthUser | null = null;
const createdRunIds: string[] = [];
const createdSessionIds: string[] = [];

before(async () => {
  if (!TEST_DATABASE_URL) return;
  pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
  q = drizzle(pool);
  repo = createHarnessRuntimeRepository(q);
  alice = await createTestUser("wes-b2b1-alice", { role: "admin" });
});

after(async () => {
  if (!q) return;
  for (const runId of createdRunIds.splice(0)) {
    await q.delete(harnessRunEvents).where(eq(harnessRunEvents.harnessRunId, runId)).catch(() => undefined);
  }
  for (const runId of createdRunIds.splice(0)) {
    await q.delete(harnessRuns).where(eq(harnessRuns.harnessRunId, runId)).catch(() => undefined);
  }
  // 会话一并清掉：本用例写进测试库的每一行都是夹具
  for (const sessionId of createdSessionIds.splice(0)) {
    await q.delete(aiSessions).where(eq(aiSessions.sessionId, sessionId)).catch(() => undefined);
  }
  await cleanupTestUsers("wes-b2b1").catch(() => undefined);
  await pool!.end();
});

async function readEvents(runId: string): Promise<EventRow[]> {
  const rows = await q!
    .select()
    .from(harnessRunEvents)
    .where(eq(harnessRunEvents.harnessRunId, runId))
    .orderBy(asc(harnessRunEvents.sequence));
  return rows.map((row) => ({
    sequence: Number(row.sequence),
    eventType: String(row.eventType),
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));
}

async function readSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  const rows = await q!.select().from(aiSessions).where(eq(aiSessions.sessionId, sessionId));
  const messages = (rows[0]?.messages ?? []) as unknown as SessionMessage[];
  return Array.isArray(messages) ? messages : [];
}

function eventsOfType(rows: EventRow[], eventType: string): EventRow[] {
  return rows.filter((row) => row.eventType === eventType);
}

/** 按来源键取会话里属于本次 Run 的那条消息——不靠数组下标，避免把顺序当成前提。 */
function sessionMessageByKey(messages: SessionMessage[], deduplicationKey: string): SessionMessage | undefined {
  return messages.find(
    (message) => message.metadata?.projectionSource?.deduplicationKey === deduplicationKey,
  );
}

/**
 * 驱动一轮真实对话：真 usecase 提交（= 真入队事务）→ 真 boot + 真 worker → 真库。
 * provider 只负责按给定分片流式作答。
 */
async function driveTurn(input: {
  sessionId: string;
  content: string;
  deltas: string[];
}): Promise<{ runId: string; answer: string }> {
  const phasePool = new Pool({ connectionString: TEST_DATABASE_URL!, max: 6 });
  const phaseDb = drizzle(phasePool);
  const phaseRepo = createHarnessRuntimeRepository(phaseDb);
  const answer = input.deltas.join("");

  try {
    const usecase = createAiRunsUsecase({
      repo: phaseRepo,
      enabled: true,
      findSession: (user: AuthUser, sessionId: string) => getAiSession(user, sessionId),
    });
    const submitted = await usecase.submitRun(alice!, input.sessionId, {
      submissionKey: `b2b1-${randomUUID()}`,
      content: input.content,
    });
    assert.equal(submitted.status, 202, "提交必须经真实 usecase 成功");
    const runId = submitted.data.runId;
    createdRunIds.push(runId);

    let modelTurns = 0;
    const fakeProvider = {
      name: "kimi",
      defaultModel: "kimi-b2b1",
      isAvailable: () => true,
      chatCompletion: async () => {
        throw new Error("chatCompletion_should_not_be_called");
      },
      streamChatCompletion: () => {
        modelTurns += 1;
        return (async function* () {
          for (const delta of input.deltas) {
            yield { contentDelta: delta, model: "kimi-b2b1", finishReason: "stop" };
          }
        })();
      },
    };

    let bootError: unknown = null;
    const runtime = startHarnessRuntime({
      repo: phaseRepo,
      enabled: true,
      resolveApiKey: () => ({ apiKey: "placeholder" }),
      getProvider: () => fakeProvider as never,
      resolveScenario: async () => ({
        model: "kimi-b2b1",
        baseUrl: "https://b2b1.invalid/v1",
        credentialScope: "requirement_kimi",
        timeoutMs: 5_000,
        modelSource: "env_default",
      }),
      createModelChat: () => async () => ({
        answer: "本用例不参与模型二次分类",
        rawContent: "本用例不参与模型二次分类",
        provider: "stub",
        model: "stub",
        attempts: 1,
        finishReason: "stop",
      }),
      toolCallProgressIntervalMs: 0,
      createWorker: ({ registry }) => ({
        start: async () => {
          try {
            const worker = createHarnessRuntimeWorker({
              repository: phaseRepo,
              registry: registry as HarnessWorkflowRegistry,
              workerId: `b2b1-${randomUUID().slice(0, 8)}`,
              timing: { claimPollIntervalMs: 10, leaseMs: 5_000, heartbeatIntervalMs: 2_000, concurrency: 1 },
            });
            for (let i = 0; i < 10; i += 1) {
              if (!(await worker.runNextAttempt())) break;
            }
          } catch (err) {
            bootError = err;
          }
        },
        stop: async () => {},
        runNextAttempt: async () => false,
        isStopping: () => false,
      }),
    });
    await runtime.stop();
    assert.equal(bootError, null, `驱动一轮真实对话不得抛错：${bootError instanceof Error ? bootError.message : String(bootError)}`);
    assert.ok(modelTurns >= 1, "provider 必须真的被调用（否则这一轮是空跑）");
    return { runId, answer };
  } finally {
    await phasePool.end();
  }
}

const TURN_1_CONTENT = `第一轮：请评估 ERP 项目工作量${"，含多组织协同".repeat(12)}\n补充：客户是制造业 ✅`;
const TURN_1_DELTAS = ["第一轮答复：", "建议按 ", "3 个模块估算", "。\n含换行与 emoji ✅"];
const TURN_2_CONTENT = "第二轮：那供应链云呢？（全角括号）";
const TURN_2_DELTAS = ["第二轮答复：", "供应链云建议单独排期。"];

function answerOf(deltas: string[]): string {
  return deltas.join("");
}

/** 字节数 + SHA-256 前 12 位：够判「同一份正文」，又不会把正文本身打进日志。 */
function digestOf(value: unknown): string {
  const text = String(value ?? "");
  const bytes = Buffer.byteLength(text, "utf-8");
  return `${bytes}B/${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)}`;
}

test(
  "批次2b-1 判据①：真实两轮对话后，每轮各一条 user/message 与 assistant/message，正文与会话消息逐字节相同",
  { skip: !TEST_DATABASE_URL },
  async () => {
    const session = await createAiSession(alice!, { title: "批次2b1对话事件会话", workflowKey: "free_chat" });
    createdSessionIds.push(session.sessionId);

    const turn1 = await driveTurn({ sessionId: session.sessionId, content: TURN_1_CONTENT, deltas: TURN_1_DELTAS });
    const turn2 = await driveTurn({ sessionId: session.sessionId, content: TURN_2_CONTENT, deltas: TURN_2_DELTAS });

    const messages = await readSessionMessages(session.sessionId);
    const turns = [
      { ...turn1, label: "第 1 轮", deltas: TURN_1_DELTAS, content: TURN_1_CONTENT },
      { ...turn2, label: "第 2 轮", deltas: TURN_2_DELTAS, content: TURN_2_CONTENT },
    ];

    for (const turn of turns) {
      const rows = await readEvents(turn.runId);
      console.log(`[B2b1·${turn.label}] ${rows.map((row) => `seq${row.sequence}:${row.eventType}`).join(" → ")}`);
      console.log(
        `[B2b1·${turn.label}] text.delta × ${eventsOfType(rows, "text.delta").length} = ${JSON.stringify(
          eventsOfType(rows, "text.delta").map((row) => row.payload.delta),
        )}`,
      );

      const userEvents = eventsOfType(rows, "user/message");
      const assistantEvents = eventsOfType(rows, "assistant/message");
      assert.equal(userEvents.length, 1, `${turn.label}：user/message 必须恰好一条，实取 ${userEvents.length}`);
      assert.equal(assistantEvents.length, 1, `${turn.label}：assistant/message 必须恰好一条，实取 ${assistantEvents.length}`);

      // 用户正文在入队事务里，紧随 run_queued——不是等 worker 跑完才补的
      assert.equal(rows[0].eventType, "run_queued");
      assert.equal(rows[1].eventType, "user/message", "user/message 必须是 run 的第 2 条事件（入队即写）");

      const sessionUser = sessionMessageByKey(messages, `${turn.runId}:user:1`);
      const sessionAssistant = sessionMessageByKey(messages, `${turn.runId}:assistant:1`);
      assert.ok(sessionUser, `${turn.label}：会话里应有本轮 user 消息`);
      assert.ok(sessionAssistant, `${turn.label}：会话里应有本轮 assistant 消息`);

      // 逐字节：两侧都必须是 string，且严格相等（不用 trim/normalize 放宽）
      assert.equal(typeof userEvents[0].payload.content, "string", "载荷 content 必须是字符串");
      assert.equal(userEvents[0].payload.content, sessionUser!.content, `${turn.label}：用户正文逐字节相同`);
      assert.equal(Buffer.byteLength(String(userEvents[0].payload.content), "utf-8"), Buffer.byteLength(sessionUser!.content, "utf-8"), `${turn.label}：UTF-8 字节长度相同`);
      assert.equal(assistantEvents[0].payload.content, sessionAssistant!.content, `${turn.label}：助手正文逐字节相同`);

      // 完整性自检：正文没被截成标题（长度对齐提交原文）、也没被拆成碎片
      assert.equal(userEvents[0].payload.content, turn.content, `${turn.label}：事件正文即提交原文`);
      assert.equal(assistantEvents[0].payload.content, answerOf(turn.deltas), `${turn.label}：事件正文是完整答复而非碎片`);
      // 判据④的构成部分：delta 一条不多一条不少，内容原样
      assert.deepEqual(
        eventsOfType(rows, "text.delta").map((row) => row.payload.delta),
        turn.deltas,
        `${turn.label}：text.delta 条数与内容必须与模型实发分片逐字相同（本批不得改动传输面）`,
      );

      // 成对打印字节数 + SHA-256 前 12 位：不连库也能复核「事件载荷 ≡ 会话正文」。
      console.log(
        `[B2b1·${turn.label}] 逐字节 user 事件[${digestOf(userEvents[0].payload.content)}] 会话[${digestOf(sessionUser!.content)}] ` +
          `· assistant 事件[${digestOf(assistantEvents[0].payload.content)}] 会话[${digestOf(sessionAssistant!.content)}]`,
      );
    }

    // 两轮之间不得串台：各自的正文只出现在各自的事件里
    const rows1 = await readEvents(turn1.runId);
    const rows2 = await readEvents(turn2.runId);
    assert.equal(eventsOfType(rows1, "user/message")[0].payload.content, TURN_1_CONTENT);
    assert.equal(eventsOfType(rows2, "user/message")[0].payload.content, TURN_2_CONTENT);
    assert.notEqual(eventsOfType(rows1, "assistant/message")[0].payload.content, eventsOfType(rows2, "assistant/message")[0].payload.content);
  },
);

test(
  "批次2b-1 判据①附带：title 与用户正文是两回事，正文取自提交入参",
  { skip: !TEST_DATABASE_URL },
  async () => {
    // 会话里发一条明显长过 80 字的消息：title 只能截到 80 字，
    // 而 user/message 必须承载完整正文——这条就是「不再依赖 title 那个巧合」的实证。
    const long = `${"这段正文远长于八十四个字，用来证明事件载荷不是从标题里抄的。".repeat(4)}`;
    const session = await createAiSession(alice!, { title: "批次2b1超长正文会话", workflowKey: "free_chat" });
    createdSessionIds.push(session.sessionId);
    const { runId } = await driveTurn({ sessionId: session.sessionId, content: long, deltas: ["长正文答复。"] });

    const rows = await readEvents(runId);
    const userEvent = eventsOfType(rows, "user/message")[0];
    assert.equal(userEvent.payload.content, long, "完整正文入事件流，不受 title 80 字上限影响");
    assert.ok(String(userEvent.payload.content).length > 80, `实取长度 ${String(userEvent.payload.content).length}`);
  },
);
