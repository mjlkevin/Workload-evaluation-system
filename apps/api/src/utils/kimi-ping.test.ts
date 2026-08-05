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

test("pingKimiChatCompletion: 上游挂起时在限期內中止并抛 timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      if (!signal) return;
      if (signal.aborted) reject(new DOMException("aborted", "AbortError"));
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });

  try {
    const startedAt = Date.now();
    await assert.rejects(
      () =>
        pingKimiChatCompletion({
          apiUrl: "https://api.moonshot.cn/v1",
          apiKey: "test-key",
          model: "kimi-k3",
          timeoutMs: 300,
        }),
      (err) => {
        assert.ok(err instanceof KimiPingFailure);
        assert.equal(err.kind, "timeout");
        return true;
      },
    );
    assert.ok(Date.now() - startedAt < 3000, "应由超时切断，而非无限挂起");
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
