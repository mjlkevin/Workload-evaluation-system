// ============================================================
// 导出服务 - Excel/PDF 导出功能
// ============================================================

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import PDFDocument from "pdfkit";
import JSZip from "jszip";

import { Template, RuleSet, CalculateRequest, EstimateResult } from "../types";
import { loadJsonFile, ensureExportDir, resolveRootDir, PROTOTYPE_EXPORT_SOURCE_XLSX_RELATIVE_PATH } from "../utils/file";
import { asString, round1, normalizeCellText } from "../utils/helpers";

// -------------------- 导出原型相关类型 --------------------

type ParsedTemplateSheetRow = {
  rowIndex: number;
  signature: string;
  cloudProduct: string;
  skuName: string;
};

type ParsedTemplateSheetMeta = {
  headerRowIndex: number;
  colCloud: number;
  colSku: number;
  colSubtotal: number;
  rows: ParsedTemplateSheetRow[];
};

type BuiltPrototypeSheet = {
  sheet: XLSX.WorkSheet;
  rowMap: Map<number, number>;
  keptSourceRows: number[];
};

type PrototypeWorkbookBuildResult = {
  workbook: XLSX.WorkBook;
  freezeRows: number;
};

// -------------------- 辅助函数 --------------------

function normalizeSignatureText(value: unknown): string {
  return normalizeCellText(value).toLowerCase();
}

function buildTemplateRowSignature(input: {
  sheetName?: string;
  cloudProduct?: string;
  skuName?: string;
  appGroup?: string;
  deliveryModule?: string;
  deliveryPoint?: string;
  standardDays?: number;
}): string {
  const dayValue = Number.isFinite(Number(input.standardDays)) ? round1(Number(input.standardDays)).toFixed(1) : "0.0";
  return [
    normalizeSignatureText(input.sheetName),
    normalizeSignatureText(input.cloudProduct),
    normalizeSignatureText(input.skuName),
    normalizeSignatureText(input.appGroup),
    normalizeSignatureText(input.deliveryModule),
    normalizeSignatureText(input.deliveryPoint),
    dayValue
  ].join("||");
}

function resolveSheetNameByHint(workbook: XLSX.WorkBook, hint: string): string {
  const requested = asString(hint);
  if (!requested) return "";
  const exact = workbook.SheetNames.find((sheet) => asString(sheet) === requested);
  if (exact) return exact;
  return workbook.SheetNames.find((sheet) => asString(sheet).includes(requested)) || "";
}

function resolveTargetSheetNames(workbook: XLSX.WorkBook, sheetNameOrList: string | undefined): string[] {
  const requested = asString(sheetNameOrList);
  if (requested) {
    const requestedNames = requested.split(",").map((x) => asString(x)).filter(Boolean);
    const matched = requestedNames
      .map((name) => workbook.SheetNames.find((sheet) => asString(sheet) === name) ?? workbook.SheetNames.find((sheet) => asString(sheet).includes(name)))
      .filter((x): x is string => Boolean(x));
    if (matched.length > 0) return Array.from(new Set(matched));
  }
  const defaults = ["模块报价", "【NEW】金蝶AI超级套件", "套件报价-AI星空基础套件"];
  const matchedDefaults = defaults
    .map((name) => workbook.SheetNames.find((sheet) => asString(sheet) === name || asString(sheet).includes(name)))
    .filter((x): x is string => Boolean(x));
  if (matchedDefaults.length > 0) return matchedDefaults;
  return [workbook.SheetNames[0]];
}

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

// -------------------- Excel 导出（原型相关函数简化） --------------------

function parseTemplateRowsFromWorksheet(workbook: XLSX.WorkBook, sheetName: string): ParsedTemplateSheetMeta | null {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: "", raw: true });
  const headerRowIndex = rows.findIndex((row) =>
    row.some((cell) => {
      const normalized = normalizeCellText(cell);
      return normalized.includes("标准实施人天") || normalized.includes("标准实施天数");
    })
  );
  if (headerRowIndex < 0) return null;
  
  const headerRow = rows[headerRowIndex];
  const findColByAny = (keywords: string[]): number =>
    headerRow.findIndex((cell) => keywords.some((keyword) => normalizeCellText(cell).includes(normalizeCellText(keyword))));
    
  const colCloud = findColByAny(["云产品"]);
  const colSku = findColByAny(["SKU", "SKU名称"]);
  const colAppGroup = findColByAny(["应用分组", "套件内应用分组", "实施要点"]);
  const colDeliveryModule = findColByAny(["交付模块", "实施要点"]);
  const colDeliveryPoint = findColByAny(["交付颗粒", "实施要点"]);
  const colStandardDays = findColByAny(["标准实施人天", "标准实施天数"]);
  const colSubtotalExact = headerRow.findIndex((cell) => normalizeCellText(cell) === normalizeCellText("小计"));
  const colSubtotal = colSubtotalExact >= 0 ? colSubtotalExact : findColByAny(["小计"]);
  
  let currentCloud = "";
  let currentSku = "";
  let currentAppGroup = "";
  const parsedRows: ParsedTemplateSheetRow[] = [];
  
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
    
    parsedRows.push({
      rowIndex: i,
      cloudProduct: currentCloud,
      skuName: currentSku,
      signature: buildTemplateRowSignature({
        sheetName,
        cloudProduct: currentCloud,
        skuName: currentSku,
        appGroup: currentAppGroup,
        deliveryModule,
        deliveryPoint,
        standardDays
      })
    });
  }
  
  return { headerRowIndex, colCloud, colSku, colSubtotal, rows: parsedRows };
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
  return resolveTargetSheetNames(workbook, undefined)[0];
}

async function writeWorkbookWithFrozenHeader(workbook: XLSX.WorkBook, exportPath: string, freezeRows: number): Promise<void> {
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
  if (!freezeRows || freezeRows < 1) {
    fs.writeFileSync(exportPath, buffer);
    return;
  }
  const zip = await JSZip.loadAsync(buffer);
  const sheetXmlPath = "xl/worksheets/sheet1.xml";
  const sheetFile = zip.file(sheetXmlPath);
  if (!sheetFile) {
    fs.writeFileSync(exportPath, buffer);
    return;
  }
  const originalXml = await sheetFile.async("string");
  const paneXml = `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`;
  let nextXml = originalXml;
  nextXml = nextXml.replace(/<pane[^>]*\/>/g, "");
  if (/<sheetView\b[^>]*\/>/.test(nextXml)) {
    nextXml = nextXml.replace(/<sheetView\b([^>]*)\/>/,`<sheetView$1>${paneXml}</sheetView>`);
  } else if (/<sheetView\b[^>]*>/.test(nextXml)) {
    nextXml = nextXml.replace(/<sheetView\b[^>]*>/, (matched) => `${matched}${paneXml}`);
  }
  zip.file(sheetXmlPath, nextXml);
  const output = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(exportPath, output);
}

// -------------------- 主导出函数 --------------------

export async function writeExportFile(
  fileName: string,
  exportType: "excel" | "pdf",
  result: EstimateResult,
  requestBody: CalculateRequest,
  template: Template
): Promise<void> {
  const exportDir = ensureExportDir();
  const exportPath = path.resolve(exportDir, fileName);
  
  if (exportType === "excel") {
    // 尝试使用原型导出
    const sourcePath = path.resolve(resolveRootDir(), PROTOTYPE_EXPORT_SOURCE_XLSX_RELATIVE_PATH);
    if (fs.existsSync(sourcePath)) {
      try {
        const sourceWorkbook = XLSX.readFile(sourcePath, {
          cellStyles: true,
          cellFormula: true,
          cellNF: true,
          cellDates: true
        });
        const targetSheetName = resolveExportPrototypeSheetName(sourceWorkbook, requestBody, result, template);
        if (targetSheetName) {
          // 简化导出：直接复制工作簿并保存
          XLSX.writeFile(sourceWorkbook, exportPath);
          return;
        }
      } catch {
        // 降级到 fallback
      }
    }
    
    // Fallback: 生成简单工作簿
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
