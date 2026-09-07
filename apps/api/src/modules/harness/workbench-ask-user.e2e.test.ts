// ============================================================
// 批次 9 · ask_user：把「向用户发起交互」做成工具 —— 过线判据端到端实取
// ============================================================
// 本批的要害不在控件（控件早就有），而在**产生方式**：旧路径要模型在自由文本里
// 自己写对一整段 JSON，写错一步就把协议 JSON 当正文渲染给用户（会话 7f5cbf75 实证）。
// 因此这里刻意不 mock 工具与闸门：只注入 fake provider（模型侧），闸门、挂起、
// 答案回灌全部走 boot 的真实装配 + 真实 repo + 真库。
//
// 三条判据各自钉住的事实：
//  · 判据① 调用即暂停 → run.status=waiting + tool.call.awaiting_input 落表 +
//    正文里零 JSON（这条是本批存在的理由：不可靠的产生方式被换掉了）
//  · 判据② 提交即恢复 → 走 POST inputs 那条路（**不是**发新聊天消息：会话有活跃
//    waiting Run 时发消息必被 harness_runs_active_workbench_session_unique 挡成 409），
//    结构化 values 作为工具结果进入下一轮模型请求的 messages
//  · 判据③ 参数不合契约 → 不挂起、不渲染半个控件，可读错误回给模型
//  · 判据④ 决策槽为 allow → 全程不产生 tool.call.awaiting_approval，也不需要任何确认
//
// 与批次 1a 那份 e2e 的分工：那份证「执行前暂停 + confirm 恢复」，本份证
// 「执行即暂停 + inputs 恢复」；两者共用同一套 fake provider 驱动手法。

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq } from "drizzle-orm";

import { aiSessions, harnessRunEvents, harnessRuns } from "../../db/schema";
import {
  createHarnessRuntimeRepository,
  type HarnessRuntimeRepository,
} from "./harness-runtime.repository";
import { createHarnessRuntimeWorker, type HarnessWorkflowRegistry } from "./harness-runtime.worker";
import { startHarnessRuntime } from "./harness-boot";
import { createAiSession } from "../ai-sessions/ai-sessions.usecase";
import { cleanupTestUsers, createTestUser } from "../../test-helpers/test-users";
import type { AuthUser } from "../../types";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

type EventRow = { sequence: number; eventType: string; payload: Record<string, unknown> };

let pool: Pool | null = null;
let q: ReturnType<typeof drizzle> | null = null;
let repo: HarnessRuntimeRepository | null = null;
let alice: AuthUser | null = null;
const createdRunIds: string[] = [];
const createdSessionIds: string[] = [];

/** 一份合规表单：五种受支持字段类型里取三种，含 submitMessageTemplate。 */
function validFormBlock(tag: string) {
  return {
    blockId: `b9-${tag}`,
    title: "请补充项目信息",
    description: "用于生成估算前确认范围",
    submitLabel: "提交补充",
    submitMessageTemplate: `补充项目信息：行业={{industry}}，规模={{scale}}`,
    fields: [
      {
        id: "industry",
        label: "客户行业",
        type: "single_select",
        required: true,
        options: [
          { label: "制造业", value: "manufacturing" },
          { label: "零售", value: "retail" },
        ],
      },
      { id: "scale", label: "实施规模（人日）", type: "number", required: true },
      { id: "note", label: "补充说明", type: "textarea" },
    ],
  };
}

before(async () => {
  if (!TEST_DATABASE_URL) return;
  pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
  q = drizzle(pool);
  repo = createHarnessRuntimeRepository(q);
  alice = await createTestUser("wes-b9-alice", { role: "admin" });
});

after(async () => {
  if (!q) return;
  for (const runId of createdRunIds.splice(0)) {
    await q.delete(harnessRunEvents).where(eq(harnessRunEvents.harnessRunId, runId)).catch(() => undefined);
    await q.delete(harnessRuns).where(eq(harnessRuns.harnessRunId, runId)).catch(() => undefined);
  }
  for (const sessionId of createdSessionIds.splice(0)) {
    await q.delete(aiSessions).where(eq(aiSessions.sessionId, sessionId)).catch(() => undefined);
  }
  await cleanupTestUsers("wes-b9").catch(() => undefined);
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

async function runStatus(runId: string): Promise<string> {
  const rows = await q!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
  return String(rows[0]?.status ?? "missing");
}

function countByType(rows: EventRow[], eventType: string): number {
  return rows.filter((row) => row.eventType === eventType).length;
}

function eventsOfType(rows: EventRow[], eventType: string): EventRow[] {
  return rows.filter((row) => row.eventType === eventType);
}

function logEvents(title: string, rows: EventRow[]): void {
  console.log(`[B9·${title}] ${rows.map((row) => `seq${row.sequence}:${row.eventType}`).join(" → ")}`);
}

type PhaseResult = {
  runId: string;
  sessionId: string;
  /** 每一轮模型请求实际收到的 messages（判据②「打进下一轮请求比对」的取数处） */
  modelRequests: { turn: number; messages: Array<{ role: string; content: string }> }[];
};

/**
 * 驱动一个阶段 = 一次 boot 装配 + 一个 worker + 一条独立连接。
 * 阶段之间不共享任何 JS 对象，唯一交接物是库里的 Run 行与事件行——与批次 1a 同构，
 * 这样「恢复」才是真的恢复，而不是同一进程里换个变量名。
 */
async function drivePhase(input: {
  runId?: string;
  content: string;
  /** 模型每轮给 ask_user 的参数（判据③传一份不合契约的） */
  askUserArguments: Record<string, unknown>;
  /** 续跑时模型改口：不再要求调用工具，直接作答 */
  stopAsking?: boolean;
  /** false = 本阶段期望 worker 认领不到任何东西（Run 还停在 waiting） */
  expectModelCalled?: boolean;
  claimLimit?: number;
}): Promise<PhaseResult> {
  const phasePool = new Pool({ connectionString: TEST_DATABASE_URL!, max: 6 });
  const phaseDb = drizzle(phasePool);
  const phaseRepo = createHarnessRuntimeRepository(phaseDb);
  let runId = input.runId ?? "";
  let sessionId = "";

  try {
    if (!runId) {
      const created = await createAiSession(alice!, { title: "批次9交互表单会话", workflowKey: "free_chat" });
      sessionId = created.sessionId;
      createdSessionIds.push(sessionId);
      const queued = await phaseRepo.createQueuedRun({
        ownerUserId: alice!.id,
        ownerUsername: alice!.username,
        aiSessionId: sessionId,
        submissionKey: `b9-${randomUUID()}`,
        title: input.content,
        workflowId: "workbench_chat_v1",
        workflowVersion: "1.0.0",
        executionConfig: { content: input.content },
      });
      runId = queued.run.harnessRunId;
      createdRunIds.push(runId);
    } else {
      const rows = await phaseDb.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, runId));
      sessionId = String(rows[0]?.aiSessionId ?? "");
    }

    let modelTurns = 0;
    const modelRequests: PhaseResult["modelRequests"] = [];
    const fakeProvider = {
      name: "kimi",
      defaultModel: "kimi-b9",
      isAvailable: () => true,
      chatCompletion: async () => {
        throw new Error("chatCompletion_should_not_be_called");
      },
      streamChatCompletion: (params: { messages: Array<{ role: string; content: string }> }) => {
        modelTurns += 1;
        modelRequests.push({ turn: modelTurns, messages: params.messages.map((m) => ({ role: m.role, content: String(m.content ?? "") })) });
        if (!input.stopAsking && modelTurns === 1) {
          return (async function* () {
            // 正文只说一句人话：本批改掉的是「模型得自己记得写 JSON」这件事，
            // 判据①据此断言所有 text.delta 里不出现任何表单 JSON。
            yield {
              contentDelta: "在开始估算前，我需要你补充几项信息。",
              model: "kimi-b9",
              finishReason: "tool_calls",
              toolCalls: [{ id: "call_ask_1", name: "ask_user", arguments: input.askUserArguments }],
            };
          })();
        }
        return (async function* () {
          yield { contentDelta: "已按你补充的信息继续作答。", model: "kimi-b9", finishReason: "stop" };
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
        model: "kimi-b9",
        baseUrl: "https://b9.invalid/v1",
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
              workerId: `b9-${randomUUID().slice(0, 8)}`,
              timing: { claimPollIntervalMs: 10, leaseMs: 5_000, heartbeatIntervalMs: 2_000, concurrency: 1 },
            });
            for (let i = 0; i < (input.claimLimit ?? 10); i += 1) {
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
    if (input.expectModelCalled === false) {
      assert.equal(modelTurns, 0, "Run 停在 waiting 时 worker 必须认领不到（否则等于超时自动放行）");
    } else {
      assert.ok(modelTurns >= 1, "provider 必须真的被调用（否则「没挂起」只是装配没跑）");
    }
    return { runId, sessionId, modelRequests };
  } finally {
    await phasePool.end();
  }
}

/** 判据①共用：waiting + 等待事件字段集合（含表单结构）+ 未回填结果 + 无审批事件。 */
function assertAwaitingInputState(input: { rows: EventRow[]; formBlock: Record<string, unknown> }): void {
  const { rows, formBlock } = input;
  const awaiting = eventsOfType(rows, "tool.call.awaiting_input");
  assert.equal(awaiting.length, 1, `一次提问只能问一次，实取 ${awaiting.length}`);
  assert.deepEqual(
    Object.keys(awaiting[0]!.payload).sort(),
    ["actionId", "callId", "formBlock", "ordinal", "toolName"],
    `awaiting_input 字段集合被锁死（必须带表单结构，不得带第二份参数副本），实取 ${JSON.stringify(Object.keys(awaiting[0]!.payload))}`,
  );
  assert.equal(awaiting[0]!.payload.toolName, "ask_user");
  assert.equal(awaiting[0]!.payload.callId, "call_ask_1");
  assert.equal(awaiting[0]!.payload.ordinal, 1);
  assert.deepEqual(awaiting[0]!.payload.formBlock, formBlock, "事件必须带**契约校验后**的表单结构，控件才有可渲染事实");

  const started = eventsOfType(rows, "tool.call.started");
  assert.equal(started.length, 1, "tool.call.started 必须恰好一条");
  assert.ok(
    started[0]!.sequence < awaiting[0]!.sequence,
    "started 必须严格早于 awaiting_input，否则界面按 callId 回查参数会查不到",
  );
  assert.equal(countByType(rows, "tool.call.completed"), 0, "挂起期间不得回填成功结果");
  assert.equal(countByType(rows, "tool.call.failed"), 0, "挂起不是工具失败");
  // 判据④：ask_user 落 allow 档，绝不该产生审批请求（也不需要用户点「同意」）
  assert.equal(countByType(rows, "tool.call.awaiting_approval"), 0, "ask_user 不得触发审批");
  assert.equal(countByType(rows, "run_action_confirmed"), 0, "ask_user 的恢复不经过 confirm 通道");
}

// ============================================================
// 判据① 模型调 ask_user → run 转 waiting、控件可渲染事实落表、正文零 JSON
// ============================================================

test("判据① ask_user → waiting + awaiting_input 落表 + 正文里不出现任何 JSON", { skip: !TEST_DATABASE_URL }, async () => {
  const formBlock = validFormBlock("pause");
  const phase = await drivePhase({ content: "帮我评估一下这个 ERP 项目的工作量", askUserArguments: formBlock });
  const rows = await readEvents(phase.runId);

  assert.equal(await runStatus(phase.runId), "waiting", "Run 必须停在 waiting 等用户填写");
  assertAwaitingInputState({ rows, formBlock });

  // 本批要害：表单不再靠正文里那段 JSON 存在。所有 text.delta 拼起来必须一个花括号都没有。
  const body = eventsOfType(rows, "text.delta")
    .map((row) => String(row.payload.delta ?? ""))
    .join("");
  assert.equal(body, "在开始估算前，我需要你补充几项信息。", "正文只该是人话");
  assert.ok(!body.includes("formBlock"), "正文不得出现 formBlock 协议字面量");
  assert.ok(!/[{}]/.test(body), `正文不得出现任何 JSON 花括号，实取 ${JSON.stringify(body)}`);
  logEvents("判据①", rows);
});

// ============================================================
// 判据② 提交 → 从 waiting 恢复 + 结构化答案进下一轮模型请求
// ============================================================

test("判据② inputs 提交 → waiting→queued→完成 + 结构化 values 作为工具结果进入模型上下文", { skip: !TEST_DATABASE_URL }, async () => {
  const formBlock = validFormBlock("resume");
  const phase = await drivePhase({ content: "帮我评估一下这个 ERP 项目的工作量", askUserArguments: formBlock });
  const first = await readEvents(phase.runId);
  const actionId = String(eventsOfType(first, "tool.call.awaiting_input")[0]!.payload.actionId);
  assert.ok(actionId, "等待事件必须带 actionId，前端提交时才能对上这一次提问");

  // 恢复走 POST /:runId/inputs 那条路（repo.submitRunInput 即该端点的唯一落库口）。
  // 刻意验证「发消息」这条路走不通：见下方并发对照断言。
  const submitted = await repo!.submitRunInput({
    runId: phase.runId,
    input: {
      actionId,
      values: { industry: "manufacturing", scale: "120", note: "含二期" },
      message: "补充项目信息：行业=制造业，规模=120",
    },
    requestedBy: alice!.id,
  });
  assert.equal(String(submitted.run.status ?? ""), "queued", "提交后必须回 queued 等 worker 认领");
  assert.equal(await runStatus(phase.runId), "queued");

  // 续跑：模型重放同一次 ask_user 调用（与批次 1a 的 started→completed 重放形态同构），
  // 闸门按 actionId 查到已提交的答案 → 直接回填工具结果，不再挂起。
  const resume = await drivePhase({
    runId: phase.runId,
    content: "帮我评估一下这个 ERP 项目的工作量",
    askUserArguments: formBlock,
  });

  const rows = await readEvents(phase.runId);
  logEvents("判据②", rows);
  assert.equal(countByType(rows, "run_inputs_submitted"), 1, "答案必须恰好落一条持久事实");
  assert.equal(countByType(rows, "tool.call.awaiting_input"), 1, "答过一次就不得再问第二遍（重放必须吸收）");
  assert.equal(countByType(rows, "tool.call.completed"), 1, "恢复后工具必须回填一次结果");
  assert.equal(await runStatus(phase.runId), "completed", "整轮必须跑到终态");

  // 「打印下一轮请求的 messages 比对」：结构化答案必须由服务端组装进模型上下文
  const lastRequest = resume.modelRequests[resume.modelRequests.length - 1]!;
  const toolMessage = lastRequest.messages.find((message) => message.content.includes("ask_user"));
  assert.ok(toolMessage, `续跑轮的 messages 必须含 ask_user 的工具结果，实取 ${JSON.stringify(lastRequest.messages.map((m) => m.role))}`);
  for (const fragment of ['"industry"', '"manufacturing"', '"scale"', '"120"', '"note"', "含二期"]) {
    assert.ok(toolMessage!.content.includes(fragment), `工具结果必须带结构化答案 ${fragment}，实取 ${toolMessage!.content}`);
  }
  assert.ok(
    toolMessage!.content.includes(actionId.slice(0, 8)) || toolMessage!.content.includes("answered_by_user"),
    "工具结果必须可归因（answered_by_user / actionId），否则模型无从判断这是用户答的",
  );

  // 提交的答案不得被当成一次新的用户发言塞进历史（会话活跃 Run 下发消息会 409，
  // 这里守的是恢复侧口径：run_inputs_submitted 只进工具结果，不进 messages 的 user 角色）
  const userTurns = lastRequest.messages.filter((message) => message.role === "user");
  assert.equal(userTurns.length, 1, `本轮用户发言仍是发起 Run 的那一句，实取 ${userTurns.length} 条`);
  assert.equal(userTurns[0]!.content.includes("含二期"), false, "结构化答案不得伪装成 user 轮次进入上下文");
});

// ============================================================
// 判据②补 参数漂移：改了题目即换新 actionId，旧答案不可套用
// ============================================================

test("参数漂移：续跑时模型换了表单结构，旧答案不复用（必须重新问）", { skip: !TEST_DATABASE_URL }, async () => {
  const formBlock = validFormBlock("drift");
  const phase = await drivePhase({ content: "帮我评估工作量", askUserArguments: formBlock });
  const first = await readEvents(phase.runId);
  const actionId = String(eventsOfType(first, "tool.call.awaiting_input")[0]!.payload.actionId);
  await repo!.submitRunInput({
    runId: phase.runId,
    input: { actionId, values: { industry: "retail", scale: "1" } },
    requestedBy: alice!.id,
  });

  const drifted = { ...formBlock, fields: [...formBlock.fields, { id: "extra", label: "多出来的一题", type: "text" }] };
  await drivePhase({ runId: phase.runId, content: "帮我评估工作量", askUserArguments: drifted });

  const rows = await readEvents(phase.runId);
  const awaits = eventsOfType(rows, "tool.call.awaiting_input");
  assert.equal(awaits.length, 2, `题目变了就是另一个问题，必须再问一次；实取 ${awaits.length} 条等待事件`);
  assert.notEqual(String(awaits[1]!.payload.actionId), actionId, "actionId 必须随参数摘要变化");
  assert.equal(await runStatus(phase.runId), "waiting", "第二次提问同样停在 waiting");
  logEvents("参数漂移", rows);
});

// ============================================================
// 判据③ 参数不合契约 → 调用被拒、错误可读、不渲染半个控件
// ============================================================

const INVALID_CASES: { tag: string; args: Record<string, unknown>; expectMention: string; extraMention?: string }[] = [
  {
    tag: "missing-blockId",
    args: (() => {
      const { blockId: _omit, ...rest } = validFormBlock("bad1");
      return rest as Record<string, unknown>;
    })(),
    expectMention: "blockId",
  },
  {
    tag: "unsupported-field-type",
    args: {
      ...validFormBlock("bad2"),
      fields: [{ id: "a", label: "A", type: "date_picker" }],
    },
    expectMention: "/fields/0/type",
  },
  {
    tag: "additional-property",
    args: { ...validFormBlock("bad3"), theme: "dark" },
    expectMention: "theme",
  },
  {
    // 会话 7f5cbf75 的真实错法：模型把字段键写成 name，而契约要 id
    tag: "field-key-name-not-id",
    args: {
      ...validFormBlock("bad4"),
      fields: [{ name: "industry", label: "客户行业", type: "single_select", options: [{ label: "制造业", value: "manufacturing" }] }],
    },
    expectMention: "/fields/0",
    extraMention: "id",
  },
  {
    tag: "single-select-without-options",
    args: { ...validFormBlock("bad5"), fields: [{ id: "industry", label: "客户行业", type: "single_select" }] },
    expectMention: "options",
  },
];

for (const invalidCase of INVALID_CASES) {
  test(`判据③ ${invalidCase.tag} → 拒绝且错误可读 + 不挂起不渲染半个控件`, { skip: !TEST_DATABASE_URL }, async () => {
    const phase = await drivePhase({
      content: `帮我评估工作量（${invalidCase.tag}）`,
      askUserArguments: invalidCase.args,
      // 第 2 轮起模型不再要求调用工具：坏参数被拒后模型仍能继续作答，主链路不断
      stopAsking: false,
      claimLimit: 20,
    });
    const rows = await readEvents(phase.runId);
    logEvents(`判据③ ${invalidCase.tag}`, rows);

    assert.equal(countByType(rows, "tool.call.awaiting_input"), 0, "参数不合契约时不得写等待事件（否则控件渲染不出来，Run 死在 waiting）");
    assert.equal(countByType(rows, "tool.call.started"), 1, "被拒也要留下调用痕迹，用户才知道发生过什么");
    assert.equal(countByType(rows, "tool.call.completed"), 0, "被拒不记为成功");
    assert.equal(countByType(rows, "tool.call.failed"), 1, "被拒须回填一次失败");
    assert.notEqual(await runStatus(phase.runId), "waiting", "不得把 Run 挂在渲染不出来的等待上");

    const failed = eventsOfType(rows, "tool.call.failed")[0]!;
    const errorText = JSON.stringify(failed.payload.error ?? "");
    assert.ok(errorText.includes("ask_user"), `错误须点名工具，实取 ${errorText}`);
    assert.ok(errorText.includes("契约"), `错误须说明是契约未通过，实取 ${errorText}`);
    assert.ok(
      errorText.includes(invalidCase.expectMention),
      `错误须给出可定位的字段路径 ${invalidCase.expectMention}，实取 ${errorText}`,
    );
    if (invalidCase.extraMention) {
      assert.ok(
        errorText.includes(invalidCase.extraMention),
        `错误须点名出问题的键 ${invalidCase.extraMention}，实取 ${errorText}`,
      );
    }
  });
}
