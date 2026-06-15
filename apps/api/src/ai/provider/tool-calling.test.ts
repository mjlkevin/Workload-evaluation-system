import test from "node:test";
import assert from "node:assert/strict";

import { KimiProvider, parseChoiceMessage } from "./kimi-provider";

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
