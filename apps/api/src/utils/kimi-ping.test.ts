import test from "node:test";
import assert from "node:assert/strict";

import { KimiPingFailure, pingKimiChatCompletion } from "./kimi-ping";

test("pingKimiChatCompletion: K2 模型不发送 temperature，使用 max_completion_tokens", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };

  try {
    await pingKimiChatCompletion({
      apiUrl: "https://api.moonshot.cn/v1",
      apiKey: "test-key",
      model: "kimi-k2.5",
    });

    assert.equal(capturedBody?.temperature, undefined);
    assert.equal(capturedBody?.max_tokens, undefined);
    assert.equal(capturedBody?.max_completion_tokens, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pingKimiChatCompletion: 余额不足分类为 quota_exceeded", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "账户余额不足，请充值" } }), { status: 429 });

  try {
    await assert.rejects(
      () =>
        pingKimiChatCompletion({
          apiUrl: "https://api.moonshot.cn/v1",
          apiKey: "test-key",
          model: "kimi-k2.5",
        }),
      (err) => {
        assert.ok(err instanceof KimiPingFailure);
        assert.equal(err.kind, "quota_exceeded");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
