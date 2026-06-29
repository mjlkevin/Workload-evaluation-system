import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import { config } from "../../config/env";
import { defaultProviderRegistry, type ModelProvider } from "../../ai/provider";
import { aiSessionsStorePath } from "../../utils";
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
      id: "test-user-1",
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

const TEST_TRACE_STORE_DIR = join(process.cwd(), "data", "chat-service-traces-test");
const TEST_TRACE_STORE_PATH = join(TEST_TRACE_STORE_DIR, "trace-store.json");

async function withChatServiceIsolation(run: () => Promise<void>) {
  const previousTraceStore = process.env.WES_TRACE_STORE_PATH;
  const previousApiKey = config.kimi.apiKey;
  const sessionPath = aiSessionsStorePath();
  const sessionExisted = existsSync(sessionPath);
  const sessionBefore = sessionExisted ? readFileSync(sessionPath, "utf-8") : "";
  const providersBefore = defaultProviderRegistry.list();
  const defaultBefore = defaultProviderRegistry.getDefault()?.name;

  rmSync(TEST_TRACE_STORE_DIR, { recursive: true, force: true });
  mkdirSync(TEST_TRACE_STORE_DIR, { recursive: true });
  process.env.WES_TRACE_STORE_PATH = TEST_TRACE_STORE_PATH;
  config.kimi.apiKey = "unit-test-kimi-key";

  try {
    await run();
  } finally {
    if (previousTraceStore === undefined) delete process.env.WES_TRACE_STORE_PATH;
    else process.env.WES_TRACE_STORE_PATH = previousTraceStore;
    config.kimi.apiKey = previousApiKey;

    defaultProviderRegistry.clear();
    for (const provider of providersBefore) {
      defaultProviderRegistry.register(provider, { asDefault: provider.name === defaultBefore });
    }

    if (sessionExisted) {
      writeFileSync(sessionPath, sessionBefore, "utf-8");
    } else if (existsSync(sessionPath)) {
      rmSync(sessionPath, { force: true });
    }
    rmSync(TEST_TRACE_STORE_DIR, { recursive: true, force: true });
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

test("homeWorkbenchChatStream: dispatch 流式成功后发送 delta/done 并写入隔离 trace store", async () => {
  await withChatServiceIsolation(async () => {
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

    const traces = queryTraces({ ownerUserId: "test-user-1" }, TEST_TRACE_STORE_PATH);
    assert.equal(traces.total, 1);
    assert.equal(traces.traces[0].summary.hasError, false);
    assert.equal(traces.traces[0].spans.some((span) => span.spanType === "model_call"), true);
  });
});

test("homeWorkbenchChatStream: provider stream 失败时发送 error 并写 failed trace", async () => {
  await withChatServiceIsolation(async () => {
    registerFakeKimiProvider({
      stream: async function* () {
        throw new Error("upstream_stream_failed");
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
    assert.equal(events.some((event) => event.event === "error"), true);
    const traces = queryTraces({ ownerUserId: "test-user-1" }, TEST_TRACE_STORE_PATH);
    assert.equal(traces.total, 1);
    assert.equal(traces.traces[0].summary.hasError, true);
    assert.equal(traces.traces[0].spans[0].error?.code, "upstream_stream_failed");
  });
});

test("homeWorkbenchChatStream: client close 后不发送 done，并写 cancelled trace", async () => {
  await withChatServiceIsolation(async () => {
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
    const traces = queryTraces({ ownerUserId: "test-user-1" }, TEST_TRACE_STORE_PATH);
    assert.equal(traces.total, 1);
    assert.equal(traces.traces[0].summary.hasError, true);
    assert.equal(traces.traces[0].spans[0].error?.code, "client_aborted");
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
