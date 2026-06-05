import test from "node:test";
import assert from "node:assert/strict";

import { parseChoiceMessage } from "./kimi-provider";

test("parseChoiceMessage: 解析普通文本回复", () => {
  const r = parseChoiceMessage({
    message: { content: "你好" },
    finish_reason: "stop",
  });
  assert.equal(r.content, "你好");
  assert.equal(r.toolCalls, undefined);
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
