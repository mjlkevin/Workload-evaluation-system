import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import supertest from "supertest";

import { createAgentRouter } from "./agent.routes";
import { signAuthToken } from "../middleware/auth";
import { cleanupTestUsers, createTestUser } from "../test-helpers/test-users";
import type { AuthUser } from "../types";
import type { ChatRunner } from "../agent/orchestrator";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

after(async () => {
  if (!testDatabaseUrl) return;
  await cleanupTestUsers("wes-agent-routes");
});

test("POST /agent/chat: 未登录返回 401", { skip: !testDatabaseUrl }, async () => {
  const res = await supertest(miniApp(fakeRunner([{ content: "不会执行" }])))
    .post("/agent/chat")
    .send({ message: "你好" });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, 40101);
});

test("POST /agent/chat: 登录后返回统一 JSON 事件数组", { skip: !testDatabaseUrl }, async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const res = await supertest(
    miniApp(
      fakeRunner([
        { toolCalls: [{ id: "call_1", name: "estimate_implementation", arguments: { items: [] } }] },
        { content: "已完成初估" },
      ]),
    ),
  )
    .post("/agent/chat")
    .set("Authorization", `Bearer ${token}`)
    .send({ message: "做个初估" });

  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.equal(res.body.data.result, "已完成初估");
  assert.deepEqual(
    res.body.data.events.map((event: { type: string }) => event.type),
    ["tool_started", "tool_finished", "assistant_message"],
  );
});

test("POST /agent/chat: 事件 type 只来自白名单", { skip: !testDatabaseUrl }, async () => {
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const res = await supertest(miniApp(fakeRunner([{ content: "ok" }])))
    .post("/agent/chat")
    .set("Authorization", `Bearer ${token}`)
    .send({ message: "你好" });

  assert.equal(res.status, 200);
  const allowed = new Set([
    "assistant_message",
    "tool_started",
    "tool_finished",
    "needs_confirmation",
    "error",
  ]);
  for (const event of res.body.data.events as Array<{ type: string }>) {
    assert.equal(allowed.has(event.type), true, `unexpected event type: ${event.type}`);
  }
});

function miniApp(runner: ChatRunner) {
  const app = express();
  app.use(express.json());
  app.use("/agent", createAgentRouter({ runner }));
  return app;
}

function fakeRunner(seq: Array<{ content?: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }>): ChatRunner {
  let i = 0;
  return {
    async chatCompletion() {
      const current = seq[Math.min(i, seq.length - 1)];
      i += 1;
      return {
        content: current.content ?? "",
        rawContent: current.content ?? "",
        model: "fake",
        provider: "fake",
        attempts: 1,
        toolCalls: current.toolCalls,
      };
    },
  };
}

// S1 后注入方式：统一走 PG 测试用户池（wes-agent-routes-* 前缀），
// after 按前缀条件 DELETE；无 DB 环境整体 skip（C4 诚实 skip）。
async function createTempUser(overrides: Partial<AuthUser> = {}): Promise<AuthUser> {
  return createTestUser("wes-agent-routes", { role: overrides.role ?? "user", ...overrides });
}

function createTokenForUser(user: AuthUser): string {
  return signAuthToken(user);
}
