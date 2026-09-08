// ============================================================
// 批次 10a · 行业主数据用例测试（纯函数，无 DB）
// ============================================================
// 本域最容易被后人改错的一条规则是「父停用则子也不出」，
// 它落在纯函数里而不是 SQL 里，就是为了能在无 DB 用例中逐条钉住。

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildIndustryOptions,
  buildIndustryTree,
  parseIndustryStatus,
  sortMasterData,
} from "./industry.usecase";
import type { IndustryCategory, IndustrySubcategory } from "./industry.types";

function cat(id: string, name: string, extra: Partial<IndustryCategory> = {}): IndustryCategory {
  return {
    id,
    name,
    status: "active",
    sortOrder: 0,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    ...extra,
  };
}

function sub(id: string, categoryId: string, name: string, extra: Partial<IndustrySubcategory> = {}): IndustrySubcategory {
  return {
    id,
    categoryId,
    name,
    status: "active",
    sortOrder: 0,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    ...extra,
  };
}

// ---------------------------------------------------------------
// 两层树组装
// ---------------------------------------------------------------

test("buildIndustryTree：二级挂到所属一级下，无二级的一级 children 为空数组", () => {
  const tree = buildIndustryTree(
    [cat("c1", "制造业"), cat("c2", "其他")],
    [sub("s1", "c1", "离散制造")],
  );
  assert.equal(tree.length, 2);
  const mfg = tree.find((t) => t.id === "c1")!;
  const other = tree.find((t) => t.id === "c2")!;
  assert.deepEqual(
    mfg.children.map((c) => c.name),
    ["离散制造"],
  );
  assert.deepEqual(other.children, [], "无二级的一级必须给空数组而不是 undefined，列表页直接遍历");
});

test("buildIndustryTree：确定性排序 sort_order → 录入时间 → id", () => {
  const tree = buildIndustryTree(
    [
      cat("c3", "其他", { sortOrder: 1, createdAt: "2026-01-01T00:00:00.000Z" }),
      cat("c1", "制造业", { sortOrder: 0, createdAt: "2026-02-01T00:00:00.000Z" }),
      cat("c2", "IT", { sortOrder: 0, createdAt: "2026-01-15T00:00:00.000Z" }),
    ],
    [],
  );
  assert.deepEqual(
    tree.map((t) => t.name),
    ["IT", "制造业", "其他"],
    "sortOrder 优先；同为 0 时按录入先后（IT 早于 制造业），sortOrder=1 的「其他」最后——" +
      "不按名称：按码点「其他」会插到「制造业」前面，那是用户看不懂的顺序",
  );
});

test("buildIndustryTree：同一父下的二级也独立排序", () => {
  const tree = buildIndustryTree(
    [cat("c1", "制造业")],
    [sub("s2", "c1", "乙类", { sortOrder: 2 }), sub("s1", "c1", "甲类", { sortOrder: 1 })],
  );
  assert.deepEqual(
    tree[0].children.map((s) => s.name),
    ["甲类", "乙类"],
  );
});

test("buildIndustryTree：父键指向不存在一级的孤儿二级不会凭空造节点（当前无外键脏数据的兜底）", () => {
  const tree = buildIndustryTree([cat("c1", "制造业")], [sub("sX", "c-不存在", "野生的细分")]);
  const allChildren = tree.flatMap((t) => t.children.map((c) => c.name));
  assert.deepEqual(allChildren, [], "孤儿二级不得被塞进任何一级之下");
});

// ---------------------------------------------------------------
// 新建单据选项（停用效果的唯一判据落点）
// ---------------------------------------------------------------

test("buildIndustryOptions：启用的一级与二级都在，二级带父级前缀 label", () => {
  const tree = buildIndustryTree(
    [cat("c1", "制造业"), cat("c2", "其他")],
    [sub("s1", "c1", "离散制造")],
  );
  const options = buildIndustryOptions(tree);
  assert.deepEqual(
    options.map((o) => o.value),
    ["制造业", "离散制造", "其他"],
    "一级紧随其下二级，保证下拉里父子相邻",
  );
  assert.deepEqual(
    options.map((o) => o.level),
    [1, 2, 1],
  );
  assert.equal(options[1].label, "制造业 / 离散制造");
  assert.equal(options[1].parentValue, "制造业");
  assert.equal(options[0].parentValue, null);
});

test("buildIndustryOptions：停用的一级不出现在选项里", () => {
  const tree = buildIndustryTree([cat("c1", "制造业"), cat("c2", "其他", { status: "inactive" })], []);
  const options = buildIndustryOptions(tree);
  assert.deepEqual(
    options.map((o) => o.value),
    ["制造业"],
  );
});

test("buildIndustryOptions：一级停用时其下启用中的二级也一律不出（父子同进同出）", () => {
  const tree = buildIndustryTree(
    [cat("c1", "制造业", { status: "inactive" })],
    [sub("s1", "c1", "离散制造", { status: "active" })],
  );
  const options = buildIndustryOptions(tree);
  assert.deepEqual(options, [], "父不可选时把子放进下拉，等于让用户选到一个入口上进不去的节点");
});

test("buildIndustryOptions：只停用二级时一级仍在选项里（停用是逐节点的，不级联向上）", () => {
  const tree = buildIndustryTree(
    [cat("c1", "制造业")],
    [sub("s1", "c1", "离散制造", { status: "inactive" }), sub("s2", "c1", "流程制造")],
  );
  const options = buildIndustryOptions(tree);
  assert.deepEqual(
    options.map((o) => o.value),
    ["制造业", "流程制造"],
  );
});

test("buildIndustryOptions：option.value 是名称文本而不是主键（历史记录按文本引用行业）", () => {
  const tree = buildIndustryTree([cat("c1", "制造业")], []);
  const options = buildIndustryOptions(tree);
  assert.equal(options[0].value, "制造业");
  assert.notEqual(options[0].value, "c1", "存主键会让同一字段出现两种代际的值，正是本批要消灭的漂移");
});

test("buildIndustryTree + options：首批只有两条一级、二级留空时选项就是它们本身", () => {
  const tree = buildIndustryTree([cat("c1", "制造业"), cat("c2", "其他")], []);
  assert.deepEqual(
    buildIndustryOptions(tree).map((o) => o.value),
    ["制造业", "其他"],
    "与库中 version_records 真实值同族逐字一致（种子见 config/master-data/industries.json）",
  );
});

// ---------------------------------------------------------------
// 入参收敛
// ---------------------------------------------------------------

test("parseIndustryStatus：只认 active / inactive，其余（含大小写变体）一律 null", () => {
  assert.equal(parseIndustryStatus("active"), "active");
  assert.equal(parseIndustryStatus("inactive"), "inactive");
  for (const bad of ["Active", "INACTIVE", "deleted", "", null, undefined, 0, {}]) {
    assert.equal(parseIndustryStatus(bad), null, `${String(bad)} 必须判为非法而不是当成 active`);
  }
});

test("sortMasterData 不改动入参数组（纯函数）", () => {
  const rows = [cat("c2", "乙"), cat("c1", "甲")];
  const sorted = sortMasterData(rows);
  assert.deepEqual(
    sorted.map((r) => r.name),
    ["甲", "乙"],
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ["乙", "甲"],
    "入参不得被就地排序",
  );
});
