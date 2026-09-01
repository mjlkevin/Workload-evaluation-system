// ============================================================
// 防漂移测试：apps/api/src 下全部测试文件必须被 test* 脚本或 CI 工作流引用
// ============================================================
// 口径（阶段 3 批 1，2026-09-01，A2）：
// 阶段 3 立项时实测 112 个 *.test.ts 中 18 个零引用（架构侧复核后
// rag-baseline 4 个为 glob 误报，真实零引用 14 个，台账 §10 B4）。
// 零引用文件永不运行——断言跑绿全是假绿证据（credentials.store.test.ts
// 曾被 system.repository.test.ts:28 注释当作「幂等语义已覆盖」的依据而
// 从未运行，该注释已随本批修正）。本守卫把「每个测试文件必须被引用」
// 变成机械可现的失败条件，分诊不再是一次性动作。
//
// 引用源（三路并集）：
//  1) apps/api/package.json 全部 test* 脚本的 src/ 参数（含 glob 展开，
//     当前在役 glob：test:modules 的 src/services/ai/rag-baseline/*.test.ts）
//  2) 根 package.json 全部 test* 脚本的 src/ 参数（test:security 直引
//     apps/api/src/...，需剥前缀；-w 转发脚本不产参数，自然跳过）
//  3) .github/workflows/*.yml 中的 src/*.test.ts 直引（防未来工作流绕过
//     npm script 直接跑文件；当前 ci.yml 全部走 npm run test:*，无直引）
//
// 排除：EXCLUDED 显式清单，每条必须带 reason（需外部密钥 / 需人工数据 /
// 成本高 等「有意排除」在此登记，让守卫认得是有意为之而非漂移）。
// 接入优先于排除：写进 test:* 脚本前先本地实跑，且断言必须是无条件形态
// （§4.11 A-1/A-2/A-3——if (x.ok) { assert } / if (!x.ok) return 跑绿
// 不构成有效覆盖）。
//
// 守卫自身被 test:modules 引用（package.json 清单内），扫描时跳过。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const API_ROOT = path.join(REPO_ROOT, "apps", "api");
const SRC_ROOT = path.join(API_ROOT, "src");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");

const SELF = "test-helpers/test-file-reference.drift.test.ts";

/** 显式排除清单：有意不接入任何 test* 套件的文件，每条必须带 reason。 */
// 当前无条目——本批 14 个零引用文件已全部处理（13 接入 + 1 删除，见台账
// §10 B4 分诊表）。未来若出现「写完就废」之外的有意排除（外部密钥 / 人工
// 数据 / 成本高），在此登记并写明原因；条目过期（文件已删或已被引用）由
// 下方测试兜底报红。
const EXCLUDED: Array<{ file: string; reason: string }> = [];

function collectTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTestFiles(full, out);
    else if (/\.test\.(ts|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 展开脚本 token：具体文件原样返回；glob 仅支持「目录/*.test.ts」形态（当前唯一在役形态）。 */
function expandGlob(token: string): string[] {
  const starIdx = token.indexOf("*");
  if (starIdx === -1) return [token];
  const slashIdx = token.lastIndexOf("/", starIdx);
  const dirPart = token.slice(0, slashIdx);
  const pattern = token.slice(slashIdx + 1);
  // SRC_ROOT 已是 src，dirPart 的 src/ 前缀需剥掉
  const dirRel = dirPart.startsWith("src/") ? dirPart.slice("src/".length) : dirPart;
  const absDir = path.join(SRC_ROOT, dirRel);
  if (!fs.existsSync(absDir)) return [];
  const re = new RegExp(
    "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return fs
    .readdirSync(absDir)
    .filter((f) => re.test(f))
    .map((f) => `${dirPart}/${f}`);
}

/** 从 npm 脚本内容提取 src/ 参数（apps/api/ 前缀先剥掉），glob 展开后转相对 src 的路径。 */
function scriptTokens(script: string): string[] {
  const out: string[] = [];
  for (const tok of script.split(/\s+/)) {
    let p = tok;
    if (p.startsWith("apps/api/")) p = p.slice("apps/api/".length);
    if (!p.startsWith("src/")) continue;
    for (const f of expandGlob(p)) out.push(f.slice("src/".length));
  }
  return out;
}

/** 三路引用源并集（相对 apps/api/src 的路径）。 */
function collectReferenced(): Set<string> {
  const refs = new Set<string>();
  for (const pkgPath of [path.join(API_ROOT, "package.json"), path.join(REPO_ROOT, "package.json")]) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> };
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
      // 只认 test* 脚本；.note 等文档键（键名含点）与 cc 包装（无 src 参数）自然跳过
      if (name.startsWith("test") && !name.includes(".")) {
        for (const f of scriptTokens(script)) refs.add(f);
      }
    }
  }
  if (fs.existsSync(WORKFLOWS_DIR)) {
    for (const wf of fs.readdirSync(WORKFLOWS_DIR)) {
      if (!/\.ya?ml$/.test(wf)) continue;
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, wf), "utf-8");
      for (const m of content.matchAll(/src\/[\w./-]+\.test\.(?:ts|mts)/g)) {
        refs.add(m[0].slice("src/".length));
      }
    }
  }
  return refs;
}

test("apps/api/src 下全部测试文件必须被 test* 脚本或 CI 工作流引用（零引用即失败）", () => {
  const scanned = collectTestFiles(SRC_ROOT);
  assert.ok(scanned.length > 80, `扫描测试文件数异常(${scanned.length})，测试自身失效`);

  const referenced = collectReferenced();
  const excluded = new Set(EXCLUDED.map((e) => e.file));
  const orphans = scanned
    .map((f) => path.relative(SRC_ROOT, f).split(path.sep).join("/"))
    .filter((rel) => rel !== SELF)
    .filter((rel) => !referenced.has(rel))
    .filter((rel) => !excluded.has(rel))
    .sort();

  assert.deepEqual(
    orphans,
    [],
    [
      "以下测试文件零引用（不在任何 test* 脚本或 CI 工作流中，也不在排除清单内）——永不运行，断言跑绿即假绿：",
      ...orphans.map((f) => `  src/${f}`),
      "处置：接入对应 test:* 套件（先本地实跑，断言须为无条件形态 §4.11 A-1/A-2/A-3），",
      "或确认属「有意排除」（需外部密钥 / 需人工数据 / 成本高）后登记进本守卫 EXCLUDED 并写明原因。",
    ].join("\n"),
  );
});

test("排除清单条目不得过期（文件已删或已被引用都必须移除条目）", () => {
  const scanned = new Set(
    collectTestFiles(SRC_ROOT).map((f) => path.relative(SRC_ROOT, f).split(path.sep).join("/")),
  );
  const referenced = collectReferenced();
  for (const e of EXCLUDED) {
    assert.ok(e.reason.length > 0, `排除条目 ${e.file} 必须写明原因`);
    assert.ok(scanned.has(e.file), `排除条目 ${e.file} 已不存在（文件已删除），本条应一并删除`);
    assert.ok(
      !referenced.has(e.file),
      `排除条目 ${e.file} 已被 test* 脚本或 CI 工作流引用——接入优先于排除，本条应删除`,
    );
  }
});
