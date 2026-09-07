// ============================================================
// 批次 9 · 判据⑤ 零回归对照（常驻核对脚本，不属生产代码）
// ============================================================
// 本批明令「旧文本抽取路径行为必须逐字节不变」，口头保证不算实取：
// 这里把同一批输入分别喂给「改前」（git HEAD 那份原件）与「改后」（工作区当前件），
// 逐字节比对返回值的 JSON 序列化。有任何一处不同即非零退出。
//
// 临时件必须与原件**同目录**：它对 ./json-utils 是相对导入，放进子目录解析不到。
// 比对数为 0 也算失败——静默空跑是本类脚本最阴的失效形态（拿不到证据却显示绿）。
//
// 跑法：cd apps/api && npx tsx scripts/b9-legacy-formblock-ab.mts
// ============================================================

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(import.meta.dirname, "..");
const REL = "src/services/ai/handlers/form-block.ts";
/** 与原件同目录的兄弟文件；跑完无条件删除（finally） */
const BEFORE_REL = "src/services/ai/handlers/form-block.b9before.ts";

const oldSource = execFileSync("git", ["show", `HEAD:./${REL}`], { cwd: ROOT, encoding: "utf8" });
const currentSource = readFileSync(resolve(ROOT, REL), "utf8");
console.log(
  oldSource === currentSource
    ? "⚠ 工作区与 HEAD 完全一致：本次对照是同源自比（只能证明函数是纯的，证明不了「加注释没改行为」）"
    : "对照有效：改前（HEAD）与改后（工作区）是两份不同文件",
);

const FORM = {
  blockId: "b",
  title: "请补充",
  submitLabel: "提交",
  fields: [{ id: "x", label: "X", type: "text" }],
};

/** 覆盖三条抽取策略 + 契约边界 + 真实失效形态 */
const fenced = (obj) => "```json\n" + JSON.stringify(obj) + "\n```";
const CORPUS = [
  ["纯文本无表单", "今天天气不错"],
  ["正常正文", "项目已创建"],
  ["围栏 json", fenced({ formBlock: FORM })],
  ["围栏无语言", "```\n" + JSON.stringify({ formBlock: FORM }) + "\n```"],
  ["正文 + 围栏", "请先补充：\n" + fenced({ formBlock: FORM })],
  ["裸 JSON 无围栏", JSON.stringify({ formBlock: FORM })],
  ["截断无闭合围栏", "```json\n" + JSON.stringify({ formBlock: FORM }).slice(0, 40)],
  ["坏结构（fields 空）", fenced({ formBlock: { ...FORM, fields: [] } })],
  // 会话 7f5cbf75 的真实错法：模型把字段键写成 name，而契约要 id
  ["字段键用 name", fenced({ formBlock: { blockId: "b", title: "t", submitLabel: "s", fields: [{ name: "x", label: "X", type: "text" }] } })],
  ["非表单 json 块", fenced({ answer: "42" })],
  ["两个围栏块", fenced({ formBlock: FORM }) + "\n再看\n" + fenced({ formBlock: { ...FORM, blockId: "c" } })],
  ["空串", ""],
  ["只有空白", "   \n  "],
  ["行内码 + 伪围栏", "示例：`inline` 与 ```\nnot json\n```"],
  ["正文提到 formBlock 字样", '这里提到 "formBlock" 字样但不是 JSON'],
  ["单引号非法 JSON", "```json\n{'formBlock':{'blockId':'b'}}\n```"],
  ["字段数超上限", fenced({ formBlock: { ...FORM, fields: Array.from({ length: 12 }, (_u, i) => ({ id: `f${i}`, label: `题${i}`, type: "text" })) } })],
  ["未知字段类型", fenced({ formBlock: { ...FORM, fields: [{ id: "a", label: "A", type: "date_picker" }] } })],
  ["多余顶层属性", fenced({ formBlock: { ...FORM, theme: "dark" } })],
  ["非 formBlock 顶层键", fenced({ blockId: "b", title: "t" })],
  ["五类字段全用一遍", fenced({ formBlock: { ...FORM, fields: [
    { id: "a", label: "A", type: "text" },
    { id: "b", label: "B", type: "textarea" },
    { id: "c", label: "C", type: "single_select", options: [{ label: "1", value: "1" }] },
    { id: "d", label: "D", type: "boolean" },
    { id: "e", label: "E", type: "number" },
  ] } })],
];

writeFileSync(resolve(ROOT, BEFORE_REL), oldSource);
let compared = 0;
let diffs = 0;

try {
  const [{ extractFormBlockFromModelOutput: before }, { extractFormBlockFromModelOutput: after }] = await Promise.all([
    import(pathToFileURL(resolve(ROOT, BEFORE_REL)).href),
    import(pathToFileURL(resolve(ROOT, REL)).href),
  ]);

  const check = (label, ...args) => {
    compared += 1;
    const b = JSON.stringify(before(...args));
    const a = JSON.stringify(after(...args));
    if (b !== a) {
      diffs += 1;
      console.log(`DIFF ${label} 第二参=${JSON.stringify(args[1] ?? null)}\n  before=${b}\n  after =${a}`);
    }
  };

  for (const [label, input] of CORPUS) {
    // 三种生产真实调用形态：单参（正文即全文）、双参同源（model-answer 的调用法）、双参异源
    check(label, input);
    check(`${label}/同参`, input, input);
    check(`${label}/异参`, input, `raw:${input}`);
  }

  assert.ok(compared > 0, "零比对即失败：一条输入都没喂进去，绿是本批要防的那种假绿");
  console.log(`判据⑤ 对照：${compared} 组调用（${CORPUS.length} 条输入 × 3 种调用形态），差异 ${diffs} 处`);
  assert.equal(diffs, 0, "旧文本抽取路径行为必须逐字节不变");
  console.log("✔ 零回归：改前改后输出逐字节相同");
} finally {
  rmSync(resolve(ROOT, BEFORE_REL), { force: true });
}
