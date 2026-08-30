// ============================================================
// 防漂移测试：无界读表 / 单文档表的测试文件必须在串行套件内
// ============================================================
// 口径（阶段 2 S6，2026-08-29 架构侧裁决 O1 + 强制守卫要求；S3 扩容）：
// npm run test:modules 默认按文件并行执行；npm run test:modules:serial-store
// 带 --test-concurrency=1。向下列表写入行的测试文件必须落在串行套件，
// 否则并发执行会互相污染，且 git 合并无冲突标记、tsc 也通过，只在全量 CI
// 间歇性炸（存储语义互斥，台账 §10 B1/B2）。
//
// 各表的「无界」成因各不相同：
// - templates / rule_sets：单文档表，loadTemplate / loadRuleSet 按
//   updated_at DESC 取「最近写入行」当活动文档，不按主键取。任何测试写入
//   一行即成为同时段全体测试眼中的生效文档。
// - knowledge_entries：list() 全表读、无 id 与前缀限定，「空表合法状态」
//   断言隐含依赖本文件是唯一写入者。
// - system_configs（S3 新增，2026-08-30）：requirementSettings /
//   knowledgeBaseConfig / implementationDependencyRules 三个 config_key 各为一行
//   upsert，无隔离维度。共写文件：system-pg.repository / system.kb-config /
//   modules.handlers / assessment / workbench-dispatch（后两者是为注入 mock 模型与
//   测试 apiKey 而整份读写 store，它们的用例断言的是「读到刚写入的配置」）。
// - version_code_rules（同上，随 system 域走）：PG 写路径是事务内 TRUNCATE
//   整表再整表重插，比 upsert 更极端——任何测试写一次就清空同时段全表。
//
// 实现：文本扫描 src 下全部 *.test.ts（剥除注释后匹配写入指纹），
// 命中指纹却不在 SERIAL_SCOPE_FILES 内的文件即判红并报出文件名；
// 同时交叉核验白名单与 package.json 串行脚本的参数列表完全一致，
// 防止「加了脚本忘了守卫」与「加了守卫忘了脚本」两种漂移。
//
// 双向约束（S6 加固）：白名单里不属于已识别写入方的文件同样判红。
// 单向校验只能拦「漏登记」，拦不住「登记过期」——S6 把 knowledge 两个
// 用例改用 in-memory 替身后，它们在白名单里躺成僵尸条目（既占串行名额
// 又误导后人「此文件会写表」），正是靠人肉发现。加了反向校验后机械可现。
//
// 豁免机制：命中指纹但经核实不写行的文件（如只取用选择器断装配的测试）
// 走 DECLARED_NON_WRITERS，逐条登记理由与期望命中数，照抄
// no-sync-store-io.drift.test.ts 白名单范式；命中数变化即红，豁免不会过期。
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
  "modules/modules.handlers.test.ts",
  // S3（2026-08-30）：system 域 JSON 读写路径删除后，四个恒写 system_configs /
  // version_code_rules 单文档表的文件移进串行组
  "modules/system/system-pg.repository.test.ts",
  "modules/system/system.kb-config.test.ts",
  "services/ai/assessment.service.test.ts",
  "services/ai/workbench-dispatch.service.test.ts",
] as const;

/** 串行套件脚本名与并行套件脚本名。 */
const SERIAL_SCRIPT = "test:modules:serial-store";
const PARALLEL_SCRIPT = "test:modules";

/**
 * 写入指纹：命中任一项即认定该测试文件会向无界读表写入行。
 * 匹配「构造 PG 仓储 / 调用写入方法 / 直连选择器 / 经共享 helper 间接写入」
 * 的符号；seedSingleDocStoreFixture 是 S6 新增的共享种入 helper（本守卫
 * 只扫 *.test.ts，helper 自身不在扫描范围内），所以必须靠调用方指纹兼容。
 * 不匹配纯 reset 钩子；也不匹配 JSON 实现类残留名（写的是本文件私有
 * 临时路径，不触碰共享表，不构成跳文件污染）。
 * S3：后六条是 system 域写入口——两条仓储构造/类型名 + 四条 config 的 save*。
 * save* 同时覆盖 system_configs 的单行 upsert 与 version_code_rules 的整表替换
 * 两条写路径（save* 是唯一写入口，裸 SQL 写库不属仓储层能力，指纹不会漏到旁路）。
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
  /\bseedSingleDocStoreFixture\b/,
  /\bcreateSystemPgRepository\b/,
  /\bSystemPgRepository\b/,
  /\bsaveRequirementSystemConfigStore\b/,
  /\bsaveKnowledgeBaseConfigStore\b/,
  /\bsaveImplementationDependencyRulesStore\b/,
  /\bsaveVersionCodeRulesStore\b/,
];

/**
 * 命中指纹但经核实不写行的文件（豁免须同时钉期望命中数，防止
 * 豁免范围静默扩大；不再命中指纹时也必须显式删掉本条）。
 */
const DECLARED_NON_WRITERS: Array<{ file: string; expectedHits: number; why: string }> = [
  {
    file: "modules/knowledge/knowledge.repository.test.ts",
    expectedHits: 6,
    why: "S6 后收缩为装配测试：只取用选择器断实现装配与单例语义，全程不 await 任何仓储方法，不写 knowledge_entries 行",
  },
  {
    file: "modules/system/system.repository.test.ts",
    expectedHits: 2,
    why: "S3 后收缩为装配与纯函数测试：JSON 读写用例已逐条删除（职责去向见本文件头注释），命中项仅为 import 与 PG 工厂签名断言处的 createSystemPgRepository，全程不 await 任何仓储方法，不写 system_configs 行",
  },
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

/** 本文件内全部写入指纹的命中次数（已剥注释）。 */
function countPatternHits(absFile: string): number {
  const source = stripComments(fs.readFileSync(absFile, "utf-8"));
  return WRITER_PATTERNS.reduce(
    (sum, re) => sum + (source.match(new RegExp(re.source, "g")) ?? []).length,
    0,
  );
}

function findWriterFiles(): string[] {
  const exempt = new Set(DECLARED_NON_WRITERS.map((entry) => entry.file));
  const writers: string[] = [];
  for (const file of collectTestFiles(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
    // 守卫自身必然包含全部指纹字符串，跳过
    if (rel === "test-helpers/single-doc-serial-scope.drift.test.ts") continue;
    if (exempt.has(rel)) continue;
    if (countPatternHits(file) > 0) writers.push(rel);
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
      `以下测试文件向无界读表（templates / rule_sets / knowledge_entries / system_configs / version_code_rules）写入行，但不在 ${SERIAL_SCRIPT} 白名单内`,
      "并发执行会互相顶掉活动文档、打破「空表合法状态」断言，或把版本编码规则整表清空（存储语义互斥，仅在全量 CI 间歇性炸）：",
      ...unregistered.map((f) => `  src/${f}`),
      `处置：加进 apps/api/package.json 的 ${SERIAL_SCRIPT}，并把同一文件登记进本测试的 SERIAL_SCOPE_FILES。`,
    ].join("\n"),
  );

  // 反向约束：白名单里不得躺「已不再是写入方」的条目——它既白占串行名额，
  // 又向后人和下一个改这个机制的人传递错信息。真需要保留时（纯只读但
  // 依赖活动文档/全表状态的用例）应把读取形态补进 WRITER_PATTERNS，而不是往本表加水份。
  const stale = (SERIAL_SCOPE_FILES as readonly string[]).filter((f) => !writers.includes(f));
  assert.deepEqual(
    stale,
    [],
    [
      `以下文件在 ${SERIAL_SCRIPT} 白名单内，但已命中不了任何写入指纹（登记过期）：`,
      ...stale.map((f) => `  src/${f}`),
      "处置：确认它确实不再写行后从串行脚本与白名单同步移除；若它仍靠时序隔离，",
      "则把它实际依赖的读取形态补进 WRITER_PATTERNS，使指纹能真断到它。",
    ].join("\n"),
  );
});

test("不写行豁免清单不得过期（命中数必须逐位相等）", () => {
  for (const entry of DECLARED_NON_WRITERS) {
    const hits = countPatternHits(path.join(SRC_ROOT, entry.file));
    assert.ok(
      hits > 0,
      `豁免条目 ${entry.file} 已不再命中任何写入指纹，本条应直接删除（豁免不能靠惯性留着）`,
    );
    assert.equal(
      hits,
      entry.expectedHits,
      `${entry.file} 指纹命中数 ${hits} ≠ 登记值 ${entry.expectedHits}（豁免范围不得静默扩大）\n登记理由：${entry.why}`,
    );
    assert.ok(
      !(SERIAL_SCOPE_FILES as readonly string[]).includes(entry.file),
      `${entry.file} 既被声明为不写行，就不应同时在串行白名单内`,
    );
  }
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
    9,
    `SERIAL_SCOPE_FILES 实为 ${SERIAL_SCOPE_FILES.length} 条：新增即意味着有新的无界读表写入方，` +
      "减少即意味着有测试文件退役或改为数据集隔离——两种情况都需同步更新本计数与 §10 台账（S6：6→5，knowledge 两用例改 in-memory 替身移出、modules.handlers 因 B3 种入移进；S3：5→9，system 域 JSON 路径删除后四个恒写 system_configs / version_code_rules 的文件移进）"
  );
});
