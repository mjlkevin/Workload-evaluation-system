// ============================================================
// Teams 域 PG 仓储测试（阶段 2 批 7 · 第 1–3 步）
// ============================================================
// 口径：按批 1–6 确立的五条硬性范式验证六张团队表的 PG 实现——
// 整存替换幂等（TRUNCATE + 全量 INSERT）、单条 UPSERT-CAS 乐观并发
// （「读版本→比较→写」下沉进一条语句）、冲突结构化返回、DB 时钟、
// 安全错误边界；外加 §4.6 测试套件模板的并发用例（同 expected 并发
// 保存恰一赢家）与缓存策略用例（不加缓存层 → 带外写入立即可见）。
// 仅读取 TEST_DATABASE_URL；缺失时按 §4.6 规则诚实报 skip。
//
// 隔离（批 3/5/6 口径）：共享测试库下多文件并发执行，全部团队行使用
// wes-t-teams-* teamId 前缀，清理为条件 DELETE（cleanupTeamRowsByPrefix）。
// store_versions.teams 为全局单行计数器：用例不依赖 version 绝对值，
// 仅断言「相对递增量」与「冲突/成功结构」，跨用例单调递增无害。
// 整存替换用例对六张团队表做 TRUNCATE——teams 六表仅本域使用
// （其余测试套件不触碰），文件内用例串行执行，无跨文件污染。

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { TeamStore } from "./team.types";
import {
  TeamStoreError,
  cleanupTeamRowsByPrefix,
  createTeamPgRepository,
  type TeamsPgRepository,
} from "./team-pg.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// 数据集隔离前缀：本文件所有团队行 teamId 均以此开头
const TEAM_PREFIX = "wes-t-teams-";

let pool: Pool | null = null;
let repo: TeamsPgRepository | null = null;

function makeStore(version: number, salt: string): TeamStore {
  const teamId = `${TEAM_PREFIX}${salt}`;
  const now = new Date().toISOString();
  const reviewId = `${teamId}-r1`;
  return {
    version,
    teams: [
      {
        teamId,
        name: `UT Team ${salt}`,
        ownerUserId: `${teamId}-owner`,
        members: [
          { userId: `${teamId}-owner`, role: "manager", joinedAt: now },
          { userId: `${teamId}-member`, role: "implementer", joinedAt: now },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    reviews: [
      {
        reviewId,
        teamId,
        globalVersionCode: `${TEAM_PREFIX}gvc-${salt}`,
        title: "UT Review",
        status: "open",
        createdBy: `${teamId}-owner`,
        createdAt: now,
        updatedAt: now,
      },
    ],
    comments: [
      {
        commentId: `${reviewId}-c1`,
        reviewId,
        authorUserId: `${teamId}-member`,
        content: "looks good",
        createdAt: now,
      },
    ],
    planBindings: [
      {
        globalVersionCode: `${TEAM_PREFIX}gvc-${salt}`,
        teamId,
        updatedAt: now,
        updatedBy: `${teamId}-owner`,
      },
    ],
    auditLogs: [
      {
        auditId: `${teamId}-a1`,
        teamId,
        actorUserId: `${teamId}-owner`,
        action: "team.create",
        targetType: "team",
        targetId: teamId,
        at: now,
      },
    ],
  };
}

async function cleanOwnRows(): Promise<void> {
  if (repo) await cleanupTeamRowsByPrefix(repo.__dbForTest(), TEAM_PREFIX);
}

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 10 });
  repo = createTeamPgRepository(drizzle(pool));
  // 清理历史残留（前次运行异常退出时 afterEach 可能未跑完）
  await cleanOwnRows();
});

beforeEach(cleanOwnRows);
afterEach(cleanOwnRows);

after(async () => {
  if (pool) await pool!.end();
});

// ─── 基础读写 ────────────────────────────────────────────────

test("loadStore 初始态：六数组为空、version 有限数", { skip: !testDatabaseUrl }, async () => {
  const store = await repo!.loadStore();
  assert.ok(Array.isArray(store.teams));
  assert.ok(Array.isArray(store.reviews));
  assert.ok(Array.isArray(store.comments));
  assert.ok(Array.isArray(store.planBindings));
  assert.ok(Array.isArray(store.auditLogs));
  assert.ok(Number.isFinite(store.version), "version 必须是有限数（空库为 0，既有数据为累计值）");
});

test("saveStoreWithExpectedVersion 成功路径：六集合全字段往返 + version 递加 1", { skip: !testDatabaseUrl }, async () => {
  const salt = randomUUID().slice(0, 8);
  const before = await repo!.loadStore();
  const input = makeStore(before.version, salt);

  const saved = await repo!.saveStoreWithExpectedVersion(input, before.version);
  assert.equal(saved.ok, true, "expected 与现行版本一致必须成功");
  if (!saved.ok) return;
  assert.equal(saved.savedVersion, before.version + 1);

  const after = await repo!.loadStore();
  assert.equal(after.version, before.version + 1);
  const team = after.teams.find((t) => t.teamId === `${TEAM_PREFIX}${salt}`);
  assert.ok(team, "团队行必须能读回");
  assert.equal(team.name, `UT Team ${salt}`);
  assert.equal(team.ownerUserId, `${TEAM_PREFIX}${salt}-owner`);
  assert.equal(team.members.length, 2, "嵌套 members 必须经 team_members 拆表往返");
  assert.deepEqual(
    team.members.map((m) => m.role).sort(),
    ["implementer", "manager"]
  );
  const review = after.reviews.find((r) => r.teamId === team.teamId);
  assert.ok(review, "reviews 行必须能读回");
  assert.equal(review.status, "open");
  assert.equal(after.comments.length >= 1, true);
  assert.ok(after.planBindings.find((b) => b.teamId === team.teamId), "planBindings 行必须能读回");
  assert.ok(after.auditLogs.find((a) => a.teamId === team.teamId), "auditLogs 行必须能读回");
});

test("同一 expected 二次保存：幂等冲突，返回现行版本", { skip: !testDatabaseUrl }, async () => {
  const salt = randomUUID().slice(0, 8);
  const before = await repo!.loadStore();
  const input = makeStore(before.version, salt);

  const first = await repo!.saveStoreWithExpectedVersion(input, before.version);
  assert.equal(first.ok, true);

  const second = await repo!.saveStoreWithExpectedVersion(input, before.version);
  assert.equal(second.ok, false, "同一 expected 重放必须冲突（CAS 恰一次生效）");
  if (!second.ok) {
    assert.equal(second.currentVersion, before.version + 1);
  }
});

test("冲突不落数据：失败保存后库内仍为旧快照", { skip: !testDatabaseUrl }, async () => {
  const salt = randomUUID().slice(0, 8);
  const before = await repo!.loadStore();
  const staleExpected = before.version - 1; // 模拟持旧版本的迟到写者
  const input = makeStore(staleExpected + 1, salt);

  const result = await repo!.saveStoreWithExpectedVersion(input, staleExpected);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.currentVersion, before.version);
  }

  const after = await repo!.loadStore();
  assert.equal(after.version, before.version, "冲突事务回滚：version 不变");
  assert.equal(after.teams.find((t) => t.teamId === `${TEAM_PREFIX}${salt}`), undefined, "冲突写不得落库");
});

test("并发同 expected 保存：恰一赢家，version 恰递加 1", { skip: !testDatabaseUrl }, async () => {
  const saltA = randomUUID().slice(0, 8);
  const saltB = randomUUID().slice(0, 8);
  const before = await repo!.loadStore();

  const [resA, resB] = await Promise.all([
    repo!.saveStoreWithExpectedVersion(makeStore(before.version, saltA), before.version),
    repo!.saveStoreWithExpectedVersion(makeStore(before.version, saltB), before.version),
  ]);

  const winners = [resA, resB].filter((r) => r.ok);
  const losers = [resA, resB].filter((r) => !r.ok);
  assert.equal(winners.length, 1, "同 expected 并发写必须恰一赢家");
  assert.equal(losers.length, 1);
  if (winners[0].ok) assert.equal(winners[0].savedVersion, before.version + 1);

  const after = await repo!.loadStore();
  assert.equal(after.version, before.version + 1, "并发收敛后 version 恰递加 1（无撕裂）");
});

test("saveStore 无校验整存：往返一致", { skip: !testDatabaseUrl }, async () => {
  const salt = randomUUID().slice(0, 8);
  const current = await repo!.loadStore();
  const input = makeStore(current.version, salt);

  await repo!.saveStore(input);

  const after = await repo!.loadStore();
  assert.ok(after.teams.find((t) => t.teamId === `${TEAM_PREFIX}${salt}`), "整存替换后数据可读回");
});

// ─── 缓存语义（不加缓存层 → 带外写入立即可见）────────────────

test("带外 SQL 写入立即可见（无缓存滞后窗口）", { skip: !testDatabaseUrl }, async () => {
  const teamId = `${TEAM_PREFIX}outofband-${randomUUID().slice(0, 8)}`;
  const now = new Date();
  await pool!.query(
    "INSERT INTO teams (team_id, name, owner_user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [teamId, "out-of-band", `${teamId}-owner`, now, now]
  );
  try {
    const store = await repo!.loadStore();
    assert.ok(store.teams.find((t) => t.teamId === teamId), "带外写入必须无 TTL 滞后可见");
  } finally {
    await cleanOwnRows();
  }
});

// ─── 版本行缺失自愈（空库首写）────────────────────────────────

test("版本行缺失时首写以 expected=0 成功（0→1），并重建行", { skip: !testDatabaseUrl }, async () => {
  await pool!.query("DELETE FROM store_versions WHERE domain = 'teams'");
  try {
    const salt = randomUUID().slice(0, 8);
    const input = makeStore(1, salt);

    const wrong = await repo!.saveStoreWithExpectedVersion(input, 3);
    assert.equal(wrong.ok, false, "行缺失且 expected≠0 必须冲突");
    if (!wrong.ok) assert.equal(wrong.currentVersion, 0, "行缺失的现行版本语义为 0");

    const okSave = await repo!.saveStoreWithExpectedVersion(input, 0);
    assert.equal(okSave.ok, true, "行缺失 + expected=0 视为空库首写");
    if (okSave.ok) assert.equal(okSave.savedVersion, 1);
  } finally {
    // 恢复计数器行（若缺失则由下次写重建，此处确保行存在以免干扰他例）
    await pool!.query(
      "INSERT INTO store_versions (domain, version) VALUES ('teams', 0) ON CONFLICT (domain) DO NOTHING"
    );
  }
});

// ─── 安全错误边界（范式 #1）────────────────────────────────────

test("底层错误收敛为 TeamStoreError，不外泄原始细节", { skip: !testDatabaseUrl }, async () => {
  const leakMessage = "connection postgres://secret-user:secret-pass@db.internal:5432/x refused";
  const brokenDb = {
    select: () => {
      throw new Error(leakMessage);
    },
  } as unknown as Parameters<typeof createTeamPgRepository>[0];

  const brokenRepo = createTeamPgRepository(brokenDb);
  await assert.rejects(
    async () => brokenRepo.loadStore(),
    (err: unknown) => {
      assert.ok(err instanceof TeamStoreError);
      assert.equal(err.code, "TEAM_STORE_INTERNAL");
      assert.ok(!err.message.includes("secret-pass"), "错误消息不得外泄连接串");
      return true;
    }
  );
});
