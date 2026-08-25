// ============================================================
// ISS-2026-08-08-001：会话附件 parsedSummary 持久化测试
// ① appendAiSessionEvent 持久化 parsedSummary
// ② 超 8000 字符截断并加 "…[truncated]" 标记
// ③ 无 parsedSummary 的旧载荷读取兼容（缺省 undefined，无迁移脚本）
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { AuthUser } from "../../types";
import { aiSessionsStorePath } from "../../utils";
import { _resetAiSessionsRepositoryForTest } from "./ai-sessions.repository";
import { appendAiSessionEvent, createAiSession, getAiSession, listAllAiSessionsForAdmin } from "./ai-sessions.usecase";

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
  // 通过 WES_AI_SESSIONS_STORE_PATH 指向临时文件，避免读写真实 data/ai-sessions.json；
  // C10（2026-08-25）：同时显式切到 JSON 实现（delete 开关 + 重置单例），
  // 否则全局开关全开（PG）时 usecase 走 PG、readStoredSession 却直读 JSON 文件，断言失效。
  const previousOverride = process.env.WES_AI_SESSIONS_STORE_PATH;
  const previousPgFlag = process.env.WES_STORE_AI_SESSIONS_PG;
  const tempPath = join(tmpdir(), `wes-ai-sessions-test-${randomUUID()}.json`);
  process.env.WES_AI_SESSIONS_STORE_PATH = tempPath;
  delete process.env.WES_STORE_AI_SESSIONS_PG;
  _resetAiSessionsRepositoryForTest();
  try {
    await run();
  } finally {
    if (previousOverride === undefined) delete process.env.WES_AI_SESSIONS_STORE_PATH;
    else process.env.WES_AI_SESSIONS_STORE_PATH = previousOverride;
    if (previousPgFlag === undefined) delete process.env.WES_STORE_AI_SESSIONS_PG;
    else process.env.WES_STORE_AI_SESSIONS_PG = previousPgFlag;
    _resetAiSessionsRepositoryForTest();
    if (existsSync(tempPath)) rmSync(tempPath, { force: true });
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
    const session = await createAiSession(testUser, { title: "附件会话", workflowKey: "parse_requirement_file" });
    const summary = "项目：存量项目\n客户：存量客户\n业务需求：\n1. 存量需求";
    await appendAiSessionEvent(testUser, session.sessionId, {
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
    const session = await createAiSession(testUser, { title: "超长摘要会话", workflowKey: "parse_requirement_file" });
    const longSummary = "需".repeat(9000);
    await appendAiSessionEvent(testUser, session.sessionId, {
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

test("ai-sessions.usecase: listAllAiSessionsForAdmin 跨用户聚合并输出审计摘要", async () => {
  await withSessionStoreIsolation(async () => {
    const alice = await createAiSession(testUser, { title: "Alice 业务评估", status: "rough_estimate" });
    await appendAiSessionEvent(testUser, alice.sessionId, {
      message: { role: "user", content: "首轮输入内容" },
    });
    await appendAiSessionEvent(testUser, alice.sessionId, {
      message: { role: "assistant", content: "最终输出内容" },
    });
    const bobUser: AuthUser = { ...testUser, id: "user-bob-audit", username: "bob" };
    await createAiSession(bobUser, { title: "Bob 标准治理", domain: "standard_governance", status: "standard_review" });

    const items = await listAllAiSessionsForAdmin({});
    assert.equal(items.length, 2, "应聚合所有用户的会话");

    const aliceSummary = items.find((item) => item.sessionId === alice.sessionId);
    assert.ok(aliceSummary, "应包含 Alice 的会话");
    assert.equal(aliceSummary.ownerUsername, testUser.username);
    assert.equal(aliceSummary.ownerUserId, testUser.id);
    assert.equal(aliceSummary.domain, "business_evaluation");
    assert.equal(aliceSummary.status, "rough_estimate");
    assert.equal(aliceSummary.turnCount, 1, "轮次应统计 user 消息数");
    assert.equal(aliceSummary.messageCount, 2);
    assert.equal(aliceSummary.firstUserMessage, "首轮输入内容");
    assert.equal(aliceSummary.lastAssistantMessage, "最终输出内容");
    assert.equal("messages" in aliceSummary, false, "审计摘要不得携带消息原文数组");
  });
});

test("ai-sessions.usecase: listAllAiSessionsForAdmin 支持 q/status/domain/时间范围过滤并按最后活动倒序", async () => {
  await withSessionStoreIsolation(async () => {
    const bobUser: AuthUser = { ...testUser, id: "user-bob-filter", username: "bob" };
    const older = await createAiSession(testUser, { title: "金蝶云星空评估会话", status: "temporary_chat" });
    const newer = await createAiSession(bobUser, { title: "标准治理会话", domain: "standard_governance", status: "standard_review" });
    // 让 older 会话的最后活动晚于 newer，验证排序依据为 updatedAt（跨毫秒确保时间戳差异）
    await new Promise((resolve) => setTimeout(resolve, 5));
    await appendAiSessionEvent(testUser, older.sessionId, {
      message: { role: "user", content: "追加一轮" },
    });

    const all = await listAllAiSessionsForAdmin({});
    assert.equal(all.length, 2);
    assert.equal(all[0].sessionId, older.sessionId, "应按 updatedAt 倒序");

    const byStatus = await listAllAiSessionsForAdmin({ status: "standard_review" });
    assert.equal(byStatus.length, 1);
    assert.equal(byStatus[0].sessionId, newer.sessionId);

    const byDomain = await listAllAiSessionsForAdmin({ domain: "standard_governance" });
    assert.equal(byDomain.length, 1);
    assert.equal(byDomain[0].sessionId, newer.sessionId);

    const byUsername = await listAllAiSessionsForAdmin({ q: "BOB" });
    assert.equal(byUsername.length, 1, "q 应大小写不敏感匹配用户名");
    assert.equal(byUsername[0].sessionId, newer.sessionId);

    const byTitle = await listAllAiSessionsForAdmin({ q: "星空" });
    assert.equal(byTitle.length, 1, "q 应匹配标题");
    assert.equal(byTitle[0].sessionId, older.sessionId);

    const bySessionId = await listAllAiSessionsForAdmin({ q: newer.sessionId.slice(0, 8) });
    assert.equal(bySessionId.length, 1, "q 应匹配会话ID");

    const fromFuture = await listAllAiSessionsForAdmin({ from: "2099-01-01" });
    assert.equal(fromFuture.length, 0, "from 晚于全部活动时应无结果");
    const toFuture = await listAllAiSessionsForAdmin({ to: "2099-01-01" });
    assert.equal(toFuture.length, 2, "to 为日期时应包含当天及之前全部记录");

    const limited = await listAllAiSessionsForAdmin({ limit: 1 });
    assert.equal(limited.length, 1, "limit 应生效");
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

    const session = await getAiSession(testUser, "legacy-attachment-session");
    assert.ok(session, "旧格式会话应可读取");
    assert.equal(session.attachments[0].parsedSummary, undefined, "旧数据缺省 parsedSummary 应为 undefined");

    // 旧会话继续追加事件不报错，且不影响既有附件
    const updated = await appendAiSessionEvent(testUser, "legacy-attachment-session", {
      message: { role: "user", content: "继续追问" },
    });
    assert.ok(updated, "旧会话应可继续追加事件");
    assert.equal(updated.messages.length, 2);
    assert.equal(updated.attachments[0].parsedSummary, undefined);
  });
});
