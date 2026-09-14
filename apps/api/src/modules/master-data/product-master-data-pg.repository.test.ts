// ============================================================
// 批次 10b · 产品主数据 PG 仓储测试
// ============================================================
// 覆盖三条裁决用例：
//   2. (产品, SKU, 模块) 唯一约束由结构挡住重复插入
//   3. 同名模块在不同产品下可以有不同标准人天
//   4. 新建开发评估时快照主数据；之后改主数据，旧评估读到的仍是旧值
//
// 隔离：使用 wes-b10b-pmd-* 前缀命名所有产品/SKU/模块，条件 DELETE 清理；
// 不写 templates / system_configs 等单文档表，因此本文件不进串行组。

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { Database } from "../../db/client";
import {
  createProductMasterDataPgRepository,
  type ProductMasterDataPgRepository,
} from "./product-master-data-pg.repository";
import { MasterDataError } from "./industry-pg.repository";
import { _resetProductMasterDataRepositoryForTest } from "./master-data.module";
import { createDevAssessment, findDevAssessmentById } from "../dev-assessment/dev-assessment.usecase";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const OWN_PREFIX = "wes-b10b-pmd-";

let pool: Pool | null = null;
let db: Database | null = null;
let repo: ProductMasterDataPgRepository | null = null;

function uniqueId(kind: string): string {
  return `${OWN_PREFIX}${kind}-${Math.random().toString(36).slice(2, 10)}`;
}

async function cleanOwnRows(): Promise<void> {
  if (!db) return;
  const p = `${OWN_PREFIX}%`;
  await db.execute(
    sql`DELETE FROM product_sku_module_assignments WHERE product_id IN (SELECT id FROM product_lines WHERE name LIKE ${p})`,
  );
  await db.execute(
    sql`DELETE FROM product_line_sku_links WHERE product_id IN (SELECT id FROM product_lines WHERE name LIKE ${p})`,
  );
  await db.execute(sql`DELETE FROM product_modules WHERE name LIKE ${p}`);
  await db.execute(sql`DELETE FROM product_skus WHERE name LIKE ${p}`);
  await db.execute(sql`DELETE FROM product_lines WHERE name LIKE ${p}`);
  await db.execute(sql`DELETE FROM product_templates WHERE template_id LIKE ${p}`);
  // 用例 4 写入的 dev_assessments 一并清理
  await db.execute(sql`DELETE FROM dev_assessments WHERE context_snapshot->'productMasterData' IS NOT NULL`);
}

before(async () => {
  if (!testDatabaseUrl) return;
  pool = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  db = drizzle(pool);
  repo = createProductMasterDataPgRepository(db);
  await cleanOwnRows();
});

beforeEach(async () => {
  await cleanOwnRows();
  _resetProductMasterDataRepositoryForTest();
  // 行项必须归属某份模板（见 schema 注释：没有 templateId 会让两份模板的数据串味），
  // 故每个用例前种一份生效模板供 createAssignment 挂靠。
  await seedActiveTemplate();
});

async function seedActiveTemplate(): Promise<void> {
  if (!db) return;
  const now = new Date();
  await db.execute(sql`UPDATE product_templates SET is_active = false WHERE is_active = true`);
  await db.execute(sql`
    INSERT INTO product_templates (template_id, template_version, template_name, groups_snapshot, sheets_snapshot, is_active, created_at, updated_at)
    VALUES (${`${OWN_PREFIX}tpl`}, 'v1', ${`${OWN_PREFIX}模板`}, '[]'::jsonb, '[]'::jsonb, true, ${now}, ${now})
    ON CONFLICT (template_id) DO UPDATE SET is_active = true, updated_at = ${now}
  `);
}

after(async () => {
  await cleanOwnRows();
  if (pool) await pool.end();
});

function expectCode(code: MasterDataError["code"]) {
  return (err: unknown) => err instanceof MasterDataError && err.code === code;
}

async function makeProduct(name: string) {
  return repo!.createProductLine({ id: uniqueId("line"), name });
}

async function makeSku(name: string) {
  return repo!.createProductSku({ id: uniqueId("sku"), name });
}

async function makeModule(name: string) {
  return repo!.createProductModule({ id: uniqueId("module"), name });
}

// ─── 用例 2：(产品, SKU, 模块) 唯一约束由结构挡住重复 ───────────

test("同一 (产品, SKU, 模块) 可以有多行——业务主键是 templateItemId，不是三元组", { skip: !testDatabaseUrl }, async () => {
  const product = await makeProduct(`${OWN_PREFIX}产品-A`);
  const sku = await makeSku(`${OWN_PREFIX}SKU-A`);
  const module = await makeModule(`${OWN_PREFIX}模块-X`);

  // 实测依据：585 条模板行里 140 条分属 68 个同名四元组（如 item-110 与 item-489 同为
  // 「质量云|质量追溯|质量追溯|质量追溯」各 1 人天）。它们是各自可勾选、各自计入工作量的
  // 独立行，按三元组/四元组去重会丢 402 人天并让 74 个 templateItemId 消失。
  const a = await repo!.createAssignment({
    productId: product.id, skuId: sku.id, moduleId: module.id,
    standardDays: 5, templateItemId: `${OWN_PREFIX}item-1`,
  });
  const b = await repo!.createAssignment({
    productId: product.id, skuId: sku.id, moduleId: module.id,
    standardDays: 8, templateItemId: `${OWN_PREFIX}item-2`,
  });
  assert.notEqual(a.id, b.id, "同三元组的两行必须共存，不得被去重吃掉");
  assert.equal((await repo!.getAssignment(a.id))!.standardDays, 5);
  assert.equal((await repo!.getAssignment(b.id))!.standardDays, 8);

  // 真正该被挡住的是同一 templateItemId 重复
  await assert.rejects(
    () =>
      repo!.createAssignment({
        productId: product.id, skuId: sku.id, moduleId: module.id,
        standardDays: 9, templateItemId: `${OWN_PREFIX}item-1`,
      }),
    "同一 templateItemId 重复必须被唯一约束拒绝",
  );
});


test("同名模块在不同产品下可拥有不同标准人天", { skip: !testDatabaseUrl }, async () => {
  const productA = await makeProduct(`${OWN_PREFIX}产品-基设A`);
  const productB = await makeProduct(`${OWN_PREFIX}产品-基设B`);
  const skuA = await makeSku(`${OWN_PREFIX}SKU-基设A`);
  const skuB = await makeSku(`${OWN_PREFIX}SKU-基设B`);
  // 模块实体全局唯一：同名只建一次
  const module = await makeModule(`${OWN_PREFIX}基础设置`);

  const assignmentA = await repo!.createAssignment({
    productId: productA.id,
    skuId: skuA.id,
    moduleId: module.id,
    standardDays: 1,
  });
  const assignmentB = await repo!.createAssignment({
    productId: productB.id,
    skuId: skuB.id,
    moduleId: module.id,
    standardDays: 2,
  });

  assert.equal(assignmentA.moduleName, assignmentB.moduleName, "模块名相同");
  assert.notEqual(assignmentA.standardDays, assignmentB.standardDays, "标准人天不同");
  assert.equal(assignmentA.standardDays, 1);
  assert.equal(assignmentB.standardDays, 2);
});

// ─── 用例 4：快照不随主数据更新而变 ───────────────────────────

test("新建开发评估快照主数据后，主数据更新不影响旧评估读到的值", { skip: !testDatabaseUrl }, async () => {
  const product = await makeProduct(`${OWN_PREFIX}产品-快照`);
  const sku = await makeSku(`${OWN_PREFIX}SKU-快照`);
  const module = await makeModule(`${OWN_PREFIX}模块-快照`);
  const assignment = await repo!.createAssignment({
    productId: product.id,
    skuId: sku.id,
    moduleId: module.id,
    standardDays: 5,
  });

  // 第一次创建开发评估：应把当前标准人天 5 快照进去
  const first = await createDevAssessment({
    assignedByUserId: "user-1",
    assessedByUserId: "user-1",
  });
  const firstRead = await findDevAssessmentById(first.devAssessmentId);
  assert.ok(firstRead);
  const firstSnapshot = firstRead!.contextSnapshot as { productMasterData?: { assignments?: Array<{ moduleId: string; standardDays: number }> } };
  assert.ok(firstSnapshot.productMasterData, "context_snapshot 应包含 productMasterData");
  const firstEntry = firstSnapshot.productMasterData!.assignments!.find((a: { moduleId: string; standardDays: number }) => a.moduleId === module.id);
  assert.ok(firstEntry, "快照中应能找到本模块");
  assert.equal(firstEntry!.standardDays, 5, "旧评估快照应记录创建时的标准人天");

  // 更新主数据：标准人天改为 99
  await repo!.updateAssignment(assignment.id, { standardDays: 99 });

  // 第二次创建开发评估：应读到新值 99
  const second = await createDevAssessment({
    assignedByUserId: "user-2",
    assessedByUserId: "user-2",
  });
  const secondRead = await findDevAssessmentById(second.devAssessmentId);
  assert.ok(secondRead);
  const secondSnapshot = secondRead!.contextSnapshot as { productMasterData?: { assignments?: Array<{ moduleId: string; standardDays: number }> } };
  const secondEntry = secondSnapshot.productMasterData!.assignments!.find((a: { moduleId: string; standardDays: number }) => a.moduleId === module.id);
  assert.ok(secondEntry);
  assert.equal(secondEntry!.standardDays, 99, "新评估快照应记录更新后的标准人天");

  // 旧评估仍应为 5
  const firstReread = await findDevAssessmentById(first.devAssessmentId);
  assert.ok(firstReread);
  const firstSnapshotAgain = firstReread!.contextSnapshot as { productMasterData?: { assignments?: Array<{ moduleId: string; standardDays: number }> } };
  const firstEntryAgain = firstSnapshotAgain.productMasterData!.assignments!.find((a: { moduleId: string; standardDays: number }) => a.moduleId === module.id);
  assert.equal(firstEntryAgain!.standardDays, 5, "旧评估快照不得被主数据更新改写");
});

// ─── 基础 CRUD 与结构约束补充 ─────────────────────────────────

test("创建后按 id 可读回，标准人天保留一位小数", { skip: !testDatabaseUrl }, async () => {
  const product = await makeProduct(`${OWN_PREFIX}产品-CRUD`);
  const sku = await makeSku(`${OWN_PREFIX}SKU-CRUD`);
  const module = await makeModule(`${OWN_PREFIX}模块-CRUD`);
  const created = await repo!.createAssignment({
    productId: product.id,
    skuId: sku.id,
    moduleId: module.id,
    standardDays: 3.33,
  });
  assert.equal(created.standardDays, 3.3, "标准人天按项目口径保留一位小数");

  const read = await repo!.getAssignment(created.id);
  assert.ok(read);
  assert.equal(read!.standardDays, 3.3);
  assert.equal(read!.productName, product.name);
  assert.equal(read!.skuName, sku.name);
  assert.equal(read!.moduleName, module.name);
});

// ─── 业务澄清（2026-09-14）：模块是可选层级，套件类 SKU 直接挂交付要点 ───────

test("套件类 SKU：同一(产品,SKU)下多条无模块交付要点可共存，不互相覆盖", { skip: !testDatabaseUrl }, async () => {
  const product = await makeProduct(`${OWN_PREFIX}核心套件`);
  const sku = await makeSku(`${OWN_PREFIX}基础套件`);

  // 套件本身就是模块组合，其下直接挂交付要点，模块位为空
  const a = await repo!.createAssignment({
    productId: product.id, skuId: sku.id, moduleId: null,
    standardDays: 3, deliveryPoint: "对账管理",
  });
  const b = await repo!.createAssignment({
    productId: product.id, skuId: sku.id, moduleId: null,
    standardDays: 2, deliveryPoint: "盘点处理",
  });

  assert.notEqual(a.id, b.id);
  assert.equal(a.moduleId, null, "模块位留空，不得用占位模块顶替");
  assert.equal(b.moduleId, null);

  const readA = await repo!.getAssignment(a.id);
  const readB = await repo!.getAssignment(b.id);
  assert.equal(readA!.standardDays, 3, "两条各自的人天都在——粒度若退回三元组，这里会塌成一条");
  assert.equal(readB!.standardDays, 2);
});

test("套件类 SKU：模块为空时，templateItemId 唯一约束同样生效", { skip: !testDatabaseUrl }, async () => {
  const product = await makeProduct(`${OWN_PREFIX}核心套件2`);
  const sku = await makeSku(`${OWN_PREFIX}基础套件2`);
  await repo!.createAssignment({
    productId: product.id, skuId: sku.id, moduleId: null,
    standardDays: 3, deliveryPoint: "对账管理", templateItemId: `${OWN_PREFIX}suite-1`,
  });
  await assert.rejects(
    () => repo!.createAssignment({
      productId: product.id, skuId: sku.id, moduleId: null,
      standardDays: 9, deliveryPoint: "对账管理", templateItemId: `${OWN_PREFIX}suite-1`,
    }),
    "同一 templateItemId 重复必须被拒绝——模块为空不影响这条",
  );
});

