#!/usr/bin/env npx tsx
// ============================================================
// O7 · Trace → Langfuse NDJSON 导出脚本（PoC）
// ============================================================
// 用法：
//   npx tsx scripts/export-traces-to-langfuse.ts [options]
//
// 选项：
//   --session <id>     按 sourceId 过滤（AI session / harness run 等）
//   --output <file>    输出文件路径（默认 stdout）
//   --format <type>    输出格式：simple | batch（默认 batch）
//   --limit <n>        最多导出条数（默认 100）
//   --source <type>    数据源：json | pg（默认 json）
//   --help             显示帮助信息
//
// 不碰生产路由，纯脚本。
// 不引入 Langfuse SDK，输出 NDJSON 供 Langfuse batch ingestion 使用。
// ============================================================

import { writeFileSync } from "node:fs";
import { argv, exit, stdout } from "node:process";

import {
  tracesToLangfuseNdjson,
  tracesToLangfuseBatchNdjson,
} from "../apps/api/src/modules/trace/trace.export";
import { queryTraces } from "../apps/api/src/modules/trace/trace.repository";
import type { TraceRecord } from "../apps/api/src/modules/trace/trace.types";

// ─── 参数解析 ────────────────────────────────────────────────

interface CliOptions {
  session?: string;
  output?: string;
  format: "simple" | "batch";
  limit: number;
  source: "json" | "pg";
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    format: "batch",
    limit: 100,
    source: "json",
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--session":
        opts.session = args[++i];
        break;
      case "--output":
        opts.output = args[++i];
        break;
      case "--format":
        opts.format = (args[++i] as "simple" | "batch") ?? opts.format;
        break;
      case "--limit":
        opts.limit = parseInt(args[++i] ?? "100", 10);
        break;
      case "--source":
        opts.source = (args[++i] as "json" | "pg") ?? opts.source;
        break;
      default:
        // 未知参数忽略
        break;
    }
  }

  return opts;
}

// ─── 帮助信息 ────────────────────────────────────────────────

const HELP_TEXT = `
Trace → Langfuse NDJSON 导出脚本（O7 PoC）

用法：
  npx tsx scripts/export-traces-to-langfuse.ts [options]

选项：
  --session <id>     按 sourceId 过滤（AI session / harness run 等）
  --output <file>    输出文件路径（默认 stdout）
  --format <type>    输出格式：simple | batch（默认 batch）
                      simple = 每行一个 LangfuseTrace JSON
                      batch  = 每行一个 ingest event（trace-create / observation-create）
  --limit <n>        最多导出条数（默认 100）
  --source <type>    数据源：json | pg（默认 json）
                      json = 从 data/traces/trace-store.json 读取
                      pg   = 从 PostgreSQL traces 表读取（需要 DATABASE_URL）
  --help, -h         显示此帮助信息

示例：
  # 导出所有 trace 为 batch NDJSON 到 stdout
  npx tsx scripts/export-traces-to-langfuse.ts

  # 按 session 过滤，输出到文件
  npx tsx scripts/export-traces-to-langfuse.ts --session sess-001 --output traces.ndjson

  # 从 PG 读取，simple 格式
  npx tsx scripts/export-traces-to-langfuse.ts --source pg --format simple --limit 50

注意：
  - 不引入 Langfuse SDK，输出 NDJSON 供 Langfuse batch ingestion 使用。
  - 不碰生产路由，纯脚本。
  - PG 模式需要配置 DATABASE_URL 环境变量。
`.trim();

// ─── JSON 数据源 ──────────────────────────────────────────────

function loadFromJsonStore(session: string | undefined, limit: number): TraceRecord[] {
  const result = queryTraces({
    ownerUserId: "", // 空字符串 = 不按 owner 过滤（admin 全量场景）
    ...(session ? { sourceId: session } : {}),
    limit,
  });
  return result.traces;
}

// ─── PG 数据源 ────────────────────────────────────────────────

async function loadFromPg(session: string | undefined, limit: number): Promise<TraceRecord[]> {
  // 动态导入 pg，避免在 JSON 模式下因缺少 pg 而崩溃
  const { default: pg } = await import("pg");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL 未设置。使用 --source json 或配置 DATABASE_URL。");
  }

  const pool = new pg.Pool({ connectionString });
  try {
    let query: string;
    let params: unknown[];

    if (session) {
      query = `
        SELECT trace_id, source_domain, source_id, owner_user_id, owner_username,
               user_input_summary, intent_result, spans, summary,
               created_at, updated_at
        FROM traces
        WHERE source_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;
      params = [session, limit];
    } else {
      query = `
        SELECT trace_id, source_domain, source_id, owner_user_id, owner_username,
               user_input_summary, intent_result, spans, summary,
               created_at, updated_at
        FROM traces
        ORDER BY created_at DESC
        LIMIT $1
      `;
      params = [limit];
    }

    const res = await pool.query(query, params);

    return res.rows.map((row) => ({
      traceId: row.trace_id,
      sourceDomain: row.source_domain,
      sourceId: row.source_id ?? undefined,
      ownerUserId: row.owner_user_id,
      ownerUsername: row.owner_username,
      userInputSummary: row.user_input_summary ?? undefined,
      intentResult: row.intent_result ?? undefined,
      spans: Array.isArray(row.spans) ? row.spans : [],
      summary: row.summary ?? {
        totalDurationMs: 0,
        spanCount: 0,
        totalTokens: 0,
        hasError: false,
        hasDegradation: false,
      },
      createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
      updatedAt: row.updated_at?.toISOString?.() ?? String(row.updated_at),
      ...(row.request_id ? { requestId: row.request_id } : {}),
    })) as TraceRecord[];
  } finally {
    await pool.end();
  }
}

// ─── 主入口 ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(argv.slice(2));

  if (opts.help) {
    stdout.write(HELP_TEXT + "\n");
    exit(0);
  }

  // 加载数据
  let traces: TraceRecord[];
  if (opts.source === "pg") {
    traces = await loadFromPg(opts.session, opts.limit);
  } else {
    traces = loadFromJsonStore(opts.session, opts.limit);
  }

  if (traces.length === 0) {
    const filterDesc = opts.session ? `session=${opts.session}` : "全量";
    stdout.write(`# 无 trace 数据（${filterDesc}，source=${opts.source}）\n`);
    exit(0);
  }

  // 映射 + 输出
  const ndjson =
    opts.format === "simple"
      ? tracesToLangfuseNdjson(traces)
      : tracesToLangfuseBatchNdjson(traces);

  if (opts.output) {
    writeFileSync(opts.output, ndjson, "utf-8");
    stdout.write(`# 已导出 ${traces.length} 条 trace → ${opts.output}（format=${opts.format}）\n`);
  } else {
    stdout.write(ndjson);
  }

  exit(0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  stdout.write(`# 导出失败：${msg}\n`);
  exit(1);
});
