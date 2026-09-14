// ============================================================
// Templates 域 PG 仓储（阶段 2 批 8 · 第 1–3 步；批次 10b 改写）
// ============================================================
// 接口形态：单文档 load/save（与 JSON 整文件语义 1:1）。
//
// 批次 10b 裁决一：新表是事实源，loadTemplate() 保持签名与返回形状不变，
// 内部改从产品主数据表派生；saveTemplate() 除保留 templates 表单行外，
// 同步把条目写入产品主数据表，避免「页面导入成功、估算读不到」的双源割裂。
//
// 五条硬性范式继续落实（批 1–7 基准）：
//  1. 错误边界：TemplateStoreError（稳定 code），每个公开方法 try/catch 后经
//     toSafeError 收敛。
//  2. 幂等：templates 表 upsert + 产品主数据表按唯一键 upsert。
//  3. 并发控制：单事务内完成双写，无字段混写。
//  4. 时间：updated_at 一律 readDbNow(tx)。
//  5. 读取失败/缺数据抛错（TEMPLATE_STORE_NOT_FOUND）。

import { desc, sql } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { readDbNow } from "../../db/now";
import { templates } from "../../db/schema";
import type { Template } from "../../types";
import { deriveTemplateFromProductTables, persistTemplateToProductTables } from "./product-template-derivation";

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
      return await deriveTemplateFromProductTables(dbInstance);
    } catch (err) {
      if (err instanceof Error && (err.message === "PRODUCT_TEMPLATE_META_MISSING" || err.message === "PRODUCT_TEMPLATE_ASSIGNMENTS_EMPTY")) {
        throw new TemplateStoreError("TEMPLATE_STORE_NOT_FOUND", err.message);
      }
      throw toSafeError(err);
    }
  }

  async function saveTemplate(template: Template): Promise<void> {
    try {
      await dbInstance.transaction(async (tx) => {
        const now = await readDbNow(tx);
        // 1. 保留 templates 表作为归档/种子兼容层（写路径不变）
        await tx
          .insert(templates)
          .values({
            templateId: template.templateId,
            templateVersion: template.templateVersion,
            templateName: template.templateName,
            groups: template.groups,
            items: template.items,
            sheets: template.sheets ?? [],
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: templates.templateId,
            set: {
              templateVersion: template.templateVersion,
              templateName: template.templateName,
              groups: template.groups,
              items: template.items,
              sheets: template.sheets ?? [],
              updatedAt: now,
            },
          });
        // 2. 同步写入产品主数据表（事实源）
        await persistTemplateToProductTables(tx, template);
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
