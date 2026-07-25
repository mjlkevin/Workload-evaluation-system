import type {
  StructuredOutputContract,
  StructuredOutputValidationIssue,
} from "./structured-output";
import type {
  HarnessRequirementReportV1Content,
  HarnessRequirementReportV2Content,
} from "../../modules/harness/harness.types";
import type { BasicProjectInfo, RequirementImportData } from "../../types";

export type CompanyProfileOutput = {
  needsDisambiguation: boolean;
  candidates: Array<{ displayName: string; summary: string }>;
  enterpriseProfile: string;
  location: string;
  customerIndustry: string;
  enterpriseRevenue: string;
  itStatus: string;
};

export type AttachmentAnalysisOutput = {
  answer: string;
  projectName: string;
  customerName: string;
  industry: string;
  productLines: string[];
  sourceSheets: string[];
  needs: string[];
  modules: string[];
  missingItems: string[];
  risks: string[];
  nextActions: string[];
  summary: string;
  sourceFiles?: string[];
};

export type RequirementBasicInfoOutput = {
  basicInfo: {
    customerName?: string;
    customerIndustry?: string;
    location?: string;
  };
};

export type DevAssessmentDraftOutput = {
  items: Array<{ index: number; codingDays: number; basis: string }>;
};

export type ChangeManagementDiffOutput = {
  diffResult: {
    added: Array<{ field: string; value: unknown }>;
    removed: Array<{ field: string; oldValue: unknown }>;
    modified: Array<{ field: string; before: unknown; after: unknown }>;
  };
  newEstimate: Record<string, unknown> | null;
};

export type ImplementationAssessmentDraftOutput = {
  assessmentDraft: {
    quoteMode: string;
    productLines: string[];
    userCount: number;
    orgCount: number;
    orgSimilarity: number;
    difficultyFactor: number;
    moduleItems: Array<{
      cloudProduct?: string;
      skuName?: string;
      moduleName: string;
      standardDays: number;
      suggestedDays: number;
      reason: string;
    }>;
    risks: string[];
    assumptions: string[];
  };
};

export type RequirementImportOutput = {
  basicInfo: BasicProjectInfo;
  requirementImportData: RequirementImportData;
};

export type InteractiveFormBlockOutput = {
  blockId: string;
  title: string;
  description?: string;
  submitLabel: string;
  submitMessageTemplate?: string;
  fields: Array<{
    id: string;
    label: string;
    type: "text" | "textarea" | "single_select" | "boolean" | "number";
    required?: boolean;
    placeholder?: string;
    helperText?: string;
    options?: Array<{ label: string; value: string }>;
  }>;
};

const STRING_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string" },
} as const;

export const REQUIREMENT_BASIC_INFO_CONTRACT: StructuredOutputContract<RequirementBasicInfoOutput> = {
  id: "requirement-basic-info-extraction",
  version: "1.0.0",
  name: "RequirementBasicInfoExtraction",
  description: "从需求材料抽取客户全称、GB/T 4754 行业编码名称和实施地点；缺失字段用空字符串或省略，不得推断为事实。",
  riskTier: "R1",
  schema: {
    type: "object",
    required: ["basicInfo"],
    additionalProperties: false,
    properties: {
      basicInfo: {
        type: "object",
        additionalProperties: false,
        properties: {
          customerName: { type: "string", description: "客户企业全称，不使用未经材料确认的简称扩写。" },
          customerIndustry: { type: "string", description: "材料明确支持的 GB/T 4754 编码和名称；未知时为空字符串。" },
          location: { type: "string", description: "实施地点或客户所在地区；未知时为空字符串。" },
        },
      },
    },
  },
};

export const DEV_ASSESSMENT_DRAFT_CONTRACT: StructuredOutputContract<DevAssessmentDraftOutput> = {
  id: "dev-assessment-draft",
  version: "1.0.0",
  name: "DevAssessmentDraft",
  description: "逐条输出开发编码人天和可审计依据；index 必须对应输入条目。",
  riskTier: "R2",
  schema: {
    type: "object",
    required: ["items"],
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["index", "codingDays", "basis"],
          additionalProperties: false,
          properties: {
            index: { type: "integer", minimum: 0 },
            codingDays: { type: "number", minimum: 0.5 },
            basis: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
};

const CHANGE_DIFF_ITEM_BASE = {
  type: "object",
  additionalProperties: false,
} as const;

export const CHANGE_MANAGEMENT_DIFF_CONTRACT: StructuredOutputContract<ChangeManagementDiffOutput> = {
  id: "change-management-diff",
  version: "1.0.0",
  name: "ChangeManagementDiff",
  description: "将变更描述转换为字段级 added/removed/modified diff；无明确字段变更时返回空数组。",
  riskTier: "R2",
  schema: {
    type: "object",
    required: ["diffResult", "newEstimate"],
    additionalProperties: false,
    properties: {
      diffResult: {
        type: "object",
        required: ["added", "removed", "modified"],
        additionalProperties: false,
        properties: {
          added: {
            type: "array",
            items: {
              ...CHANGE_DIFF_ITEM_BASE,
              required: ["field", "value"],
              properties: { field: { type: "string", minLength: 1 }, value: {} },
            },
          },
          removed: {
            type: "array",
            items: {
              ...CHANGE_DIFF_ITEM_BASE,
              required: ["field", "oldValue"],
              properties: { field: { type: "string", minLength: 1 }, oldValue: {} },
            },
          },
          modified: {
            type: "array",
            items: {
              ...CHANGE_DIFF_ITEM_BASE,
              required: ["field", "before", "after"],
              properties: { field: { type: "string", minLength: 1 }, before: {}, after: {} },
            },
          },
        },
      },
      newEstimate: { type: ["object", "null"], additionalProperties: true },
    },
  },
};

export const IMPLEMENTATION_ASSESSMENT_DRAFT_CONTRACT: StructuredOutputContract<ImplementationAssessmentDraftOutput> = {
  id: "implementation-assessment-draft",
  version: "1.0.0",
  name: "ImplementationAssessmentDraft",
  description: "实施评估草稿；数值非负，比例在 0 到 1，每个模块必须提供独立评估依据。",
  riskTier: "R2",
  schema: {
    type: "object",
    required: ["assessmentDraft"],
    additionalProperties: false,
    properties: {
      assessmentDraft: {
        type: "object",
        required: ["quoteMode", "productLines", "userCount", "orgCount", "orgSimilarity", "difficultyFactor", "moduleItems", "risks", "assumptions"],
        additionalProperties: false,
        properties: {
          quoteMode: { type: "string", minLength: 1 },
          productLines: STRING_ARRAY_SCHEMA,
          userCount: { type: "number", minimum: 0 },
          orgCount: { type: "number", minimum: 0 },
          orgSimilarity: { type: "number", minimum: 0, maximum: 1 },
          difficultyFactor: { type: "number", minimum: 0, maximum: 1 },
          moduleItems: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["moduleName", "standardDays", "suggestedDays", "reason"],
              additionalProperties: false,
              properties: {
                cloudProduct: { type: "string" },
                skuName: { type: "string" },
                moduleName: { type: "string", minLength: 1 },
                standardDays: { type: "number", minimum: 0 },
                suggestedDays: { type: "number", minimum: 0 },
                reason: { type: "string", minLength: 1 },
              },
            },
          },
          risks: STRING_ARRAY_SCHEMA,
          assumptions: STRING_ARRAY_SCHEMA,
        },
      },
    },
  },
};

const requiredStringRowSchema = (fields: string[]) => ({
  type: "array",
  items: {
    type: "object",
    required: fields,
    additionalProperties: false,
    properties: Object.fromEntries(fields.map((field) => [field, { type: "string" }])),
  },
});

export const REQUIREMENT_IMPORT_CONTRACT: StructuredOutputContract<RequirementImportOutput> = {
  id: "requirement-import",
  version: "1.0.0",
  name: "RequirementImport",
  description: "需求 Excel 全量抽取结果；缺失字符串为空、缺失数组为空，禁止保留模板占位内容。",
  riskTier: "R1",
  schema: {
    type: "object",
    required: ["basicInfo", "requirementImportData"],
    additionalProperties: false,
    properties: {
      basicInfo: {
        type: "object",
        required: ["customerName", "location", "projectName", "opportunityNo", "productLines", "customerIndustry", "enterpriseRevenue", "itStatus", "expectedGoLive", "enterpriseProfile", "projectBackgroundNeeds", "projectGoals"],
        additionalProperties: false,
        properties: {
          customerName: { type: "string", description: "客户企业全称；未知时为空字符串。" },
          location: { type: "string", description: "实施地点；未知时为空字符串。" },
          projectName: { type: "string", description: "项目名称；未知时为空字符串。" },
          opportunityNo: { type: "string", description: "材料中的商机号；未知时为空字符串。" },
          productLines: STRING_ARRAY_SCHEMA,
          customerIndustry: { type: "string", description: "有材料证据的行业编码和名称。" },
          enterpriseRevenue: { type: "string" },
          itStatus: { type: "string" },
          expectedGoLive: { type: "string" },
          enterpriseProfile: { type: "string" },
          projectBackgroundNeeds: { type: "string" },
          projectGoals: { type: "string" },
        },
      },
      requirementImportData: {
        type: "object",
        required: ["valuePropositionRows", "businessNeedRows", "devOverviewRows", "productModuleRows", "implementationScopeRows", "meetingNotes", "keyPointRows"],
        additionalProperties: false,
        properties: {
          valuePropositionRows: requiredStringRowSchema(["summary", "refinedContent", "originalDemand", "interviewOutline"]),
          businessNeedRows: requiredStringRowSchema(["businessDomain", "category", "businessNeed", "proposer", "title", "preSalesIncluded", "standardImplemented", "solutionSuggestion", "requiresCustomDev"]),
          devOverviewRows: {
            type: "array",
            items: {
              type: "object",
              required: ["businessDomain", "moduleName", "moduleBrief", "functionDesc", "solutionSuggestion", "codingDays", "estimateBasis"],
              additionalProperties: false,
              properties: {
                businessDomain: { type: "string" },
                moduleName: { type: "string" },
                moduleBrief: { type: "string" },
                functionDesc: { type: "string" },
                solutionSuggestion: { type: "string" },
                codingDays: { type: "number", minimum: 0 },
                estimateBasis: { type: "string" },
              },
            },
          },
          productModuleRows: requiredStringRowSchema(["productDomain", "moduleName", "subModule", "userCount", "implementationOrgCount", "pilotOrgCount", "partyBLead", "partyALead"]),
          implementationScopeRows: requiredStringRowSchema(["companyName", "companyType", "moduleScope", "location", "implementationMode", "note"]),
          meetingNotes: { type: "string", description: "真实纪要或约束；只有模板占位时为空字符串。" },
          keyPointRows: requiredStringRowSchema(["analysisCategory", "subItem", "detail", "note"]),
        },
      },
    },
  },
};

export const INTERACTIVE_FORM_BLOCK_CONTRACT: StructuredOutputContract<InteractiveFormBlockOutput> = {
  id: "workbench-interactive-form-block",
  version: "1.0.0",
  name: "WorkbenchInteractiveFormBlock",
  description: "工作台内嵌交互表单协议；只允许受支持的字段类型，单选项必须提供可提交选项。",
  riskTier: "R1",
  schema: {
    type: "object",
    required: ["blockId", "title", "submitLabel", "fields"],
    additionalProperties: false,
    properties: {
      blockId: { type: "string", minLength: 1, maxLength: 200 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 500 },
      submitLabel: { type: "string", minLength: 1, maxLength: 200 },
      submitMessageTemplate: { type: "string", maxLength: 1000 },
      fields: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          required: ["id", "label", "type"],
          additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 1, maxLength: 200 },
            label: { type: "string", minLength: 1, maxLength: 200 },
            type: { type: "string", enum: ["text", "textarea", "single_select", "boolean", "number"] },
            required: { type: "boolean" },
            placeholder: { type: "string", maxLength: 200 },
            helperText: { type: "string", maxLength: 400 },
            options: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: {
                type: "object",
                required: ["label", "value"],
                additionalProperties: false,
                properties: {
                  label: { type: "string", minLength: 1 },
                  value: { type: "string", minLength: 1 },
                },
              },
            },
          },
        },
      },
    },
  },
  semanticValidate(value) {
    return value.fields.flatMap((field, index) =>
      field.type === "single_select" && (!field.options || field.options.length === 0)
        ? [{ path: `/fields/${index}/options`, keyword: "semantic", message: "single_select 必须提供 options" }]
        : []);
  },
};

export const COMPANY_PROFILE_CONTRACT: StructuredOutputContract<CompanyProfileOutput> = {
  id: "company-profile",
  version: "1.0.0",
  name: "CompanyProfile",
  description: "企业画像与同名主体消歧结果；未知事实必须为空字符串，不得编造默认值。",
  riskTier: "R1",
  schema: {
    type: "object",
    required: [
      "needsDisambiguation",
      "candidates",
      "enterpriseProfile",
      "location",
      "customerIndustry",
      "enterpriseRevenue",
      "itStatus",
    ],
    additionalProperties: false,
    properties: {
      needsDisambiguation: {
        type: "boolean",
        description: "客户名称是否对应多个无法自动确认的企业主体。",
      },
      candidates: {
        type: "array",
        maxItems: 3,
        description: "需要消歧时的候选主体；无需消歧时为空数组。",
        items: {
          type: "object",
          required: ["displayName", "summary"],
          additionalProperties: false,
          properties: {
            displayName: { type: "string", minLength: 1, description: "可供用户选择的企业主体全称。" },
            summary: { type: "string", description: "区分该主体的地点、业务或登记线索。" },
          },
        },
      },
      enterpriseProfile: { type: "string", description: "有证据支撑的企业简介；未知时为空字符串。" },
      location: { type: "string", description: "企业所在地区；未知时为空字符串。" },
      customerIndustry: { type: "string", description: "客户行业事实；不能确认时为空字符串。" },
      enterpriseRevenue: { type: "string", description: "公开或已知营收/规模；未知时为空字符串。" },
      itStatus: { type: "string", description: "已知信息化现状；未知时为空字符串。" },
    },
  },
  semanticValidate(value) {
    const issues: StructuredOutputValidationIssue[] = [];
    if (value.needsDisambiguation && value.candidates.length === 0) {
      issues.push({
        path: "/candidates",
        keyword: "semantic",
        message: "needsDisambiguation=true 时至少需要一个候选主体",
      });
    }
    return issues;
  },
};

export const ATTACHMENT_ANALYSIS_CONTRACT: StructuredOutputContract<AttachmentAnalysisOutput> = {
  id: "attachment-requirement-analysis",
  version: "1.0.0",
  name: "AttachmentRequirementAnalysis",
  description: "附件需求分析或多附件合并结果；数组字段必须保持数组结构。",
  riskTier: "R1",
  schema: {
    type: "object",
    required: [
      "answer",
      "projectName",
      "customerName",
      "industry",
      "productLines",
      "sourceSheets",
      "needs",
      "modules",
      "missingItems",
      "risks",
      "nextActions",
      "summary",
    ],
    additionalProperties: false,
    properties: {
      answer: { type: "string", description: "面向用户的简短分析结论。" },
      projectName: { type: "string", description: "项目名称；无法确认时使用待补充。" },
      customerName: { type: "string", description: "客户企业名称；无法确认时使用待补充。" },
      industry: { type: "string", description: "有附件证据的行业；无法确认时使用待补充。" },
      productLines: STRING_ARRAY_SCHEMA,
      sourceSheets: STRING_ARRAY_SCHEMA,
      needs: STRING_ARRAY_SCHEMA,
      modules: STRING_ARRAY_SCHEMA,
      missingItems: STRING_ARRAY_SCHEMA,
      risks: STRING_ARRAY_SCHEMA,
      nextActions: STRING_ARRAY_SCHEMA,
      summary: { type: "string", description: "附件分析摘要。" },
      sourceFiles: STRING_ARRAY_SCHEMA,
    },
  },
};

const HARNESS_PROJECT_SCHEMA = {
  type: "object",
  required: ["projectName", "customerName", "industry"],
  additionalProperties: false,
  properties: {
    projectName: { type: "string", description: "项目名称；无法确认时填待补充。" },
    customerName: { type: "string", description: "客户企业名称；无法确认时填待补充。" },
    industry: { type: "string", description: "有证据的行业；无法确认时填待补充。" },
  },
} as const;

const HARNESS_FINDINGS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    required: ["domain", "scenario", "moduleHint", "confidence", "evidenceRefs"],
    additionalProperties: false,
    properties: {
      domain: { type: "string" },
      scenario: { type: "string" },
      moduleHint: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidenceRefs: { type: "array", items: { type: "string", minLength: 1 } },
    },
  },
} as const;

const HARNESS_MISSING_FIELDS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    required: ["field", "reason", "priority"],
    additionalProperties: false,
    properties: {
      field: { type: "string" },
      reason: { type: "string" },
      priority: { type: "string", enum: ["must", "should", "could"] },
    },
  },
} as const;

const HARNESS_QUESTIONS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    required: ["question", "targetRole", "reason"],
    additionalProperties: false,
    properties: {
      question: { type: "string" },
      targetRole: { type: "string" },
      reason: { type: "string" },
    },
  },
} as const;

const HARNESS_RISKS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    required: ["title", "assumption", "impact"],
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      assumption: { type: "string" },
      impact: { type: "string" },
    },
  },
} as const;

const HARNESS_ACTIONS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    required: ["label", "actionType"],
    additionalProperties: false,
    properties: {
      label: { type: "string" },
      actionType: { type: "string" },
    },
  },
} as const;

export const HARNESS_REPORT_V1_CONTRACT: StructuredOutputContract<HarnessRequirementReportV1Content> = {
  id: "harness-requirement-report-v1",
  version: "1.0.0",
  name: "HarnessRequirementReportV1",
  description: "Harness 需求解析报告 v1；所有分析数组和子项字段必须完整，confidence 范围为 0 到 1。",
  riskTier: "R2",
  schema: {
    type: "object",
    required: ["version", "sourceFile", "project", "sourceSheets", "requirementFindings", "missingFields", "clarificationQuestions", "risks", "nextActions"],
    additionalProperties: false,
    properties: {
      version: { type: "string", const: "v1" },
      sourceFile: { type: "string", minLength: 1 },
      project: HARNESS_PROJECT_SCHEMA,
      sourceSheets: STRING_ARRAY_SCHEMA,
      requirementFindings: HARNESS_FINDINGS_SCHEMA,
      missingFields: HARNESS_MISSING_FIELDS_SCHEMA,
      clarificationQuestions: HARNESS_QUESTIONS_SCHEMA,
      risks: HARNESS_RISKS_SCHEMA,
      nextActions: HARNESS_ACTIONS_SCHEMA,
    },
  },
};

export const HARNESS_REPORT_V2_CONTRACT: StructuredOutputContract<HarnessRequirementReportV2Content> = {
  id: "harness-requirement-report-v2",
  version: "1.0.0",
  name: "HarnessRequirementReportV2",
  description: "Harness 澄清后需求解析报告 v2；包含用户回答、证据引用和下一步动作。",
  riskTier: "R2",
  schema: {
    type: "object",
    required: ["version", "sourceFile", "project", "sourceSheets", "requirementFindings", "missingFields", "clarificationQuestions", "answeredQuestions", "risks", "nextActions", "clarificationSummary"],
    additionalProperties: false,
    properties: {
      version: { type: "string", const: "v2" },
      sourceFile: { type: "string", minLength: 1 },
      project: HARNESS_PROJECT_SCHEMA,
      sourceSheets: STRING_ARRAY_SCHEMA,
      requirementFindings: HARNESS_FINDINGS_SCHEMA,
      missingFields: HARNESS_MISSING_FIELDS_SCHEMA,
      clarificationQuestions: HARNESS_QUESTIONS_SCHEMA,
      answeredQuestions: {
        type: "array",
        items: {
          type: "object",
          required: ["question", "answer", "source"],
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            answer: {},
            source: { type: "string", enum: ["user_chat", "structured_form"] },
          },
        },
      },
      risks: HARNESS_RISKS_SCHEMA,
      nextActions: HARNESS_ACTIONS_SCHEMA,
      clarificationSummary: { type: "string" },
    },
  },
};
