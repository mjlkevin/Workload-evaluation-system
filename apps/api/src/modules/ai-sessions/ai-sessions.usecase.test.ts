// ============================================================
// ISS-2026-08-08-001：会话附件 parsedSummary 持久化测试
// ① appendAiSessionEvent 持久化 parsedSummary
// ② 超 8000 字符截断并加 "…[truncated]" 标记
// ③ 无 parsedSummary 的旧载荷读取兼容（缺省 undefined，无迁移脚本）
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";

import type { AuthUser } from "../../types";
import { aiSessionsStorePath } from "../../utils";
import { appendAiSessionEvent, createAiSession, getAiSession } from "./ai-sessions.usecase";

const testUser: AuthUser = {
  id: "user-attachment-summary-test",
  username: "attachment-summary-tester",
  passwordHash: "test-hash",
  role: "user",
  businessRole: "pre_sales",
  status: "active",
  createdAt: "2026-08-08T00:00:00.000Z",
  lastLoginAt: "2026-08-08T00:00:00.000Z",
};

async function withSessionStoreIsolation(run: () => Promise<void>): Promise<void> {
  const storePath = aiSessionsStorePath();
  const existed = existsSync(storePath);
  const before = existed ? readFileSync(storePath, "utf-8") : "";
  try {
    await run();
  } finally {
    if (existed) writeFileSync(storePath, before, "utf-8");
    else if (existsSync(storePath)) rmSync(storePath, { force: true });
  }
}

function readStoredSession(sessionId: string): { attachments: Array<{ name: string; parsedSummary?: string }> } | undefined {
  const raw = JSON.parse(readFileSync(aiSessionsStorePath(), "utf-8")) as {
    sessions: Array<{ sessionId: string; attachments: Array<{ name: string; parsedSummary?: string }> }>;
  };
  return raw.sessions.find((session) => session.sessionId === sessionId);
}

test("ai-sessions.usecase: appendAiSessionEvent 持久化附件 parsedSummary 到存储文件", async () => {
  await withSessionStoreIsolation(async () => {
    const session = createAiSession(testUser, { title: "附件会话", workflowKey: "parse_requirement_file" });
    const summary = "项目：存量项目\n客户：存量客户\n业务需求：\n1. 存量需求";
    appendAiSessionEvent(testUser, session.sessionId, {
      message: { role: "user", content: "帮我看看这个文件" },
      attachments: [{ name: "存量附件.xlsx", size: 1200, type: "application/xlsx", parsedSummary: summary }],
    });

    const stored = readStoredSession(session.sessionId);
    assert.ok(stored, "会话应已落盘");
    assert.equal(stored.attachments.length, 1);
    assert.equal(stored.attachments[0].name, "存量附件.xlsx");
    assert.equal(stored.attachments[0].parsedSummary, summary);
  });
});

test("ai-sessions.usecase: parsedSummary 超 8000 字符时截断并加标记", async () => {
  await withSessionStoreIsolation(async () => {
    const session = createAiSession(testUser, { title: "超长摘要会话", workflowKey: "parse_requirement_file" });
    const longSummary = "需".repeat(9000);
    appendAiSessionEvent(testUser, session.sessionId, {
      message: { role: "user", content: "帮我看看这个文件" },
      attachments: [{ name: "超长附件.xlsx", parsedSummary: longSummary }],
    });

    const stored = readStoredSession(session.sessionId);
    assert.ok(stored, "会话应已落盘");
    const persisted = stored.attachments[0].parsedSummary || "";
    assert.equal(persisted.length <= 8000 + "…[truncated]".length, true, "截断后长度不应显著超过上限");
    assert.ok(persisted.startsWith("需".repeat(8000)), "应保留前 8000 字符");
    assert.ok(persisted.endsWith("…[truncated]"), "截断应带 …[truncated] 标记");
    assert.ok(!persisted.includes("需".repeat(8001)), "不应保留超限内容");
  });
});

test("ai-sessions.usecase: 缺失 parsedSummary 的旧附件数据读取兼容", async () => {
  await withSessionStoreIsolation(async () => {
    const nowIso = "2026-08-08T00:00:00.000Z";
    // 直接写入旧格式存储：附件只有 name/size/type/createdAt
    writeFileSync(aiSessionsStorePath(), JSON.stringify({
      sessions: [{
        sessionId: "legacy-attachment-session",
        ownerUserId: testUser.id,
        ownerUsername: testUser.username,
        title: "旧格式会话",
        domain: "business_evaluation",
        workflowKey: "parse_requirement_file",
        businessRole: "pre_sales",
        status: "rough_estimate",
        summary: "",
        messages: [{ messageId: "m-legacy", role: "user", content: "帮我看看这个文件", createdAt: nowIso, attachmentIds: ["att-legacy"] }],
        attachments: [{ attachmentId: "att-legacy", name: "旧附件.xlsx", size: 800, type: "application/xlsx", createdAt: nowIso }],
        artifacts: [],
        pendingActions: [],
        linkedRecords: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      }],
    }), "utf-8");

    const session = getAiSession(testUser, "legacy-attachment-session");
    assert.ok(session, "旧格式会话应可读取");
    assert.equal(session.attachments[0].parsedSummary, undefined, "旧数据缺省 parsedSummary 应为 undefined");

    // 旧会话继续追加事件不报错，且不影响既有附件
    const updated = appendAiSessionEvent(testUser, "legacy-attachment-session", {
      message: { role: "user", content: "继续追问" },
    });
    assert.ok(updated, "旧会话应可继续追加事件");
    assert.equal(updated.messages.length, 2);
    assert.equal(updated.attachments[0].parsedSummary, undefined);
  });
});
