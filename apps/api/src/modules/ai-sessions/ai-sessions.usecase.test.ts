// ============================================================
// ISS-2026-08-08-001：会话附件 parsedSummary 持久化测试
// ① appendAiSessionEvent 持久化 parsedSummary
// ② 超 8000 字符截断并加 "…[truncated]" 标记
// ③ 无 parsedSummary 的旧载荷读取兼容（缺省 undefined，无迁移脚本）
// ============================================================
// S2b-1（2026-08-27）：随九开关走 PG——fixture 经 createAiSession 种入、断言
// 经 getAiSession/listAllAiSessionsForAdmin 读回（同仓储单例，构造与读取
// 同源）；共享 PG 下聚合断言改为定向（find by sessionId）+ 唯一前缀 q 限定域，
// 不再依赖空库；用例 finally 按 sessionId 清理；缺失 TEST_DATABASE_URL 时
// 按 C4 诚实 skip。旧格式兼容用例迁移至 ai-sessions-pg.repository.test.ts。

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { AuthUser } from "../../types";
import { _resetAiSessionsRepositoryForTest } from "./ai-sessions.repository";
import {
  appendAiSessionEvent,
  createAiSession,
  deleteAiSession,
  getAiSession,
  listAllAiSessionsForAdmin,
} from "./ai-sessions.usecase";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

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
  // S2b-1：随全局开关走 PG，无需再指向临时 JSON 文件；重置单例确保
  // 每次按当前开关重建（与其余测试文件并发时不共享过期实例）。
  _resetAiSessionsRepositoryForTest();
  try {
    await run();
  } finally {
    _resetAiSessionsRepositoryForTest();
  }
}

test("ai-sessions.usecase: appendAiSessionEvent 持久化附件 parsedSummary 到存储", { skip: !testDatabaseUrl }, async () => {
  await withSessionStoreIsolation(async () => {
    const session = await createAiSession(testUser, { title: "附件会话", workflowKey: "parse_requirement_file" });
    try {
      const summary = "项目：存量项目\n客户：存量客户\n业务需求：\n1. 存量需求";
      await appendAiSessionEvent(testUser, session.sessionId, {
        message: { role: "user", content: "帮我看看这个文件" },
        attachments: [{ name: "存量附件.xlsx", size: 1200, type: "application/xlsx", parsedSummary: summary }],
      });

      const stored = await getAiSession(testUser, session.sessionId);
      assert.ok(stored, "会话应已落盘");
      assert.equal(stored.attachments.length, 1);
      assert.equal(stored.attachments[0].name, "存量附件.xlsx");
      assert.equal(stored.attachments[0].parsedSummary, summary);
    } finally {
      await deleteAiSession(testUser, session.sessionId);
    }
  });
});

test("ai-sessions.usecase: parsedSummary 超 8000 字符时截断并加标记", { skip: !testDatabaseUrl }, async () => {
  await withSessionStoreIsolation(async () => {
    const session = await createAiSession(testUser, { title: "超长摘要会话", workflowKey: "parse_requirement_file" });
    try {
      const longSummary = "需".repeat(9000);
      await appendAiSessionEvent(testUser, session.sessionId, {
        message: { role: "user", content: "帮我看看这个文件" },
        attachments: [{ name: "超长附件.xlsx", parsedSummary: longSummary }],
      });

      const stored = await getAiSession(testUser, session.sessionId);
      assert.ok(stored, "会话应已落盘");
      const persisted = stored.attachments[0].parsedSummary || "";
      assert.equal(persisted.length <= 8000 + "…[truncated]".length, true, "截断后长度不应显著超过上限");
      assert.ok(persisted.startsWith("需".repeat(8000)), "应保留前 8000 字符");
      assert.ok(persisted.endsWith("…[truncated]"), "截断应带 …[truncated] 标记");
      assert.ok(!persisted.includes("需".repeat(8001)), "不应保留超限内容");
    } finally {
      await deleteAiSession(testUser, session.sessionId);
    }
  });
});

test("ai-sessions.usecase: listAllAiSessionsForAdmin 跨用户聚合并输出审计摘要", { skip: !testDatabaseUrl }, async () => {
  await withSessionStoreIsolation(async () => {
    const alice = await createAiSession(testUser, { title: "Alice 业务评估", status: "rough_estimate" });
    const bobUser: AuthUser = { ...testUser, id: "user-bob-audit", username: "bob" };
    let bobSession: Awaited<ReturnType<typeof createAiSession>> | null = null;
    try {
      await appendAiSessionEvent(testUser, alice.sessionId, {
        message: { role: "user", content: "首轮输入内容" },
      });
      await appendAiSessionEvent(testUser, alice.sessionId, {
        message: { role: "assistant", content: "最终输出内容" },
      });
      bobSession = await createAiSession(bobUser, { title: "Bob 标准治理", domain: "standard_governance", status: "standard_review" });

      const items = await listAllAiSessionsForAdmin({});
      // 共享 PG 下不做空库依赖断言：按 sessionId 定向查找，仅验证跨用户聚合语义
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

      const bobSummary = items.find((item) => item.sessionId === bobSession!.sessionId);
      assert.ok(bobSummary, "应聚合其他用户的会话");
      assert.equal(bobSummary.ownerUsername, "bob");
    } finally {
      if (bobSession) await deleteAiSession(bobUser, bobSession.sessionId);
      await deleteAiSession(testUser, alice.sessionId);
    }
  });
});

test("ai-sessions.usecase: listAllAiSessionsForAdmin 支持 q/status/domain/时间范围过滤并按最后活动倒序", { skip: !testDatabaseUrl }, async () => {
  await withSessionStoreIsolation(async () => {
    // 唯一前缀 username：q 限定域，隔离共享 PG 中其他并发测试文件的数据；
    // title 带随机后缀保证 q 全文匹配唯一（length===1 不依赖空库）
    const filterUser: AuthUser = { ...testUser, id: "user-filter-owner", username: "wes-usecase-filter-owner" };
    const bobUser: AuthUser = { ...testUser, id: "user-filter-bob", username: "wes-usecase-filter-bob" };
    const uniqueTitle = `金蝶云星空评估会话-${randomUUID()}`;
    const older = await createAiSession(filterUser, { title: uniqueTitle, status: "temporary_chat" });
    const newer = await createAiSession(bobUser, { title: "标准治理会话", domain: "standard_governance", status: "standard_review" });
    try {
      // 让 older 会话的最后活动晚于 newer，验证排序依据为 updatedAt（跨毫秒确保时间戳差异）
      await new Promise((resolve) => setTimeout(resolve, 5));
      await appendAiSessionEvent(filterUser, older.sessionId, {
        message: { role: "user", content: "追加一轮" },
      });

      const all = await listAllAiSessionsForAdmin({ q: "wes-usecase-filter" });
      assert.equal(all.length, 2, "q 限定域内应聚合两会话");
      assert.equal(all[0].sessionId, older.sessionId, "应按 updatedAt 倒序");

      const byStatus = await listAllAiSessionsForAdmin({ q: "wes-usecase-filter", status: "standard_review" });
      assert.equal(byStatus.length, 1);
      assert.equal(byStatus[0].sessionId, newer.sessionId);

      const byDomain = await listAllAiSessionsForAdmin({ q: "wes-usecase-filter", domain: "standard_governance" });
      assert.equal(byDomain.length, 1);
      assert.equal(byDomain[0].sessionId, newer.sessionId);

      const byUsername = await listAllAiSessionsForAdmin({ q: "wes-usecase-filter-bob" });
      assert.equal(byUsername.length, 1, "q 应大小写不敏感匹配用户名");
      assert.equal(byUsername[0].sessionId, newer.sessionId);

      const byTitle = await listAllAiSessionsForAdmin({ q: uniqueTitle });
      assert.equal(byTitle.length, 1, "q 应匹配标题");
      assert.equal(byTitle[0].sessionId, older.sessionId);

      const bySessionId = await listAllAiSessionsForAdmin({ q: newer.sessionId.slice(0, 8) });
      assert.equal(bySessionId.length, 1, "q 应匹配会话ID");

      const fromFuture = await listAllAiSessionsForAdmin({ q: "wes-usecase-filter", from: "2099-01-01" });
      assert.equal(fromFuture.length, 0, "from 晚于全部活动时应无结果");
      const toFuture = await listAllAiSessionsForAdmin({ q: "wes-usecase-filter", to: "2099-01-01" });
      assert.equal(toFuture.length, 2, "to 为日期时应包含当天及之前全部记录");

      const limited = await listAllAiSessionsForAdmin({ q: "wes-usecase-filter", limit: 1 });
      assert.equal(limited.length, 1, "limit 应生效");
    } finally {
      await deleteAiSession(bobUser, newer.sessionId);
      await deleteAiSession(filterUser, older.sessionId);
    }
  });
});

// S2b-1：旧格式兼容用例（原 writeFileSync 直写 JSON）已删除——职责迁移至
// ai-sessions-pg.repository.test.ts（seedSession 种旧格式 jsonb +
// findSession/appendSessionEvent 断言，随九开关走 PG 同源验证）。

