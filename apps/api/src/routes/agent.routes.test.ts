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

test("POST /agent/chat: 请求体 confirm 不再被当作批准——写工具在本通道失败关闭", { skip: !testDatabaseUrl }, async () => {
  // 批次 6b 返修（③）：本通道没有可持久化的审批闸门，过去靠 req.body.confirm 一个布尔
  // 一刀切批准本轮全部待确认调用。现在该字段不再被读取：ask 档工具一律不执行。
  const token = createTokenForUser(await createTempUser({ role: "admin" }));
  const res = await supertest(
    miniApp(
      fakeRunner([
        { toolCalls: [{ id: "call_1", name: "create_project", arguments: { projectName: "越权建项目" } }] },
        { content: "该操作未执行" },
      ]),
    ),
  )
    .post("/agent/chat")
    .set("Authorization", `Bearer ${token}`)
    .send({ message: "建个项目", confirm: true });

  assert.equal(res.status, 200);
  const events = res.body.data.events as Array<{ type: string; name?: string; ok?: boolean; error?: string }>;
  assert.ok(
    !events.some((event) => event.type === "tool_started" && event.name === "create_project"),
    `带 confirm:true 的请求体不得换来写工具执行：${JSON.stringify(events)}`,
  );
  const refusal = events.find((event) => event.type === "tool_finished" && event.name === "create_project");
  assert.ok(refusal, "必须回填一条该工具的失败结果，否则模型会以为已执行");
  assert.equal(refusal.ok, false);
  assert.match(refusal.error ?? "", /未经发现|没有审批链路|停用|不可见/, "失败原因必须说清是哪道闸门挡下的");
  assert.equal(res.body.data.result, "该操作未执行");
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
