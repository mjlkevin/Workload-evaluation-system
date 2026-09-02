// ============================================================
// 防漂移测试：apps/api/src 与仓根 scripts/ 下全部测试文件必须被
// 「CI 可达」脚本或 CI 工作流引用
// ============================================================
// 口径（阶段 3 批 2，2026-09-01，A/B）：
// 批 1（A2）判据是「被某条 test* 脚本引用」，同一失效类型两处仍成立：
//   缺口 1：scripts/ 下 6 个测试文件不在 CI 执行范围，守卫扫不到
//           （board-event / board-work-items / speak-plainly-skill 零引用；
//           branch-board / branch-board-page 被 test:board:branches 引用
//           但该脚本不在 CI；check-tracked-secrets 被 test:security 引用
//           但该脚本不在 CI——批 2 任务 C 已让其进 CI）。
//   缺口 2：新增一条脚本把文件挂上去即可让守卫满意，而 CI 可能压根
//           不执行那条脚本（缺口 1 后 3 条就是这个形态的活样本）。
// 本版判据升级为「CI 可达」：
//   - 从 .github/workflows/*.yml 的 run: 命令解析 CI 实际执行的 npm 脚本
//     集合（含 npm run X / npm run X -w apps/api / cd apps/api && npm run X /
//     --prefix 等形态；非 npm run 命令如 npm ci / npx tsc 自然跳过）
//   - 一层转发：CI 直接执行的根脚本内容里 npm run Y（-w apps/api → api 包，
//     --prefix 属其它包跳过）→ Y 同样 CI 可达（如根 test:rules → api test:rules）
//   - 引用源只认 CI 可达脚本的 src/ 与 scripts/ 参数（glob 展开保留，
//     当前在役 glob：test:modules 的 src/services/ai/rag-baseline/*.test.ts）
//     + 工作流直引（src/*.test.ts 与 scripts/*.test.js）
//   - 被非 CI 可达脚本引用的测试文件按零引用处理（要么让该脚本进 CI，
//     要么登记 EXCLUDED 并写明原因）
// 扫描面：apps/api/src（*.test.ts/.mts）+ 仓根 scripts/（*.test.ts/.mts/.js）。
// 零引用文件永不运行——断言跑绿全是假绿证据（credentials.store.test.ts
// 曾被 system.repository.test.ts:28 注释当作「幂等语义已覆盖」的依据而
// 从未运行，该注释已随批 1 修正）。
// 排除：EXCLUDED 显式清单，每条必须带 reason（需外部密钥 / 需人工数据 /
// 成本高 等「有意排除」在此登记，让守卫认得是有意为之而非漂移）。
// 接入优先于排除：写进 CI 可达脚本前先本地实跑，且断言必须是无条件形态
// （§4.11 A-1/A-2/A-3——if (x.ok) { assert } / if (!x.ok) return 跑绿
// 不构成有效覆盖）。
// 守卫自身被 test:modules 引用（CI 可达），扫描时跳过。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const API_ROOT = path.join(REPO_ROOT, "apps", "api");
const SRC_ROOT = path.join(API_ROOT, "src");
const SCRIPTS_DIR = path.join(REPO_ROOT, "scripts");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");

const SELF = "test-helpers/test-file-reference.drift.test.ts";

/** 显式排除清单：有意不接入任何 CI 可达套件的文件（src/ 或 scripts/ 相对路径），每条必须带 reason。 */
// 当前无条目——批 1 14 个零引用已全部处理（13 接入 + 1 删除）；批 2 scripts/ 6 个
// 已全部接入（5 个进 test:scripts + check-tracked-secrets 随 test:security 进 CI，
// 见台账 §10 S3B2 分诊表）。未来若出现「写完就废」之外的有意排除（外部密钥 /
// 人工数据 / 成本高），在此登记并写明原因；条目过期（文件已删或已被引用）由
// 下方测试兜底报红。
const EXCLUDED: Array<{ file: string; reason: string }> = [];

function collectTestFiles(dir: string, re: RegExp, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTestFiles(full, re, out);
    else if (re.test(entry.name)) out.push(full);
  }
  return out;
}

/** 展开脚本 token：具体文件原样返回；glob 仅支持「目录/*.ext」形态（当前唯一在役形态）。 */
function expandGlob(token: string, baseDir: string, prefix: string): string[] {
  const starIdx = token.indexOf("*");
  if (starIdx === -1) return [token];
  const slashIdx = token.lastIndexOf("/", starIdx);
  let dirPart = token.slice(0, slashIdx);
  if (dirPart.startsWith(`${prefix}/`)) dirPart = dirPart.slice(prefix.length + 1);
  const pattern = token.slice(slashIdx + 1);
  const absDir = path.join(baseDir, dirPart);
  if (!fs.existsSync(absDir)) return [];
  const re = new RegExp(
    "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return fs
    .readdirSync(absDir)
    .filter((f) => re.test(f))
    .map((f) => `${prefix}/${dirPart}/${f}`);
}

/** 从 npm 脚本内容提取 src/（相对 apps/api/src）与 scripts/（相对仓根 scripts/）参数。 */
function scriptTokensInto(script: string, into: { src: Set<string>; scripts: Set<string> }): void {
  for (const tok of script.split(/\s+/)) {
    let p = tok;
    if (p.startsWith("apps/api/")) p = p.slice("apps/api/".length);
    if (p.startsWith("src/")) {
      for (const f of expandGlob(p, SRC_ROOT, "src")) into.src.add(f.slice("src/".length));
    } else if (p.startsWith("scripts/")) {
      for (const f of expandGlob(p, SCRIPTS_DIR, "scripts")) {
        into.scripts.add(f.slice("scripts/".length));
      }
    }
  }
}

/** CI 直接执行的 npm 脚本（run: 行）：根集与 api 集（cd apps/api 或 -w apps/api 形态）。 */
function ciDirectScripts(): { root: Set<string>; api: Set<string> } {
  const root = new Set<string>();
  const api = new Set<string>();
  if (!fs.existsSync(WORKFLOWS_DIR)) return { root, api };
  for (const wf of fs.readdirSync(WORKFLOWS_DIR)) {
    if (!/\.ya?ml$/.test(wf)) continue;
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, wf), "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*run:\s*['"]?(.+?)['"]?\s*$/);
      if (!m) continue;
      const cmd = m[1];
      // -w apps/api 出现在整行内即整个命令属 api 包；cd apps/api 同
      const apiCwd = /cd\s+apps\/api\b/.test(cmd) || /(?:^|\s)-w\s+apps\/api\b/.test(cmd);
      for (const mm of cmd.matchAll(/npm run ([\w:.-]+)/g)) {
        if (apiCwd) api.add(mm[1]);
        else root.add(mm[1]);
      }
    }
  }
  return { root, api };
}

/**
 * CI 可达脚本全集：CI 直接执行的脚本 + 一层转发
 * （CI 执行的根脚本内容里 npm run Y：-w apps/api → api 包；无 -w → 根包；
 *   --prefix 属其它包（ui 等）不产 src/scripts 参数，跳过）。
 */
function ciReachableScripts(): { root: Set<string>; api: Set<string> } {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
  ) as { scripts?: Record<string, string> };
  const apiPkg = JSON.parse(
    fs.readFileSync(path.join(API_ROOT, "package.json"), "utf-8"),
  ) as { scripts?: Record<string, string> };
  const { root, api } = ciDirectScripts();
  for (const name of [...root]) {
    const script = rootPkg.scripts?.[name];
    if (!script) continue;
    for (const mm of script.matchAll(/npm run ([\w:.-]+)(?:\s+-w\s+([\w./-]+))?/g)) {
      if (mm[2]) {
        if (mm[2] === "apps/api") api.add(mm[1]);
        // 其它 workspace（ui 等）无 src/scripts 测试参数，跳过
      } else if (!/(?:^|\s)--prefix\b/.test(script)) {
        root.add(mm[1]);
      }
    }
  }
  return { root, api };
}

/**
 * 工作流直引：只认 run: 行的命令内容（防未来工作流绕过 npm script 直接跑文件）。
 * S3B3（任务 C）：不再对整份 YAML 做正则——若注释里写出 scripts/xxx.test.js 形态的路径，
 * 该文件会被当成已引用（假绿路径）；只认 run: 行（或 # 起始注释行天然跳过）。
 */
function workflowDirectRefs(content: string, into: { src: Set<string>; scripts: Set<string> }): void {
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*run:\s*['"]?(.+?)['"]?\s*$/);
    if (!m) continue;
    for (const mm of m[1].matchAll(/src\/[\w./-]+\.test\.(?:ts|mts)/g)) {
      into.src.add(mm[0].slice("src/".length));
    }
    for (const mm of m[1].matchAll(/scripts\/[\w./-]+\.test\.(?:js|ts|mts)/g)) {
      into.scripts.add(mm[0].slice("scripts/".length));
    }
  }
}

/** CI 可达引用源并集：src 相对 apps/api/src、scripts 相对仓根 scripts/。 */
function collectReferenced(): { src: Set<string>; scripts: Set<string> } {
  const refs = { src: new Set<string>(), scripts: new Set<string>() };
  const { root, api } = ciReachableScripts();
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
  ) as { scripts?: Record<string, string> };
  const apiPkg = JSON.parse(
    fs.readFileSync(path.join(API_ROOT, "package.json"), "utf-8"),
  ) as { scripts?: Record<string, string> };
  for (const name of root) {
    const script = rootPkg.scripts?.[name];
    // 只认 test* 脚本；.note 等文档键（键名含点）自然跳过
    if (script && name.startsWith("test") && !name.includes(".")) scriptTokensInto(script, refs);
  }
  for (const name of api) {
    const script = apiPkg.scripts?.[name];
    if (script && name.startsWith("test") && !name.includes(".")) scriptTokensInto(script, refs);
  }
  if (fs.existsSync(WORKFLOWS_DIR)) {
    for (const wf of fs.readdirSync(WORKFLOWS_DIR)) {
      if (!/\.ya?ml$/.test(wf)) continue;
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, wf), "utf-8");
      workflowDirectRefs(content, refs);
    }
  }
  return refs;
}

test("apps/api/src 与 scripts/ 下全部测试文件必须被 CI 可达脚本或工作流引用（零引用即失败）", () => {
  const scannedSrc = collectTestFiles(SRC_ROOT, /\.test\.(ts|mts)$/);
  assert.ok(scannedSrc.length > 80, `src 扫描测试文件数异常(${scannedSrc.length})，测试自身失效`);
  const scannedScripts = collectTestFiles(SCRIPTS_DIR, /\.test\.(ts|mts|js)$/);
  assert.ok(scannedScripts.length >= 6, `scripts 扫描测试文件数异常(${scannedScripts.length})，测试自身失效`);

  const referenced = collectReferenced();
  const excluded = new Set(EXCLUDED.map((e) => e.file));
  const orphans = [
    ...scannedSrc
      .map((f) => path.relative(SRC_ROOT, f).split(path.sep).join("/"))
      .filter((rel) => rel !== SELF)
      .filter((rel) => !referenced.src.has(rel))
      .filter((rel) => !excluded.has(rel))
      .map((rel) => `src/${rel}`),
    ...scannedScripts
      .map((f) => path.relative(SCRIPTS_DIR, f).split(path.sep).join("/"))
      .filter((rel) => !referenced.scripts.has(rel))
      .filter((rel) => !excluded.has(rel))
      .map((rel) => `scripts/${rel}`),
  ].sort();

  assert.deepEqual(
    orphans,
    [],
    [
      "以下测试文件零引用（不在任何 CI 可达 test* 脚本或 CI 工作流中，也不在排除清单内）——永不运行，断言跑绿即假绿：",
      ...orphans,
      "处置：接入 CI 可达套件（先本地实跑，断言须为无条件形态 §4.11 A-1/A-2/A-3；",
      "被非 CI 可达脚本引用的文件同样按零引用处理——让该脚本进 CI，或登记 EXCLUDED 写明原因），",
      "或确认属「有意排除」（需外部密钥 / 需人工数据 / 成本高）后登记进本守卫 EXCLUDED 并写明原因。",
    ].join("\n"),
  );
});

test("工作流直引只认 run: 行，注释里的测试路径不计入引用（S3B3 任务 C）", () => {
  const refs = { src: new Set<string>(), scripts: new Set<string>() };
  const yaml = [
    "# 示例注释：scripts/comment-fake.test.js 不应计入",
    "# scripts/another-comment.test.js 也不计入",
    "steps:",
    "  - name: run scripts tests",
    "    run: node scripts/real.test.js src/real.test.ts",
    "  - name: commented-out step",
    "    # run: node scripts/comment-fake.test.js",
  ].join("\n");
  workflowDirectRefs(yaml, refs);
  assert.deepEqual([...refs.scripts], ["real.test.js"]);
  assert.deepEqual([...refs.src], ["real.test.ts"]);
});

test("排除清单条目不得过期（文件已删或已被引用都必须移除条目）", () => {
  const scanned = new Set([
    ...collectTestFiles(SRC_ROOT, /\.test\.(ts|mts)$/).map((f) =>
      `src/${path.relative(SRC_ROOT, f).split(path.sep).join("/")}`,
    ),
    ...collectTestFiles(SCRIPTS_DIR, /\.test\.(ts|mts|js)$/).map((f) =>
      `scripts/${path.relative(SCRIPTS_DIR, f).split(path.sep).join("/")}`,
    ),
  ]);
  const referenced = collectReferenced();
  const referencedAll = new Set([
    ...[...referenced.src].map((f) => `src/${f}`),
    ...[...referenced.scripts].map((f) => `scripts/${f}`),
  ]);
  for (const e of EXCLUDED) {
    assert.ok(e.reason.length > 0, `排除条目 ${e.file} 必须写明原因`);
    assert.ok(scanned.has(e.file), `排除条目 ${e.file} 已不存在（文件已删除），本条应一并删除`);
    assert.ok(
      !referencedAll.has(e.file),
      `排除条目 ${e.file} 已被 CI 可达脚本或工作流引用——接入优先于排除，本条应删除`,
    );
  }
});
