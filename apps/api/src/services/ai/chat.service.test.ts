import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PassThrough } from "node:stream";
import { Pool } from "pg";
import type { Request, Response } from "express";
import { config } from "../../config/env";
import { defaultProviderRegistry, type ModelProvider } from "../../ai/provider";
import type { AuthUser } from "../../types";
import { appendAiSessionEvent, createAiSession, deleteAiSession, listAiSessions } from "../../modules/ai-sessions/ai-sessions.usecase";
import { queryTraces } from "../../modules/trace/trace.repository";
import {
  allParsedHomeAttachments,
  buildMergedRequirementAnalysisReport,
  buildRequirementAnalysisReport,
  homeWorkbenchChatStream,
  resolveWorkbenchStreamFinalContent,
  type HomeAttachmentInput,
  type HomeMessageInput,
} from "./chat.service";

// ─── allParsedHomeAttachments ────────────────────────────────────────────────

test("allParsedHomeAttachments: 收集跨多条消息的所有附件", () => {
  const att = (name: string, summary = "业务需求：1. xxx"): HomeAttachmentInput => ({
    name,
    parsedSummary: summary,
  });
  const messages: HomeMessageInput[] = [
    { role: "user", content: "msg1", attachments: [att("a.xlsx"), att("b.docx")] },
    { role: "assistant", content: "reply", attachments: [] },
    { role: "user", content: "msg2", attachments: [att("c.pdf")] },
  ];
  const result = allParsedHomeAttachments(messages);
  assert.deepEqual(result.map((a) => a.name), ["a.xlsx", "b.docx", "c.pdf"]);
});

test("allParsedHomeAttachments: 按文件名去重", () => {
  const att = (name: string): HomeAttachmentInput => ({ name, parsedSummary: "summary" });
  const messages: HomeMessageInput[] = [
    { role: "user", content: "msg1", attachments: [att("a.xlsx")] },
    { role: "user", content: "msg2", attachments: [att("a.xlsx")] },
  ];
  const result = allParsedHomeAttachments(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "a.xlsx");
});

test("allParsedHomeAttachments: 跳过无 parsedSummary 的附件", () => {
  const messages: HomeMessageInput[] = [
    {
      role: "user", content: "msg", attachments: [
        { name: "empty.xlsx" },
        { name: "good.xlsx", parsedSummary: "summary" },
      ],
    },
  ];
  const result = allParsedHomeAttachments(messages);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "good.xlsx");
});

test("allParsedHomeAttachments: 空消息列表返回空数组", () => {
  assert.deepEqual(allParsedHomeAttachments([]), []);
});

// ─── buildMergedRequirementAnalysisReport ─────────────────────────────────────

const makeAttachment = (name: string): HomeAttachmentInput => ({
  name,
  parsedSummary: `项目：TestProject\n客户：TestCustomer\n行业：金融\n业务需求：\n1. 需求来自${name}`,
});

test("buildMergedRequirementAnalysisReport: 合并多份独立报告", () => {
  const attachments = [makeAttachment("file1.xlsx"), makeAttachment("file2.docx")];
  const reports = attachments.map((a) => buildRequirementAnalysisReport(a));
  const merged = buildMergedRequirementAnalysisReport(attachments, reports);

  assert.deepEqual(merged.sourceFiles, ["file1.xlsx", "file2.docx"]);
  assert.ok(Array.isArray(merged.sourceFile));
  assert.deepEqual(merged.sourceFile, ["file1.xlsx", "file2.docx"]);
  assert.ok(merged.needs.length >= 1);
  assert.equal(merged.projectName, "TestProject");
  assert.equal(merged.customerName, "TestCustomer");
  assert.equal(merged.industry, "金融");
});

test("buildMergedRequirementAnalysisReport: modelOverrides 优先于默认值", () => {
  const attachments = [makeAttachment("f1.xlsx"), makeAttachment("f2.xlsx")];
  const reports = attachments.map((a) => buildRequirementAnalysisReport(a));
  const overrides = { projectName: "覆盖项目", customerName: "覆盖客户" };
  const merged = buildMergedRequirementAnalysisReport(attachments, reports, overrides);

  assert.equal(merged.projectName, "覆盖项目");
  assert.equal(merged.customerName, "覆盖客户");
});

test("buildMergedRequirementAnalysisReport: 单附件时也正确工作", () => {
  const attachments = [makeAttachment("single.xlsx")];
  const reports = attachments.map((a) => buildRequirementAnalysisReport(a));
  const merged = buildMergedRequirementAnalysisReport(attachments, reports);

  assert.deepEqual(merged.sourceFiles, ["single.xlsx"]);
  assert.equal(merged.projectName, "TestProject");
});

// ─── RP-029: SSE handler 测试 ─────────────────────────────────────────────

function createMockReqRes(overrides: {
  user?: Record<string, unknown> | null;
  body?: unknown;
}): { req: Request; res: Response; getSseEvents: () => Array<{ event: string; data: unknown }> } {
  const req = new PassThrough() as unknown as Request;
  req.body = overrides.body ?? { messages: [{ role: "user", content: "hello" }] };
  if (overrides.user !== null) {
    (req as unknown as Record<string, unknown>).user = overrides.user ?? {
      id: TRACE_TEST_USER_ID,
      username: "tester",
      role: "user",
      businessRole: "pre_sales",
      status: "active",
    };
  }
  req.on = PassThrough.prototype.on.bind(req) as unknown as Request["on"];

  const written: string[] = [];
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let ended = false;

  const res = {
    setHeader: (key: string, value: string) => { headers[key] = value; },
    flushHeaders: () => {},
    write: (chunk: string) => { written.push(chunk); return true; },
    end: () => { ended = true; },
    status: (code: number) => { statusCode = code; return res; },
    json: () => {},
    get statusCode() { return statusCode; },
    set statusCodeSetter(v: number) { statusCode = v; },
  } as unknown as Response;

  const getSseEvents = (): Array<{ event: string; data: unknown }> => {
    const raw = written.join("");
    const events: Array<{ event: string; data: unknown }> = [];
    const blocks = raw.split("\n\n").filter(Boolean);
    for (const block of blocks) {
      const lines = block.split("\n");
      let event = "";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) event = line.slice(7);
        if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (event && data) {
        try { events.push({ event, data: JSON.parse(data) }); } catch { events.push({ event, data }); }
      }
    }
    return events;
  };

  return { req, res, getSseEvents };
}

// S3（2026-08-30）：trace JSON 路径删除后，本文件三条流式用例的 trace 断言走 PG。
// traces 表由多个测试文件共享（CI 按文件并行执行），沿用 trace-pg.repository.test.ts
// 已确立的数据集隔离范式：独占 owner 前缀 + 用例级条件 DELETE + 按 owner 过滤的
// 计数断言（全表精确计数在共享库不可判定）。前缀刻意与 wes-t-trace-% 不同，
// 避免并发执行时 trace.test.ts 的清理误删本文件在途的行。
const TRACE_TEST_USER_ID = "wes-chat-svc-user-1";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

let tracePool: Pool | null = null;

async function cleanTraceRows(): Promise<void> {
  if (!testDatabaseUrl) return;
  tracePool ??= new Pool({ connectionString: testDatabaseUrl, max: 2 });
  await tracePool.query("DELETE FROM traces WHERE owner_user_id = $1", [TRACE_TEST_USER_ID]);
}

after(async () => {
  await cleanTraceRows();
  if (tracePool) await tracePool.end();
});

/**
 * handler 侧 trace 写入是 fire-and-forget（workbench-chat-stream.handler.ts 未
 * await recordWorkbenchTurnTrace，外层 try/catch 也接不住它的 rejection）：
 * JSON 时代靠 microtask 顺序恰好读到，切 PG 后走真实 I/O、必须等落库。
 * 故轮询到出现行为止；超时则原样返回，让调用处的 total 断言照常判红——
 * 等待不弱化断言，只把「最终必须写入」这层不变量显式化。
 */
async function queryOwnTraces(ownerUserId: string) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = await queryTraces({ ownerUserId });
    if (result.total > 0 || Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// S2b-1（2026-08-27）：三个 homeWorkbenchChatStream 完整流程用例在九开关全开时
// 内部创建会话（title 取用户消息首句「请基于附件总结风险」）写入 PG，用例级 finally 定向清理。
async function cleanupTestStreamSessions(): Promise<void> {
  const user: AuthUser = {
    id: TRACE_TEST_USER_ID,
    username: "tester",
    passwordHash: "test-hash",
    role: "user",
    businessRole: "pre_sales",
    status: "active",
    createdAt: "2026-08-08T00:00:00.000Z",
    lastLoginAt: "2026-08-08T00:00:00.000Z",
  };
  for (const session of await listAiSessions(user)) {
    if (session.title === "请基于附件总结风险") await deleteAiSession(user, session.sessionId);
  }
}

async function withChatServiceIsolation(run: () => Promise<void>) {
  const previousApiKey = config.kimi.apiKey;
  // C10（2026-08-25）：chat.service 用例以 session 文件快照 / trace 文件断言，
  // 假定 ai-sessions 与 trace 走 JSON 实现；全局开关全开（PG）时写入 PG、断言读 JSON，
  // 断言失效。显式隔离到 JSON 实现。
  // S2b-1/S2b-2：ai-sessions JSON 路径已删除，session 文件快照/还原随之移除
  // （用例经 repository 单例读写，after 按测试用户清理）。
  // S3（2026-08-30）：trace JSON 路径同样删除，原 WES_TRACE_STORE_PATH 注入 +
  // `delete WES_STORE_TRACES_PG` 的 JSON 隔离钩子随之移除，改为 PG 数据集隔离
  // （cleanTraceRows 按独占 owner 定向清理）。
  const providersBefore = defaultProviderRegistry.list();
  const defaultBefore = defaultProviderRegistry.getDefault()?.name;

  config.kimi.apiKey = "unit-test-kimi-key";
  await cleanTraceRows();

  try {
    await run();
  } finally {
    config.kimi.apiKey = previousApiKey;

    defaultProviderRegistry.clear();
    for (const provider of providersBefore) {
      defaultProviderRegistry.register(provider, { asDefault: provider.name === defaultBefore });
    }

    await cleanTraceRows();
  }
}

function registerFakeKimiProvider(options: {
  stream?: () => AsyncIterable<{ contentDelta: string; model?: string; finishReason?: string }>;
  chatAnswer?: string;
}) {
  const provider: ModelProvider = {
    name: "kimi",
    defaultModel: "kimi-test",
    isAvailable: () => true,
    chatCompletion: async () => ({
      content: options.chatAnswer || "模型分类兜底",
      rawContent: options.chatAnswer || "模型分类兜底",
      model: "kimi-test",
      provider: "kimi",
      attempts: 1,
      finishReason: "stop",
    }),
    streamChatCompletion: options.stream
      ? async function* () {
        for await (const chunk of options.stream!()) {
          yield {
            contentDelta: chunk.contentDelta,
            content: chunk.contentDelta,
            model: chunk.model || "kimi-test",
            provider: "kimi",
            attempts: 1,
            finishReason: chunk.finishReason,
          };
        }
      }
      : undefined,
  };
  defaultProviderRegistry.clear();
  defaultProviderRegistry.register(provider, { asDefault: true });
}

test("homeWorkbenchChatStream: 空消息列表发送 error 事件", async () => {
  const { req, res, getSseEvents } = createMockReqRes({
    body: { messages: [] },
  });

  await homeWorkbenchChatStream(req, res);

  const events = getSseEvents();
  assert.ok(events.length >= 1, "should have at least one event");
  assert.equal(events[0].event, "error");
  assert.equal((events[0].data as Record<string, unknown>).code, "messages_required");
});

test("homeWorkbenchChatStream: 缺少用户消息发送 error 事件", async () => {
  const { req, res, getSseEvents } = createMockReqRes({
    body: { messages: [{ role: "assistant", content: "hi" }] },
  });

  await homeWorkbenchChatStream(req, res);

  const events = getSseEvents();
  assert.ok(events.length >= 1);
  assert.equal(events[0].event, "error");
  assert.equal((events[0].data as Record<string, unknown>).code, "user_message_required");
});

test("homeWorkbenchChatStream: 未认证用户不崩溃", async () => {
  const req = new PassThrough() as unknown as Request;
  req.body = { messages: [{ role: "user", content: "test" }] };
  // 不设置 user 属性，并且 header 返回空（模拟未登录）
  (req as unknown as Record<string, unknown>).user = undefined;
  req.on = PassThrough.prototype.on.bind(req) as unknown as Request["on"];
  (req as unknown as Record<string, unknown>).header = () => undefined;

  let ended = false;
  const res = {
    setHeader: () => {},
    flushHeaders: () => {},
    write: () => true,
    end: () => { ended = true; },
    status: () => res,
    json: () => {},
  } as unknown as Response;

  // 应该直接返回，不抛出异常
  await homeWorkbenchChatStream(req, res);
});

test("homeWorkbenchChatStream: SSE 头信息正确设置", async () => {
  const headers: Record<string, string> = {};
  const req = new PassThrough() as unknown as Request;
  req.body = { messages: [] };
  (req as unknown as Record<string, unknown>).user = { id: "u1", username: "test", role: "user", businessRole: "pre_sales", status: "active" };
  req.on = PassThrough.prototype.on.bind(req) as unknown as Request["on"];

  const res = {
    setHeader: (key: string, value: string) => { headers[key] = value; },
    flushHeaders: () => {},
    write: () => true,
    end: () => {},
    status: () => res,
    json: () => {},
  } as unknown as Response;

  await homeWorkbenchChatStream(req, res);

  assert.equal(headers["Content-Type"], "text/event-stream");
  assert.equal(headers["Cache-Control"], "no-cache");
  assert.equal(headers["Connection"], "keep-alive");
});

test("homeWorkbenchChatStream: dispatch 流式成功后发送 delta/done 并写入 PG trace 表", { skip: !testDatabaseUrl }, async () => {
  await withChatServiceIsolation(async () => {
    try {
    registerFakeKimiProvider({
      stream: async function* () {
        yield { contentDelta: "第一段", model: "kimi-test" };
        yield { contentDelta: "第二段", model: "kimi-test", finishReason: "stop" };
      },
    });

    const { req, res, getSseEvents } = createMockReqRes({
      body: {
        workflowKey: "free_chat",
        messages: [{
          role: "user",
          content: "请基于附件总结风险",
          attachments: [{ name: "risk.xlsx", parsedSummary: "项目：风险项目\n业务需求：\n1. 风险识别" }],
        }],
      },
    });

    await homeWorkbenchChatStream(req, res);

    const events = getSseEvents();
    assert.deepEqual(events.map((event) => event.event), ["delta", "delta", "done"]);
    assert.equal((events[2].data as Record<string, unknown>).content, "第一段第二段");

    const traces = await queryOwnTraces(TRACE_TEST_USER_ID);
    assert.equal(traces.total, 1);
    assert.equal(traces.traces[0].summary.hasError, false);
    assert.equal(traces.traces[0].spans.some((span) => span.spanType === "model_call"), true);
    } finally {
      await cleanupTestStreamSessions();
    }
  });
});

test("homeWorkbenchChatStream: provider stream 失败时发送 error 并写 failed trace", { skip: !testDatabaseUrl }, async () => {
  await withChatServiceIsolation(async () => {
    try {
    registerFakeKimiProvider({
      // 非生成器形式：首次拉取即抛错（async generator 无 yield 会触发 require-yield）
      stream: () => ({
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error("upstream_stream_failed");
            },
          };
        },
      }),
    });

    const { req, res, getSseEvents } = createMockReqRes({
      body: {
        workflowKey: "free_chat",
        messages: [{
          role: "user",
          content: "请基于附件总结风险",
          attachments: [{ name: "risk.xlsx", parsedSummary: "项目：风险项目\n业务需求：\n1. 风险识别" }],
        }],
      },
    });

    await homeWorkbenchChatStream(req, res);

    const events = getSseEvents();
    assert.equal(events.some((event) => event.event === "error"), true);
    const traces = await queryOwnTraces(TRACE_TEST_USER_ID);
    assert.equal(traces.total, 1);
    assert.equal(traces.traces[0].summary.hasError, true);
    assert.equal(traces.traces[0].spans[0].error?.code, "upstream_stream_failed");
    } finally {
      await cleanupTestStreamSessions();
    }
  });
});

test("homeWorkbenchChatStream: client close 后不发送 done，并写 cancelled trace", { skip: !testDatabaseUrl }, async () => {
  await withChatServiceIsolation(async () => {
    try {
    const { req, res, getSseEvents } = createMockReqRes({
      body: {
        workflowKey: "free_chat",
        messages: [{
          role: "user",
          content: "请基于附件总结风险",
          attachments: [{ name: "risk.xlsx", parsedSummary: "项目：风险项目\n业务需求：\n1. 风险识别" }],
        }],
      },
    });
    registerFakeKimiProvider({
      stream: async function* () {
        yield { contentDelta: "第一段", model: "kimi-test" };
        req.emit("close");
        yield { contentDelta: "第二段", model: "kimi-test", finishReason: "stop" };
      },
    });

    await homeWorkbenchChatStream(req, res);

    const events = getSseEvents();
    assert.deepEqual(events.map((event) => event.event), ["delta"]);
    const traces = await queryOwnTraces(TRACE_TEST_USER_ID);
    assert.equal(traces.total, 1);
    assert.equal(traces.traces[0].summary.hasError, true);
    assert.equal(traces.traces[0].spans[0].error?.code, "client_aborted");
    } finally {
      await cleanupTestStreamSessions();
    }
  });
});

test("resolveWorkbenchStreamFinalContent: 流式最终内容以 dispatch answer 为准", () => {
  const result = resolveWorkbenchStreamFinalContent("知识库参考\n\n---\n\n第一段第二段", [
    { contentDelta: "第一段" },
    { contentDelta: "第二段" },
  ]);

  assert.equal(result.hasStreaming, true);
  assert.equal(result.content, "知识库参考\n\n---\n\n第一段第二段");
});

// ─── ISS-2026-08-08-001: 流式显式报告闸门与会话附件回退对齐 ───────────────────────────

test("homeWorkbenchChatStream: 显式报告请求回退会话附件后直接生成报告（与非流式对齐）", { skip: !testDatabaseUrl }, async () => {
  await withChatServiceIsolation(async () => {
    registerFakeKimiProvider({
      chatAnswer: JSON.stringify({
        answer: "已完成 AI 深度需求分析，并生成《需求解析报告 v1》。",
        projectName: "流式回退项目",
        customerName: "流式回退客户",
        industry: "制造业",
        needs: ["存量需求一"],
        modules: ["财务云 / 总账"],
        missingItems: ["实施组织范围"],
        risks: ["范围未锁定"],
        nextActions: ["补充项目信息"],
      }),
    });

    const streamUser: AuthUser = {
      id: TRACE_TEST_USER_ID,
      username: "tester",
      passwordHash: "test-hash",
      role: "user",
      businessRole: "pre_sales",
      status: "active",
      createdAt: "2026-08-08T00:00:00.000Z",
      lastLoginAt: "2026-08-08T00:00:00.000Z",
    };
    const session = await createAiSession(streamUser, { title: "流式存量附件会话", workflowKey: "parse_requirement_file" });
    try {
    await appendAiSessionEvent(streamUser, session.sessionId, {
      message: { role: "user", content: "帮我看看这个文件" },
      attachments: [{
        name: "流式存量需求.xlsx",
        parsedSummary: "项目：流式回退项目\n客户：流式回退客户\n行业：制造业\n业务需求：\n1. 存量需求一",
      }],
    });

    const { req, res, getSseEvents } = createMockReqRes({
      body: {
        sessionId: session.sessionId,
        workflowKey: "parse_requirement_file",
        // 显式报告请求，但请求级消息不携带附件
        messages: [{ role: "user", content: "请基于当前附件生成需求解析报告" }],
      },
    });

    await homeWorkbenchChatStream(req, res);

    const events = getSseEvents();
    const done = events.find((event) => event.event === "done");
    assert.ok(done, "应发送 done 事件并携带报告结果");
    const doneData = done.data as {
      content?: string;
      intent?: string;
      session?: { artifacts?: Array<{ type?: string; title?: string }> };
    };
    assert.equal(doneData.intent, "harness_report_generation");
    assert.match(doneData.content || "", /AI 深度需求分析/);
    assert.ok(
      (doneData.session?.artifacts || []).some((artifact) => artifact.type === "requirement_analysis_report"),
      "done 事件的 session 应包含 requirement_analysis_report artifact",
    );
    const allPayload = JSON.stringify(events);
    assert.ok(!allPayload.includes("请上传需求文件"), "会话已有附件时不应再出现上传引导文案");
    } finally {
      await deleteAiSession(streamUser, session.sessionId);
    }
  });
});
