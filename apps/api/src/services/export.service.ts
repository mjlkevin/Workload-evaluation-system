// ============================================================
// 导出服务 - Excel/PDF 导出功能
// ============================================================

import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import XLSX from "xlsx";
import PDFDocument from "pdfkit";

import { calculateEstimate } from "../engine";
import { Template, CalculateRequest, EstimateResult, TemplateItem, RuleSet } from "../types";
import { ensureExportDir, resolveRootDir, PROTOTYPE_EXPORT_SOURCE_XLSX_RELATIVE_PATH } from "../utils/file";
import { asString, round1, normalizeCellText } from "../utils/helpers";

// -------------------- PDF 导出 --------------------

async function writePdfFile(
  exportPath: string,
  result: EstimateResult,
  requestBody: CalculateRequest
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const stream = fs.createWriteStream(exportPath);
    doc.pipe(stream);

    doc.fontSize(18).text("Workload Estimate Report", { underline: true });
    doc.moveDown(0.8);
    doc.fontSize(11);
    doc.text(`exportedAt: ${new Date().toISOString()}`);
    doc.text(`templateId: ${result.templateId}`);
    doc.text(`ruleSetId: ${result.ruleSetId}`);
    doc.text(`templateVersion: ${result.templateVersion}`);
    doc.text(`ruleVersion: ${result.ruleVersion}`);
    doc.text(`pipelineVersion: ${result.pipelineVersion}`);

    doc.moveDown(0.8);
    doc.fontSize(13).text("Summary");
    doc.fontSize(11);
    doc.text(`baseDays: ${result.baseDays}`);
    doc.text(`userIncrementDays: ${result.userIncrementDays}`);
    doc.text(`difficultyIncrementDays: ${result.difficultyIncrementDays}`);
    doc.text(`orgIncrementDays: ${result.orgIncrementDays}`);
    doc.text(`totalDays: ${result.totalDays}`);

    doc.moveDown(0.8);
    doc.fontSize(13).text("Request");
    doc.fontSize(11).text(
      `userCount=${requestBody.userCount}, difficultyFactor=${requestBody.difficultyFactor}, orgCount=${requestBody.orgCount}, orgSimilarityFactor=${requestBody.orgSimilarityFactor}`
    );

    doc.moveDown(0.8);
    doc.fontSize(13).text("Items");
    doc.fontSize(11);
    for (const item of result.itemResults.filter((x) => x.included)) {
      doc.text(
        `${item.templateItemId} | included=${item.included ? "Y" : "N"} | standard=${item.standardDays} | subtotal=${item.itemSubtotalDays}`
      );
    }

    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", (err) => reject(err));
  });
}

// -------------------- Excel：参考「模块报价」版式 --------------------

function normalizeSignatureText(value: unknown): string {
  return normalizeCellText(value).toLowerCase();
}

function buildTemplateRowLookupKey(input: {
  sheetName?: string;
  cloudProduct?: string;
  skuName?: string;
  appGroup?: string;
  deliveryModule?: string;
  deliveryPoint?: string;
}): string {
  return [
    normalizeSignatureText(input.sheetName),
    normalizeSignatureText(input.cloudProduct),
    normalizeSignatureText(input.skuName),
    normalizeSignatureText(input.appGroup),
    normalizeSignatureText(input.deliveryModule),
    normalizeSignatureText(input.deliveryPoint)
  ].join("||");
}

function resolveSheetNameByHint(workbook: XLSX.WorkBook, hint: string): string {
  const requested = asString(hint);
  if (!requested) return "";
  const exact = workbook.SheetNames.find((sheet) => asString(sheet) === requested);
  if (exact) return exact;
  return workbook.SheetNames.find((sheet) => asString(sheet).includes(requested)) || "";
}

function resolveExportPrototypeSheetName(
  workbook: XLSX.WorkBook,
  requestBody: CalculateRequest,
  result: EstimateResult,
  template: Template
): string {
  const byRequest = resolveSheetNameByHint(workbook, requestBody.selectedSheet || "");
  if (byRequest) return byRequest;
  const includedMap = new Map(result.itemResults.map((item) => [item.templateItemId, item.included]));
  const matchedTemplateItem = template.items.find((item) => includedMap.get(item.templateItemId));
  const byIncluded = resolveSheetNameByHint(workbook, matchedTemplateItem?.sheetName || "");
  if (byIncluded) return byIncluded;
  const defaults = ["模块报价", "【NEW】金蝶AI超级套件", "套件报价-AI星空基础套件"];
  const matchedDefaults = defaults
    .map((name) => workbook.SheetNames.find((sheet) => asString(sheet) === name || asString(sheet).includes(name)))
    .filter((x): x is string => Boolean(x));
  if (matchedDefaults.length > 0) return matchedDefaults[0];
  return workbook.SheetNames[0];
}

type HeaderColumns = {
  colCloud: number;
  colSku: number;
  colImplementPoint: number;
  colPointDesc: number;
  colEvalDesc: number;
  colStandard: number;
  colInclude: number;
  colLineSubtotal: number;
  colSkuSubtotal: number;
};

function resolveHeaderColumns(headerRow: unknown[]): HeaderColumns | null {
  const cells = headerRow.map((c) => normalizeCellText(c));
  const findExact = (text: string): number => cells.findIndex((c) => c === normalizeCellText(text));
  const colCloud = findExact("云产品");
  const colSku = cells.findIndex((c) => c === "SKU名称" || c.includes("SKU名称"));
  const colImplementPoint = findExact("实施要点");
  const colPointDesc = findExact("实施要点内容说明");
  const colEvalDesc = findExact("评估说明");
  const colStandard = cells.findIndex((c) => c.includes("标准实施人天") || c.includes("标准实施天数"));
  const colInclude = findExact("是否包含");
  const colLineSubtotal = findExact("单项小计");
  const colSkuSubtotal = cells.findIndex((c) => c === "小计");
  if (colCloud < 0 || colSku < 0 || colImplementPoint < 0 || colStandard < 0) return null;
  return {
    colCloud,
    colSku,
    colImplementPoint,
    colPointDesc,
    colEvalDesc,
    colStandard,
    colInclude,
    colLineSubtotal,
    colSkuSubtotal
  };
}

function findHeaderRowIndex(rows: unknown[][]): number {
  return rows.findIndex((row) =>
    row.some((cell) => {
      const normalized = normalizeCellText(cell);
      return normalized.includes("标准实施人天") || normalized.includes("标准实施天数");
    })
  );
}

function findFooterStartRow(rows: unknown[][], headerRowIndex: number): number {
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const label = normalizeCellText(rows[i][1]);
    if (label.includes("产品实施工作量小计")) return i;
  }
  return -1;
}

function buildSourceRowKeyMap(
  rows: unknown[][],
  sheetName: string,
  headerRowIndex: number,
  footerStartRow: number,
  cols: HeaderColumns
): Map<string, number> {
  const map = new Map<string, number>();
  let currentCloud = "";
  let currentSku = "";
  for (let i = headerRowIndex + 1; i < footerStartRow; i++) {
    const row = rows[i] as unknown[];
    const cloud = cols.colCloud >= 0 ? asString(row[cols.colCloud]) : "";
    const sku = cols.colSku >= 0 ? asString(row[cols.colSku]) : "";
    if (cloud) currentCloud = cloud;
    if (sku) currentSku = sku;
    const point = asString(row[cols.colImplementPoint] ?? "");
    if (!point || point.includes("工作量") || point.includes("小计") || point.includes("合计")) continue;
    const key = buildTemplateRowLookupKey({
      sheetName,
      cloudProduct: currentCloud,
      skuName: currentSku,
      appGroup: point,
      deliveryModule: point,
      deliveryPoint: point
    });
    if (!map.has(key)) map.set(key, i);
  }
  return map;
}

function templateItemLookupKey(item: TemplateItem, sheetName: string): string {
  const point = asString(item.deliveryPoint || item.deliveryModule || item.appGroup || item.itemName);
  return buildTemplateRowLookupKey({
    sheetName,
    cloudProduct: item.cloudProduct,
    skuName: item.skuName,
    appGroup: item.appGroup || point,
    deliveryModule: item.deliveryModule || point,
    deliveryPoint: item.deliveryPoint || point
  });
}

/** 克隆一行并固定为 targetLen 列（超出截断，不足补空），用于导出列范围一致 */
function deepCloneRow(row: unknown[], targetLen: number): unknown[] {
  const next = row.slice(0, targetLen);
  while (next.length < targetLen) next.push("");
  return next.map((c) => c);
}

/** 去掉页脚块末尾「整行在导出列范围内无内容」的空行（如参考表 17–20 行） */
function trimTrailingEmptyRows(block: unknown[][], maxColIndex: number): unknown[][] {
  let end = block.length;
  while (end > 0) {
    const row = block[end - 1] || [];
    let has = false;
    for (let c = 0; c <= maxColIndex; c++) {
      if (normalizeCellText(row[c]) !== "") {
        has = true;
        break;
      }
    }
    if (has) break;
    end--;
  }
  return block.slice(0, end);
}

function sheetMatchesModuleQuoteLayout(headerRow: unknown[]): boolean {
  const line = headerRow.map((c) => normalizeCellText(c)).join(" ");
  return line.includes("云产品") && line.includes("SKU") && line.includes("实施要点") && line.includes("标准实施");
}

function normalizeCloudFilter(requestBody: CalculateRequest): Set<string> | null {
  const raw = requestBody.selectedCloudNames;
  if (!raw || !Array.isArray(raw)) return null;
  const set = new Set(raw.map((x) => normalizeCellText(x)).filter(Boolean));
  return set.size > 0 ? set : null;
}

function sheetFilterPass(item: TemplateItem, requestBody: CalculateRequest): boolean {
  const sheetHint = asString(requestBody.selectedSheet).trim();
  if (!sheetHint || sheetHint === "全部工作表") return true;
  const itemSheet = asString(item.sheetName).trim();
  return normalizeCellText(itemSheet) === normalizeCellText(sheetHint) || itemSheet.includes(sheetHint) || sheetHint.includes(itemSheet);
}

function cloudFilterPass(item: TemplateItem, cloudSet: Set<string> | null): boolean {
  if (!cloudSet) return true;
  const cloud = normalizeCellText(item.cloudProduct || "");
  return cloudSet.has(cloud);
}

/** 参考截图：表头 / 表体 / 页脚配色与细边框 */
const STYLE = {
  headerBlue: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF00B0F0" } },
  headerYellow: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFFF00" } },
  headerCyan: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFBDD7EE" } },
  dataGreen: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE2EFDA" } },
  dataGreenAlt: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFC6EFCE" } },
  white: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFFFFF" } },
  footerBandBlue: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFB4C6E7" } },
  titleGray: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF2F2F2" } }
};

function xlsxColWidthToExcelJs(sourceWs: XLSX.WorkSheet, maxColIndex: number): number[] {
  const w = sourceWs["!cols"];
  const out: number[] = [];
  for (let c = 0; c <= maxColIndex; c++) {
    const entry = w?.[c];
    const wch = typeof entry?.wch === "number" ? entry.wch : typeof entry?.width === "number" ? entry.width / 7 : 12;
    out.push(Math.min(48, Math.max(4, wch)));
  }
  return out;
}

function edgeBorder(r0: number, c0: number, numRows: number, numCols: number): Partial<ExcelJS.Borders> {
  return {
    top: { style: r0 === 0 ? "medium" : "thin", color: { argb: "FF000000" } },
    bottom: { style: r0 === numRows - 1 ? "medium" : "thin", color: { argb: "FF000000" } },
    left: { style: c0 === 0 ? "medium" : "thin", color: { argb: "FF000000" } },
    right: { style: c0 === numCols - 1 ? "medium" : "thin", color: { argb: "FF000000" } }
  };
}

/** 数据区纵向合并：云产品列、SKU 列、小计列（J），与参考 Excel 一致 */
type DataVerticalMerge = { r0Top: number; r0Bottom: number; c0: number };

/**
 * 按连续相同云产品 / 连续相同(云+SKU) 清空从属格并生成纵向 merge 列表（r0 为整张表 0-based 行号）。
 */
function buildDataAreaVerticalMerges(
  dataRows: unknown[][],
  exportItems: TemplateItem[],
  cols: HeaderColumns,
  dataStartRow0: number
): DataVerticalMerge[] {
  const merges: DataVerticalMerge[] = [];
  const n = dataRows.length;
  if (n === 0 || exportItems.length !== n) return merges;

  const cc = cols.colCloud;
  const cs = cols.colSku;
  const cj = cols.colSkuSubtotal;

  let a = 0;
  while (a < n) {
    const cld = normalizeCellText(asString(exportItems[a].cloudProduct));
    let b = a + 1;
    while (b < n && normalizeCellText(asString(exportItems[b].cloudProduct)) === cld) b++;
    if (cc >= 0) {
      for (let k = a + 1; k < b; k++) dataRows[k][cc] = "";
      if (b - a > 1) merges.push({ r0Top: dataStartRow0 + a, r0Bottom: dataStartRow0 + b - 1, c0: cc });
    }
    a = b;
  }

  a = 0;
  while (a < n) {
    const cld = normalizeCellText(asString(exportItems[a].cloudProduct));
    const sku = normalizeCellText(asString(exportItems[a].skuName));
    let b = a + 1;
    while (
      b < n &&
      normalizeCellText(asString(exportItems[b].cloudProduct)) === cld &&
      normalizeCellText(asString(exportItems[b].skuName)) === sku
    ) {
      b++;
    }
    if (cs >= 0) {
      for (let k = a + 1; k < b; k++) dataRows[k][cs] = "";
      if (b - a > 1) merges.push({ r0Top: dataStartRow0 + a, r0Bottom: dataStartRow0 + b - 1, c0: cs });
    }
    if (cj >= 0) {
      for (let k = a + 1; k < b; k++) dataRows[k][cj] = "";
      if (b - a > 1) merges.push({ r0Top: dataStartRow0 + a, r0Bottom: dataStartRow0 + b - 1, c0: cj });
    }
    a = b;
  }

  return merges;
}

function buildDataMergeSlaveKeys(merges: DataVerticalMerge[]): Set<string> {
  const keys = new Set<string>();
  for (const m of merges) {
    for (let r = m.r0Top + 1; r <= m.r0Bottom; r++) {
      keys.add(`${r},${m.c0}`);
    }
  }
  return keys;
}

/**
 * 使用 ExcelJS 写出带填充色、边框的「模块报价」导出表（社区版 xlsx 不写入样式）。
 */
async function writeModuleQuoteExcelStyled(
  exportPath: string,
  outRows: unknown[][],
  sheetName: string,
  headerRowIndex: number,
  footerStartRow0: number,
  footerBlockLen: number,
  cols: HeaderColumns,
  maxColIndex: number,
  footerMergeOffsets: readonly number[],
  mergeColB: number,
  mergeColI: number,
  colWidths: number[],
  dataVerticalMerges: DataVerticalMerge[],
  /** 页脚「项目管理」行难度系数（0–1），对应列按 Excel 百分比显示 */
  footerDifficultyFactor: number
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31), {
    views: [{ state: "frozen", ySplit: headerRowIndex + 1 }]
  });

  const numRows = outRows.length;
  const excelCols = maxColIndex + 1;
  const footerSubtotalOffsets = new Set([0, 2, 4, 6]);
  const mergeOffsetSet = new Set(footerMergeOffsets.filter((o) => o < footerBlockLen));
  const dataMergeSlaveKeys = buildDataMergeSlaveKeys(dataVerticalMerges);

  for (let c = 0; c < excelCols; c++) {
    ws.getColumn(c + 1).width = colWidths[c] ?? 12;
  }

  for (let r0 = 0; r0 < numRows; r0++) {
    const row = outRows[r0] || [];
    const excelRow = ws.getRow(r0 + 1);
    for (let c0 = 0; c0 < excelCols; c0++) {
      const v = row[c0];
      const cell = excelRow.getCell(c0 + 1);
      if (v !== "" && v !== undefined && v !== null) {
        cell.value = v as string | number | boolean;
      }
    }
  }

  for (const m of dataVerticalMerges) {
    if (m.r0Top >= m.r0Bottom) continue;
    ws.mergeCells(m.r0Top + 1, m.c0 + 1, m.r0Bottom + 1, m.c0 + 1);
    const master = ws.getCell(m.r0Top + 1, m.c0 + 1);
    master.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }

  for (const off of footerMergeOffsets) {
    if (off >= footerBlockLen) continue;
    const r0 = footerStartRow0 + off;
    const er = r0 + 1;
    ws.mergeCells(er, mergeColB + 1, er, mergeColI + 1);
    const master = ws.getCell(er, mergeColB + 1);
    master.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    master.font = { bold: true };
    master.fill = STYLE.footerBandBlue;
  }

  /** 项目管理行（页脚块内偏移 3）「标准实施人天」列：存小数、显示为百分比（如 0.2 → 20%） */
  const PM_FOOTER_OFFSET = 3;
  const diffCol0 = cols.colStandard >= 0 ? cols.colStandard : 6;
  const diffRow0 = footerStartRow0 + PM_FOOTER_OFFSET;
  if (diffRow0 < numRows && diffCol0 < excelCols && PM_FOOTER_OFFSET < footerBlockLen) {
    const pctCell = ws.getCell(diffRow0 + 1, diffCol0 + 1);
    const dec = Math.min(1, Math.max(0, Number(footerDifficultyFactor)));
    pctCell.value = dec;
    pctCell.numFmt = "0%";
  }

  for (let r0 = 0; r0 < numRows; r0++) {
    const er = r0 + 1;
    const inFooter = r0 >= footerStartRow0;
    const footerOff = inFooter ? r0 - footerStartRow0 : -1;
    const inData = r0 > headerRowIndex && r0 < footerStartRow0;

    for (let c0 = 0; c0 < excelCols; c0++) {
      const ec = c0 + 1;
      const cell = ws.getCell(er, ec);

      if (mergeOffsetSet.has(footerOff) && c0 > mergeColB && c0 <= mergeColI) {
        continue;
      }

      if (inData && dataMergeSlaveKeys.has(`${r0},${c0}`)) {
        continue;
      }

      if (r0 < headerRowIndex) {
        cell.fill = STYLE.titleGray;
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        continue;
      }

      if (r0 === headerRowIndex) {
        cell.font = { bold: true };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        if (c0 === cols.colCloud || c0 === cols.colSku) cell.fill = STYLE.headerBlue;
        else if (
          c0 === cols.colImplementPoint ||
          c0 === cols.colPointDesc ||
          c0 === cols.colEvalDesc ||
          c0 === cols.colStandard
        ) {
          cell.fill = STYLE.headerYellow;
        } else if (c0 === cols.colInclude || c0 === cols.colLineSubtotal || c0 === cols.colSkuSubtotal) {
          cell.fill = STYLE.headerCyan;
        } else if (c0 === 0) {
          cell.fill = STYLE.titleGray;
        } else {
          cell.fill = STYLE.headerYellow;
        }
        continue;
      }

      if (inData) {
        const isCloudOrSkuCol = c0 === cols.colCloud || c0 === cols.colSku;
        cell.alignment = {
          vertical: "middle",
          horizontal:
            c0 === cols.colStandard ||
            c0 === cols.colInclude ||
            c0 === cols.colLineSubtotal ||
            c0 === cols.colSkuSubtotal ||
            isCloudOrSkuCol
              ? "center"
              : "left",
          wrapText: true
        };
        if (c0 === cols.colInclude) {
          cell.fill = STYLE.white;
        } else if (c0 === cols.colLineSubtotal || c0 === cols.colSkuSubtotal) {
          cell.fill = STYLE.dataGreen;
          cell.font = { bold: true };
        } else {
          cell.fill = STYLE.dataGreen;
        }
        continue;
      }

      if (inFooter && footerOff >= 0) {
        const isSubtotalBand = footerSubtotalOffsets.has(footerOff);
        const jCol = cols.colSkuSubtotal;

        if (isSubtotalBand) {
          if (c0 === mergeColB) {
            continue;
          }
          if (jCol >= 0 && c0 === jCol) {
            cell.fill = STYLE.dataGreenAlt;
            cell.font = { bold: true };
            cell.alignment = { vertical: "middle", horizontal: "center" };
          } else {
            cell.fill = STYLE.footerBandBlue;
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          }
          continue;
        }

        cell.fill = STYLE.dataGreenAlt;
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        if (footerOff === 1 && (ec === 4 || ec === 6)) {
          cell.fill = STYLE.white;
        }
        if (footerOff === 3 && ec === 7) {
          cell.fill = STYLE.white;
        }
        if (footerOff === 5 && ec === 7) {
          cell.fill = STYLE.white;
        }
        if (jCol >= 0 && c0 === jCol) {
          cell.font = { bold: true };
        }
      }
    }
  }

  for (let r0 = 0; r0 < numRows; r0++) {
    const er = r0 + 1;
    const footerOff = r0 >= footerStartRow0 ? r0 - footerStartRow0 : -1;
    for (let c0 = 0; c0 < excelCols; c0++) {
      if (mergeOffsetSet.has(footerOff) && c0 > mergeColB && c0 <= mergeColI) {
        continue;
      }
      if (dataMergeSlaveKeys.has(`${r0},${c0}`)) {
        continue;
      }
      ws.getCell(er, c0 + 1).border = edgeBorder(r0, c0, numRows, excelCols) as ExcelJS.Borders;
    }
  }

  await wb.xlsx.writeFile(exportPath);
}

/**
 * 按参考 Excel 的「模块报价」类版式导出：仅包含已勾选且命中云产品筛选的行，并重算底部汇总区（避免 #NAME? 等公式残留）。
 */
async function tryWriteModuleQuoteStyleExcel(
  exportPath: string,
  result: EstimateResult,
  requestBody: CalculateRequest,
  template: Template,
  ruleSet: RuleSet,
  sourcePath: string
): Promise<boolean> {
  if (!fs.existsSync(sourcePath)) return false;

  let sourceWorkbook: XLSX.WorkBook;
  try {
    sourceWorkbook = XLSX.readFile(sourcePath, {
      cellStyles: true,
      cellFormula: true,
      cellNF: true,
      cellDates: true
    });
  } catch {
    return false;
  }

  const targetSheetName = resolveExportPrototypeSheetName(sourceWorkbook, requestBody, result, template);
  const sourceWs = sourceWorkbook.Sheets[targetSheetName];
  if (!sourceWs) return false;

  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sourceWs, { header: 1, defval: "", raw: true });
  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex < 0) return false;

  const headerRow = rows[headerRowIndex];
  const cols = resolveHeaderColumns(headerRow);
  if (!cols || !sheetMatchesModuleQuoteLayout(headerRow)) return false;

  const footerStartRow = findFooterStartRow(rows, headerRowIndex);
  if (footerStartRow < 0) return false;

  const maxColIndex = Math.max(
    headerRow.length - 1,
    cols.colSkuSubtotal >= 0 ? cols.colSkuSubtotal : cols.colStandard,
    11
  );
  /** 导出截止到「小计」列，去掉 K 列及以后（如 R202505版本对标、空白列） */
  const exportMaxColIndex =
    cols.colSkuSubtotal >= 0 ? cols.colSkuSubtotal : Math.min(maxColIndex, Math.max(cols.colStandard, 9));

  const rowKeyToSourceIndex = buildSourceRowKeyMap(rows, targetSheetName, headerRowIndex, footerStartRow, cols);

  const itemResultById = new Map(result.itemResults.map((r) => [r.templateItemId, r]));
  const cloudSet = normalizeCloudFilter(requestBody);

  const exportItems: TemplateItem[] = [];
  for (const item of template.items) {
    const r = itemResultById.get(item.templateItemId);
    if (!r?.included) continue;
    if (!sheetFilterPass(item, requestBody)) continue;
    if (!cloudFilterPass(item, cloudSet)) continue;
    exportItems.push(item);
  }

  const exportIds = new Set(exportItems.map((it) => it.templateItemId));
  const recalcItems = requestBody.items.map((it) => ({
    ...it,
    included: Boolean(it.included && exportIds.has(it.templateItemId))
  }));
  const footerResult = calculateEstimate({ ...requestBody, items: recalcItems }, template, ruleSet);

  const headerBlock = rows
    .slice(0, headerRowIndex + 1)
    .map((r) => deepCloneRow(r as unknown[], exportMaxColIndex + 1));
  let footerBlock = rows.slice(footerStartRow).map((r) => deepCloneRow(r as unknown[], exportMaxColIndex + 1));
  footerBlock = trimTrailingEmptyRows(footerBlock, exportMaxColIndex);

  const dataRows: unknown[][] = [];
  for (const item of exportItems) {
    const key = templateItemLookupKey(item, targetSheetName);
    const srcIdx = rowKeyToSourceIndex.get(key);
    const baseRow =
      srcIdx !== undefined
        ? deepCloneRow(rows[srcIdx] as unknown[], exportMaxColIndex + 1)
        : deepCloneRow([], exportMaxColIndex + 1);

    if (srcIdx === undefined) {
      if (cols.colCloud >= 0) baseRow[cols.colCloud] = asString(item.cloudProduct);
      if (cols.colSku >= 0) baseRow[cols.colSku] = asString(item.skuName);
      const point = asString(item.deliveryPoint || item.deliveryModule || item.appGroup || item.itemName);
      if (cols.colImplementPoint >= 0) baseRow[cols.colImplementPoint] = point;
      if (cols.colPointDesc >= 0) baseRow[cols.colPointDesc] = asString(item.deliveryDesc);
      if (cols.colEvalDesc >= 0) baseRow[cols.colEvalDesc] = asString(item.evalDesc);
    }

    const ir = itemResultById.get(item.templateItemId)!;
    const std = round1(Number(ir.effectiveStandardDays ?? ir.standardDays));
    const lineSub = round1(ir.itemSubtotalDays);

    if (cols.colStandard >= 0) baseRow[cols.colStandard] = std;
    if (cols.colInclude >= 0) baseRow[cols.colInclude] = ir.included ? "√" : "";
    if (cols.colLineSubtotal >= 0) baseRow[cols.colLineSubtotal] = lineSub;
    if (cols.colSkuSubtotal >= 0) baseRow[cols.colSkuSubtotal] = "";

    dataRows.push(baseRow);
  }

  if (cols.colSkuSubtotal >= 0 && cols.colLineSubtotal >= 0 && dataRows.length > 0) {
    let runStart = 0;
    let prevKey = "";
    const flushRun = (end: number) => {
      let sum = 0;
      for (let k = runStart; k < end; k++) {
        const line = Number(dataRows[k][cols.colLineSubtotal] as number);
        if (Number.isFinite(line)) sum = round1(sum + line);
      }
      if (runStart < end) dataRows[runStart][cols.colSkuSubtotal] = round1(sum);
    };
    for (let i = 0; i < exportItems.length; i++) {
      const it = exportItems[i];
      const key = `${normalizeCellText(it.cloudProduct)}||${normalizeCellText(it.skuName)}`;
      if (i > 0 && key !== prevKey) {
        flushRun(i);
        runStart = i;
      }
      prevKey = key;
    }
    flushRun(exportItems.length);
  }

  const pickFooterRow = (offsetFromFooterStart: number): unknown[] | undefined => footerBlock[offsetFromFooterStart];

  const setJ = (offset: number, value: number) => {
    const r = pickFooterRow(offset);
    if (!r) return;
    if (cols.colSkuSubtotal >= 0) r[cols.colSkuSubtotal] = round1(value);
  };

  const tier = footerResult.calculationBreakdown.userCountTier;
  const fUserCount = 3;
  const fUserFactor = 5;
  const fDiffPct = 6;
  const fOrgSim = 6;

  const rUser = pickFooterRow(1);
  if (rUser) {
    if (fUserCount < rUser.length) rUser[fUserCount] = requestBody.userCount;
    if (fUserFactor < rUser.length) rUser[fUserFactor] = tier.factor;
    if (cols.colSkuSubtotal >= 0) rUser[cols.colSkuSubtotal] = round1(footerResult.userIncrementDays);
  }

  const rDiff = pickFooterRow(3);
  const diffCol0 = cols.colStandard >= 0 ? cols.colStandard : fDiffPct;
  if (rDiff && diffCol0 < rDiff.length) {
    rDiff[diffCol0] = Math.min(1, Math.max(0, requestBody.difficultyFactor));
  }
  if (rDiff && cols.colSkuSubtotal >= 0) rDiff[cols.colSkuSubtotal] = round1(footerResult.difficultyIncrementDays);

  const rOrg = pickFooterRow(5);
  if (rOrg && fOrgSim < rOrg.length) {
    rOrg[fOrgSim] = requestBody.orgSimilarityFactor;
  }
  if (rOrg && cols.colSkuSubtotal >= 0) {
    rOrg[cols.colSkuSubtotal] = round1(footerResult.orgIncrementDays);
  }

  const s0 = round1(footerResult.baseDays);
  const s1 = round1(footerResult.baseDays + footerResult.userIncrementDays);
  const s2 = round1(footerResult.baseDays + footerResult.userIncrementDays + footerResult.difficultyIncrementDays);
  const s3 = round1(footerResult.totalDays);
  setJ(0, s0);
  setJ(2, s1);
  setJ(4, s2);
  setJ(6, s3);

  /** 与参考表一致：「产品实施工作量小计/合计」等标签行合并 B:I（0-based 列 1–8），小计数值保留在 J 列 */
  const FOOTER_LABEL_MERGE_ROW_OFFSETS = [0, 2, 4, 6] as const;
  const mergeColB = 1;
  const mergeColI = 8;
  for (const off of FOOTER_LABEL_MERGE_ROW_OFFSETS) {
    const r = pickFooterRow(off);
    if (!r) continue;
    for (let c = mergeColB + 1; c <= mergeColI; c++) {
      r[c] = "";
    }
  }

  const dataStartRow0 = headerBlock.length;
  const dataVerticalMerges = buildDataAreaVerticalMerges(dataRows, exportItems, cols, dataStartRow0);

  const outRows = [...headerBlock, ...dataRows, ...footerBlock];
  const footerStartRow0 = headerBlock.length + dataRows.length;
  const colWidths = xlsxColWidthToExcelJs(sourceWs, exportMaxColIndex);
  await writeModuleQuoteExcelStyled(
    exportPath,
    outRows,
    targetSheetName,
    headerRowIndex,
    footerStartRow0,
    footerBlock.length,
    cols,
    exportMaxColIndex,
    FOOTER_LABEL_MERGE_ROW_OFFSETS,
    mergeColB,
    mergeColI,
    colWidths,
    dataVerticalMerges,
    requestBody.difficultyFactor
  );
  return true;
}

// -------------------- 主导出函数 --------------------

export async function writeExportFile(
  fileName: string,
  exportType: "excel" | "pdf",
  result: EstimateResult,
  requestBody: CalculateRequest,
  template: Template,
  ruleSet: RuleSet
): Promise<void> {
  const exportDir = ensureExportDir();
  const exportPath = path.resolve(exportDir, fileName);

  if (exportType === "excel") {
    const sourcePath = path.resolve(resolveRootDir(), PROTOTYPE_EXPORT_SOURCE_XLSX_RELATIVE_PATH);
    const handled = await tryWriteModuleQuoteStyleExcel(exportPath, result, requestBody, template, ruleSet, sourcePath);
    if (handled) return;

    const fallbackWorkbook = XLSX.utils.book_new();
    const includedItems = result.itemResults.filter((item) => item.included);
    const metaRows = [
      ["field", "value"],
      ["exportedAt", new Date().toISOString()],
      ["templateId", result.templateId],
      ["ruleSetId", result.ruleSetId],
      ["templateVersion", result.templateVersion],
      ["ruleVersion", result.ruleVersion],
      ["pipelineVersion", result.pipelineVersion]
    ];
    const summaryRows = [
      ["metric", "value"],
      ["baseDays", result.baseDays],
      ["userIncrementDays", result.userIncrementDays],
      ["difficultyIncrementDays", result.difficultyIncrementDays],
      ["orgIncrementDays", result.orgIncrementDays],
      ["totalDays", result.totalDays]
    ];
    const itemRows = [
      ["templateItemId", "included", "standardDays", "itemSubtotalDays"],
      ...includedItems.map((item) => [
        item.templateItemId,
        item.included ? "Y" : "N",
        item.standardDays,
        item.itemSubtotalDays
      ])
    ];
    const requestRows = [
      ["requestField", "value"],
      ["userCount", requestBody.userCount],
      ["difficultyFactor", requestBody.difficultyFactor],
      ["orgCount", requestBody.orgCount],
      ["orgSimilarityFactor", requestBody.orgSimilarityFactor]
    ];
    XLSX.utils.book_append_sheet(fallbackWorkbook, XLSX.utils.aoa_to_sheet(metaRows), "META");
    XLSX.utils.book_append_sheet(fallbackWorkbook, XLSX.utils.aoa_to_sheet(summaryRows), "SUMMARY");
    XLSX.utils.book_append_sheet(fallbackWorkbook, XLSX.utils.aoa_to_sheet(itemRows), "ITEMS");
    XLSX.utils.book_append_sheet(fallbackWorkbook, XLSX.utils.aoa_to_sheet(requestRows), "REQUEST");
    XLSX.writeFile(fallbackWorkbook, exportPath);
    return;
  }

  await writePdfFile(exportPath, result, requestBody);
}
