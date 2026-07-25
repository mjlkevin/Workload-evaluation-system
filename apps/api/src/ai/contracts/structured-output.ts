import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

import { structuredOutputEventsTotal } from "../../metrics";
import { isProviderError } from "../provider/errors";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  JsonSchemaResponseFormat,
  ModelProvider,
  ResponseFormat,
} from "../provider/model-provider";

export type StructuredOutputRiskTier = "R0" | "R1" | "R2" | "R3";

export type StructuredOutputValidationIssue = {
  path: string;
  keyword: string;
  message: string;
  params?: Record<string, unknown>;
};

export type StructuredOutputContract<T> = {
  id: string;
  version: string;
  name: string;
  description: string;
  riskTier: StructuredOutputRiskTier;
  schema: Record<string, unknown>;
  semanticValidate?: (value: T) => StructuredOutputValidationIssue[];
};

export type StructuredCompletionResult<T> = {
  data: T;
  rawContent: string;
  response: ChatCompletionResponse;
  contractId: string;
  schemaVersion: string;
  riskTier: StructuredOutputRiskTier;
  responseFormat: "json_schema" | "json_object";
  outputAttempts: number;
  repairAttempts: number;
  fallbackReason?: "provider_json_schema_unsupported";
  validationIssues: StructuredOutputValidationIssue[];
};

export type RunStructuredCompletionInput<T> = {
  provider: ModelProvider;
  contract: StructuredOutputContract<T>;
  request: ChatCompletionRequest;
  maxOutputAttempts?: number;
  allowJsonObjectFallback?: boolean;
};

export class StructuredOutputValidationError extends Error {
  readonly contractId: string;
  readonly schemaVersion: string;
  readonly issues: StructuredOutputValidationIssue[];
  readonly rawContent: string;

  constructor(
    contract: StructuredOutputContract<unknown>,
    issues: StructuredOutputValidationIssue[],
    rawContent: string,
  ) {
    super(`structured_output_validation_failed:${contract.id}@${contract.version}`);
    this.name = "StructuredOutputValidationError";
    this.contractId = contract.id;
    this.schemaVersion = contract.version;
    this.issues = issues;
    this.rawContent = rawContent;
  }
}

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

const validatorCache = new Map<string, ValidateFunction>();

export function responseFormatForContract<T>(contract: StructuredOutputContract<T>): JsonSchemaResponseFormat {
  return {
    type: "json_schema",
    json_schema: {
      name: contract.name,
      strict: true,
      description: contract.description,
      schema: contract.schema,
    },
  };
}

export function validateStructuredValue<T>(
  contract: StructuredOutputContract<T>,
  value: unknown,
): { valid: true; data: T; issues: [] } | { valid: false; issues: StructuredOutputValidationIssue[] } {
  const validate = getValidator(contract);
  const structurallyValid = validate(value);
  const structuralIssues = structurallyValid ? [] : normalizeAjvErrors(validate.errors);
  if (!structurallyValid) return { valid: false, issues: structuralIssues };

  const data = value as T;
  const semanticIssues = contract.semanticValidate?.(data) ?? [];
  if (semanticIssues.length > 0) return { valid: false, issues: semanticIssues };
  return { valid: true, data, issues: [] };
}

export function parseStructuredOutput<T>(contract: StructuredOutputContract<T>, rawContent: string): T {
  const parsed = parseJsonValue(rawContent);
  const validation = validateStructuredValue(contract, parsed);
  if (!validation.valid) {
    throw new StructuredOutputValidationError(contract as StructuredOutputContract<unknown>, validation.issues, rawContent);
  }
  return validation.data;
}

export async function runStructuredCompletion<T>(
  input: RunStructuredCompletionInput<T>,
): Promise<StructuredCompletionResult<T>> {
  const maxOutputAttempts = clampOutputAttempts(input.maxOutputAttempts);
  const allowFormatFallback = input.allowJsonObjectFallback !== false;
  let responseFormat: ResponseFormat = responseFormatForContract(input.contract);
  let responseFormatName: "json_schema" | "json_object" = "json_schema";
  let fallbackReason: "provider_json_schema_unsupported" | undefined;
  let messages = [...input.request.messages];
  let lastValidationError: StructuredOutputValidationError | undefined;

  for (let outputAttempt = 1; outputAttempt <= maxOutputAttempts; outputAttempt += 1) {
    let response: ChatCompletionResponse;
    try {
      response = await input.provider.chatCompletion({
        ...input.request,
        messages,
        responseFormat,
      });
    } catch (error) {
      if (
        responseFormatName === "json_schema" &&
        allowFormatFallback &&
        isUnsupportedJsonSchemaError(error)
      ) {
        responseFormat = "json_object";
        responseFormatName = "json_object";
        fallbackReason = "provider_json_schema_unsupported";
        incrementMetric(input.contract, "format_fallback");
        response = await input.provider.chatCompletion({
          ...input.request,
          messages,
          responseFormat,
        });
      } else {
        incrementMetric(input.contract, "provider_error");
        throw error;
      }
    }

    try {
      const data = parseStructuredOutput(input.contract, response.content);
      incrementMetric(input.contract, outputAttempt > 1 ? "repaired" : "success");
      return {
        data,
        rawContent: response.rawContent || response.content,
        response,
        contractId: input.contract.id,
        schemaVersion: input.contract.version,
        riskTier: input.contract.riskTier,
        responseFormat: responseFormatName,
        outputAttempts: outputAttempt,
        repairAttempts: outputAttempt - 1,
        fallbackReason,
        validationIssues: [],
      };
    } catch (error) {
      if (!(error instanceof StructuredOutputValidationError)) throw error;
      lastValidationError = error;
      incrementMetric(input.contract, "validation_failed");
      if (outputAttempt >= maxOutputAttempts) throw error;
      messages = [
        ...input.request.messages,
        {
          role: "user",
          content: buildRepairInstruction(input.contract, error.issues),
        },
      ];
    }
  }

  throw lastValidationError ?? new Error("structured_output_unreachable");
}

function getValidator<T>(contract: StructuredOutputContract<T>): ValidateFunction {
  const cacheKey = `${contract.id}@${contract.version}`;
  const cached = validatorCache.get(cacheKey);
  if (cached) return cached;
  const compiled = ajv.compile(contract.schema);
  validatorCache.set(cacheKey, compiled);
  return compiled;
}

function parseJsonValue(rawContent: string): unknown {
  const raw = String(rawContent || "").trim();
  if (!raw) throw new Error("structured_output_empty");
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  const error = new Error("structured_output_invalid_json");
  (error as Error & { cause?: unknown }).cause = lastError;
  throw error;
}

function normalizeAjvErrors(errors: ErrorObject[] | null | undefined): StructuredOutputValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message || "invalid value",
    params: error.params as Record<string, unknown>,
  }));
}

function buildRepairInstruction<T>(
  contract: StructuredOutputContract<T>,
  issues: StructuredOutputValidationIssue[],
): string {
  const summary = issues
    .slice(0, 12)
    .map((issue) => `${issue.path || "/"}: ${issue.message} (${issue.keyword})`)
    .join("\n");
  return [
    `上一轮输出未通过结构化输出契约 ${contract.id}@${contract.version}。`,
    "请修正以下字段后重新输出完整 JSON 对象；不要输出 Markdown、解释或代码块：",
    summary || "/: invalid structured output",
  ].join("\n");
}

function isUnsupportedJsonSchemaError(error: unknown): boolean {
  if (!isProviderError(error) || error.code !== "bad_request") return false;
  const text = `${error.message} ${error.legacyReason || ""}`;
  const mentionsFormat = /response[_ -]?format|json[_ -]?schema|structured output/i.test(text);
  const explicitlyUnsupported = /not supported|unsupported|not available|unknown (?:type|format)|不支持/i.test(text);
  return mentionsFormat && explicitlyUnsupported;
}

function clampOutputAttempts(value: number | undefined): number {
  const numeric = Number(value ?? 2);
  if (!Number.isFinite(numeric)) return 2;
  return Math.max(1, Math.min(3, Math.floor(numeric)));
}

function incrementMetric<T>(contract: StructuredOutputContract<T>, outcome: string): void {
  structuredOutputEventsTotal.inc({
    contract_id: contract.id,
    schema_version: contract.version,
    outcome,
  });
}
