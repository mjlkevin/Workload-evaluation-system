// ============================================================
// 防漂移测试：全仓无同步 store I/O（阶段 1 收口证明）
// ============================================================
// 口径（阶段 1 批 8）：全部 store 仓储与请求路径不得出现
// readFileSync / writeFileSync 调用 —— 同步 I/O 阻塞事件循环，
// 阶段 1 目标为全量异步化（阶段 2 切 PostgreSQL 主存储）。
//
// 实现：TS compiler API 解析 src 下非测试 .ts/.mts 源文件，
// 定位全部 readFileSync / writeFileSync 调用点，按两条豁免规则
// 过滤后断言无剩余。
//
// 豁免一（AST 自动，无需登记）：模块顶层 async 函数且命名匹配
// /^(load|save)[A-Z]\w*$/ —— 阶段 1 accessor 已签名 async、
// 函数体仍为同步实现（各文件带「阶段 1 批 N：签名改 async，
// 实现不动」注释），函数体替换属阶段 2。
//
// 豁免二（显式白名单）：FILE_WHITELIST 文件级条目，每条附理由。
// 白名单命中仅输出审查日志，不使测试失败；新增命中会在日志中
// 暴露，供人工审查是否仍属既定豁免范围。
//
// 失败信息输出「相对路径:行:列 + 所属函数」，可直接定位。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC_ROOT = path.resolve(__dirname, "..");

const SYNC_IO_NAMES = new Set(["readFileSync", "writeFileSync"]);

/** 文件级白名单：条目内所有同步 I/O 调用豁免（命中输出审查日志）。 */
// 条目均经 RED 违例清单逐项裁决（批 8）：
// - 用户指定例外：config-integrity.ts（启动期路径，D15 阶段 2 删除对象）、db/seed.ts（seed 源读取）
// - 阶段 1 批 N accessor 的内部同步实现：team repository
//   （函数体「实现不动」，阶段 2 替换存储时一并异步化）
//   （S6 2026-08-29：knowledge repository 的 JSON 实现类已删除，其条目随之下线）
//   （S3 2026-08-30：trace repository 的 JSON 读写路径已删除，其条目随之下线）
// - 复用型同步工具：utils/file.ts、prompt-registry.ts、rag-baseline 三个文件
//   （被请求路径复用或 CLI/离线工具；异步化属阶段 2 评估项）
//
// 计数钉定（批 8 收口，架构侧要求）：每条白名单的 expectedHits 为当前实际命中数，
// 断言严格相等——新增命中即红（新增未经批准的同步 I/O），阶段 2 逐步消除也会红
// （已减少，强制更新计数使进展可见）。
const FILE_WHITELIST: Array<{ file: string; reason: string; expectedHits: number }> = [
  {
    file: "ops/config-integrity.ts",
    reason: "启动期配置完整性检查（非请求路径），D15 已登记为阶段 2 删除对象；用户指定例外",
    expectedHits: 4,
  },
  {
    file: "db/seed.ts",
    reason: "seed 源数据读取（一次性初始化 CLI）；用户指定例外",
    expectedHits: 1,
  },
  {
    file: "services/ai/rag-baseline/rag-baseline.cli.ts",
    reason: "rag-baseline 评测 CLI 入口（findProjectRoot/loadCandidate），非请求路径，不参与在线 store I/O",
    expectedHits: 2,
  },
  {
    file: "services/ai/rag-baseline/rag-baseline-dataset.ts",
    reason: "rag-baseline 离线数据集加载（loadRagBaselineDataset），非请求路径",
    expectedHits: 1,
  },
  {
    file: "services/ai/rag-baseline/rag-baseline-report.repository.ts",
    reason: "rag-baseline 离线报告落盘（saveRagBaselineArtifact），非请求路径",
    expectedHits: 1,
  },
  {
    file: "services/ai/rag-eval/prompt-registry.ts",
    reason: "prompt 模板配置读取，被 knowledge-tool.service（请求路径）复用为同步配置加载；异步化属阶段 2 评估项",
    expectedHits: 1,
  },
  {
    file: "utils/file.ts",
    reason: "loadJsonFile/saveJsonFile 通用同步工具；S6 后生产侧零调用方（loadJsonFile 仅剩 seed 测试 helper 读 seed 源 fixture，saveJsonFile 已全仓零引用 → 台账 B5，清理归 S7），异步化属阶段 2 评估项",
    expectedHits: 2,
  },
  {
    file: "modules/team/team.repository.ts",
    reason: "批 7 选择器下沉的 JSON 实现（loadTeamStoreJson/saveTeamStoreJson/saveTeamStoreWithExpectedVersionJson async accessor）共用的模块级同步原子写辅助 writeJsonAtomic，第 4 步随 JSON 路径删除",
    expectedHits: 1,
  },
];

function isWhitelistedFile(rel: string): string | null {
  const hit = FILE_WHITELIST.find((w) => rel === w.file);
  return hit ? hit.reason : null;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (
      /\.(ts|mts)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|mts)$/.test(entry.name) &&
      !/\.d\.(ts|mts)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/** 调用点是否位于「模块顶层 async + load/save 命名」accessor 函数体内。 */
function isInsideAccessorBody(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current)) return false;
    if (ts.isFunctionDeclaration(current)) {
      const name = current.name?.text;
      const isAsync = !!current.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      return isAsync && !!name && /^(load|save)[A-Z]\w*$/.test(name);
    }
    if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) return false;
    current = current.parent;
  }
  return false;
}

/** 最近外层函数名（便于失败定位）。 */
function enclosingFunctionName(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isFunctionLike(current)) {
      const name = current.name;
      return name && ts.isIdentifier(name) ? name.text : "<anon>";
    }
    current = current.parent;
  }
  return "<top-level>";
}

interface Hit {
  file: string;
  line: number;
  col: number;
  fn: string;
}

function findSyncIoCalls(): { hits: Hit[]; whitelisted: Array<Hit & { reason: string }> } {
  const hits: Hit[] = [];
  const whitelisted: Array<Hit & { reason: string }> = [];
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file);
    const whitelistReason = isWhitelistedFile(rel);
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf-8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        let calleeName: string | undefined;
        if (ts.isIdentifier(node.expression)) {
          calleeName = node.expression.text;
        } else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
          calleeName = node.expression.name.text;
        }
        if (calleeName && SYNC_IO_NAMES.has(calleeName) && !isInsideAccessorBody(node)) {
          const pos = sf.getLineAndCharacterOfPosition(node.getStart());
          const entry: Hit = {
            file: rel,
            line: pos.line + 1,
            col: pos.character + 1,
            fn: enclosingFunctionName(node),
          };
          if (whitelistReason) whitelisted.push({ ...entry, reason: whitelistReason });
          else hits.push(entry);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { hits, whitelisted };
}

test("全仓 store 仓储与请求路径无 readFileSync/writeFileSync 调用", () => {
  // 测试自身失效守卫：扫描路径解析错误或文件收集失败时直接暴露
  const scanned = collectSourceFiles(SRC_ROOT);
  assert.ok(scanned.length > 100, `扫描源文件数异常(${scanned.length})，测试自身失效`);

  const { hits, whitelisted } = findSyncIoCalls();
  for (const w of whitelisted) {
    console.log(`[no-sync-store-io] 白名单命中 ${w.file}:${w.line}:${w.col} (${w.fn}) — ${w.reason}`);
  }

  // 未白名单命中必须为 0（新增代码禁止 readFileSync/writeFileSync）
  assert.deepEqual(
    hits,
    [],
    [
      "同步 store I/O 调用未豁免（应为 0，新增代码禁止 readFileSync/writeFileSync）：",
      ...hits.map((h) => `  ${h.file}:${h.line}:${h.col} — ${h.fn}()`),
    ].join("\n"),
  );

  // 白名单计数钉定：每条白名单的实际命中数必须与 expectedHits 严格相等
  // 实际 > 预期 → 新增了未经批准的同步 I/O；实际 < 预期 → 已减少（阶段 2 进展），需更新计数
  const mismatches: string[] = [];
  for (const w of FILE_WHITELIST) {
    const actual = whitelisted.filter((h) => h.file === w.file).length;
    if (actual !== w.expectedHits) {
      const direction =
        actual > w.expectedHits
          ? `新增了未经批准的同步 I/O（actual=${actual} > expected=${w.expectedHits}）`
          : `已减少，请更新 expectedHits（阶段 2 进展）（actual=${actual} < expected=${w.expectedHits}）`;
      mismatches.push(`  ${w.file}: ${direction}`);
    }
  }
  assert.deepEqual(
    mismatches,
    [],
    ["白名单命中数与 expectedHits 不一致：", ...mismatches].join("\n"),
  );
});
