export type TemplateItem = {
  templateItemId: string;
  groupId: string;
  itemName: string;
  standardDays: number;
};

export type Template = {
  templateId: string;
  templateVersion: string;
  templateName: string;
  groups: Array<{ groupId: string; groupName: string }>;
  items: TemplateItem[];
};

export type RuleSet = {
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

export type CalculateRequest = {
  templateId: string;
  ruleSetId: string;
  userCount: number;
  difficultyFactor: number;
  orgCount: number;
  orgSimilarityFactor: number;
  items: Array<{
    templateItemId: string;
    included: boolean;
    customStandardDays?: number;
  }>;
};

export type EstimateResult = {
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
    effectiveStandardDays: number;
    itemSubtotalDays: number;
  }>;
};

export function round1(input: number): number {
  return Math.round(input * 10) / 10;
}

function applyRounding(value: number, mode: "none" | "ceil_int" = "none"): number {
  if (mode === "ceil_int") {
    return Math.ceil(value);
  }
  return round1(value);
}

export function validateCalculateRequest(
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

  const templateItemIds = new Set(template.items.map((item) => item.templateItemId));
  const requestItemIds = new Set(body.items.map((item) => item.templateItemId));
  const unknownItems = body.items
    .filter((item) => !templateItemIds.has(item.templateItemId))
    .map((item) => item.templateItemId);
  if (unknownItems.length > 0) {
    return {
      ok: false,
      code: 40001,
      message: "参数错误",
      details: [{ field: "items", reason: `unknown_item_ids:${unknownItems.join(",")}` }]
    };
  }
  const invalidCustomDays = body.items.filter(
    (item) =>
      item.customStandardDays !== undefined &&
      (!Number.isFinite(item.customStandardDays) || Number(item.customStandardDays) < 0)
  );
  if (invalidCustomDays.length > 0) {
    return {
      ok: false,
      code: 40001,
      message: "参数错误",
      details: [{ field: "items.customStandardDays", reason: "must_be_non_negative_number" }]
    };
  }
  const missingItems = template.items
    .filter((item) => !requestItemIds.has(item.templateItemId))
    .map((item) => item.templateItemId);
  if (missingItems.length > 0) {
    return {
      ok: false,
      code: 42201,
      message: "计算请求数据不完整",
      details: [{ field: "items", reason: `missing_item_ids:${missingItems.join(",")}` }]
    };
  }

  return { ok: true };
}

export function calculateEstimate(body: CalculateRequest, template: Template, ruleSet: RuleSet): EstimateResult {
  const hasStage = (stage: string) => ruleSet.pipeline.includes(stage);
  const selectedMap = new Map<string, boolean>(body.items.map((item) => [item.templateItemId, Boolean(item.included)]));
  const customDaysMap = new Map<string, number>(
    body.items
      .filter((item) => item.customStandardDays !== undefined)
      .map((item) => [item.templateItemId, round1(Number(item.customStandardDays))])
  );
  const itemResults = template.items.map((item) => {
    const itemRuleEnabled = hasStage("itemRule");
    const included = selectedMap.get(item.templateItemId) ?? false;
    const effectiveStandardDays = customDaysMap.get(item.templateItemId) ?? item.standardDays;
    return {
      templateItemId: item.templateItemId,
      included,
      standardDays: item.standardDays,
      effectiveStandardDays,
      itemSubtotalDays: itemRuleEnabled && included ? effectiveStandardDays : 0
    };
  });

  const baseDays = hasStage("grouping") ? round1(itemResults.reduce((sum, cur) => sum + cur.itemSubtotalDays, 0)) : 0;
  const tier =
    ruleSet.baseRule.userCountTiers.find((x) => body.userCount >= x.min && body.userCount <= x.max) || {
      min: 0,
      max: 0,
      factor: 0
    };
  const userIncrementDays = hasStage("baseRule")
    ? applyRounding(baseDays * tier.factor, ruleSet.baseRule.userIncrementRounding || "none")
    : 0;
  const difficultyIncrementDays = hasStage("baseRule") ? round1(baseDays * body.difficultyFactor) : 0;
  const orgFactor = ruleSet.orgIncrementRule.factor ?? 0.1;
  const orgFactorTotal = hasStage("orgIncrementRule") && ruleSet.orgIncrementRule.enabled
    ? Math.max(0, body.orgCount - 1) * (1 - body.orgSimilarityFactor) * orgFactor
    : 0;
  const orgIncrementDays = round1(baseDays * orgFactorTotal);
  const totalDays = round1(baseDays + userIncrementDays + difficultyIncrementDays + orgIncrementDays);

  const groupSubtotals = hasStage("grouping")
    ? template.groups.map((group) => {
        const subtotalDays = round1(
          template.items
            .filter((item) => item.groupId === group.groupId)
            .reduce((sum, item) => {
              const selected = selectedMap.get(item.templateItemId) ?? false;
              const effectiveDays = customDaysMap.get(item.templateItemId) ?? item.standardDays;
              return sum + (selected ? effectiveDays : 0);
            }, 0)
        );
        return {
          groupId: group.groupId,
          groupName: group.groupName,
          subtotalDays
        };
      })
    : [];

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
