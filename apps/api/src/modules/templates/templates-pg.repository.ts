// ============================================================
// Templates 域 PG 仓储（阶段 2 批 8 · 第 1–3 步）
// ============================================================
// 接口形态：单文档 load/save（与 JSON 整文件语义 1:1）。
// templates 域只有一个活动模板（config/templates/example-template.json
// 整文件 = 唯一文档），管理端导入（JSON/Excel）整体替换该文档。
//
// PG 侧形态（表已存在，字段 1:1，批 8 零 migration）：
//  - templates 表以 template_id 为主键。导入可能携带不同 templateId
//    （importTemplateExcel 生成 tmpl-import-<ts>），因此写入为
//    「按输入 templateId 的单行 upsert」；读取取「最近写入行」
//    （updated_at DESC + template_id DESC 确定性兜底）为活动文档。
//  - 不做整表替换/TRUNCATE（持续性约束 §4.9 C1）：单行 upsert 天
//    然满足「整文档替换」的 API 契约——listTemplates / getTemplate /
//    估算上下文全部经 loadTemplate() 只见活动文档；被替换的旧
//    templateId 行不再对任何 API 可见（语义等同 JSON 整文件覆盖），
//    仅存储层残留，由 db:seed --force 的整表重置兜底清理。
//
// 五条硬性范式落实（批 1–7 基准）：
//  1. 错误边界：TemplateStoreError（稳定 code），每个公开方法
//     try/catch 后经 toSafeError 收敛；基础设施错误统一
//     TEMPLATE_STORE_INTERNAL，pg/drizzle 原始错误（可能含 SQL
//     参数/连接串）不外泄。
//  2. 幂等：单行 upsert（onConflictDoUpdate）对同一输入重复执行
//     结果不变。
//  3. 并发控制：单语句 upsert 无字段混写——同 templateId 并发写
//     last-writer-wins 收敛为完整输入；不同 templateId 并发写各自
//     成行、读侧取最新行（确定性排序），与 JSON 整文件写的
//     last-writer-wins 竞态结果同构（无部分字段撕裂）。
//  4. 时间：updated_at 一律 readDbNow(tx)（DB 时钟），禁止
//     Date.now() 落库。
//  5. ISS-2026-08-18-004：读取失败必须抛错。缺行亦抛错
//     （TEMPLATE_STORE_NOT_FOUND）——对齐 JSON 侧「缺文件抛
//     Config file not found」语义（模板无空结构兜底概念；
//     db:seed 保证行存在）。
//
// 缓存策略：不加缓存层（批 8 指令要求先测量 414KB 单行读取耗时，
// 实测 2026-08-24，开发库，n=50）：
//  - PG 单行读取（414KB jsonb：groups 12.7KB + items 345KB +
//    sheets 0.2KB）中位 2.27ms（min 1.50 / p95 2.62）；
//    JSON 同文件 readFileSync+parse 中位 1.07ms（min 0.95 /
//    p95 1.32）。PG 约为 JSON 2 倍但同为毫秒级，绝对差 ~1.2ms。
//  - 不引入缓存的理由：①绝对耗时亚 3ms，估算请求含 585 items
//    计算与 HTTP 往返，1.2ms 差异不可感知；②模板经管理端导入后
//    必须立即生效（批 4 system 同口径：管理界面变更不容 TTL
//    滞后）；③多副本部署下进程级缓存引入分歧（§4.7 同论证）；
//    ④读取频率为每次估算请求一次，非高频循环读。
//  - 带外 SQL 写入立即可见由测试用例证明（无缓存层 → 无需失效协调）。

import { desc, sql } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { templates } from "../../db/schema";
import type { Template } from "../../types";

// ============================================================
// 安全错误（范式 #1 / #5）
// ============================================================

export class TemplateStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "TemplateStoreError";
    this.code = code;
  }
}

function toSafeError(err: unknown): TemplateStoreError {
  if (err instanceof TemplateStoreError) return err;
  return new TemplateStoreError("TEMPLATE_STORE_INTERNAL", "template store persistence failed");
}

// ============================================================
// 仓储接口（JSON / PG 双实现共用）
// ============================================================

export interface TemplateStoreRepository {
  /** 读取活动模板（范式 #5：失败/缺行抛错） */
  loadTemplate(): Promise<Template>;
  /** 整文档替换写入（按输入 templateId 单行 upsert） */
  saveTemplate(template: Template): Promise<void>;
}

export type TemplatesPgRepository = TemplateStoreRepository & {
  /** 测试专用：暴露底层连接以做带外断言/清理 */
  __dbForTest(): Database;
};

// ============================================================
// PG 实现
// ============================================================

export function createTemplatesPgRepository(dbInstance: Database = db): TemplatesPgRepository {
  async function loadTemplate(): Promise<Template> {
    try {
      // 活动文档 = 最近写入行；template_id DESC 为同 updated_at 时的
      // 确定性兜底（并发写同刻提交时读侧结果可预测）。
      const rows = await dbInstance
        .select()
        .from(templates)
        .orderBy(desc(templates.updatedAt), desc(templates.templateId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new TemplateStoreError("TEMPLATE_STORE_NOT_FOUND", "template row missing");
      }
      return {
        templateId: row.templateId,
        templateVersion: row.templateVersion,
        templateName: row.templateName,
        groups: row.groups as Template["groups"],
        items: row.items as Template["items"],
        sheets: (row.sheets ?? []) as Template["sheets"],
      };
    } catch (err) {
      throw toSafeError(err);
    }
  }

  async function saveTemplate(template: Template): Promise<void> {
    try {
      await dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        const values = {
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          templateName: template.templateName,
          groups: template.groups,
          items: template.items,
          // 与 db:seed 归一化口径一致（sheets 缺省 []）
          sheets: template.sheets ?? [],
          updatedAt: now,
        };
        await tx
          .insert(templates)
          .values(values)
          .onConflictDoUpdate({
            target: templates.templateId,
            set: values,
          });
      });
    } catch (err) {
      throw toSafeError(err);
    }
  }

  return {
    __dbForTest() {
      return dbInstance;
    },
    loadTemplate,
    saveTemplate,
  };
}

// 测试专用：带外核对行数（共享测试库数据集隔离，禁止整表计数）。
export async function countTemplateRowsByPrefix(
  dbInstance: Database,
  prefix: string
): Promise<number> {
  const result = await dbInstance.execute(
    sql`SELECT count(*)::int AS n FROM templates WHERE template_id LIKE ${prefix + "%"}`
  );
  return Number((result.rows as Array<{ n: number }>)[0]?.n ?? 0);
}

/** 测试专用：按前缀条件清理（数据集隔离，不整表 TRUNCATE）。 */
export async function cleanupTemplateRowsByPrefix(
  dbInstance: Database,
  prefix: string
): Promise<void> {
  await dbInstance.execute(sql`DELETE FROM templates WHERE template_id LIKE ${prefix + "%"}`);
}
