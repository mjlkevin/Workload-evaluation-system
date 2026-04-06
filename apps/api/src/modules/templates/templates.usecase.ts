import { Request, Response } from "express";
import XLSX from "xlsx";
import { randomUUID } from "node:crypto";

import { Template, TemplateItem, isTemplateLike } from "../../types";
import { asString, round1, normalizeCellText, parseDefaultIncluded } from "../../utils/helpers";
import { ok, fail } from "../../utils/response";
import { requireAuth, requireRole } from "../../middleware/auth";
import { loadTemplate, saveTemplate } from "./templates.repository";

function resolveTargetSheetNames(workbook: XLSX.WorkBook, sheetNameOrList: string | undefined): string[] {
  const requested = asString(sheetNameOrList);
  if (requested) {
    const requestedNames = requested
      .split(",")
      .map((x) => asString(x))
      .filter(Boolean);
    const matched = requestedNames
      .map((name) => {
        return (
          workbook.SheetNames.find((sheet) => asString(sheet) === name) ??
          workbook.SheetNames.find((sheet) => asString(sheet).includes(name))
        );
      })
      .filter((x): x is string => Boolean(x));
    if (matched.length > 0) {
      return Array.from(new Set(matched));
    }
  }
  const defaults = ["模块报价", "【NEW】金蝶AI超级套件", "套件报价-AI星空基础套件"];
  const matchedDefaults = defaults
    .map((name) => workbook.SheetNames.find((sheet) => asString(sheet) === name || asString(sheet).includes(name)))
    .filter((x): x is string => Boolean(x));
  if (matchedDefaults.length > 0) {
    return matchedDefaults;
  }
  return [workbook.SheetNames[0]];
}

function parseTemplateFromWorkbook(
  workbook: XLSX.WorkBook,
  sheetNameOrList: string | undefined,
  fallbackTemplateName: string,
  fallbackVersion: string
): Template {
  const targetSheetNames = resolveTargetSheetNames(workbook, sheetNameOrList);
  const groupIdByKey = new Map<string, string>();
  const groups: Array<{ groupId: string; groupName: string }> = [];
  const items: TemplateItem[] = [];
  let itemSeq = 1;

  for (const sheetName of targetSheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
      header: 1,
      defval: "",
      raw: true
    });

    const headerRowIndex = rows.findIndex((row) =>
      row.some((cell) => {
        const normalized = normalizeCellText(cell);
        return normalized.includes("标准实施人天") || normalized.includes("标准实施天数");
      })
    );

    if (headerRowIndex < 0) continue;

    const headerRow = rows[headerRowIndex];
    const findColByAny = (keywords: string[]): number =>
      headerRow.findIndex((cell) => keywords.some((keyword) => normalizeCellText(cell).includes(normalizeCellText(keyword))));

    const colCloud = findColByAny(["云产品"]);
    const colSku = findColByAny(["SKU", "SKU名称"]);
    const colAppGroup = findColByAny(["应用分组", "套件内应用分组", "实施要点"]);
    const colDeliveryModule = findColByAny(["交付模块", "实施要点"]);
    const colDeliveryPoint = findColByAny(["交付颗粒", "实施要点"]);
    const colDeliveryDesc = findColByAny([
      "交付说明",
      "实施要点内容说明",
      "要点内容说明",
    ]);
    const colEvalDesc = findColByAny(["评估说明"]);
    const colStandardDays = findColByAny(["标准实施人天", "标准实施天数"]);
    const colIncluded = findColByAny(["是否包含"]);

    let currentCloud = "";
    let currentSku = "";
    let currentAppGroup = "";

    for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (colCloud >= 0 && asString(row[colCloud])) currentCloud = asString(row[colCloud]);
      if (colSku >= 0 && asString(row[colSku])) currentSku = asString(row[colSku]);
      if (colAppGroup >= 0 && asString(row[colAppGroup])) currentAppGroup = asString(row[colAppGroup]);

      const standardDays = Number(colStandardDays >= 0 ? row[colStandardDays] : NaN);
      if (!Number.isFinite(standardDays) || standardDays <= 0) continue;

      const deliveryPoint = asString(colDeliveryPoint >= 0 ? row[colDeliveryPoint] : "");
      const deliveryModule = asString(colDeliveryModule >= 0 ? row[colDeliveryModule] : "");
      const itemName = deliveryPoint || deliveryModule || currentAppGroup || currentSku || currentCloud;
      if (!itemName || itemName.includes("工作量") || itemName.includes("小计") || itemName.includes("合计")) continue;

      const groupName = currentAppGroup || currentSku || currentCloud || "未分组";
      const groupKey = `${sheetName}::${groupName}`;
      let groupId = groupIdByKey.get(groupKey);
      if (!groupId) {
        groupId = `grp-${groupIdByKey.size + 1}`;
        groupIdByKey.set(groupKey, groupId);
        groups.push({ groupId, groupName });
      }

      items.push({
        templateItemId: `item-${itemSeq}`,
        groupId,
        itemName,
        standardDays: round1(standardDays),
        sheetName: asString(sheetName),
        cloudProduct: currentCloud,
        skuName: currentSku,
        appGroup: currentAppGroup,
        deliveryModule,
        deliveryPoint,
        deliveryDesc: asString(colDeliveryDesc >= 0 ? row[colDeliveryDesc] : ""),
        evalDesc: asString(colEvalDesc >= 0 ? row[colEvalDesc] : ""),
        defaultIncluded: parseDefaultIncluded(colIncluded >= 0 ? row[colIncluded] : "")
      });
      itemSeq += 1;
    }
  }

  if (items.length === 0) {
    throw new Error("no_template_items_parsed");
  }

  return {
    templateId: `tmpl-import-${Date.now()}`,
    templateVersion: fallbackVersion,
    templateName: fallbackTemplateName,
    groups,
    items,
    sheets: targetSheetNames.map((sheet, idx) => ({ sheetId: `sheet-${idx + 1}`, sheetName: asString(sheet) }))
  };
}

export function listTemplates(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const template = loadTemplate();
  res.json(
    ok({
      list: [
        {
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          templateName: template.templateName
        }
      ]
    })
  );
}

export function getTemplate(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const template = loadTemplate();
  if (req.params.templateId !== template.templateId) {
    return fail(res, 40401, "资源不存在", [{ field: "templateId", reason: "not_found" }]);
  }
  res.json(ok(template));
}

export function importTemplateJson(req: Request, res: Response) {
  if (!requireRole(req, res, ["admin"])) return;

  const requestId = randomUUID();
  const input = req.body;

  if (!isTemplateLike(input)) {
    return fail(res, 40001, "参数错误", [{ field: "template", reason: "invalid_structure" }]);
  }

  saveTemplate(input);
  res.json(
    ok(
      {
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        groups: input.groups.length,
        items: input.items.length
      },
      requestId
    )
  );
}

export function importTemplateExcel(req: Request, res: Response) {
  if (!requireRole(req, res, ["admin"])) return;

  const requestId = randomUUID();
  if (!req.file) {
    return fail(res, 40001, "参数错误", [{ field: "file", reason: "required" }]);
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const templateName = asString(req.body.templateName) || `导入模板-${Date.now()}`;
    const templateVersion = asString(req.body.templateVersion) || "imported-v1";
    const sheetHint = asString(req.body.sheetNames) || asString(req.body.sheetName);
    const parsed = parseTemplateFromWorkbook(workbook, sheetHint, templateName, templateVersion);

    if (asString(req.body.templateId)) {
      parsed.templateId = asString(req.body.templateId);
    }

    saveTemplate(parsed);
    res.json(
      ok(
        {
          templateId: parsed.templateId,
          templateVersion: parsed.templateVersion,
          groups: parsed.groups.length,
          items: parsed.items.length,
          sourceSheets: parsed.sheets?.map((sheet) => sheet.sheetName) || [workbook.SheetNames[0]]
        },
        requestId
      )
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "parse_failed";
    fail(res, 40001, "参数错误", [{ field: "file", reason }]);
  }
}
