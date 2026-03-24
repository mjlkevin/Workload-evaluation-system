import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import XLSX from "xlsx";
import PDFDocument from "pdfkit";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());

type TemplateItem = {
  templateItemId: string;
  groupId: string;
  itemName: string;
  standardDays: number;
};

type Template = {
  templateId: string;
  templateVersion: string;
  templateName: string;
  groups: Array<{ groupId: string; groupName: string }>;
  items: TemplateItem[];
};

type RuleSet = {
  ruleSetId: string;
  ruleVersion: string;
  pipelineVersion: string;
  pipeline: string[];
  baseRule: {
    userCountTiers: Array<{ min: number; max: number; factor: number }>;
    difficultyFactorList: number[];
  };
  orgIncrementRule: {
    enabled: boolean;
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

function ok(data: unknown) {
  return { code: 0, message: "ok", data };
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
  res: express.Response
): Promise<void> {
  const template = loadJsonFile<Template>("config/templates/example-template.json");
  const ruleSet = loadJsonFile<RuleSet>("config/rules/example-rule-set.json");
  const validation = validateCalculateRequest(body, template, ruleSet);
  if (!validation.ok) {
    fail(res, validation.code, validation.message, validation.details);
    return;
  }
  const result = calculateEstimate(body, template, ruleSet);
  const exportType = body.exportType === "pdf" ? "pdf" : "excel";
  const extension = exportType === "pdf" ? "pdf" : "xlsx";
  const fileName = `estimate-${Date.now()}.${extension}`;
  await writeExportFile(fileName, exportType, result, body);
  const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  res.json(
    ok({
      totalDays: result.totalDays,
      downloadUrl: `/downloads/${fileName}`,
      expireAt
    })
  );
}

function validateCalculateRequest(
  body: CalculateRequest,
  template: Template,
  ruleSet: RuleSet
): { ok: true } | { ok: false; code: number; message: string; details: Array<{ field: string; reason: string }> } {
  if (!body?.templateId || !body?.ruleSetId) {
    return {
      ok: false,
      code: 40001,
      message: "参数错误",
      details: [
        { field: "templateId", reason: "required" },
        { field: "ruleSetId", reason: "required" }
      ]
    };
  }
  if (body.templateId !== template.templateId || body.ruleSetId !== ruleSet.ruleSetId) {
    return {
      ok: false,
      code: 40401,
      message: "资源不存在",
      details: [{ field: "templateId/ruleSetId", reason: "not_found" }]
    };
  }
  if (
    !Number.isInteger(body.userCount) ||
    !Number.isInteger(body.orgCount) ||
    body.userCount < 0 ||
    body.orgCount < 0
  ) {
    return {
      ok: false,
      code: 40001,
      message: "参数错误",
      details: [
        { field: "userCount", reason: "must_be_non_negative_integer" },
        { field: "orgCount", reason: "must_be_non_negative_integer" }
      ]
    };
  }
  if (
    typeof body.orgSimilarityFactor !== "number" ||
    body.orgSimilarityFactor < 0 ||
    body.orgSimilarityFactor > 1
  ) {
    return {
      ok: false,
      code: 40001,
      message: "参数错误",
      details: [{ field: "orgSimilarityFactor", reason: "must_be_in_0_to_1" }]
    };
  }
  if (!ruleSet.baseRule.difficultyFactorList.includes(body.difficultyFactor)) {
    return {
      ok: false,
      code: 40003,
      message: "规则校验失败",
      details: [{ field: "difficultyFactor", reason: "not_in_rule_set" }]
    };
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return {
      ok: false,
      code: 42201,
      message: "计算请求数据不完整",
      details: [{ field: "items", reason: "required" }]
    };
  }
  return { ok: true };
}

function calculateEstimate(body: CalculateRequest, template: Template, ruleSet: RuleSet): EstimateResult {
  const selectedMap = new Map<string, boolean>(
    body.items.map((item) => [item.templateItemId, Boolean(item.included)])
  );
  const itemResults = template.items.map((item) => {
    const included = selectedMap.get(item.templateItemId) ?? false;
    return {
      templateItemId: item.templateItemId,
      included,
      standardDays: item.standardDays,
      itemSubtotalDays: included ? item.standardDays : 0
    };
  });

  const baseDays = round1(itemResults.reduce((sum, cur) => sum + cur.itemSubtotalDays, 0));
  const tier =
    ruleSet.baseRule.userCountTiers.find(
      (x) => body.userCount >= x.min && body.userCount <= x.max
    ) || { min: 0, max: 0, factor: 0 };
  const userIncrementDays = round1(baseDays * tier.factor);
  const difficultyIncrementDays = round1(baseDays * body.difficultyFactor);
  const orgFactor = ruleSet.orgIncrementRule.enabled
    ? Math.max(0, body.orgCount - 1) * (1 - body.orgSimilarityFactor) * 0.1
    : 0;
  const orgIncrementDays = round1(baseDays * orgFactor);
  const totalDays = round1(baseDays + userIncrementDays + difficultyIncrementDays + orgIncrementDays);

  const groupSubtotals = template.groups.map((group) => {
    const subtotalDays = round1(
      template.items
        .filter((item) => item.groupId === group.groupId)
        .reduce((sum, item) => {
          const selected = selectedMap.get(item.templateItemId) ?? false;
          return sum + (selected ? item.standardDays : 0);
        }, 0)
    );
    return {
      groupId: group.groupId,
      groupName: group.groupName,
      subtotalDays
    };
  });

  return {
    templateId: template.templateId,
    ruleSetId: ruleSet.ruleSetId,
    templateVersion: template.templateVersion,
    ruleVersion: ruleSet.ruleVersion,
    pipelineVersion: ruleSet.pipelineVersion,
    baseDays,
    userIncrementDays,
    difficultyIncrementDays,
    orgIncrementDays,
    totalDays,
    calculationBreakdown: {
      userCountTier: {
        hitRange: `${tier.min}-${tier.max}`,
        factor: tier.factor,
        incrementDays: userIncrementDays
      },
      difficulty: {
        factor: body.difficultyFactor,
        incrementDays: difficultyIncrementDays
      },
      organization: {
        orgCount: body.orgCount,
        similarityFactor: body.orgSimilarityFactor,
        incrementDays: orgIncrementDays
      }
    },
    groupSubtotals,
    itemResults
  };
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

app.post("/api/v1/estimates/calculate", (req, res) => {
  const body = req.body as CalculateRequest;
  const template = loadJsonFile<Template>("config/templates/example-template.json");
  const ruleSet = loadJsonFile<RuleSet>("config/rules/example-rule-set.json");

  const validation = validateCalculateRequest(body, template, ruleSet);
  if (!validation.ok) {
    return fail(res, validation.code, validation.message, validation.details);
  }
  res.json(ok(calculateEstimate(body, template, ruleSet)));
});

app.post("/api/v1/estimates/calculate-and-export", async (req, res) => {
  const body = req.body as CalculateRequest & { exportType?: "excel" | "pdf" };
  await handleCalculateAndExport(body, res);
});

app.post("/api/v1/estimates/export/excel", async (req, res) => {
  const body = req.body as CalculateRequest;
  await handleCalculateAndExport({ ...body, exportType: "excel" }, res);
});

app.post("/api/v1/estimates/export/pdf", async (req, res) => {
  const body = req.body as CalculateRequest;
  await handleCalculateAndExport({ ...body, exportType: "pdf" }, res);
});

app.get("/api/v1/exports/history", (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 20)));
  const data = listExportHistory(page, pageSize);
  res.json(ok({ page, pageSize, ...data }));
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
