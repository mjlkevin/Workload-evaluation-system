// ============================================================
// 批次 1a · 写操作工具执行前审批闸门 —— 六条过线判据的端到端实取
// ============================================================
// 这条链是本批唯一能同时证明「闸门真的挡住写库」与「等待是库里的一行而不是内存
// Promise」的地方，因此刻意不 mock 工具实现：只注入 fake provider（模型侧）与
// fake 场景配置，create_project 走 default-registry 的**真实**实现、落真实
// version_records 行。判据①③⑥靠「查库数副作用行数」定论，不查日志也不查返回值。
//
// 三条设计约束在测试里的对应：
//  · 约束①服务端判定 → 判据⑤（模型自称已获批仍被拦；连问两轮都不放行，
//    放行与否只取决于库里那行来自 JWT 用户的决策）
//  · 约束②只带 callId → 每条判据都钉住 awaiting_approval / rejected / confirmed 的
//    payload 字段集合，并断言参数只落在 tool.call.started 那一份上
//  · 约束③可持久 → 判据④（换一个真 OS 进程读回 waiting 并提交确认，续跑由全新装配驱动）
//
// 另加三条口径守护：不设超时（不自动拒绝）、参数漂移时旧批准不可复用、
// 无审批链路的通道一律拒绝执行写工具；外加一条反向对照证明写路径真的通。

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq, sql } from "drizzle-orm";

import {
  aiSessions,
  harnessRunAttempts,
  harnessRunEvents,
  harnessRuns,
  versionRecords,
} from "../../db/schema";
import {
  createHarnessRuntimeRepository,
  type HarnessRuntimeRepository,
} from "./harness-runtime.repository";
import { createHarnessRuntimeWorker, type HarnessWorkflowRegistry } from "./harness-runtime.worker";
import { startHarnessRuntime } from "./harness-boot";
import { createAiSession, getAiSession } from "../ai-sessions/ai-sessions.usecase";
import {
  createProjectEvaluationForUser,
  listProjectEvaluationsForUser,
} from "../project-evaluations/project-evaluations.module";
import { cleanupTestUsers, createTestUser } from "../../test-helpers/test-users";
import type { AuthUser } from "../../types";
import { routeWorkbenchIntent } from "../../services/ai/workbench-intent.service";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

type EventRow = { sequence: number; eventType: string; payload: Record<string, unknown> };

let pool: Pool | null = null;
let q: ReturnType<typeof drizzle> | null = null;
let repo: HarnessRuntimeRepository | null = null;
let alice: AuthUser | null = null;
const createdRunIds: string[] = [];
const createdSessionIds: string[] = [];
const createdProjectNames: string[] = [];

/** 随机项目名：断言只数本轮自己的行，不依赖表非空/唯一写入者。 */
function name(tag: string): string {
  const value = `批次1a${tag}${randomUUID().slice(0, 8)}`;
  createdProjectNames.push(value);
  return value;
}

before(async () => {
  if (!TEST_DATABASE_URL) return;
  pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
  q = drizzle(pool);
  repo = createHarnessRuntimeRepository(q);
  alice = await createTestUser("wes-b1a-alice", { role: "admin" });
});

after(async () => {
  if (!q) return;
  for (const projectName of createdProjectNames.splice(0)) {
    await q
      .delete(versionRecords)
      .where(
        sql`${versionRecords.ownerUserId} = ${alice!.id} AND ${versionRecords.payload}->>'projectName' = ${projectName}`,
      )
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
  await cleanupTestUsers("wes-b1a").catch(() => undefined);
  await pool!.end();
});

/** 副作用行数：查库（versions 域真实读路径），不是查内存计数。 */
async function countProjectsByName(projectName: string): Promise<number> {
  const list = await listProjectEvaluationsForUser(alice!, { q: projectName });
  return list.filter((item) => item.projectName === projectName).length;
}

async function readEvents(runId: string): Promise<EventRow[]> {
  const rows = await q!.select().from(harnessRunEvents).where(eq(harnessRunEvents.harnessRunId, runId)).orderBy(asc(harnessRunEvents.sequence));
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

async function listApprovalActions(runId: string): Promise<string[]> {
  const rows = await readEvents(runId);
  return rows.filter((row) => row.eventType === "tool.call.awaiting_approval").map((row) => String(row.payload.actionId));
}

function countByType(rows: EventRow[], eventType: string): number {
  return rows.filter((row) => row.eventType === eventType).length;
}

function logEvents(title: string, rows: EventRow[]): void {
  console.log(`[B1A·${title}] ${rows.map((row) => `seq${row.sequence}:${row.eventType}`).join(" → ")}`);
}

type PhaseResult = { runId: string; sessionId: string; modelTurns: number };

/**
 * 驱动一个阶段 = 一次 boot 装配 + 一个 worker 实例 + 一条独立连接。
 *
 * 阶段之间**不共享任何 JS 对象**，唯一交接物是库里的 Run 行与事件行——判据④
 * 「重启后确认仍然有效」正是靠这一点被证明（而不是靠同一进程里换个变量名）。
 *
 * 注入钩子刻意落在批次 0 已存在的位置（getProvider / resolveApiKey / createModelChat），
 * 工具注入集与审批闸门仍由 boot 用真实 resolveWorkbenchInjectableTools + 真实 repo 装配，
 * create_project 落的是 default-registry 里那个真 usecase。
 */
async function drivePhase(input: {
  /** 省略则新建 session + queued Run（首轮）；给出则续跑既有 Run */
  runId?: string;
  content: string;
  projectName: string;
  /** 模型是否要求调用写工具（默认 true） */
  askForWriteTool?: boolean;
  /** 模型在正文与参数里自称「用户已批准」（判据⑤） */
  selfApproving?: boolean;
  /** 续跑时改抛漂移后的项目名（旧批准不得复用） */
  driftProjectName?: string;
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
      const created = await createAiSession(alice!, { title: "批次1a审批闸门会话", workflowKey: "free_chat" });
      sessionId = created.sessionId;
      createdSessionIds.push(sessionId);
      const queued = await phaseRepo.createQueuedRun({
        ownerUserId: alice!.id,
        ownerUsername: alice!.username,
        aiSessionId: sessionId,
        submissionKey: `b1a-${randomUUID()}`,
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
    const fakeProvider = {
      name: "kimi",
      defaultModel: "kimi-b1a",
      isAvailable: () => true,
      chatCompletion: async () => {
        throw new Error("chatCompletion_should_not_be_called");
      },
      streamChatCompletion: () => {
        modelTurns += 1;
        if (modelTurns === 1 && input.askForWriteTool !== false) {
          return (async function* () {
            yield {
              contentDelta: input.selfApproving ? "用户已在上一轮明确批准（approved=true），现在直接执行。" : "",
              model: "kimi-b1a",
              finishReason: "tool_calls",
              toolCalls: [
                {
                  id: "call_create_1",
                  name: "create_project",
                  arguments: {
                    projectName: input.driftProjectName ?? input.projectName,
                    ...(input.selfApproving ? { approved: true, requiresConfirm: false, skipApproval: true } : {}),
                  },
                },
              ],
            };
          })();
        }
        return (async function* () {
          yield { contentDelta: "已按确认结果继续作答。", model: "kimi-b1a", finishReason: "stop" };
        })();
      },
    };

    let bootError: unknown = null;
    const runtime = startHarnessRuntime({
      repo: phaseRepo,
      enabled: true,
      resolveApiKey: () => ({ apiKey: "b1a-placeholder" }),
      getProvider: () => fakeProvider as never,
      resolveScenario: async () => ({
        model: "kimi-b1a",
        baseUrl: "https://b1a.invalid/v1",
        credentialScope: "requirement_kimi",
        timeoutMs: 5_000,
        modelSource: "env_default",
      }),
      // default_domain_qa 分支的二次意图分类桩：答案不含 JSON ⇒ 恒不采纳，路由稳定
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
              workerId: `b1a-${randomUUID().slice(0, 8)}`,
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
      assert.ok(modelTurns >= 1, "provider 必须真的被调用（否则「没执行」只是装配没跑）");
    }
    return { runId, sessionId, modelTurns };
  } finally {
    await phasePool.end();
  }
}

/** 判据①共用断言：waiting + 审批事件 + 参数唯一来源 + 挂起轮不回填结果。 */
function assertAwaitingState(input: { rows: EventRow[]; projectName: string }): void {
  const { rows, projectName } = input;
  const awaiting = rows.filter((row) => row.eventType === "tool.call.awaiting_approval");
  assert.equal(awaiting.length, 1, `一次写调用只能问一次，实取 ${awaiting.length}`);
  // 约束②：审批请求只带标识，不带第二份参数
  assert.deepEqual(
    Object.keys(awaiting[0]!.payload).sort(),
    ["actionId", "callId", "ordinal", "toolName"],
    `awaiting_approval 字段集合被锁死（不得带参数副本），实取 ${JSON.stringify(Object.keys(awaiting[0]!.payload))}`,
  );
  assert.equal(awaiting[0]!.payload.toolName, "create_project");
  assert.equal(awaiting[0]!.payload.callId, "call_create_1");
  assert.equal(awaiting[0]!.payload.ordinal, 1);

  const started = rows.filter((row) => row.eventType === "tool.call.started");
  assert.equal(started.length, 1, `tool.call.started 必须恰好一条，实取 ${started.length}`);
  assert.deepEqual(started[0]!.payload.arguments, { projectName }, "参数只能落在 tool.call.started 这一份");
  assert.equal(started[0]!.payload.callId, "call_create_1", "started 必须带 callId，审批事件才能按它对账");
  assert.ok(started[0]!.sequence < awaiting[0]!.sequence, "started 必须严格早于 awaiting_approval——否则界面按 callId 回查参数会查不到");
  // 挂起轮工具未执行：既无成功回填也无失败回填
  assert.equal(countByType(rows, "tool.call.completed"), 0, "挂起期间不得回填成功结果");
  assert.equal(countByType(rows, "tool.call.failed"), 0, "挂起不是工具失败");
}

// ============================================================
// 判据① 请求写工具 → waiting、事件落表、工具未执行
// ============================================================

test("判据① 写工具请求 → waiting + 审批事件落表 + 查库零副作用行", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("待批");
  const phase = await drivePhase({ content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });
  const before = await countProjectsByName(projectName);
  const rows = await readEvents(phase.runId);

  assert.equal(await runStatus(phase.runId), "waiting", "Run 必须停在 waiting");
  assertAwaitingState({ rows, projectName });
  const after = await countProjectsByName(projectName);
  assert.equal(after, before, `挂起期间不得写库，实取 ${before} → ${after}`);
  assert.equal(after, 0, `探针项目名必须查无此行，实取 ${after}`);
  logEvents("判据①", rows);
});

// ============================================================
// 判据② 同意 → 恰好执行一次
// ============================================================

test("判据② 同意后恰好执行一次（副作用 1 行 / completed 1 条 / 不重复问）", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("已批");
  const phase = await drivePhase({ content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });
  const actionId = (await listApprovalActions(phase.runId))[0]!;

  const confirmed = await repo!.confirmRunAction({ runId: phase.runId, actionId, confirmedBy: alice!.id });
  assert.equal(confirmed.created, true);
  assert.equal(await runStatus(phase.runId), "queued", "确认后必须回 queued 等 worker 认领");
  // 约束②对账：同意侧复用 run_action_confirmed，由服务端从审批请求抄入 callId / toolName
  const confirmedPayload = confirmed.event!.payload as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(confirmedPayload).sort(),
    ["actionId", "callId", "confirmedBy", "toolName"],
    `run_action_confirmed 必须补 callId 以便对账，实取 ${JSON.stringify(Object.keys(confirmedPayload))}`,
  );
  assert.equal(confirmedPayload.callId, "call_create_1");

  await drivePhase({ runId: phase.runId, content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });

  assert.equal(await countProjectsByName(projectName), 1, `判据②：恰好写库一次，实取 ${await countProjectsByName(projectName)} 行`);
  const rows = await readEvents(phase.runId);
  assert.equal(countByType(rows, "tool.call.awaiting_approval"), 1, "已批准不得再问一次");
  assert.equal(countByType(rows, "tool.call.started"), 2, "重放会重新发起同一调用（一次挂起、一次执行）");
  assert.equal(countByType(rows, "tool.call.completed"), 1, "completed 必须恰好一条");
  assert.equal(countByType(rows, "run_action_confirmed"), 1);
  assert.equal(await runStatus(phase.runId), "completed", "续跑后必须正常收尾");
  const session = await getAiSession(alice!, phase.sessionId);
  const assistant = (session?.messages ?? []).filter((message) => message.role === "assistant").at(-1) as { content?: string } | undefined;
  assert.match(String(assistant?.content ?? ""), /已按确认结果继续作答/, "批准后模型仍要把话说完并落库");
  logEvents("判据②", rows);
});

// ============================================================
// 判据③ 拒绝 → 模型收到失败结果并继续作答；工具从未执行
// ============================================================

test("判据③ 拒绝后模型继续作答，且工具从未执行（查库零副作用行）", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("被拒");
  const phase = await drivePhase({ content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });
  const actionId = (await listApprovalActions(phase.runId))[0]!;

  const rejected = await repo!.rejectRunAction({ runId: phase.runId, actionId, rejectedBy: alice!.id });
  assert.equal(rejected.created, true);
  assert.equal(await runStatus(phase.runId), "queued", "拒绝后 Run 必须回 queued 让模型把话说完");
  const rejectedPayload = rejected.event!.payload as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(rejectedPayload).sort(),
    ["actionId", "callId", "rejectedBy", "toolName"],
    `tool.call.rejected 字段集合被锁死（不带参数副本），实取 ${JSON.stringify(Object.keys(rejectedPayload))}`,
  );

  await drivePhase({ runId: phase.runId, content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });

  assert.equal(await countProjectsByName(projectName), 0, "判据③：拒绝后工具一次都没执行");
  const rows = await readEvents(phase.runId);
  assert.equal(countByType(rows, "tool.call.rejected"), 1);
  assert.equal(countByType(rows, "tool.call.completed"), 0);
  const failed = rows.filter((row) => row.eventType === "tool.call.failed");
  assert.equal(failed.length, 1, "回填给模型的必须是失败结果（模型才知道要继续作答）");
  assert.match(String(failed[0]!.payload.error), /拒绝/, `失败原因要写明是被拒绝，实取 ${JSON.stringify(failed[0]!.payload)}`);
  const session = await getAiSession(alice!, phase.sessionId);
  const assistant = (session?.messages ?? []).filter((message) => message.role === "assistant").at(-1) as { content?: string } | undefined;
  assert.match(String(assistant?.content ?? ""), /已按确认结果继续作答/, "拒绝后模型必须继续作答并落库");
  assert.equal(await runStatus(phase.runId), "completed");
  logEvents("判据③", rows);
});

// ============================================================
// 判据④ 等待期间重启 worker → 确认仍然有效（可持久性证明）
// ============================================================

/** 起一个只认识连接串的子进程，由它读回 waiting 并提交确认（跨进程证据）。 */
async function restartInNewProcess(
  runId: string,
  confirmedBy: string,
): Promise<{ childPid: number; statusBefore: string; awaitingEvents: number; created: boolean; statusAfter: string }> {
  const childPath = resolve(__dirname, "../../test-helpers/b1a-approval-restart-child.ts");
  // 从 cwd 逐级上溯找 tsx（workspace 安装位置随 npm 版本而变，写死会假失败）
  let tsx: string | undefined;
  for (let dir = process.cwd(); ; dir = resolve(dir, "..")) {
    const candidate = resolve(dir, "node_modules/.bin/tsx");
    if (existsSync(candidate)) {
      tsx = candidate;
      break;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = resolve(dir, "..");
  }
  assert.ok(tsx, `找不到 node_modules/.bin/tsx（cwd=${process.cwd()}），无法起子进程`);
  const stdout = execFileSync(process.execPath, [tsx, childPath, runId, confirmedBy], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
    maxBuffer: 8 * 1024 * 1024,
  });
  const line = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
  assert.ok(line.startsWith("{"), `子进程必须输出一行 JSON，实取 ${JSON.stringify(stdout.slice(0, 400))}`);
  return JSON.parse(line);
}

test("判据④ 等待期间真换 OS 进程 → 确认仍然有效且只执行一次", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("重启");
  const phase = await drivePhase({ content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });
  assert.equal(await runStatus(phase.runId), "waiting");
  assert.equal(await countProjectsByName(projectName), 0);

  // 「重启」的可验证定义（两层，缺一都不算证明）：
  //  a) 换一个**真 OS 进程**读回 waiting 并提交确认——子进程只带连接串进来，
  //     不继承父进程任何内存对象；它能读回审批请求，即「等待」是库里的一行。
  //  b) 续跑由全新装配（新 Pool / 新 repo / 新 worker / 新 boot 闭包）驱动。
  // 阻塞回调（orchestrator.ts:64 的 await confirm(...)）在 a) 处必炸：那个 Promise
  // 随父进程销毁，库里也没有任何一行说明它存在过。
  const child = await restartInNewProcess(phase.runId, alice!.id);
  assert.notEqual(child.childPid, process.pid, "确认必须由另一个 OS 进程提交，否则不算跨进程重启");
  assert.equal(child.statusBefore, "waiting", `新进程读回的必须是 waiting，实取 ${child.statusBefore}`);
  assert.equal(child.awaitingEvents, 1, `新进程必须能读回那条审批请求，实取 ${child.awaitingEvents}`);
  assert.equal(child.created, true, "新进程里的确认必须被判为首次确认");
  assert.equal(child.statusAfter, "queued");

  await drivePhase({ runId: phase.runId, content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });

  assert.equal(await countProjectsByName(projectName), 1, "跨进程确认后必须真的执行一次");
  const rows = await readEvents(phase.runId);
  assert.equal(countByType(rows, "tool.call.awaiting_approval"), 1, "重启后不得重复问用户");
  assert.equal(countByType(rows, "tool.call.completed"), 1);
  console.log(`[B1A·判据④] 子进程 pid=${child.childPid}（父 pid=${process.pid}）读回 waiting 并提交确认 → 副作用 0 → 1 行`);
});

// ============================================================
// 判据⑤ 模型无法自我批准（失败方向关闭）
// ============================================================

test("判据⑤ 模型自称已获批仍被拦；补真决策后同一条输出才放行一次", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("自批");
  const first = await drivePhase({
    content: `帮我创建一个ERP项目，名叫${projectName}`,
    projectName,
    selfApproving: true,
  });
  assert.equal(await runStatus(first.runId), "waiting", "自称已获批不得放行");
  assert.equal(await countProjectsByName(projectName), 0);

  // 用户没答应（不确认）→ Run 停在 waiting，任何新 worker 都认领不到它，
  // 因此也谈不上「再问一次」或「自动执行」：等待就是等待，不设超时也不自动拒绝。
  await drivePhase({
    runId: first.runId,
    content: `帮我创建一个ERP项目，名叫${projectName}`,
    projectName,
    selfApproving: true,
    expectModelCalled: false,
  });
  assert.equal(await countProjectsByName(projectName), 0, "自称已获批 + 无人确认 ⇒ 一次都不得执行");
  assert.equal(await runStatus(first.runId), "waiting", "既不该被判成功也不该被判失败");
  const midRows = await readEvents(first.runId);
  assert.equal(countByType(midRows, "tool.call.awaiting_approval"), 1, "未被回答的审批只问一次，不重复骚扰");
  assert.equal(countByType(midRows, "tool.call.completed"), 0);
  assert.equal(countByType(midRows, "tool.call.rejected"), 0, "不得自行写入拒绝决策");

  // 反向对照：同一条自称已获批的输出，一旦库里有真决策就放行——
  // 证明放行与否唯一取决于库里那行决策（confirmedBy 是 JWT 用户），不是模型文本。
  const actions = await listApprovalActions(first.runId);
  await repo!.confirmRunAction({ runId: first.runId, actionId: actions[0]!, confirmedBy: alice!.id });
  await drivePhase({ runId: first.runId, content: `帮我创建一个ERP项目，名叫${projectName}`, projectName, selfApproving: true });
  assert.equal(await countProjectsByName(projectName), 1, "用户真确认后应放行一次");
  const rows = await readEvents(first.runId);
  assert.equal(countByType(rows, "tool.call.completed"), 1);
  logEvents("判据⑤", rows);
});

// ============================================================
// 判据⑥ 并发确认同一动作 → 恰好执行一次
// ============================================================

test("判据⑥ 三条独立连接并发确认 → 决策 1 条、执行 1 次、副作用 1 行", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("并发");
  const phase = await drivePhase({ content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });
  const actionId = (await listApprovalActions(phase.runId))[0]!;

  // 两条独立连接 + 三份并发提交（行锁的正面考验：不用同一连接则躲不开真竞态）
  const racerPool = new Pool({ connectionString: TEST_DATABASE_URL!, max: 4 });
  const racerRepo = createHarnessRuntimeRepository(drizzle(racerPool));
  try {
    const results = await Promise.all([
      repo!.confirmRunAction({ runId: phase.runId, actionId, confirmedBy: alice!.id }),
      racerRepo.confirmRunAction({ runId: phase.runId, actionId, confirmedBy: alice!.id }),
      racerRepo.confirmRunAction({ runId: phase.runId, actionId, confirmedBy: alice!.id }),
    ]);
    assert.equal(results.filter((result) => result.created).length, 1, `恰一次判为首次确认，实取 ${results.filter((r) => r.created).length}`);
  } finally {
    await racerPool.end();
  }

  const beforeResume = await readEvents(phase.runId);
  assert.equal(countByType(beforeResume, "run_action_confirmed"), 1, "重复确认不得重复事件");
  assert.equal(countByType(beforeResume, "tool.call.awaiting_approval"), 1);

  await drivePhase({ runId: phase.runId, content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });
  const projects = await countProjectsByName(projectName);
  assert.equal(projects, 1, `判据⑥：恰执行一次，实取 ${projects} 行`);
  const rows = await readEvents(phase.runId);
  assert.equal(countByType(rows, "tool.call.completed"), 1);
  assert.equal(countByType(rows, "run_action_confirmed"), 1);
  logEvents("判据⑥", rows);
});

// ============================================================
// 产品口径守护（用户已定，不得自行更改）
// ============================================================

test("不设超时：无人应答就一直停在 waiting，不自动拒绝也不自动放行", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("无超时");
  const phase = await drivePhase({ content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });
  const run = (await q!.select().from(harnessRuns).where(eq(harnessRuns.harnessRunId, phase.runId)))[0] as unknown as Record<string, unknown>;
  assert.equal(String(run.status), "waiting");
  assert.equal(
    Object.keys(run).some((key) => /approval.*(expire|timeout)|expires/i.test(key)),
    false,
    `不得引入审批超时列，实取字段 ${JSON.stringify(Object.keys(run))}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await runStatus(phase.runId), "waiting", "状态不得自行改变（自动拒绝会让用户以为系统吞了他的请求）");
  // 真正的「无超时」证据：等待中的 Run 对 worker 不可认领，也没有任何定时路径会动它
  await drivePhase({
    runId: phase.runId,
    content: `帮我创建一个ERP项目，名叫${projectName}`,
    projectName,
    expectModelCalled: false,
  });
  assert.equal(await runStatus(phase.runId), "waiting", "worker 再来一轮也必须原地不动");
  assert.equal(await countProjectsByName(projectName), 0);
  const rows = await readEvents(phase.runId);
  assert.equal(countByType(rows, "tool.call.rejected"), 0, "不得自行写入拒绝决策");
  assert.equal(countByType(rows, "run_failed"), 0, "不得把等待判为失败");
});

test("参数漂移：模型换了项目名，旧批准不可复用（必须再问）", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("漂移");
  const drifted = `${projectName}-被改掉`;
  createdProjectNames.push(drifted);
  const phase = await drivePhase({ content: `帮我创建一个ERP项目，名叫${projectName}`, projectName });
  const actionId = (await listApprovalActions(phase.runId))[0]!;
  await repo!.confirmRunAction({ runId: phase.runId, actionId, confirmedBy: alice!.id });

  await drivePhase({ runId: phase.runId, content: `帮我创建一个ERP项目，名叫${projectName}`, projectName, driftProjectName: drifted });

  assert.equal(await countProjectsByName(drifted), 0, "用户批的是 A，不得因为存在决策就去写 B");
  assert.equal(await countProjectsByName(projectName), 0);
  const actions = await listApprovalActions(phase.runId);
  assert.equal(new Set(actions).size, 2, `漂移后必须产生新的审批请求，实取 ${JSON.stringify(actions)}`);
  const rows = await readEvents(phase.runId);
  assert.equal(countByType(rows, "tool.call.completed"), 0);
  assert.equal(await runStatus(phase.runId), "waiting");
});

test("退役核对：写动作措辞不再被正则截走（否则本批等于没做）", { skip: !TEST_DATABASE_URL }, async () => {
  for (const message of [
    "帮我创建一个ERP项目",
    "帮我创建广州可味达项目",
    "新建一个正式评估记录",
    "进入正式评估",
    "我创建了什么项目",
  ]) {
    const routed = routeWorkbenchIntent({ message, hasAttachment: false, hasLatestV1Artifact: false, clientAction: "" });
    assert.notEqual(routed.intent, "write_action_request", `退役后不得再命中 write_action_request：${message}`);
    assert.notEqual(routed.routingRule, "write_action_keywords", `退役后不得再走该规则：${message}`);
  }
  // 「创建项目」类必须落到能被模型接管的路径（兜底 domain_qa → 工具循环 → 审批闸门）
  const routed = routeWorkbenchIntent({ message: "帮我创建一个ERP项目", hasAttachment: false, hasLatestV1Artifact: false, clientAction: "" });
  assert.equal(routed.routingRule, "default_domain_qa", `实取 ${JSON.stringify(routed)}`);
});

// ============================================================
// 反向对照：证明「零副作用」断言量的是一扇真的会开的门
// ============================================================

test("对照：直调 create_project usecase 确实写库（否则本文件所有零计数都无意义）", { skip: !TEST_DATABASE_URL }, async () => {
  const projectName = name("对照");
  const created = await createProjectEvaluationForUser(alice!, { projectName });
  assert.equal(created.projectName, projectName);
  assert.equal(
    await countProjectsByName(projectName),
    1,
    "直调必须写下一行——判据①③⑤里的「0 行」才是闸门挡住的证据，而不是写路径本身不通",
  );
});
