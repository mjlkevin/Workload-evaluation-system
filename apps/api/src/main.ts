import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import XLSX from "xlsx";
import PDFDocument from "pdfkit";
import multer from "multer";
import { calculateEstimate, validateCalculateRequest } from "./engine";

const app = express();
const port = Number(process.env.PORT || 3000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json());

type TemplateItem = {
  templateItemId: string;
  groupId: string;
  itemName: string;
  standardDays: number;
  sheetName?: string;
  cloudProduct?: string;
  skuName?: string;
  appGroup?: string;
  deliveryModule?: string;
  deliveryPoint?: string;
  deliveryDesc?: string;
  evalDesc?: string;
  defaultIncluded?: boolean;
};

type Template = {
  templateId: string;
  templateVersion: string;
  templateName: string;
  groups: Array<{ groupId: string; groupName: string }>;
  items: TemplateItem[];
  sheets?: Array<{ sheetId: string; sheetName: string }>;
};

type RuleSet = {
  ruleSetId: string;
  ruleVersion: string;
  pipelineVersion: string;
  pipeline: string[];
  baseRule: {
    userCountTiers: Array<{ min: number; max: number; factor: number }>;
    difficultyFactorList: number[];
    userIncrementRounding?: "none" | "ceil_int";
  };
  orgIncrementRule: {
    enabled: boolean;
    factor?: number;
  };
};

type RuleSetMeta = {
  grouping: string[];
  itemRule: string[];
  baseRule: RuleSet["baseRule"];
  orgIncrementRule: RuleSet["orgIncrementRule"];
  pipeline: RuleSet["pipeline"];
};

type CalculateRequest = {
  templateId: string;
  ruleSetId: string;
  userCount: number;
  difficultyFactor: number;
  orgCount: number;
  orgSimilarityFactor: number;
  items: Array<{
    templateItemId: string;
    included: boolean;
  }>;
};

type EstimateResult = {
  templateId: string;
  ruleSetId: string;
  templateVersion: string;
  ruleVersion: string;
  pipelineVersion: string;
  baseDays: number;
  userIncrementDays: number;
  difficultyIncrementDays: number;
  orgIncrementDays: number;
  totalDays: number;
  calculationBreakdown: {
    userCountTier: { hitRange: string; factor: number; incrementDays: number };
    difficulty: { factor: number; incrementDays: number };
    organization: { orgCount: number; similarityFactor: number; incrementDays: number };
  };
  groupSubtotals: Array<{ groupId: string; groupName: string; subtotalDays: number }>;
  itemResults: Array<{
    templateItemId: string;
    included: boolean;
    standardDays: number;
    itemSubtotalDays: number;
  }>;
};

function loadJsonFile<T>(relativePath: string): T {
  const candidates = [
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), "..", "..", relativePath)
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  }
  throw new Error(`Config file not found: ${relativePath}`);
}

function saveJsonFile(relativePath: string, data: unknown): void {
  const filePath = path.resolve(resolveRootDir(), relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function ok(data: unknown, requestId?: string) {
  return requestId ? { code: 0, message: "ok", data, requestId } : { code: 0, message: "ok", data };
}

function fail(
  res: express.Response,
  code: number,
  message: string,
  details?: Array<{ field: string; reason: string }>
) {
  return res.status(400).json({
    code,
    message,
    details: details || [],
    requestId: randomUUID()
  });
}

function round1(input: number): number {
  return Math.round(input * 10) / 10;
}

function applyRounding(value: number, mode: "none" | "ceil_int" = "none"): number {
  if (mode === "ceil_int") {
    return Math.ceil(value);
  }
  return round1(value);
}

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function isTemplateLike(input: unknown): input is Template {
  const t = input as Partial<Template>;
  return Boolean(
    t &&
      typeof t.templateId === "string" &&
      typeof t.templateVersion === "string" &&
      typeof t.templateName === "string" &&
      Array.isArray(t.groups) &&
      Array.isArray(t.items)
  );
}

function isRuleSetLike(input: unknown): input is RuleSet {
  const r = input as Partial<RuleSet>;
  return Boolean(
    r &&
      typeof r.ruleSetId === "string" &&
      typeof r.ruleVersion === "string" &&
      typeof r.pipelineVersion === "string" &&
      Array.isArray(r.pipeline) &&
      r.baseRule &&
      Array.isArray(r.baseRule.userCountTiers) &&
      Array.isArray(r.baseRule.difficultyFactorList) &&
      r.orgIncrementRule &&
      typeof r.orgIncrementRule.enabled === "boolean"
  );
}

function normalizeCellText(value: unknown): string {
  return asString(value).replace(/\s+/g, "");
}

function parseDefaultIncluded(value: unknown): boolean {
  const raw = asString(value).toLowerCase();
  return raw === "√" || raw === "v" || raw === "true" || raw === "1" || raw === "y" || raw === "yes";
}

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
    if (!ws) {
      continue;
    }
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
    if (headerRowIndex < 0) {
      continue;
    }
    const headerRow = rows[headerRowIndex];
    const findColByAny = (keywords: string[]): number =>
      headerRow.findIndex((cell) => keywords.some((keyword) => normalizeCellText(cell).includes(normalizeCellText(keyword))));

    const colCloud = findColByAny(["云产品"]);
    const colSku = findColByAny(["SKU", "SKU名称"]);
    const colAppGroup = findColByAny(["应用分组", "套件内应用分组", "实施要点"]);
    const colDeliveryModule = findColByAny(["交付模块", "实施要点"]);
    const colDeliveryPoint = findColByAny(["交付颗粒", "实施要点"]);
    const colDeliveryDesc = findColByAny(["交付说明", "实施要点内容说明"]);
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
      if (!Number.isFinite(standardDays) || standardDays <= 0) {
        continue;
      }

      const deliveryPoint = asString(colDeliveryPoint >= 0 ? row[colDeliveryPoint] : "");
      const deliveryModule = asString(colDeliveryModule >= 0 ? row[colDeliveryModule] : "");
      const itemName = deliveryPoint || deliveryModule || currentAppGroup || currentSku || currentCloud;
      if (!itemName || itemName.includes("工作量") || itemName.includes("小计") || itemName.includes("合计")) {
        continue;
      }

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

function resolveRootDir(): string {
  const candidates = [process.cwd(), path.resolve(process.cwd(), "..", "..")];
  for (const baseDir of candidates) {
    if (fs.existsSync(path.resolve(baseDir, "config"))) {
      return baseDir;
    }
  }
  return process.cwd();
}

function ensureExportDir(): string {
  const exportDir = path.resolve(resolveRootDir(), "exports");
  fs.mkdirSync(exportDir, { recursive: true });
  return exportDir;
}

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
    for (const item of result.itemResults) {
      doc.text(
        `${item.templateItemId} | included=${item.included ? "Y" : "N"} | standard=${item.standardDays} | subtotal=${item.itemSubtotalDays}`
      );
    }

    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", (err) => reject(err));
  });
}

async function writeExportFile(
  fileName: string,
  exportType: "excel" | "pdf",
  result: EstimateResult,
  requestBody: CalculateRequest
): Promise<void> {
  const exportDir = ensureExportDir();
  const exportPath = path.resolve(exportDir, fileName);
  if (exportType === "excel") {
    const workbook = XLSX.utils.book_new();

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
      ...result.itemResults.map((item) => [
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

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metaRows), "META");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), "SUMMARY");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(itemRows), "ITEMS");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(requestRows), "REQUEST");
    XLSX.writeFile(workbook, exportPath);
    return;
  }
  await writePdfFile(exportPath, result, requestBody);
}

type ExportHistoryItem = {
  fileName: string;
  size: number;
  modifiedAt: string;
  downloadUrl: string;
};

type SessionEstimateContext = {
  sessionId: string;
  templateId: string;
  ruleSetId: string;
  createdAt: number;
  expiresAt: number;
};

type IdempotencyRecord = {
  payloadHash: string;
  data: {
    totalDays: number;
    downloadUrl: string;
    expireAt: string;
  };
  requestId: string;
  createdAt: number;
};

const EXPORT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const idempotencyStore = new Map<string, IdempotencyRecord>();
const sessionStore = new Map<string, SessionEstimateContext>();

function cleanupExpiredSessions(nowMs = Date.now()): void {
  for (const [sessionId, ctx] of sessionStore.entries()) {
    if (ctx.expiresAt <= nowMs) {
      sessionStore.delete(sessionId);
    }
  }
}

function getRequesterRole(req: express.Request): "admin" | "operator" {
  const raw = String(req.header("X-Role") || "operator").trim().toLowerCase();
  return raw === "admin" ? "admin" : "operator";
}

function requireRole(req: express.Request, res: express.Response, allowed: Array<"admin" | "operator">): boolean {
  const role = getRequesterRole(req);
  if (!allowed.includes(role)) {
    fail(res, 40301, "权限不足", [{ field: "role", reason: "forbidden" }]);
    return false;
  }
  return true;
}

function listExportHistory(page: number, pageSize: number): { total: number; items: ExportHistoryItem[] } {
  const exportDir = ensureExportDir();
  const files = fs
    .readdirSync(exportDir)
    .filter((name) => name.endsWith(".xlsx") || name.endsWith(".pdf"))
    .map((fileName) => {
      const fullPath = path.resolve(exportDir, fileName);
      const stat = fs.statSync(fullPath);
      return {
        fileName,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        downloadUrl: `/downloads/${fileName}`,
        mtimeMs: stat.mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const total = files.length;
  const start = (page - 1) * pageSize;
  const items = files.slice(start, start + pageSize).map(({ mtimeMs, ...rest }) => rest);
  return { total, items };
}

async function handleCalculateAndExport(
  body: CalculateRequest & { exportType?: "excel" | "pdf" },
  res: express.Response,
  idempotencyKey?: string
): Promise<void> {
  const requestId = randomUUID();
  const template = loadJsonFile<Template>("config/templates/example-template.json");
  const ruleSet = loadJsonFile<RuleSet>("config/rules/example-rule-set.json");
  const validation = validateCalculateRequest(body, template, ruleSet);
  if (!validation.ok) {
    fail(res, validation.code, validation.message, validation.details);
    return;
  }
  const result = calculateEstimate(body, template, ruleSet);
  const exportType = body.exportType === "pdf" ? "pdf" : "excel";
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ ...body, exportType }))
    .digest("hex");

  if (idempotencyKey) {
    const existing = idempotencyStore.get(idempotencyKey);
    if (existing) {
      const expired = Date.now() - existing.createdAt > EXPORT_IDEMPOTENCY_TTL_MS;
      if (expired) {
        idempotencyStore.delete(idempotencyKey);
      } else if (existing.payloadHash !== payloadHash) {
        fail(res, 40001, "参数错误", [{ field: "Idempotency-Key", reason: "payload_conflict" }]);
        return;
      } else {
        res.json(ok(existing.data, existing.requestId));
        return;
      }
    }
  }

  const extension = exportType === "pdf" ? "pdf" : "xlsx";
  const fileName = `estimate-${Date.now()}.${extension}`;
  await writeExportFile(fileName, exportType, result, body);
  const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const responseData = {
    totalDays: result.totalDays,
    downloadUrl: `/downloads/${fileName}`,
    expireAt
  };

  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, {
      payloadHash,
      data: responseData,
      requestId,
      createdAt: Date.now()
    });
  }

  res.json(
    ok(responseData, requestId)
  );
}

app.get("/api/v1/health", (_req, res) => {
  res.json(ok({ service: "workload-api", status: "up" }));
});

app.get("/api/v1/templates", (_req, res) => {
  const template = loadJsonFile<Template>("config/templates/example-template.json");
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
});

app.get("/api/v1/templates/:templateId", (req, res) => {
  const template = loadJsonFile<Template>("config/templates/example-template.json");
  if (req.params.templateId !== template.templateId) {
    return fail(res, 40401, "资源不存在", [{ field: "templateId", reason: "not_found" }]);
  }
  res.json(ok(template));
});

app.get("/api/v1/rule-sets/active", (_req, res) => {
  const ruleSet = loadJsonFile<RuleSet>("config/rules/example-rule-set.json");
  res.json(ok(ruleSet));
});

app.get("/api/v1/rule-sets/meta", (_req, res) => {
  const ruleSet = loadJsonFile<RuleSet>("config/rules/example-rule-set.json");
  const meta: RuleSetMeta = {
    grouping: ["group by groupId from template.items"],
    itemRule: ["included ? standardDays : 0"],
    baseRule: ruleSet.baseRule,
    orgIncrementRule: ruleSet.orgIncrementRule,
    pipeline: ruleSet.pipeline
  };
  res.json(ok(meta));
});

app.post("/api/v1/templates/import-json", (req, res) => {
  if (!requireRole(req, res, ["admin"])) {
    return;
  }
  const requestId = randomUUID();
  const input = req.body;
  if (!isTemplateLike(input)) {
    return fail(res, 40001, "参数错误", [{ field: "template", reason: "invalid_structure" }]);
  }
  saveJsonFile("config/templates/example-template.json", input);
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
});

app.post("/api/v1/rule-sets/import-json", (req, res) => {
  if (!requireRole(req, res, ["admin"])) {
    return;
  }
  const requestId = randomUUID();
  const input = req.body;
  if (!isRuleSetLike(input)) {
    return fail(res, 40001, "参数错误", [{ field: "ruleSet", reason: "invalid_structure" }]);
  }
  saveJsonFile("config/rules/example-rule-set.json", input);
  res.json(
    ok(
      {
        ruleSetId: input.ruleSetId,
        ruleVersion: input.ruleVersion,
        pipelineVersion: input.pipelineVersion
      },
      requestId
    )
  );
});

app.post("/api/v1/templates/import-excel", upload.single("file"), (req, res) => {
  if (!requireRole(req, res, ["admin"])) {
    return;
  }
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
    saveJsonFile("config/templates/example-template.json", parsed);
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
});

app.post("/api/v1/estimates/calculate", (req, res) => {
  if (!requireRole(req, res, ["admin", "operator"])) {
    return;
  }
  const body = req.body as CalculateRequest;
  const template = loadJsonFile<Template>("config/templates/example-template.json");
  const ruleSet = loadJsonFile<RuleSet>("config/rules/example-rule-set.json");
  const requestId = randomUUID();

  const validation = validateCalculateRequest(body, template, ruleSet);
  if (!validation.ok) {
    return fail(res, validation.code, validation.message, validation.details);
  }
  res.json(ok(calculateEstimate(body, template, ruleSet), requestId));
});

app.post("/api/v1/estimates/calculate-and-export", async (req, res) => {
  if (!requireRole(req, res, ["admin", "operator"])) {
    return;
  }
  const body = req.body as CalculateRequest & { exportType?: "excel" | "pdf" };
  const idempotencyKey = String(req.header("Idempotency-Key") || "").trim() || undefined;
  await handleCalculateAndExport(body, res, idempotencyKey);
});

app.post("/api/v1/estimates/export/excel", async (req, res) => {
  if (!requireRole(req, res, ["admin", "operator"])) {
    return;
  }
  const body = req.body as CalculateRequest;
  const idempotencyKey = String(req.header("Idempotency-Key") || "").trim() || undefined;
  await handleCalculateAndExport({ ...body, exportType: "excel" }, res, idempotencyKey);
});

app.post("/api/v1/estimates/export/pdf", async (req, res) => {
  if (!requireRole(req, res, ["admin", "operator"])) {
    return;
  }
  const body = req.body as CalculateRequest;
  const idempotencyKey = String(req.header("Idempotency-Key") || "").trim() || undefined;
  await handleCalculateAndExport({ ...body, exportType: "pdf" }, res, idempotencyKey);
});

app.get("/api/v1/exports/history", (req, res) => {
  if (!requireRole(req, res, ["admin", "operator"])) {
    return;
  }
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 20)));
  const data = listExportHistory(page, pageSize);
  res.json(ok({ page, pageSize, ...data }));
});

app.post("/api/v1/sessions/start", (req, res) => {
  if (!requireRole(req, res, ["admin", "operator"])) {
    return;
  }
  const { templateId, ruleSetId } = (req.body || {}) as { templateId?: string; ruleSetId?: string };
  const template = loadJsonFile<Template>("config/templates/example-template.json");
  const ruleSet = loadJsonFile<RuleSet>("config/rules/example-rule-set.json");
  if (!templateId || !ruleSetId) {
    return fail(res, 40001, "参数错误", [
      { field: "templateId", reason: "required" },
      { field: "ruleSetId", reason: "required" }
    ]);
  }
  if (templateId !== template.templateId || ruleSetId !== ruleSet.ruleSetId) {
    return fail(res, 40401, "资源不存在", [{ field: "templateId/ruleSetId", reason: "not_found" }]);
  }
  cleanupExpiredSessions();
  const now = Date.now();
  const sessionId = randomUUID();
  const ctx: SessionEstimateContext = {
    sessionId,
    templateId,
    ruleSetId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS
  };
  sessionStore.set(sessionId, ctx);
  res.json(
    ok({
      sessionId,
      templateId,
      ruleSetId,
      expiresAt: new Date(ctx.expiresAt).toISOString()
    })
  );
});

app.post("/api/v1/sessions/:sessionId/calculate", (req, res) => {
  if (!requireRole(req, res, ["admin", "operator"])) {
    return;
  }
  cleanupExpiredSessions();
  const sessionId = String(req.params.sessionId || "");
  const session = sessionStore.get(sessionId);
  if (!session) {
    return fail(res, 40401, "资源不存在", [{ field: "sessionId", reason: "not_found_or_expired" }]);
  }
  const body = req.body as Omit<CalculateRequest, "templateId" | "ruleSetId">;
  const mergedBody: CalculateRequest = {
    templateId: session.templateId,
    ruleSetId: session.ruleSetId,
    userCount: body.userCount,
    difficultyFactor: body.difficultyFactor,
    orgCount: body.orgCount,
    orgSimilarityFactor: body.orgSimilarityFactor,
    items: body.items
  };
  const template = loadJsonFile<Template>("config/templates/example-template.json");
  const ruleSet = loadJsonFile<RuleSet>("config/rules/example-rule-set.json");
  const requestId = randomUUID();
  const validation = validateCalculateRequest(mergedBody, template, ruleSet);
  if (!validation.ok) {
    return fail(res, validation.code, validation.message, validation.details);
  }
  res.json(
    ok(
      {
        sessionId,
        ...calculateEstimate(mergedBody, template, ruleSet)
      },
      requestId
    )
  );
});

app.get("/downloads/:fileName", (req, res) => {
  const exportDir = ensureExportDir();
  const fileName = path.basename(req.params.fileName);
  const filePath = path.resolve(exportDir, fileName);
  if (!fs.existsSync(filePath)) {
    return fail(res, 40401, "资源不存在", [{ field: "fileName", reason: "not_found" }]);
  }
  const extension = path.extname(fileName).toLowerCase();
  const contentType =
    extension === ".pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  res.setHeader("Content-Type", contentType);
  res.download(filePath, fileName);
});

app.listen(port, () => {
  // Keep startup logs explicit for local bootstrap checks.
  console.log(`[api] listening on http://localhost:${port}`);
});
