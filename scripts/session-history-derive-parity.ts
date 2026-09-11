// ============================================================
// 批次 2a 造缝 / 2b-3 换源 · 「取会话历史」开发库全量逐字节对照
// ============================================================
// 用途：对 ai_sessions 中**现存的每一条会话**，把「改造前的读取路径」（本文件内的
// LEGACY 冻结副本，直读 jsonb 快照）与「现行读取路径」（经事件流解析后的记录 →
// deriveSessionMessages）各取一次结果，JSON.stringify 后严格比对。六层全部一致才退出码 0。
//
// 为什么留在仓库里（不是一次性脚本）：批次 2b-3 已把派生缝的数据源从 jsonb 快照换成
// append-only 事件序列，本脚本正是「换源之后历史仍与旧存储逐字节相同」的回归闸门——
// 之后每次动读取源都要重跑它并通过。
//
// 换源后本脚本另打印两行数出来的事实：
//  · **回落残量**（口径②：残量数到 0 即可在 2c 删掉回落）——含未覆盖会话逐条归因；
//  · **整表一次取事实的 SQL 条数**（架构侧硬要求：管理员审计全表逐条 map 不得变 N+1）。
//
// ⚠ 覆盖力有一条必须连本段一起读：开发库实取 101 条会话里对话事件（user/message /
// assistant/message）**各 0 条**，17 条带消息的存量今天**必然 100% 走回落**。于是
// 「六层全一致」在存量上只证明「回落没弄坏老数据」，**不证明**事件流重建不静默少历史。
// 后者是本批要害，其逐字节证据在
// apps/api/src/modules/harness/workbench-history-source.e2e.test.ts（新建真实两轮对话
// → 断言源=events 而非回落 → 与快照逐字节相同，并含「改掉快照正文仍读到事件那份」的
// 判别用例）。本脚本每次都会打印「事件路径 N 条」，N=0 时明确说明它没证到那一半——
// 别让一个 PASS 听起来比实际更有力。
//
// 反循环口径（架构侧 2026-09-06 确认）：LEGACY_* 为改造前代码的原样冻结副本，
// 只读 session 对象自身字段，绝不 import 被改函数。
//
// 覆盖力自陈（务必连本段一起读，别让「N 条全一致」听起来比实际更有力）：
// 本脚本跑的是**真实存量数据**，而真实存量数据的形状分布由脚本自己量出来并打印
// （见下方 census）：绝大多数会话 messages 为空数组，空数组上六层全都恒等、
// 没有判别力——窗口截断、system/tool 角色过滤、附件引用解析、判据形状异常这些
// 真正会因改道而漂移的分支，只有非空且带这些特征的那部分样本才覆盖得到。
// 形状维度的确定性覆盖在 apps/api/src/modules/ai-sessions/session-history.test.ts
// （合成样本，CI 空库同样成立）。两份证据互补，缺一不可。
//
// 用法（需指向开发库，只读不写）：
//   DATABASE_URL=postgres://… npm run check:session-history-parity
//   未显式给 DATABASE_URL 时回落到 apps/api/.env 的 DATABASE_URL。
// ============================================================

import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import dotenv from "dotenv";

import { deriveSessionMessages, resolveSessionHistories } from "../apps/api/src/modules/ai-sessions/session-history";
import { createConversationEventHistorySource } from "../apps/api/src/modules/harness/conversation-event-history";
import { summarizeSessionForAdminAudit } from "../apps/api/src/modules/ai-sessions/ai-sessions.usecase";
import { asString } from "../apps/api/src/utils/helpers";
import {
  WORKBENCH_MODEL_HISTORY_WINDOW,
  buildHomeMessageContentForModel,
  sessionRecordToHomeMessages,
} from "../apps/api/src/services/ai/handlers/workbench-shared";
import { hasOngoingWorkbenchToolInteraction } from "../apps/api/src/services/ai/workbench-intent.service";
import { deriveWorkbenchModelHistoryFromSession } from "../apps/api/src/services/ai/workbench-request-invariant";
import type { AiSessionRecord } from "../apps/api/src/modules/ai-sessions/ai-sessions.types";

// ============================================================
// LEGACY 冻结副本（改造前逐字照抄，勿改）
// ============================================================

function legacySessionRecordToHomeMessages(session: AiSessionRecord | null | undefined) {
  if (!session || !Array.isArray(session.messages)) return [];
  const attachmentsById = new Map((Array.isArray(session.attachments) ? session.attachments : []).map((attachment) => [attachment.attachmentId, attachment]));
  return session.messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && asString(message.content))
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
      attachments: (message.attachmentIds ?? [])
        .map((id) => attachmentsById.get(id))
        .filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment))
        .map((attachment) => ({ name: attachment.name, size: attachment.size, type: attachment.type, parsedSummary: attachment.parsedSummary })),
    }));
}

function legacyModelHistory(session: AiSessionRecord | null | undefined, userContent: string) {
  const storedHistory = legacySessionRecordToHomeMessages(session);
  const shaped = storedHistory
    .slice(-WORKBENCH_MODEL_HISTORY_WINDOW)
    .map((message) => ({ role: message.role, content: buildHomeMessageContentForModel(message) }));
  if (shaped.length > 0) shaped[shaped.length - 1] = { role: "user", content: userContent };
  else shaped.push({ role: "user", content: userContent });
  return shaped;
}

const ADMIN_AUDIT_TEXT_MAX = 120;

function legacyTruncateAuditText(value: unknown, max = ADMIN_AUDIT_TEXT_MAX): string {
  const text = asString(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function legacyAdminSummary(session: AiSessionRecord) {
  const firstUserMessage = session.messages.find((message) => message.role === "user");
  const lastAssistantMessage = [...session.messages].reverse().find((message) => message.role === "assistant");
  return {
    sessionId: session.sessionId,
    title: session.title,
    ownerUserId: session.ownerUserId,
    ownerUsername: session.ownerUsername,
    businessRole: asString(session.businessRole),
    domain: session.domain,
    workflowKey: session.workflowKey,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    turnCount: session.messages.filter((message) => message.role === "user").length,
    attachmentCount: session.attachments.length,
    artifactCount: session.artifacts.length,
    firstUserMessage: legacyTruncateAuditText(firstUserMessage?.content),
    lastAssistantMessage: legacyTruncateAuditText(lastAssistantMessage?.content),
  };
}

function legacyViewMessageCount(session: AiSessionRecord): number {
  return session.messages?.length ?? 0;
}

// ============================================================
// 对照主体
// ============================================================

const LAYERS = [
  "①原始历史",
  "②模型历史整形",
  "③模型请求窗口",
  "④进行中工具交互判据",
  "⑤管理员审计摘要",
  "⑥视图消息计数",
] as const;

type Layer = (typeof LAYERS)[number];

const PROBE_USER_CONTENT = "对照探针：本轮用户正文（固定串，两侧同源）";

/**
 * @param snapshot 改造前读取路径看到的记录（messages = ai_sessions.messages 裸快照）
 * @param resolved 现行读取路径拿到的记录（messages = 事件流解析结果，覆盖不住则整会话回落）
 */
function compareSession(snapshot: AiSessionRecord, resolved: AiSessionRecord): Array<{ layer: Layer; detail: string }> {
  const problems: Array<{ layer: Layer; detail: string }> = [];
  const derived = deriveSessionMessages(resolved);

  const checks: Array<[Layer, unknown, unknown]> = [
    // ① 换源要害：事件流重建出来的历史，与快照那一份逐字节
    ["①原始历史", snapshot.messages, derived],
    ["②模型历史整形", legacySessionRecordToHomeMessages(snapshot), sessionRecordToHomeMessages(resolved)],
    ["③模型请求窗口", legacyModelHistory(snapshot, PROBE_USER_CONTENT), deriveWorkbenchModelHistoryFromSession({ session: resolved, userContent: PROBE_USER_CONTENT })],
    ["④进行中工具交互判据", hasOngoingWorkbenchToolInteraction(snapshot.messages), hasOngoingWorkbenchToolInteraction(derived)],
    ["⑤管理员审计摘要", legacyAdminSummary(snapshot), summarizeSessionForAdminAudit(resolved)],
    ["⑥视图消息计数", legacyViewMessageCount(snapshot), derived.length],
  ];

  for (const [layer, legacy, current] of checks) {
    const a = JSON.stringify(legacy);
    const b = JSON.stringify(current);
    if (a !== b) problems.push({ layer, detail: `旧=${shorten(a)} 新=${shorten(b)}` });
  }
  return problems;
}

function shorten(json: string): string {
  return json.length > 400 ? `${json.slice(0, 400)}…(${json.length} chars)` : json;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || dotenv.config({ path: path.resolve(process.cwd(), "apps/api/.env") }).parsed?.DATABASE_URL;
  if (!url) {
    console.error("[parity] 缺少 DATABASE_URL（开发库连接串）。用法：DATABASE_URL=postgres://… npm run check:session-history-parity");
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url });
  // 计数壳：drizzle 的 node-postgres 会话对「没有 connect 的 client」直接调
  // client.query(config, values)。记下来才能把「整表一次取事实」打印成实测数字，
  // 而不是注释里的一句承诺（架构侧 2b-3 硬要求）。
  const statements: string[] = [];
  const countingPool = {
    query: (config: unknown, values?: unknown[]) => {
      statements.push(String((config as { text?: unknown })?.text ?? config));
      return pool.query(config as never, values as never[]);
    },
    release: () => undefined,
  };
  const historySource = createConversationEventHistorySource(drizzle(countingPool as never) as never);
  const factStatements = () => statements.filter((text) => /harness_run_events/i.test(text)).length;
  try {
    // 数据形状普查：让「覆盖力有多弱」成为脚本自己量出来的事实，而不是读报告人的印象
    const shape = await pool.query(
      `with sized as (
         select session_id,
                case when jsonb_typeof(messages) = 'array' then jsonb_array_length(messages) end as n,
                jsonb_typeof(messages) as kind
           from ai_sessions
       )
       select
         count(*)::int                                          as sessions,
         count(*) filter (where kind <> 'array')::int           as non_array_messages,
         count(*) filter (where n = 0)::int                     as empty_messages,
         count(*) filter (where n > 0)::int                     as non_empty_messages,
         count(*) filter (where n > ${WORKBENCH_MODEL_HISTORY_WINDOW})::int as over_window,
         coalesce(sum(n), 0)::int                               as total_messages
       from sized`,
    );
    const roles = await pool.query(
      `select m.value->>'role' as role, count(*)::int as n
         from ai_sessions s, jsonb_array_elements(s.messages) as m
        group by 1 order by 2 desc`,
    );
    const features = await pool.query(
      `with ref_dangling as (
         select distinct s.session_id
           from ai_sessions s,
                jsonb_array_elements(s.messages) m,
                jsonb_array_elements(coalesce(m.value->'attachmentIds', '[]'::jsonb)) aid
          where not exists (
            select 1 from jsonb_array_elements(s.attachments) a
             where a.value->>'attachmentId' = aid.value #>> '{}'
          )
       ), tool_trace as (
         select distinct s.session_id
           from ai_sessions s, jsonb_array_elements(s.messages) m
          where jsonb_typeof(m.value->'metadata'->'toolCalls') = 'array'
            and jsonb_array_length(m.value->'metadata'->'toolCalls') > 0
       ), with_att as (
         select distinct s.session_id
           from ai_sessions s, jsonb_array_elements(s.messages) m
          where jsonb_array_length(coalesce(m.value->'attachmentIds', '[]'::jsonb)) > 0
       )
       select
         (select count(*) from with_att)::int     as sessions_with_attachment_refs,
         (select count(*) from ref_dangling)::int as sessions_with_dangling_refs,
         (select count(*) from tool_trace)::int   as sessions_with_tool_trace`,
    );
    const facts = await pool.query(
      `select event_type, count(*)::int as n
         from harness_run_events
        where event_type in ('user/message','assistant/message')
        group by 1 order by 1`,
    );
    const runsCensus = await pool.query(
      `select count(*)::int as runs,
              count(*) filter (where retry_of_run_id is not null)::int as retry_runs,
              count(distinct ai_session_id) filter (where ai_session_id is not null)::int as sessions_with_runs
         from harness_runs`,
    );
    const census = shape.rows[0];
    console.log("[parity] 目标库：%s", describeTarget(url));
    console.log("[parity] 数据普查：%j", census);
    console.log("[parity] 角色分布：%j", roles.rows);
    console.log("[parity] 特征覆盖：%j", features.rows[0]);
    console.log("[parity] Run 普查：%j", runsCensus.rows[0]);
    console.log("[parity] 对话事实（事件流侧可重建的量）：%j", facts.rows);
    if (Number(census.non_array_messages) > 0) {
      console.log("[parity] ⚠ 存在 %s 条 messages 非 jsonb 数组的行——旧审计表达式在这种行上会抛 TypeError，改道后不抛；此差异仅在这种行上成立，已逐条列出。", census.non_array_messages);
    }

    const sessionRows = (await pool.query("select * from ai_sessions order by session_id")).rows;

    // 零比对不构成通过：本脚本的前提是「拿存量数据比对」，空库上「全部一致」是空跑。
    // CI 的测试库就是空的，故它不在 CI 跑（确定性覆盖由 session-history.test.ts 的
    // 合成用例承担）；若将来有人把它接进 CI 而计数为 0，必须当场红而不是绿。
    if (sessionRows.length === 0) {
      console.error("[parity] 结论：FAIL（空跑）—— 目标库 %s 无任何会话，无从比对", describeTarget(url));
      process.exit(2);
    }

    // 整表一次解析：走的就是仓储读取口那一步（resolveSessionHistories），
    // 于是「一批会话一次查询」在这里是被实测的，不是被声称的。
    const snapshots = sessionRows.map(toRecord);
    const beforeResolve = factStatements();
    const { records: resolvedRecords, resolutions } = await resolveSessionHistories(snapshots, historySource);
    const queriesForFacts = factStatements() - beforeResolve;
    const onEventPath = resolutions.filter((resolution) => resolution.source === "events");
    // 「走了事件路径」里绝大多数是空会话（两侧都空，恒等，没有判别力）——
    // 真正证到「从事件流重建出历史」的只有重建出非空序列的那些
    const rebuiltNonEmpty = onEventPath.filter((resolution) => resolution.eventMessageCount > 0);
    const fellBack = resolutions.filter((resolution) => resolution.source === "snapshot");
    const noFacts = fellBack.filter((resolution) => resolution.reason === "no-conversation-facts");
    const notCovered = fellBack.filter((resolution) => resolution.reason === "snapshot-not-covered");
    const mergedTurns = resolutions.reduce((sum, resolution) => sum + resolution.mergedRetryUserTurns, 0);

    console.log(
      "[parity] 换源解析：%d 条会话一次取事实，实测 harness_run_events 相关 SQL = %d 条（逐会话查会是 %d 条）",
      snapshots.length,
      queriesForFacts,
      snapshots.length,
    );
    console.log(
      "[parity] 源分布：事件路径=%d（其中真正重建出非空历史=%d）回落快照=%d（无对话事件=%d 覆盖不住=%d）归并 retry 用户轮=%d",
      onEventPath.length,
      rebuiltNonEmpty.length,
      fellBack.length,
      noFacts.length,
      notCovered.length,
      mergedTurns,
    );
    // 判据②的「残量可数」：回落清单逐条打到 id 级，数到 0 就是 2c 删回落的时候
    for (const resolution of fellBack) {
      console.log(
        `[parity] 回落 session=${resolution.sessionId} 原因=${resolution.reason} 快照=${resolution.snapshotMessageCount} 事件重建=${resolution.eventMessageCount}` +
          (resolution.uncovered.length > 0 ? ` 未覆盖=${JSON.stringify(resolution.uncovered)}` : ""),
      );
    }

    // 按序配对：解析器对每条记录出一个结果，错位会让六层比对全比错对象——
    // 这种「看起来绿其实在比别的」必须当场红，不能靠事后再查。
    if (resolvedRecords.length !== snapshots.length || resolutions.length !== snapshots.length) {
      console.error(
        "[parity] 结论：FAIL —— 解析器返回 %d 条记录 / %d 条判定，与 %d 条会话不配对",
        resolvedRecords.length,
        resolutions.length,
        snapshots.length,
      );
      process.exit(2);
    }

    let compared = 0;
    let mismatched = 0;
    const perLayer = new Map<Layer, number>();
    for (const layer of LAYERS) perLayer.set(layer, 0);

    for (let index = 0; index < snapshots.length; index += 1) {
      const snapshot = snapshots[index];
      const resolved = resolvedRecords[index];
      if (resolutions[index].sessionId !== snapshot.sessionId || resolved.sessionId !== snapshot.sessionId) {
        console.error("[parity] 结论：FAIL —— 第 %d 条解析结果与会话 %s 错位", index, snapshot.sessionId);
        process.exit(2);
      }
      compared += 1;
      const problems = compareSession(snapshot, resolved);
      if (problems.length === 0) continue;
      mismatched += 1;
      for (const p of problems) {
        perLayer.set(p.layer, (perLayer.get(p.layer) ?? 0) + 1);
        console.log(`[parity] ✗ ${snapshot.sessionId} ${p.layer}: ${p.detail}`);
      }
    }

    console.log("[parity] 逐字节对照：%d 条会话 × %d 层 = %d 次比对", compared, LAYERS.length, compared * LAYERS.length);
    for (const layer of LAYERS) {
      console.log(`[parity]   ${layer}: ${compared - (perLayer.get(layer) ?? 0)}/${compared} 一致`);
    }
    if (mismatched > 0) {
      console.error("[parity] 结论：FAIL —— %d 条会话存在差异（逐条列出于上），不得以「差异无害」带过", mismatched);
      process.exit(1);
    }
    if (rebuiltNonEmpty.length === 0) {
      console.warn(
        "[parity] ⚠ 本库没有任何一条会话的历史真正来自事件流（事件路径上的会话全是空历史）。" +
          "本次 PASS 只证明「回落没弄坏存量」，**不证明**事件流重建不静默少历史；" +
          "那一半的证据在 apps/api/src/modules/harness/workbench-history-source.e2e.test.ts" +
          "（新建真实两轮对话 → 断言源=events → 与快照逐字节相同 + 判别用例）。",
      );
    }
    console.log("[parity] 结论：PASS —— 现存全部会话六层输出与改造前逐字节相同");
  } finally {
    await pool.end();
  }
}

/**
 * 行 → 记录的映射。刻意**不**复用 ai-sessions-pg.repository 的 toSessionRecord：
 * 那会把「存储适配层」也拉进被比较对象，本脚本要比的只是它之下的历史读取路径。
 * 时间列按 repository 同一口径转 ISO（Date#toISOString），使两侧入参形状一致。
 */
function toRecord(row: Record<string, unknown>): AiSessionRecord {
  const r = row as Record<string, unknown> & {
    created_at: Date;
    updated_at: Date;
    archived_at: Date | null;
  };
  return {
    sessionId: r.session_id as string,
    ownerUserId: r.owner_user_id as string,
    ownerUsername: r.owner_username as string,
    title: r.title as string,
    domain: r.domain as AiSessionRecord["domain"],
    workflowKey: r.workflow_key as string,
    businessRole: r.business_role as string,
    status: r.status as AiSessionRecord["status"],
    summary: r.summary as string,
    messages: r.messages as AiSessionRecord["messages"],
    attachments: r.attachments as AiSessionRecord["attachments"],
    artifacts: r.artifacts as AiSessionRecord["artifacts"],
    pendingActions: r.pending_actions as AiSessionRecord["pendingActions"],
    linkedRecords: r.linked_records as AiSessionRecord["linkedRecords"],
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    ...(r.archived_at ? { archivedAt: r.archived_at.toISOString() } : {}),
  };
}

function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "<无法解析的连接串>";
  }
}

main().catch((err) => {
  console.error("[parity] 对照脚本异常：", err instanceof Error ? err.message : err);
  process.exit(2);
});
