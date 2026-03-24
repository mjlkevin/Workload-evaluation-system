import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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

function writeExportFile(
  fileName: string,
  exportType: "excel" | "pdf",
  result: EstimateResult,
  requestBody: CalculateRequest
): void {
  const exportDir = ensureExportDir();
  const exportPath = path.resolve(exportDir, fileName);
  const lines = [
    "工作量评估导出（占位版）",
    `导出类型: ${exportType}`,
    `导出时间: ${new Date().toISOString()}`,
    `templateId: ${result.templateId}`,
    `ruleSetId: ${result.ruleSetId}`,
    `templateVersion: ${result.templateVersion}`,
    `ruleVersion: ${result.ruleVersion}`,
    `pipelineVersion: ${result.pipelineVersion}`,
    `totalDays: ${result.totalDays}`,
    "",
    "请求参数:",
    JSON.stringify(requestBody, null, 2),
    "",
    "计算结果:",
    JSON.stringify(result, null, 2)
  ];
  fs.writeFileSync(exportPath, lines.join("\n"), "utf-8");
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

app.post("/api/v1/estimates/calculate-and-export", (req, res) => {
  const body = req.body as CalculateRequest & { exportType?: "excel" | "pdf" };
  const template = loadJsonFile<Template>("config/templates/example-template.json");
  const ruleSet = loadJsonFile<RuleSet>("config/rules/example-rule-set.json");
  const validation = validateCalculateRequest(body, template, ruleSet);
  if (!validation.ok) {
    return fail(res, validation.code, validation.message, validation.details);
  }
  const result = calculateEstimate(body, template, ruleSet);
  const exportType = body.exportType === "pdf" ? "pdf" : "excel";
  const extension = exportType === "pdf" ? "pdf" : "xlsx";
  const fileName = `estimate-${Date.now()}.${extension}`;
  writeExportFile(fileName, exportType, result, body);
  const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  res.json(
    ok({
      totalDays: result.totalDays,
      downloadUrl: `/downloads/${fileName}`,
      expireAt
    })
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
