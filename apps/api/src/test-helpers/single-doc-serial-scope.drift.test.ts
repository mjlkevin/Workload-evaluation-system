// ============================================================
// 防漂移测试：无界读表 / 单文档表的测试文件必须在串行套件内
// ============================================================
// 口径（阶段 2 S6，2026-08-29 架构侧裁决 O1 + 强制守卫要求）：
// npm run test:modules 默认按文件并行执行；npm run test:modules:serial-store
// 带 --test-concurrency=1。向下列三张表写入行的测试文件必须落在串行套件，
// 否则并发执行会互相污染，且 git 合并无冲突标记、tsc 也通过，只在全量 CI
// 间歇性炸（存储语义互斥，台账 §10 B1/B2）。
//
// 三张表的「无界」成因各不相同：
// - templates / rule_sets：单文档表，loadTemplate / loadRuleSet 按
//   updated_at DESC 取「最近写入行」当活动文档，不按主键取。任何测试写入
//   一行即成为同时段全体测试眼中的生效文档。
// - knowledge_entries：list() 全表读、无 id 与前缀限定，「空表合法状态」
//   断言隐含依赖本文件是唯一写入者。
//
// 实现：文本扫描 src 下全部 *.test.ts（剥除注释后匹配写入指纹），
// 命中指纹却不在 SERIAL_SCOPE_FILES 内的文件即判红并报出文件名；
// 同时交叉核验白名单与 package.json 串行脚本的参数列表完全一致，
// 防止「加了脚本忘了守卫」与「加了守卫忘了脚本」两种漂移。
//
// 白名单计数钉定：expectedFiles 与实际条目严格相等——新增触碰即红
// （要求显式登记），阶段 2 后续批次收敛也会红（强制更新，进展可见）。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const API_ROOT = path.resolve(__dirname, "..", "..");
const SRC_ROOT = path.join(API_ROOT, "src");

/** 触碰无界读表 / 单文档表的写入指纹 → 必须串行执行的文件。 */
const SERIAL_SCOPE_FILES = [
  "modules/templates/templates-pg.repository.test.ts",
  "modules/rules/rules-pg.repository.test.ts",
  "modules/modules.usecase.test.ts",
  "modules/knowledge/knowledge-pg.repository.test.ts",
  "modules/knowledge/knowledge.usecase.test.ts",
  "routes/knowledge.routes.test.ts",
] as const;

/** 串行套件脚本名与并行套件脚本名。 */
const SERIAL_SCRIPT = "test:modules:serial-store";
const PARALLEL_SCRIPT = "test:modules";

/**
 * 写入指纹：命中任一项即认定该测试文件会向无界读表写入行。
 * 只匹配「构造 PG 仓储 / 调用写入方法 / 直连选择器」的符号，不匹配
 * 纯 reset 钩子（modules.handlers.test.ts 仅取用 _reset*ForTest()，
 * 属只读方，留在并行套件）；也不匹配 JSON 实现类（new KnowledgeRepository
 * 写的是本文件私有临时路径，不触碰共享表，不构成跨文件污染）。
 */
const WRITER_PATTERNS: RegExp[] = [
  /\bcreateTemplatesPgRepository\b/,
  /\bTemplatesPgRepository\b/,
  /\bgetTemplateRepository\b/,
  /\bsaveTemplate\b/,
  /\bcreateRuleSetsPgRepository\b/,
  /\bRuleSetsPgRepository\b/,
  /\bgetRuleSetRepository\b/,
  /\bsaveRuleSet\b/,
  /\bKnowledgePgRepository\b/,
  /\bgetKnowledgeRepository\b/,
];

/** 剥除行注释与块注释，避免文档性提及被误判为写入。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function collectTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTestFiles(full, out);
    else if (/\.(test|spec)\.(ts|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function findWriterFiles(): string[] {
  const writers: string[] = [];
  for (const file of collectTestFiles(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
    // 守卫自身必然包含全部指纹字符串，跳过
    if (rel === "test-helpers/single-doc-serial-scope.drift.test.ts") continue;
    const source = stripComments(fs.readFileSync(file, "utf-8"));
    if (WRITER_PATTERNS.some((re) => re.test(source))) writers.push(rel);
  }
  return writers.sort();
}

/** 从 npm script 中取出 src/ 下的文件参数列表（相对 src 的路径）。 */
function scriptFiles(script: string): string[] {
  return script
    .split(/\s+/)
    .filter((tok) => tok.startsWith("src/"))
    .map((tok) => tok.slice("src/".length))
    .sort();
}

test("触碰无界读表与单文档表的测试文件必须全部在串行白名单内", () => {
  const scanned = collectTestFiles(SRC_ROOT);
  assert.ok(scanned.length > 40, `扫描测试文件数异常(${scanned.length})，测试自身失效`);

  const writers = findWriterFiles();
  const unregistered = writers.filter((f) => !(SERIAL_SCOPE_FILES as readonly string[]).includes(f));
  assert.deepEqual(
    unregistered,
    [],
    [
      `以下测试文件向 templates / rule_sets / knowledge_entries 写入行，但不在 ${SERIAL_SCRIPT} 白名单内`,
      "并发执行会互相顶掉活动文档或打破「空表合法状态」断言（存储语义互斥，仅在全量 CI 间歇性炸）：",
      ...unregistered.map((f) => `  src/${f}`),
      `处置：加进 apps/api/package.json 的 ${SERIAL_SCRIPT}，并把同一文件登记进本测试的 SERIAL_SCOPE_FILES。`,
    ].join("\n"),
  );
});

test("串行白名单与 package.json 脚本参数列表逐位一致", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(API_ROOT, "package.json"), "utf-8")) as {
    scripts: Record<string, string>;
  };
  const serialScript = pkg.scripts[SERIAL_SCRIPT];
  const parallelScript = pkg.scripts[PARALLEL_SCRIPT];
  assert.ok(serialScript, `${SERIAL_SCRIPT} 脚本缺失`);
  assert.ok(parallelScript, `${PARALLEL_SCRIPT} 脚本缺失`);
  assert.ok(
    serialScript.includes("--test-concurrency=1"),
    `${SERIAL_SCRIPT} 必须带 --test-concurrency=1，否则串行约束失效`,
  );

  const scriptList = scriptFiles(serialScript);
  assert.deepEqual(
    scriptList,
    [...SERIAL_SCOPE_FILES].sort(),
    `${SERIAL_SCRIPT} 的文件列表与本守卫 SERIAL_SCOPE_FILES 不一致（单边改动即漂移）`,
  );

  const parallelList = scriptFiles(parallelScript);
  const leaked = scriptList.filter((f) => parallelList.includes(f));
  assert.deepEqual(leaked, [], `串行套件文件同时出现在 ${PARALLEL_SCRIPT}，会被并行执行：` + leaked.join(", "));
});

test("串行白名单计数钉定（新增触碰或批次收敛都必须显式更新本条）", () => {
  assert.equal(
    SERIAL_SCOPE_FILES.length,
    6,
    `SERIAL_SCOPE_FILES 实为 ${SERIAL_SCOPE_FILES.length} 条：新增即意味着有新的无界读表写入方，` +
      "减少即意味着有测试文件退役或改为数据集隔离——两种情况都需同步更新本计数与 §10 台账",
  );
});
