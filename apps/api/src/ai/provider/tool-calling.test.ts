import test from "node:test";
import assert from "node:assert/strict";

import { KimiProvider, parseChoiceMessage } from "./kimi-provider";
import { ProviderError } from "./errors";

test("parseChoiceMessage: 解析普通文本回复", () => {
  const r = parseChoiceMessage({
    message: { content: "你好" },
    finish_reason: "stop",
  });
  assert.equal(r.content, "你好");
  assert.equal(r.toolCalls, undefined);
  assert.equal(r.finishReason, "stop");
});

test("parseChoiceMessage: 解析 tool_calls（content 可空）", () => {
  const r = parseChoiceMessage({
    message: {
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "estimate_implementation", arguments: '{"packId":"RI-1"}' } },
      ],
    },
    finish_reason: "tool_calls",
  });
  assert.equal(r.content, "");
  assert.deepEqual(r.toolCalls, [{ id: "call_1", name: "estimate_implementation", arguments: { packId: "RI-1" } }]);
});

test("parseChoiceMessage: arguments 非法 JSON 兜底为空对象", () => {
  const r = parseChoiceMessage({
    message: { content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "f", arguments: "{bad" } }] },
    finish_reason: "tool_calls",
  });
  assert.deepEqual(r.toolCalls?.[0].arguments, {});
});

test("parseChoiceMessage: arguments 为 JSON 数组时兜底为空对象", () => {
  const r = parseChoiceMessage({
    message: { content: null, tool_calls: [{ id: "c3", type: "function", function: { name: "f", arguments: "[1,2,3]" } }] },
    finish_reason: "tool_calls",
  });
  assert.deepEqual(r.toolCalls?.[0].arguments, {});
});

test("KimiProvider: 请求体在 tools 非空时注入 tools 和默认 tool_choice=auto", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      }),
      { status: 200 },
    );
  };

  try {
    const provider = new KimiProvider({ apiKey: "test-key" });
    await provider.chatCompletion({
      messages: [{ role: "user", content: "估算" }],
      tools: [
        {
          type: "function",
          function: {
            name: "estimate_implementation",
            description: "估算实施工作量",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });

    assert.deepEqual(capturedBody?.tools, [
      {
        type: "function",
        function: {
          name: "estimate_implementation",
          description: "估算实施工作量",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
    assert.equal(capturedBody?.tool_choice, "auto");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KimiProvider: content 为空但 tool_calls 非空时返回 toolCalls 和 finishReason", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "estimate_implementation", arguments: '{"packId":"RI-1"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
      { status: 200 },
    );

  try {
    const provider = new KimiProvider({ apiKey: "test-key" });
    const r = await provider.chatCompletion({
      messages: [{ role: "user", content: "估算" }],
    });

    assert.equal(r.content, "");
    assert.equal(r.rawContent, "");
    assert.equal(r.finishReason, "tool_calls");
    assert.deepEqual(r.toolCalls, [
      { id: "call_1", name: "estimate_implementation", arguments: { packId: "RI-1" } },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KimiProvider: fetch timeout 会按 retryable 错误重试并返回后续成功结果", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      const timeout = new Error("operation timed out");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "retry ok" }, finish_reason: "stop" }],
      }),
      { status: 200 },
    );
  };

  try {
    const provider = new KimiProvider({ apiKey: "test-key", defaultMaxAttempts: 2 });
    const r = await provider.chatCompletion({
      messages: [{ role: "user", content: "估算" }],
      timeoutMs: 3000,
    });

    assert.equal(r.content, "retry ok");
    assert.equal(r.attempts, 2);
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KimiProvider: caller abort signal cancels the upstream request without retry", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  controller.abort();
  let receivedSignal: AbortSignal | undefined;
  let callCount = 0;
  globalThis.fetch = async (_input, init) => {
    callCount += 1;
    receivedSignal = init?.signal as AbortSignal;
    throw new DOMException("The operation was aborted.", "AbortError");
  };

  try {
    const provider = new KimiProvider({ apiKey: "test-key", defaultMaxAttempts: 3 });
    const stream = provider.streamChatCompletion({
      messages: [{ role: "user", content: "停止" }],
      abortSignal: controller.signal,
    })[Symbol.asyncIterator]();

    await assert.rejects(
      () => stream.next(),
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "request_failed");
        assert.equal(err.legacyReason, "client_aborted");
        assert.equal(err.retryable, false);
        return true;
      },
    );
    assert.equal((receivedSignal as AbortSignal | undefined)?.aborted, true);
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KimiProvider: K2 请求省略 temperature 并透传 Kimi 专属补全参数与 usage", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }),
      { status: 200 },
    );
  };

  try {
    const provider = new KimiProvider({ apiKey: "test-key" });
    const r = await provider.chatCompletion({
      model: "kimi-k2.5",
      messages: [
        { role: "assistant", content: "{", partial: true },
        { role: "user", content: "继续" },
      ],
      temperature: 0.3,
      maxCompletionTokens: 128,
      promptCacheKey: "project-rp-027",
      thinking: { type: "enabled", budget_tokens: 64 },
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "EstimateResult",
          strict: true,
          schema: { type: "object", properties: { ok: { type: "boolean" } } },
        },
      },
    });

    assert.equal(Object.prototype.hasOwnProperty.call(capturedBody ?? {}, "temperature"), false);
    assert.equal(capturedBody?.max_completion_tokens, 128);
    assert.equal(capturedBody?.prompt_cache_key, "project-rp-027");
    assert.deepEqual(capturedBody?.thinking, { type: "enabled", budget_tokens: 64 });
    assert.deepEqual((capturedBody?.messages as Array<Record<string, unknown>> | undefined)?.[0]?.partial, true);
    assert.deepEqual(r.usage, { promptTokens: 11, completionTokens: 7, totalTokens: 18 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KimiProvider: quota 类错误映射为 quota_exceeded 且不重试", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return new Response(JSON.stringify({ error: { message: "账户余额不足，请充值" } }), { status: 402 });
  };

  try {
    const provider = new KimiProvider({ apiKey: "test-key", defaultMaxAttempts: 3 });
    await assert.rejects(
      () => provider.chatCompletion({ messages: [{ role: "user", content: "估算" }] }),
      (err) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "quota_exceeded");
        assert.equal(err.retryable, false);
        return true;
      },
    );
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KimiProvider: 流式响应提取 reasoning_content 与 usage", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'data: {"choices":[{"delta":{"reasoning_content":"先判断","content":"答案"},"finish_reason":null}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}',
                "",
                "data: [DONE]",
                "",
              ].join("\n"),
            ),
          );
          controller.close();
        },
      }),
      { status: 200 },
    );

  try {
    const provider = new KimiProvider({ apiKey: "test-key" });
    const chunks = [];
    for await (const chunk of provider.streamChatCompletion({
      messages: [{ role: "user", content: "估算" }],
    })) {
      chunks.push(chunk);
    }

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].contentDelta, "答案");
    assert.equal(chunks[0].reasoningContentDelta, "先判断");
    assert.deepEqual(chunks[0].usage, { promptTokens: 3, completionTokens: 4, totalTokens: 7 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================
// Batch 0 · 异步流式路径工具调用能力（三处注入点中的 harness 站点前置）
// 缺失即静默：流式若不注入 tools，模型永远不会发起 tool_calls；
// 若不解析 delta.tool_calls，即使发起了也读不到。
// ============================================================

test("KimiProvider: 流式请求体在 tools 非空时注入 tools 与默认 tool_choice=auto", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  const encoder = new TextEncoder();
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n'),
          );
          controller.close();
        },
      }),
      { status: 200 },
    );
  };

  try {
    const provider = new KimiProvider({ apiKey: "test-key" });
    for await (const _chunk of provider.streamChatCompletion({
      messages: [{ role: "user", content: "查项目" }],
      tools: [
        {
          type: "function",
          function: {
            name: "query_project_list",
            description: "查询项目列表",
            parameters: { type: "object", properties: { keyword: { type: "string" } } },
          },
        },
      ],
    })) {
      // 冲刷流，请求体在首个 await 前已构造
    }

    assert.deepEqual(capturedBody?.tools, [
      {
        type: "function",
        function: {
          name: "query_project_list",
          description: "查询项目列表",
          parameters: { type: "object", properties: { keyword: { type: "string" } } },
        },
      },
    ]);
    assert.equal(capturedBody?.tool_choice, "auto");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KimiProvider: 流式按 index 聚合 delta.tool_calls 分片并在末 chunk 输出完整调用", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const events = [
    // 分片 1：id / name 出现在最早的分片，arguments 为空
    '{"choices":[{"index":0,"delta":{"role":"assistant","content":"","tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"query_project_list","arguments":""}}]},"finish_reason":null}]}',
    // 分片 2：arguments 续写
    '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"keyword\\":"}}]},"finish_reason":null}]}',
    // 分片 3：并行第二个调用 + 第一个调用参数收尾
    '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ERP\\"}"}},{"index":1,"id":"call_b","type":"function","function":{"name":"lookup_rule","arguments":"{}"}}]},"finish_reason":null}]}',
    // 终止分片
    '{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
  ];

  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(events.map((e) => `data: ${e}`).join("\n\n") + "\n\ndata: [DONE]\n"));
          controller.close();
        },
      }),
      { status: 200 },
    );

  try {
    const provider = new KimiProvider({ apiKey: "test-key" });
    const chunks = [];
    for await (const chunk of provider.streamChatCompletion({
      messages: [{ role: "user", content: "查项目" }],
      tools: [],
    })) {
      chunks.push(chunk);
    }

    const terminal = chunks[chunks.length - 1];
    assert.equal(terminal.finishReason, "tool_calls");
    assert.deepEqual(terminal.toolCalls, [
      { id: "call_a", name: "query_project_list", arguments: { keyword: "ERP" } },
      { id: "call_b", name: "lookup_rule", arguments: {} },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("KimiProvider: 流式无 tool_calls 时不输出 toolCalls 字段（additive 不污染普通回答）", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"普通回答"},"finish_reason":null}]}\n\n' +
                'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n',
            ),
          );
          controller.close();
        },
      }),
      { status: 200 },
    );

  try {
    const provider = new KimiProvider({ apiKey: "test-key" });
    const chunks = [];
    for await (const chunk of provider.streamChatCompletion({
      messages: [{ role: "user", content: "闲聊" }],
    })) {
      chunks.push(chunk);
    }

    assert.equal(
      chunks.every((chunk) => !("toolCalls" in chunk) || chunk.toolCalls === undefined),
      true,
    );
    assert.equal(chunks[chunks.length - 1].finishReason, "stop");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
