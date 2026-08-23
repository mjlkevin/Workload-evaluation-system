// ============================================================
// Teams 域 PG 仓储（阶段 2 批 7 · 第 1–3 步）
// ============================================================
// 接口形态（与批 5 trace 同形）：整存 load/save + 乐观并发 save。
// teams usecase 全部写操作是整存 RMW（load → 内存改写 → 带版本保存），
// 无法拆成单行操作（每次写跨 业务行 + audit log 两张以上表），因此
// 接口保留整存形态，并发控制下沉到 store 级版本计数器的单条条件
// UPDATE CAS（见下）。「调用点零改动」：选择器透明委托，
// team.usecase.ts 无需改造。
//
// store 级 version 处置（批 7 核心决策，架构侧指令「给出方案与理由」）：
//  - 不给业务表加 version 列：JSON TeamStore.version 是跨集合的整存
//    乐观并发 token（任何写都递增，并发写不同集合也冲突）。拆到行级
//    需要同时给 teams / team_reviews / team_plan_bindings 等多表加列，
//    且行级 CAS 表达不了跨表原子比较——语义对不上，改动面反而更大。
//  - 不以纯事务行锁替代：事务串行化会把「冲突失败（40909 重试提示）」
//    变成「阻塞等待后成功」，改变前端既有冲突契约。
//  - 采用：单行元数据表 store_versions（0019 migration，新建表、不动
//    0012 六张业务表），写事务内单条条件 UPDATE CAS 完成「读版本→比较→
//    递增」——整体下沉进一条语句（§4.6 规则：先校验后写必须下沉进
//    CAS 条件，不得保留独立前置判断）。冲突时事务回滚，40909 契约不变。
//
// 五条硬性范式落实（批 1–6 基准）：
//  1. 错误边界：TeamStoreError（稳定 code），每个公开方法 try/catch 后
//     经 toSafeError 收敛；版本冲突为结构化返回（{ok:false}）而非异常
//     （与 JSON 侧契约一致）；基础设施错误统一 TEAM_STORE_INTERNAL，
//     pg/drizzle 原始错误（可能含 SQL 参数/连接串）不外泄。
//  2. 幂等：整存替换（TRUNCATE + 全量 INSERT）对同一输入重复执行结果
//     不变；条件 UPDATE CAS 对同一 expected 重复提交恰一次生效（后续冲突）。
//  3. 并发控制：条件 UPDATE CAS 行锁串行化全部写者（并发写同域必有一方
//    40909，与 JSON 整存乐观并发语义 1:1）；CAS 通过后的整存替换在
//    同一事务内，无第二个写者可交错。成功判定用 RETURNING 行数，
//    不用返回版本值反推（避免现行版本恰为 expected+1 的误判）。
//  4. 时间：版本行 updated_at 用 readDbNow(tx)（DB 时钟）；业务行
//    时间戳保留 store 内值（整存替换语义 = 如实保存输入快照，与
//    批 4 rule_sets.effective_at 保留输入值同口径）。
//  5. ISS-2026-08-18-004：读取失败必须抛错；空表/缺版本行返回空结构
//     与 version=0（对齐 JSON「空库初始态」），且读路径不写回。
//
// 缓存策略：不加缓存层。理由：①teams 读全部是工作台低频点查/小集合
//  过滤（团队列表、成员校验、评审列表），直查成本可忽略（6 表均有
//  主键/外键索引）；②数据量极小（当前量级 <100 行/表）；③成员/评审
//  变更须即时生效（权限校验依赖），缓存引入失效协调成本无收益；
//  ④多副本部署下每次读即最新提交值，强一致。与批 6 versions「不加」
//  结论同构（点查 + 一致性敏感）。
//
// 嵌套拆表映射（架构侧批 7 特殊点 2）：
//  - teams[].members 嵌套数组 ↔ team_members 独立表（复合主键
//    team_id+user_id）；load 时按 joinedAt 聚合回 TeamRecord.members。
//  - reviews / comments / planBindings / auditLogs 顶层扁平数组 ↔
//    team_reviews / team_review_comments / team_plan_bindings /
//    team_audit_logs，字段 1:1（0012 migration 已建，批 7 零改动）。

import { asc, eq, inArray, sql } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import {
  storeVersions,
  teamAuditLogs,
  teamMembers,
  teamPlanBindings,
  teamReviewComments,
  teamReviews,
  teams,
} from "../../db/schema";
import type { TeamRecord, TeamStore } from "./team.types";

const DOMAIN = "teams";

// ============================================================
// 安全错误（范式 #1 / #5）
// ============================================================

export class TeamStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "TeamStoreError";
    this.code = code;
  }
}

function toSafeError(err: unknown): TeamStoreError {
  if (err instanceof TeamStoreError) return err;
  return new TeamStoreError("TEAM_STORE_INTERNAL", "team store persistence failed");
}

// ============================================================
// 仓储接口（JSON / PG 双实现共用）
// ============================================================

export interface TeamStoreRepository {
  /** 整存读取（范式 #5：失败抛错；空库返回 version=0 空结构） */
  loadStore(): Promise<TeamStore>;
  /** 整存写入（无版本校验，对齐 JSON saveTeamStore） */
  saveStore(store: TeamStore): Promise<void>;
  /** 乐观并发整存写入：版本不符返回 {ok:false, currentVersion}（对齐 JSON 契约） */
  saveStoreWithExpectedVersion(
    store: TeamStore,
    expectedVersion: number
  ): Promise<{ ok: true; savedVersion: number } | { ok: false; currentVersion: number }>;
}

export type TeamsPgRepository = TeamStoreRepository & {
  /** 测试专用：暴露底层连接以做带外断言/清理 */
  __dbForTest(): Database;
};

// ============================================================
// 行 ↔ 记录映射（PG timestamptz → ISO 字符串契约）
// ============================================================

function toIso(value: Date): string {
  return value.toISOString();
}

function toDate(value: string): Date {
  return new Date(value);
}

async function assembleStore(dbInstance: Database): Promise<TeamStore> {
  const [teamRows, memberRows, reviewRows, commentRows, bindingRows, auditRows] = await Promise.all([
    dbInstance.select().from(teams).orderBy(asc(teams.createdAt), asc(teams.teamId)),
    dbInstance.select().from(teamMembers).orderBy(asc(teamMembers.joinedAt), asc(teamMembers.userId)),
    dbInstance.select().from(teamReviews).orderBy(asc(teamReviews.createdAt), asc(teamReviews.reviewId)),
    dbInstance
      .select()
      .from(teamReviewComments)
      .orderBy(asc(teamReviewComments.createdAt), asc(teamReviewComments.commentId)),
    dbInstance.select().from(teamPlanBindings).orderBy(asc(teamPlanBindings.globalVersionCode)),
    dbInstance.select().from(teamAuditLogs).orderBy(asc(teamAuditLogs.at), asc(teamAuditLogs.auditId)),
  ]);

  const membersByTeam = new Map<string, TeamRecord["members"]>();
  for (const m of memberRows) {
    const list = membersByTeam.get(m.teamId) ?? [];
    list.push({ userId: m.userId, role: m.role as TeamRecord["members"][number]["role"], joinedAt: toIso(m.joinedAt) });
    membersByTeam.set(m.teamId, list);
  }

  const [versionRow] = await dbInstance
    .select()
    .from(storeVersions)
    .where(eq(storeVersions.domain, DOMAIN))
    .limit(1);

  return {
    version: versionRow?.version ?? 0,
    teams: teamRows.map((t) => ({
      teamId: t.teamId,
      name: t.name,
      ownerUserId: t.ownerUserId,
      members: membersByTeam.get(t.teamId) ?? [],
      createdAt: toIso(t.createdAt),
      updatedAt: toIso(t.updatedAt),
    })),
    reviews: reviewRows.map((r) => ({
      reviewId: r.reviewId,
      teamId: r.teamId,
      globalVersionCode: r.globalVersionCode,
      title: r.title,
      status: r.status as TeamStore["reviews"][number]["status"],
      createdBy: r.createdBy,
      createdAt: toIso(r.createdAt),
      updatedAt: toIso(r.updatedAt),
    })),
    comments: commentRows.map((c) => ({
      commentId: c.commentId,
      reviewId: c.reviewId,
      authorUserId: c.authorUserId,
      content: c.content,
      createdAt: toIso(c.createdAt),
    })),
    planBindings: bindingRows.map((b) => ({
      globalVersionCode: b.globalVersionCode,
      teamId: b.teamId,
      updatedAt: toIso(b.updatedAt),
      updatedBy: b.updatedBy,
    })),
    auditLogs: auditRows.map((a) => ({
      auditId: a.auditId,
      teamId: a.teamId,
      actorUserId: a.actorUserId,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      at: toIso(a.at),
    })),
  };
}

/**
 * 整存替换：六表清空后按 store 快照全量重写（范式 #2 幂等）。
 * 调用方必须已持有写者串行化保证（条件 UPDATE CAS 行锁或调用方自证无并发）。
 */
async function replaceAllTables(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  store: TeamStore
): Promise<void> {
  await tx.execute(
    sql`TRUNCATE TABLE ${teams}, ${teamMembers}, ${teamReviews}, ${teamReviewComments}, ${teamPlanBindings}, ${teamAuditLogs}`
  );
  if (store.teams.length > 0) {
    await tx.insert(teams).values(
      store.teams.map((t) => ({
        teamId: t.teamId,
        name: t.name,
        ownerUserId: t.ownerUserId,
        createdAt: toDate(t.createdAt),
        updatedAt: toDate(t.updatedAt),
      }))
    );
  }
  const memberValues = store.teams.flatMap((t) =>
    t.members.map((m) => ({
      teamId: t.teamId,
      userId: m.userId,
      role: m.role,
      joinedAt: toDate(m.joinedAt),
    }))
  );
  if (memberValues.length > 0) {
    await tx.insert(teamMembers).values(memberValues);
  }
  if (store.reviews.length > 0) {
    await tx.insert(teamReviews).values(
      store.reviews.map((r) => ({
        reviewId: r.reviewId,
        teamId: r.teamId,
        globalVersionCode: r.globalVersionCode,
        title: r.title,
        status: r.status,
        createdBy: r.createdBy,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
      }))
    );
  }
  if (store.comments.length > 0) {
    await tx.insert(teamReviewComments).values(
      store.comments.map((c) => ({
        commentId: c.commentId,
        reviewId: c.reviewId,
        authorUserId: c.authorUserId,
        content: c.content,
        createdAt: toDate(c.createdAt),
      }))
    );
  }
  if (store.planBindings.length > 0) {
    await tx.insert(teamPlanBindings).values(
      store.planBindings.map((b) => ({
        globalVersionCode: b.globalVersionCode,
        teamId: b.teamId,
        updatedAt: toDate(b.updatedAt),
        updatedBy: b.updatedBy,
      }))
    );
  }
  if (store.auditLogs.length > 0) {
    await tx.insert(teamAuditLogs).values(
      store.auditLogs.map((a) => ({
        auditId: a.auditId,
        teamId: a.teamId,
        actorUserId: a.actorUserId,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        at: toDate(a.at),
      }))
    );
  }
}

/**
 * 条件 UPDATE CAS（范式 #3 + §4.6 规则）：
 * 「读版本 → 比较 → 递增」整体在一条 UPDATE 的 where 条件内完成，
 * 无独立前置判断——并发下比较不可被绕过（行锁串行化竞争者）。
 * 成功判定用 RETURNING 行数（命中必恰 1 行），不用「返回版本值」
 * 反推（现行版本恰为 expected+1 时值反推会误判）。
 * 行缺失（空库未初始化）：仅 expected=0 时允许 INSERT 首写（0→1），
 * INSERT 同样带 ON CONFLICT DO NOTHING 守卫，并发重复插入恰一方生效。
 */
async function bumpVersionCas(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  expectedVersion: number
): Promise<{ saved: boolean; savedVersion: number; currentVersion: number }> {
  const now = await readDbNow(tx);
  const bumped = await tx.execute(
    sql`UPDATE "store_versions"
        SET "version" = "version" + 1, "updated_at" = ${now}
        WHERE "domain" = ${DOMAIN} AND "version" = ${expectedVersion}
        RETURNING "version"`
  );
  if (bumped.rowCount === 1) {
    return {
      saved: true,
      savedVersion: (bumped.rows[0] as { version: number }).version,
      currentVersion: expectedVersion,
    };
  }
  // 未命中：行缺失或版本不符——读现行版本消歧（锁内读，仅用于冲突报告）
  const current = await tx.execute(
    sql`SELECT "version" FROM "store_versions" WHERE "domain" = ${DOMAIN}`
  );
  if (current.rowCount === 0) {
    if (expectedVersion !== 0) {
      return { saved: false, savedVersion: 0, currentVersion: 0 };
    }
    const inserted = await tx.execute(
      sql`INSERT INTO "store_versions" ("domain", "version", "updated_at")
          VALUES (${DOMAIN}, 1, ${now})
          ON CONFLICT ("domain") DO NOTHING
          RETURNING "version"`
    );
    if (inserted.rowCount === 1) {
      return { saved: true, savedVersion: 1, currentVersion: 0 };
    }
    // 并发插入竞争已输：重读现行版本报冲突
    const reread = await tx.execute(
      sql`SELECT "version" FROM "store_versions" WHERE "domain" = ${DOMAIN}`
    );
    return {
      saved: false,
      savedVersion: 0,
      currentVersion: (reread.rows[0] as { version: number } | undefined)?.version ?? 0,
    };
  }
  return {
    saved: false,
    savedVersion: 0,
    currentVersion: (current.rows[0] as { version: number }).version,
  };
}

// ============================================================
// PG 仓储实现
// ============================================================

export function createTeamPgRepository(dbInstance: Database = db): TeamsPgRepository {
  return {
    __dbForTest() {
      return dbInstance;
    },

    async loadStore() {
      try {
        return await assembleStore(dbInstance);
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async saveStore(store) {
      try {
        await dbInstance.transaction(async (tx) => {
          await replaceAllTables(tx, store);
        });
      } catch (err) {
        throw toSafeError(err);
      }
    },

    async saveStoreWithExpectedVersion(store, expectedVersion) {
      try {
        return await dbInstance.transaction(async (tx) => {
          const cas = await bumpVersionCas(tx, expectedVersion);
          if (!cas.saved) {
            // 事务回滚：UPSERT 的写入一并撤销，无副作用
            throw new TeamStoreConflict(cas.currentVersion);
          }
          await replaceAllTables(tx, store);
          return { ok: true as const, savedVersion: cas.savedVersion };
        });
      } catch (err) {
        if (err instanceof TeamStoreConflict) {
          return { ok: false as const, currentVersion: err.currentVersion };
        }
        throw toSafeError(err);
      }
    },
  };
}

/** 内部冲突信号（事务边界用，不外泄；结构化返回给调用方） */
class TeamStoreConflict extends Error {
  readonly currentVersion: number;

  constructor(currentVersion: number) {
    super("TEAM_STORE_CONFLICT");
    this.name = "TeamStoreConflict";
    this.currentVersion = currentVersion;
  }
}

/** 测试辅助：清理指定前缀团队及其关联行（共享测试库隔离用） */
export async function cleanupTeamRowsByPrefix(dbInstance: Database, teamIdPrefix: string): Promise<void> {
  const teamIds = (
    await dbInstance
      .select({ teamId: teams.teamId })
      .from(teams)
      .where(sql`${teams.teamId} LIKE ${`${teamIdPrefix}%`}`)
  ).map((r) => r.teamId);
  if (teamIds.length === 0) return;
  await dbInstance.delete(teamReviewComments).where(
    inArray(
      teamReviewComments.reviewId,
      dbInstance.select({ reviewId: teamReviews.reviewId }).from(teamReviews).where(inArray(teamReviews.teamId, teamIds))
    )
  );
  await dbInstance.delete(teamReviews).where(inArray(teamReviews.teamId, teamIds));
  await dbInstance.delete(teamMembers).where(inArray(teamMembers.teamId, teamIds));
  await dbInstance.delete(teamAuditLogs).where(inArray(teamAuditLogs.teamId, teamIds));
  await dbInstance.delete(teamPlanBindings).where(inArray(teamPlanBindings.teamId, teamIds));
  await dbInstance.delete(teams).where(inArray(teams.teamId, teamIds));
}
