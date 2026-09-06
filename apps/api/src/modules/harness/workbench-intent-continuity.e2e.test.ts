// ============================================================
// 批次 1c · 缺陷二过线判据的端到端实取
// ============================================================
// 「进行中的工具交互不得被意图路由劫走」这件事，单测只能证明纯函数会短路，
// 证不了两件真正要害的事：
//  a) 判据读的那个字段（assistant 消息的 metadata.toolCalls）**真的由异步
//     Run 通道写进库里**——否则整条判据读的是一个永空的键，等价于永不生效；
//  b) 短路的终点确实是模型 + 工具路径，而不是某个静态 handler。
// 因此本文件不 mock workflow / dispatch，只用 fake provider 替掉模型本身，
// 会话消息、Run 行、事件行全部真实落库，判据从**读回的库**里取。
//
// 复刻的是真实会话 830bdb17 的两轮原话：
//   轮一「帮我创建一个新的项目，项目名：…」→ 工具 → 审批 → 执行 → 作答
//   轮二「客户名称：深圳蓝海集团； 客户行业：综合集团；」→ 此前被
//        industry_knowledge_terms 劫走，模型从未收到这句回答。
// 外加一条反向对照：轮一没有工具调用时，轮二的路由必须**逐字不变**
// （本批只加「进行中则让位」这一条，不退役任何正则 handler）。

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq, sql } from "drizzle-orm";

import { aiSessions, harnessRunAttempts, harnessRunEvents, harnessRuns, versionRecords } from "../../db/schema";
import { createHarnessRuntimeRepository, type HarnessRuntimeRepository } from "./harness-runtime.repository";
import { createHarnessRuntimeWorker, type HarnessWorkflowRegistry } from "./harness-runtime.worker";
import { startHarnessRuntime } from "./harness-boot";
import { createAiSession, getAiSession } from "../ai-sessions/ai-sessions.usecase";
import type { AiMessage } from "../ai-sessions/ai-sessions.types";
import { cleanupTestUsers, createTestUser } from "../../test-helpers/test-users";
import type { AuthUser } from "../../types";
import { routeWorkbenchIntent, hasOngoingWorkbenchToolInteraction } from "../../services/ai/workbench-intent.service";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** 真实会话里的两句原话，逐字抄录 */
const TURN_CREATE = "帮我创建一个新的项目，项目名：";
const TURN_ANSWER = "客户名称：深圳蓝海集团； 客户行业：综合集团；";

let pool: Pool | null = null;
let q: ReturnType<typeof drizzle> | null = null;
let repo: HarnessRuntimeRepository | null = null;
let alice: AuthUser | null = null;
const createdRunIds: string[] = [];
const createdSessionIds: string[] = [];
const createdProjectNames: string[] = [];

function name(tag: string): string {
  const value = `批次1c${tag}${randomUUID().slice(0, 8)}`;
  createdProjectNames.push(value);
  return value;
}

before(async () => {
  if (!TEST_DATABASE_URL) return;
  pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
  q = drizzle(pool);
  repo = createHarnessRuntimeRepository(q);
  alice = await createTestUser("wes-b1c-kevin", { role: "admin" });
});

after(async () => {
  if (!q) return;
  for (const projectName of createdProjectNames.splice(0)) {
    await q
      .delete(versionRecords)
      .where(sql`${versionRecords.ownerUserId} = ${alice!.id} AND ${versionRecords.payload}->>'projectName' = ${projectName}`)
      .catch(() => undefined);
  }
  for (const sessionId of createdSessionIds.splice(0)) {
    await q.delete(aiSessions).where(eq(aiSessions.sessionId, sessionId)).catch(() => undefined);
  }
  for (const runId of createdRunIds.splice(0)) {
    await q.delete(harnessRunEvents).where(eq(harnessRunEvents.harnessRunId, runId)).catch(() => undefined);
    await q.delete(harnessRunAttempts).where(eq(harnessRunAttempts.harnessRunId, runId)).catch(() => undefined);
    await q.delete(harnessRuns).where(eq(harnessRuns.harnessRunId, runId)).catch(() => undefined);
  }
  await cleanupTestUsers("wes-b1c").catch(() => undefined);
  await pool!.end();
});

/** 读回真实落库的会话消息（判据与路由结果的唯一事实源） */
async function readAssistantMessages(sessionId: string): Promise<AiMessage[]> {
  const session = await getAiSession(alice!, sessionId);
  return (session?.messages ?? []).filter((message) => message.role === "assistant");
}

async function readEvents(runId: string): Promise<Array<{ sequence: number; eventType: string; payload: Record<string, unknown> }>> {
  const rows = await q!.select().from(harnessRunEvents).where(eq(harnessRunEvents.harnessRunId, runId)).orderBy(asc(harnessRunEvents.sequence));
  return rows.map((row) => ({ sequence: Number(row.sequence), eventType: String(row.eventType), payload: (row.payload ?? {}) as Record<string, unknown> }));
}

type PhaseResult = { runId: string; sessionId: string; modelTurns: number };

/**
 * 驱动一个阶段 = 一次 boot 装配 + 一个新 worker + 一条独立连接，阶段之间不共享
 * 任何 JS 对象，唯一交接物是库里的行——与批次 1a 的驱动口径同款。
 *
 * @param askForWriteTool 本轮模型是否发起写工具（false = 纯文本回答）
 * @param answerText      模型最后一段正文（用于认出「这句话到底是谁答的」）
 */
async function drivePhase(input: {
  /** 省略则新建 session + queued Run（首轮）；给出则在同一会话上排队新 Run */
  sessionId?: string;
  runId?: string;
  content: string;
  projectName: string;
  askForWriteTool?: boolean;
  answerText?: string;
  /** 续跑既有 Run（确认后原地重跑），不新建 */
  resume?: boolean;
}): Promise<PhaseResult> {
  const phasePool = new Pool({ connectionString: TEST_DATABASE_URL!, max: 6 });
  const phaseDb = drizzle(phasePool);
  const phaseRepo = createHarnessRuntimeRepository(phaseDb);
  let runId = input.runId ?? "";
  let sessionId = input.sessionId ?? "";

  try {
    if (!input.resume) {
      if (!sessionId) {
        const created = await createAiSession(alice!, { title: "批次1c意图连续性会话", workflowKey: "free_chat" });
        sessionId = created.sessionId;
        createdSessionIds.push(sessionId);
      }
      const queued = await phaseRepo.createQueuedRun({
        ownerUserId: alice!.id,
        ownerUsername: alice!.username,
        aiSessionId: sessionId,
        submissionKey: `b1c-${randomUUID()}`,
        title: input.content,
        workflowId: "workbench_chat_v1",
        workflowVersion: "1.0.0",
        executionConfig: { content: input.content },
      });
      runId = queued.run.harnessRunId;
      createdRunIds.push(runId);
    }

    let modelTurns = 0;
    const fakeProvider = {
      name: "kimi",
      defaultModel: "kimi-b1c",
      isAvailable: () => true,
      chatCompletion: async () => {
        throw new Error("chatCompletion_should_not_be_called");
      },
      streamChatCompletion: () => {
        modelTurns += 1;
        if (modelTurns === 1 && input.askForWriteTool !== false) {
          return (async function* () {
            yield {
              contentDelta: "",
              model: "kimi-b1c",
              finishReason: "tool_calls",
              toolCalls: [{ id: "call_create_1", name: "create_project", arguments: { projectName: input.projectName } }],
            };
          })();
        }
        return (async function* () {
          yield { contentDelta: input.answerText ?? "这是模型本轮的真实回答。", model: "kimi-b1c", finishReason: "stop" };
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
        model: "kimi-b1c",
        baseUrl: "https://b1c.invalid/v1",
        credentialScope: "requirement_kimi",
        timeoutMs: 5_000,
        modelSource: "env_default",
      }),
      // default_domain_qa 分支的二次意图分类桩：不返回 JSON ⇒ 恒不采纳，路由稳定。
      // 本批的短路用例连这个桩都不该碰到（routingRule 不是 default_domain_qa）。
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
              workerId: `b1c-${randomUUID().slice(0, 8)}`,
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
    assert.equal(bootError, null, `阶段驱动不得抛错：${bootError instanceof Error ? bootError.message : String(bootError)}`);
    assert.ok(modelTurns >= 1, "provider 必须真的被调用（否则「走了模型路径」只是没装配起来）");
    return { runId, sessionId, modelTurns };
  } finally {
    await phasePool.end();
  }
}

/** 从落库的 assistant 消息里取本轮路由结果（intent 在 metadata 顶层、routingRule 嵌在 trace 下） */
function routingOf(message: AiMessage | undefined): { intent?: string; routingRule?: string } {
  const metadata = message?.metadata as { intent?: unknown; trace?: { routingRule?: unknown } } | undefined;
  return {
    intent: typeof metadata?.intent === "string" ? metadata.intent : undefined,
    routingRule: typeof metadata?.trace?.routingRule === "string" ? metadata.trace.routingRule : undefined,
  };
}

test("判据④ 端到端：说创建项目 → 工具 → waiting → 确认后作答 → 用户补充信息必须进模型", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("连续");

  // ── 轮一前半：模型发起写工具，闸门把 Run 停在 waiting ──
  const first = await drivePhase({ content: `${TURN_CREATE}${projectName}`, projectName });
  assert.equal(String((await q!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, first.runId)))[0]?.status), "waiting");
  const awaiting = (await readEvents(first.runId)).filter((row) => row.eventType === "tool.call.awaiting_approval");
  assert.equal(awaiting.length, 1, "写工具必须问用户一次");

  // 此刻会话里**还没有** assistant 消息：挂起轮不落库。这条事实顺带说明为什么
  // 「最近一轮 run 处于 waiting」不能当判据——用户这句补充压根进不了 dispatch
  // （同一会话只允许一个活跃 Run，waiting 即活跃，新消息一律 409）。
  assert.equal((await readAssistantMessages(first.sessionId)).length, 0, "挂起期间不得回填 assistant 消息");

  // ── 轮一后半：用户确认 → 工具执行 → 模型把话说完并落库 ──
  const actionId = String(awaiting[0]!.payload.actionId);
  await repo!.confirmRunAction({ runId: first.runId, actionId, confirmedBy: alice!.id });
  await drivePhase({ runId: first.runId, sessionId: first.sessionId, content: `${TURN_CREATE}${projectName}`, projectName, resume: true });

  const afterFirstTurn = await readAssistantMessages(first.sessionId);
  assert.equal(afterFirstTurn.length, 1, "轮一恰好落一条 assistant 消息");
  const toolCallsFirst = (afterFirstTurn[0]!.metadata as { toolCalls?: unknown }).toolCalls;
  assert.ok(
    Array.isArray(toolCallsFirst) && toolCallsFirst.length === 1,
    `判据读的那个字段必须真的被写进库，实取 ${JSON.stringify(toolCallsFirst)}`,
  );
  assert.equal(
    (toolCallsFirst as Array<{ name: string }>)[0]!.name,
    "create_project",
    "工具痕迹里记的必须是那次写调用",
  );
  // a) 成立：判据读的就是这份持久事实
  assert.equal(hasOngoingWorkbenchToolInteraction((await getAiSession(alice!, first.sessionId))!.messages), true);

  // ── 轮二：用户对被劫走的那句补充信息 ──
  const second = await drivePhase({ sessionId: first.sessionId, content: TURN_ANSWER, projectName, askForWriteTool: false, answerText: "已把客户信息补进这个项目。" });
  const afterSecondTurn = await readAssistantMessages(first.sessionId);
  assert.equal(afterSecondTurn.length, 2, "轮二也要落一条 assistant 消息");
  const routedSecond = routingOf(afterSecondTurn[1]);
  // b) 成立：终点是模型路径，且**没有**走 RP-003 的二次分类
  assert.equal(routedSecond.routingRule, "ongoing_tool_interaction", `实取 ${JSON.stringify(routedSecond)}`);
  assert.equal(routedSecond.intent, "domain_qa");
  assert.equal(afterSecondTurn[1]!.content, "已把客户信息补进这个项目。", "答案必须出自模型本轮的真实输出，而不是知识库正则 handler 的文案");
  assert.equal(second.modelTurns >= 1, true);

  // 反向核验：劫走它的那条正则今天仍然在位（本批没退役任何 handler），
  // 只是在这一轮被让位规则挡在了后面。
  const rawRule = routeWorkbenchIntent({ message: TURN_ANSWER, hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(rawRule.routingRule, "industry_knowledge_terms", `正则规则必须原样还在，实取 ${JSON.stringify(rawRule)}`);

  // 窗口只有一轮：轮二没有工具调用，判据必须回落到 false，
  // 否则等价于把这个会话的正则路由永久关掉（那是批次 4 的范围）。
  assert.equal(hasOngoingWorkbenchToolInteraction((await getAiSession(alice!, first.sessionId))!.messages), false, "无工具痕迹的一轮之后不得继续短路");

  console.log(
    `[B1C·判据④] runA=${first.runId.slice(0, 8)} ${(await readEvents(first.runId)).map((row) => `seq${row.sequence}:${row.eventType}`).join(" → ")}\n` +
      `[B1C·判据④] runB=${second.runId.slice(0, 8)} 轮一落库=${JSON.stringify(routingOf(afterFirstTurn[0]))} 轮二落库=${JSON.stringify(routingOf(afterSecondTurn[1]))}\n` +
      `[B1C·判据④] 轮二答案（模型真实输出）=${afterSecondTurn[1]!.content}\n` +
      `[B1C·判据④] 正则规则仍在位（未退役）=${JSON.stringify(rawRule)}`,
  );
});

test("反向对照：轮一没有工具调用时，同一句补充信息的路由逐字不变", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("对照");
  // 轮一：纯文本回答（模型没发起任何工具）
  const plain = await drivePhase({ content: `这个项目大概要多少人天，${projectName}`, projectName, askForWriteTool: false, answerText: "要看范围，先给你一个大区间。" });
  const assistant = await readAssistantMessages(plain.sessionId);
  assert.equal(assistant.length, 1);
  assert.equal((assistant[0]!.metadata as { toolCalls?: unknown } | undefined)?.toolCalls, undefined, "没有工具调用就不该有工具痕迹");
  assert.equal(hasOngoingWorkbenchToolInteraction((await getAiSession(alice!, plain.sessionId))!.messages), false);

  // 本轮落库的路由结果也必须仍是原来的兜底口径（本批对不存在的进行中状态零改动）
  assert.equal(routingOf(assistant[0]).routingRule, "default_domain_qa", `实取 ${JSON.stringify(routingOf(assistant[0]))}`);

  // 于是轮二这句「行业」追问照旧命中行业知识规则——零回归的持久化侧证据
  const second = routeWorkbenchIntent({
    message: TURN_ANSWER,
    hasAttachment: false,
    hasLatestV1Artifact: false,
    hasOngoingToolInteraction: hasOngoingWorkbenchToolInteraction((await getAiSession(alice!, plain.sessionId))!.messages),
  });
  assert.deepEqual(second, { intent: "knowledge_query", confidence: 0.82, routingRule: "industry_knowledge_terms" });
});
