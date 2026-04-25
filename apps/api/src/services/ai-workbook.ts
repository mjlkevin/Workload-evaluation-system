// ============================================================
// AI Workbook Parser
// ============================================================
// 从 Excel Workbook 解析需求导入数据。
// 原位于 ai.service.ts，P0.2 拆分至此独立模块。

import XLSX from "xlsx";
import { RequirementImportData } from "../types";
import { asString, normalizeCellText, parseCellNumber } from "../utils/helpers";

// ------------------------------------------------------------------
// Excel 读取辅助
// ------------------------------------------------------------------

export function getSheetRows(workbook: XLSX.WorkBook, sheetName: string): (string | number)[][] {
  if (!sheetName) return [];
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: "", raw: false });
  try {
    const merges = Array.isArray(ws["!merges"]) ? (ws["!merges"] as XLSX.Range[]) : [];
    if (!merges.length) return rows;
    if (!rows.length) return rows;

    const rowCount = rows.length;
    const maxColCount = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
    let expandedCellBudget = 0;
    const maxExpandedCells = 120000;

    for (const merge of merges) {
      const rawStartRow = merge?.s?.r ?? -1;
      const rawEndRow = merge?.e?.r ?? -1;
      const rawStartCol = merge?.s?.c ?? -1;
      const rawEndCol = merge?.e?.c ?? -1;
      if (rawStartRow < 0 || rawEndRow < rawStartRow || rawStartCol < 0 || rawEndCol < rawStartCol) continue;

      const startRow = Math.min(rowCount - 1, rawStartRow);
      const endRow = Math.min(rowCount - 1, rawEndRow);
      const startCol = Math.min(maxColCount - 1, rawStartCol);
      const endCol = Math.min(maxColCount - 1, rawEndCol);
      if (endRow < startRow || endCol < startCol) continue;
      const area = (endRow - startRow + 1) * (endCol - startCol + 1);
      if (area > 20000) continue;
      if (expandedCellBudget + area > maxExpandedCells) break;

      const startCellAddress = XLSX.utils.encode_cell({ r: startRow, c: startCol });
      const mergedValue = asString(rows[startRow]?.[startCol] ?? ws[startCellAddress]?.v ?? "");
      if (!mergedValue) continue;
      for (let r = startRow; r <= endRow; r += 1) {
        if (!rows[r]) rows[r] = [];
        for (let c = startCol; c <= endCol; c += 1) {
          if (!asString(rows[r][c])) {
            rows[r][c] = mergedValue;
          }
        }
      }
      expandedCellBudget += area;
    }
    return rows;
  } catch {
    return rows;
  }
}

export function buildWorkbookPreviewText(workbook: XLSX.WorkBook): string {
  const chunks: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = getSheetRows(workbook, sheetName);
    if (!rows.length) continue;
    const text = rows
      .map((row) => row.map((cell) => asString(cell)).filter(Boolean).join(" "))
      .filter(Boolean)
      .join("\n");
    if (text) {
      chunks.push(`--- ${sheetName} ---\n${text}`);
    }
  }
  return chunks.join("\n\n");
}

// ------------------------------------------------------------------
// 产品模块归一化
// ------------------------------------------------------------------

export function normalizeProductDomainName(value: string): string {
  const text = asString(value);
  if (!text) return "";
  if (/星空旗舰版/.test(text)) {
    return text.replace(/星空旗舰版/g, "金蝶AI星空");
  }
  return text;
}

function mapProductDomainToProductLine(value: string): string {
  const text = normalizeProductDomainName(value);
  if (!text) return "";
  if (/金蝶AI星空|星空/.test(text)) return "金蝶AI星空";
  if (/金蝶AI星瀚|星瀚/.test(text)) return "金蝶AI星瀚";
  if (/云之家/.test(text)) return "云之家";
  if (/发票云/.test(text)) return "发票云";
  return "";
}

export function inferProductLinesFromProductModules(
  rows: RequirementImportData["productModuleRows"]
): string[] {
  const picked = new Set<string>();
  for (const row of rows) {
    const line = mapProductDomainToProductLine(asString(row.productDomain));
    if (line) picked.add(line);
  }
  return Array.from(picked);
}

export function normalizeProductModuleRows(
  rows: RequirementImportData["productModuleRows"]
): RequirementImportData["productModuleRows"] {
  const result: RequirementImportData["productModuleRows"] = [];
  let lastProductDomain = "";
  let lastModuleName = "";
  let lastSubModule = "";
  let lastImplementationOrgCount = "";
  let lastPilotOrgCount = "";
  let lastPartyBLead = "";
  let lastPartyALead = "";
  const userCountByModule = new Map<string, string>();
  let sharedBusinessUserCount = "";
  let lastUserCountColumnValue = "";

  for (const row of rows) {
    const productDomain = normalizeProductDomainName(asString(row.productDomain) || lastProductDomain);
    const moduleName = asString(row.moduleName) || lastModuleName;
    const subModule = asString(row.subModule) || lastSubModule;

    const rawUserCountCell = asString(row.userCount).trim();
    if (rawUserCountCell) {
      lastUserCountColumnValue = rawUserCountCell;
    }

    let userCount = rawUserCountCell || lastUserCountColumnValue;
    if (userCount) {
      userCountByModule.set(moduleName, userCount);
      if (/财务云|供应链云/.test(moduleName)) {
        sharedBusinessUserCount = userCount;
      }
    } else if (moduleName && userCountByModule.has(moduleName)) {
      userCount = userCountByModule.get(moduleName) || "";
    } else if (/财务云|供应链云/.test(moduleName) && sharedBusinessUserCount) {
      userCount = sharedBusinessUserCount;
    } else if (/流程服务云/.test(moduleName)) {
      userCount = "";
    }

    const implementationOrgCount = asString(row.implementationOrgCount) || lastImplementationOrgCount;
    const pilotOrgCount = asString(row.pilotOrgCount) || lastPilotOrgCount;
    const partyBLead = asString(row.partyBLead) || lastPartyBLead;
    const partyALead = asString(row.partyALead) || lastPartyALead;

    result.push({
      productDomain,
      moduleName,
      subModule,
      userCount,
      implementationOrgCount,
      pilotOrgCount,
      partyBLead,
      partyALead
    });

    lastProductDomain = productDomain || lastProductDomain;
    lastModuleName = moduleName || lastModuleName;
    lastSubModule = subModule || lastSubModule;
    lastImplementationOrgCount = implementationOrgCount || lastImplementationOrgCount;
    lastPilotOrgCount = pilotOrgCount || lastPilotOrgCount;
    lastPartyBLead = partyBLead || lastPartyBLead;
    lastPartyALead = partyALead || lastPartyALead;
  }

  return result;
}

export function requirementProductModuleRowsHaveMeaningfulContent(rows: RequirementImportData["productModuleRows"]): boolean {
  if (!rows.length) return false;
  return rows.some(
    (r) =>
      asString(r.productDomain).trim() ||
      asString(r.moduleName).trim() ||
      asString(r.subModule).trim()
  );
}

// ------------------------------------------------------------------
// 数据合并
// ------------------------------------------------------------------

export function mergeRequirementImportData(primary: RequirementImportData, fallback: RequirementImportData): RequirementImportData {
  const productModuleRows = requirementProductModuleRowsHaveMeaningfulContent(primary.productModuleRows)
    ? primary.productModuleRows
    : fallback.productModuleRows.length
      ? fallback.productModuleRows
      : primary.productModuleRows;

  return {
    valuePropositionRows: primary.valuePropositionRows.length ? primary.valuePropositionRows : fallback.valuePropositionRows,
    businessNeedRows: primary.businessNeedRows.length ? primary.businessNeedRows : fallback.businessNeedRows,
    devOverviewRows: primary.devOverviewRows.length ? primary.devOverviewRows : fallback.devOverviewRows,
    productModuleRows,
    implementationScopeRows: primary.implementationScopeRows.length ? primary.implementationScopeRows : fallback.implementationScopeRows,
    meetingNotes: primary.meetingNotes || fallback.meetingNotes,
    keyPointRows: primary.keyPointRows.length ? primary.keyPointRows : fallback.keyPointRows
  };
}

// ------------------------------------------------------------------
// Workbook 主解析器
// ------------------------------------------------------------------

export function parseRequirementImportFromWorkbook(workbook: XLSX.WorkBook): RequirementImportData {
  const sectionData: RequirementImportData = {
    valuePropositionRows: [],
    businessNeedRows: [],
    devOverviewRows: [],
    productModuleRows: [],
    implementationScopeRows: [],
    meetingNotes: "",
    keyPointRows: []
  };
  const collectedMeetingNotes: string[] = [];

  const parseTable = (
    rows: (string | number)[][],
    headerAliases: Record<string, string[]>,
    rowBuilder: (pick: (field: string) => string, pickNumber: (field: string) => number) => Record<string, unknown>,
    isMeaningfulRow: (row: Record<string, unknown>) => boolean
  ): Array<Record<string, unknown>> => {
    let headerIndex = -1;
    let headerMap: Record<string, number> = {};
    const fields = Object.keys(headerAliases);
    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx];
      const candidateMap: Record<string, number> = {};
      for (const field of fields) {
        const aliases = headerAliases[field] || [];
        const col = row.findIndex((cell) => aliases.some((alias) => normalizeCellText(cell).includes(normalizeCellText(alias))));
        if (col >= 0) {
          candidateMap[field] = col;
        }
      }
      if (Object.keys(candidateMap).length >= Math.max(2, Math.ceil(fields.length / 3))) {
        headerIndex = idx;
        headerMap = candidateMap;
        break;
      }
    }
    if (headerIndex < 0) return [];

    const result: Array<Record<string, unknown>> = [];
    let consecutiveBlank = 0;
    for (let idx = headerIndex + 1; idx < rows.length; idx += 1) {
      const source = rows[idx];
      const pick = (field: string): string => {
        const col = headerMap[field];
        return col === undefined ? "" : asString(source[col]);
      };
      const pickNumber = (field: string): number => {
        const col = headerMap[field];
        return col === undefined ? 0 : parseCellNumber(source[col]);
      };
      const built = rowBuilder(pick, pickNumber);
      const meaningful = isMeaningfulRow(built);
      if (!meaningful) {
        const isWholeRowBlank = source.every((cell) => !asString(cell));
        consecutiveBlank = isWholeRowBlank ? consecutiveBlank + 1 : 0;
        if (consecutiveBlank >= 2) break;
        continue;
      }
      consecutiveBlank = 0;
      result.push(built);
    }
    return result;
  };

  for (const sheetName of workbook.SheetNames) {
    const rows = getSheetRows(workbook, sheetName);
    if (!rows.length) continue;
    const normalizedSheetName = normalizeCellText(sheetName);

    if (normalizedSheetName.includes("会议纪要") || normalizedSheetName.includes("调研纪要")) {
      const text = rows
        .map((row) => row.map((cell) => asString(cell)).filter(Boolean).join(" "))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) {
        collectedMeetingNotes.push(text);
      }
    } else {
      for (const row of rows) {
        const key = normalizeCellText(row[0]);
        if (key.includes("会议纪要") || key.includes("调研纪要")) {
          const maybeText = [asString(row[1]), asString(row[2]), asString(row[3])].filter(Boolean).join(" ").trim();
          if (maybeText) collectedMeetingNotes.push(maybeText);
        }
      }
    }

    if (sectionData.valuePropositionRows.length === 0) {
      const list = parseTable(
        rows,
        {
          summary: ["简要内容", "提炼总结", "总结"],
          refinedContent: ["具体内容", "提炼内容"],
          originalDemand: ["访谈原始诉求", "原始诉求", "原始需求"],
          interviewOutline: ["访谈提纲"]
        },
        (pick) => ({
          summary: pick("summary"),
          refinedContent: pick("refinedContent"),
          originalDemand: pick("originalDemand"),
          interviewOutline: pick("interviewOutline")
        }),
        (row) => Object.values(row).some((value) => asString(value))
      );
      sectionData.valuePropositionRows = list as RequirementImportData["valuePropositionRows"];
    }

    if (sectionData.businessNeedRows.length === 0) {
      const list = parseTable(
        rows,
        {
          businessDomain: ["业务领域"],
          category: ["分类", "类型"],
          businessNeed: ["业务需求及问题", "业务需求", "问题"],
          proposer: ["提出人", "提出方"],
          title: ["职务", "岗位"],
          preSalesIncluded: ["售前方案包含", "售前是否包含"],
          standardImplemented: ["标准产品是否实现"],
          solutionSuggestion: ["建议解决方案", "方案建议"],
          requiresCustomDev: ["是否需二次开发", "是否需要二开"]
        },
        (pick) => ({
          businessDomain: pick("businessDomain"),
          category: pick("category"),
          businessNeed: pick("businessNeed"),
          proposer: pick("proposer"),
          title: pick("title"),
          preSalesIncluded: pick("preSalesIncluded"),
          standardImplemented: pick("standardImplemented"),
          solutionSuggestion: pick("solutionSuggestion"),
          requiresCustomDev: pick("requiresCustomDev")
        }),
        (row) => Object.values(row).some((value) => asString(value))
      );
      sectionData.businessNeedRows = list as RequirementImportData["businessNeedRows"];
    }

    if (sectionData.devOverviewRows.length === 0) {
      const list = parseTable(
        rows,
        {
          businessDomain: ["业务领域"],
          moduleName: ["模块名称", "模块"],
          moduleBrief: ["模块简述"],
          functionDesc: ["功能说明", "功能描述"],
          solutionSuggestion: ["建议解决方案", "方案建议"],
          codingDays: ["基准编码人天", "开发工作量", "编码人天"],
          estimateBasis: ["估算依据"]
        },
        (pick, pickNumber) => ({
          businessDomain: pick("businessDomain"),
          moduleName: pick("moduleName"),
          moduleBrief: pick("moduleBrief"),
          functionDesc: pick("functionDesc"),
          solutionSuggestion: pick("solutionSuggestion"),
          codingDays: pickNumber("codingDays"),
          estimateBasis: pick("estimateBasis")
        }),
        (row) =>
          Object.entries(row).some(([key, value]) => {
            if (key === "codingDays") return Number(value) > 0;
            return asString(value);
          })
      );
      sectionData.devOverviewRows = list as RequirementImportData["devOverviewRows"];
    }

    if (sectionData.productModuleRows.length === 0) {
      const list = parseTable(
        rows,
        {
          productDomain: ["产品领域", "产品分组", "产品组"],
          moduleName: ["模块名称", "模块", "应用"],
          subModule: ["子模块"],
          userCount: ["用户数", "用户数量"],
          implementationOrgCount: ["实施组织数", "实施组织数量"],
          pilotOrgCount: ["试点家数", "试点单位数量"],
          partyBLead: ["乙方主导推广"],
          partyALead: ["甲方主导推广"]
        },
        (pick) => ({
          productDomain: pick("productDomain"),
          moduleName: pick("moduleName"),
          subModule: pick("subModule"),
          userCount: pick("userCount"),
          implementationOrgCount: pick("implementationOrgCount"),
          pilotOrgCount: pick("pilotOrgCount"),
          partyBLead: pick("partyBLead"),
          partyALead: pick("partyALead")
        }),
        (row) => Object.values(row).some((value) => asString(value))
      );
      sectionData.productModuleRows = normalizeProductModuleRows(
        list as RequirementImportData["productModuleRows"]
      );
    }

    if (sectionData.implementationScopeRows.length === 0) {
      const list = parseTable(
        rows,
        {
          companyName: ["公司名称"],
          companyType: ["公司性质", "公司类型"],
          moduleScope: ["实施模块范围说明", "模块范围"],
          location: ["实施地点", "地点"],
          implementationMode: ["实施/推广模式", "实施方式"],
          note: ["备注"]
        },
        (pick) => ({
          companyName: pick("companyName"),
          companyType: pick("companyType"),
          moduleScope: pick("moduleScope"),
          location: pick("location"),
          implementationMode: pick("implementationMode"),
          note: pick("note")
        }),
        (row) => Object.values(row).some((value) => asString(value))
      );
      sectionData.implementationScopeRows = list as RequirementImportData["implementationScopeRows"];
    }

    if (sectionData.keyPointRows.length === 0) {
      const list = parseTable(
        rows,
        {
          analysisCategory: ["分析项目", "分析类别"],
          subItem: ["子项"],
          detail: ["明细内容", "内容明细"],
          note: ["备注"]
        },
        (pick) => ({
          analysisCategory: pick("analysisCategory"),
          subItem: pick("subItem"),
          detail: pick("detail"),
          note: pick("note")
        }),
        (row) => Object.values(row).some((value) => asString(value))
      );
      sectionData.keyPointRows = list as RequirementImportData["keyPointRows"];
    }
  }

  sectionData.meetingNotes = collectedMeetingNotes.join("\n").trim();
  sectionData.productModuleRows = normalizeProductModuleRows(sectionData.productModuleRows);
  return sectionData;
}
