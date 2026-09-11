// ============================================================
// 批次 2b-2 · 对话正文事件 —— 过线判据①端到端实取（两轮真实对话）
// ============================================================
// 判据①要求：走一条真实对话（含至少两轮）→ 每轮各有一条 user/message 与一条
// assistant/message，且载荷与 ai_sessions.messages 里对应消息**逐字节相同**。
//
// 口径在 2b-2 收紧了一档：2b-1 只比 `payload.content ≡ message.content`，而载荷
// 当时**只有** content 一个字段。开发库实取（48 条存量消息）：messageId 48 条、
// createdAt 48 条、metadata 44 条、attachmentIds 27 条——这些 2b-3 换读取源后
// 无处可取。所以本文件现在比的是**整条消息**，逐字段打印 + JSON.stringify 全等，
// **不排除任何键**（projectionSource 也在内：它是「恰好一次落库」的幂等防线，
// 一份即将成为事实源的记录必须自带）。
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
/** 整条消息（原样取自 jsonb），比对要求看到所有字段，故不预先收窄形状。 */
type SessionMessage = Record<string, unknown> & {
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
  /** 批次 2b-2：附件轮次用于验 attachmentIds 也在信封里逐字节对齐。 */
  attachments?: Array<{ name: string; size?: number; type?: string; parsedSummary?: string }>;
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
      ...(input.attachments ? { attachments: input.attachments } : {}),
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

/**
 * 判据①（2b-2 口径）：事件载荷 ≡ 会话里那条消息，**逐字段 + 整对象逐字节**。
 *
 * 为什么两层都要：
 *  · 只比整对象 JSON，红的时候看不出差在哪个字段，回填证据无从下手；
 *  · 只逐字段比，会漏掉「两侧字段集合本身不同」——所以先比键集合，再比序列化全文。
 * 刻意**不列排除键**：projectionSource 也要比（架构侧 2026-09-11 裁决——一份即将
 * 成为事实源的记录必须自带全部字段；开了「除某键之外」的口子，三批之后没人记得
 * 这把尺子还量不量得准）。
 */
function assertEnvelopeIdentical(
  label: string,
  payload: Record<string, unknown>,
  stored: Record<string, unknown>,
): void {
  const payloadKeys = Object.keys(payload).sort();
  const storedKeys = Object.keys(stored).sort();
  console.log(`[B2b2·${label}] 事件字段 ${JSON.stringify(payloadKeys)} · 会话字段 ${JSON.stringify(storedKeys)}`);
  for (const key of storedKeys) {
    console.log(
      `[B2b2·${label}]   ${key}: 事件[${digestOf(JSON.stringify(payload[key] ?? null))}] ` +
        `会话[${digestOf(JSON.stringify(stored[key] ?? null))}]`,
    );
  }
  assert.deepEqual(payloadKeys, storedKeys, `${label}：两侧字段集合必须相同（少一个字段=2b-3 重建时该字段无处可取）`);
  assert.equal(
    JSON.stringify(payload),
    JSON.stringify(stored),
    `${label}：事件载荷必须与会话那条消息逐字节相同（逐字段摘要见上，差异不得以「字段无关紧要」放过）`,
  );
}

test(
  "批次2b-2 判据①：真实两轮对话后，每轮各一条 user/message 与 assistant/message，整条消息与会话侧逐字段相同",
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

      // 逐字节：整条消息，逐字段 + JSON.stringify 全等（2b-2 口径，不排除任何键）
      assert.equal(typeof userEvents[0].payload.content, "string", "载荷 content 必须是字符串");
      assertEnvelopeIdentical(`${turn.label} user`, userEvents[0].payload, sessionUser!);
      assertEnvelopeIdentical(`${turn.label} assistant`, assistantEvents[0].payload, sessionAssistant!);

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

test(
  "批次2b-2 判据①附带：带附件的真实轮次，attachmentIds 与附件身份逐字节对齐",
  { skip: !TEST_DATABASE_URL },
  async () => {
    // 开发库存量 48 条消息里 27 条带 attachmentIds——2b-3 换源后若载荷不带它，
    // 附件解析上下文（模型历史里那段【附件解析上下文】）会整块丢失。
    // 本用例走真实提交（附件随 submission 进 executionConfig）+ 真实执行。
    const session = await createAiSession(alice!, { title: "批次2b2附件轮次会话", workflowKey: "free_chat" });
    createdSessionIds.push(session.sessionId);
    const content = "这份需求文件里的多组织协同怎么落地？";
    const { runId } = await driveTurn({
      sessionId: session.sessionId,
      content,
      deltas: ["按组织维度拆分范围后单独排期。"],
      attachments: [{
        name: "客户需求.xlsx",
        size: 4096,
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        parsedSummary: "项目：蓝海制造\n需求：多组织业务协同",
      }],
    });

    const rows = await readEvents(runId);
    const messages = await readSessionMessages(session.sessionId);
    const userEvent = eventsOfType(rows, "user/message")[0];
    const sessionUser = sessionMessageByKey(messages, `${runId}:user:1`);
    assert.ok(userEvent, "带附件的轮次同样必须有 user/message");
    assert.ok(sessionUser, "带附件的轮次同样必须有会话用户消息");
    assertEnvelopeIdentical("附件轮 user", userEvent.payload, sessionUser!);

    const attachmentIds = userEvent.payload.attachmentIds as string[];
    assert.equal(attachmentIds.length, 1, "实取：本轮应引用 1 个附件");
    assert.ok(attachmentIds[0].startsWith("att-"), "附件身份仍是 att- 前缀（未改口径，只是改由提交侧 mint）");
    // 附件实体必须真的落在会话 attachments 上，且 id 与消息引用一致——否则 2b-3 之后
    // 「消息说有附件、附件表里没有」就是悬挂引用（parity 脚本正是按这个特征计数的）。
    const sessionRow = await q!.select().from(aiSessions).where(eq(aiSessions.sessionId, session.sessionId));
    const storedAttachments = (sessionRow[0]?.attachments ?? []) as Array<{ attachmentId: string; name: string }>;
    assert.deepEqual(
      storedAttachments.filter((item) => attachmentIds.includes(item.attachmentId)).map((item) => item.name),
      ["客户需求.xlsx"],
      "attachmentIds 指向的附件实体必须真实存在（会话侧引用完整性）",
    );
  },
);
