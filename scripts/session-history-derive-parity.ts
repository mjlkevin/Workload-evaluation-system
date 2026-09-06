// ============================================================
// 批次 2a · 「取会话历史」派生缝 —— 开发库全量逐字节对照
// ============================================================
// 用途：对 ai_sessions 中**现存的每一条会话**，把「改造前的读取路径」与
// 「改造后经 deriveSessionMessages 的路径」各取一次结果，JSON.stringify 后
// 严格比对。六层全部一致才退出码 0。
//
// 为什么留在仓库里（不是一次性脚本）：批次 2b 要把派生缝的实现从 jsonb 快照换成
// append-only 事件序列。届时**唯一**要动的就是 session-history.ts 里那个函数，
// 而本脚本正是「换完之后历史仍与旧存储逐字节相同」的回归闸门——
// 2b 每次翻转实现都要重跑它并通过。
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
import dotenv from "dotenv";

import { deriveSessionMessages } from "../apps/api/src/modules/ai-sessions/session-history";
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

function compareSession(session: AiSessionRecord): Array<{ layer: Layer; detail: string }> {
  const problems: Array<{ layer: Layer; detail: string }> = [];
  const derived = deriveSessionMessages(session);

  const checks: Array<[Layer, unknown, unknown]> = [
    ["①原始历史", session.messages, derived],
    ["②模型历史整形", legacySessionRecordToHomeMessages(session), sessionRecordToHomeMessages(session)],
    ["③模型请求窗口", legacyModelHistory(session, PROBE_USER_CONTENT), deriveWorkbenchModelHistoryFromSession({ session, userContent: PROBE_USER_CONTENT })],
    ["④进行中工具交互判据", hasOngoingWorkbenchToolInteraction(session.messages), hasOngoingWorkbenchToolInteraction(derived)],
    ["⑤管理员审计摘要", legacyAdminSummary(session), summarizeSessionForAdminAudit(session)],
    ["⑥视图消息计数", legacyViewMessageCount(session), derived.length],
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
    const census = shape.rows[0];
    console.log("[parity] 目标库：%s", describeTarget(url));
    console.log("[parity] 数据普查：%j", census);
    console.log("[parity] 角色分布：%j", roles.rows);
    console.log("[parity] 特征覆盖：%j", features.rows[0]);
    if (Number(census.non_array_messages) > 0) {
      console.log("[parity] ⚠ 存在 %s 条 messages 非 jsonb 数组的行——旧审计表达式在这种行上会抛 TypeError，改道后不抛；此差异仅在这种行上成立，已逐条列出。", census.non_array_messages);
    }

    const sessions = (await pool.query("select * from ai_sessions order by session_id")).rows;

    let compared = 0;
    let mismatched = 0;
    const perLayer = new Map<Layer, number>();
    for (const layer of LAYERS) perLayer.set(layer, 0);

    for (const row of sessions) {
      const session = toRecord(row);
      compared += 1;
      const problems = compareSession(session);
      if (problems.length === 0) continue;
      mismatched += 1;
      for (const p of problems) {
        perLayer.set(p.layer, (perLayer.get(p.layer) ?? 0) + 1);
        console.log(`[parity] ✗ ${session.sessionId} ${p.layer}: ${p.detail}`);
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
