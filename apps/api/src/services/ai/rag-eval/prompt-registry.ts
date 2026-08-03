import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type RagPromptVersion = {
  id: string;
  version: number;
  template: string;
  variables: string[];
  hash: string;
};

type RagPromptStore = {
  version?: number;
  prompts?: Record<string, Array<Partial<RagPromptVersion>>>;
};

const BUILTIN_RAG_ANSWER_V1 = {
  id: "rag-answer",
  version: 1,
  template: [
    "你是产品知识助手。请严格基于以下检索到的文档内容回答用户问题。",
    "规则：",
    "1. 如果文档中有相关信息，请综合多个文档给出完整回答，并在引用处标注来源文档编号（如[文档1]）。",
    "2. 如果文档中没有相关信息，请明确说明'知识库中未找到相关内容'，不要编造答案。",
    "3. 回答要简洁专业，适合售前顾问参考。",
    "",
    "检索到的文档：",
    "{{context}}",
  ].join("\n"),
  variables: ["context"],
};

function promptHash(input: { id: string; version: number; template: string; variables: string[] }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function normalizePrompt(input: Partial<RagPromptVersion>): RagPromptVersion | null {
  const id = String(input.id || "").trim();
  const version = Number(input.version);
  const template = String(input.template || "");
  const variables = Array.isArray(input.variables)
    ? input.variables.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (!id || !Number.isInteger(version) || version < 1 || !template) return null;
  return {
    id,
    version,
    template,
    variables,
    hash: promptHash({ id, version, template, variables }),
  };
}

function builtinPrompt(): RagPromptVersion {
  return normalizePrompt(BUILTIN_RAG_ANSWER_V1)!;
}

export function defaultPromptRegistryPath(): string {
  return path.join(process.cwd(), "config", "rag", "prompts.json");
}

export function resolvePrompt(
  id: string,
  version: number,
  storePath = defaultPromptRegistryPath(),
): RagPromptVersion {
  if (fs.existsSync(storePath)) {
    try {
      const store = JSON.parse(fs.readFileSync(storePath, "utf8")) as RagPromptStore;
      const candidate = (store.prompts?.[id] || []).find((item) => Number(item.version) === version);
      const normalized = candidate ? normalizePrompt({ ...candidate, id }) : null;
      if (normalized) return normalized;
    } catch {
      // 配置文件损坏不得默认切换至其他版本；仅内置 v1 可降级。
    }
  }
  if (id === BUILTIN_RAG_ANSWER_V1.id && version === BUILTIN_RAG_ANSWER_V1.version) {
    return builtinPrompt();
  }
  throw new Error(`prompt_not_found:${id}@${version}`);
}

export function renderPrompt(prompt: RagPromptVersion, variables: Record<string, string>): string {
  let rendered = prompt.template;
  for (const variable of prompt.variables) {
    if (!Object.prototype.hasOwnProperty.call(variables, variable)) {
      throw new Error(`missing_prompt_variable:${variable}`);
    }
    rendered = rendered.split(`{{${variable}}}`).join(String(variables[variable]));
  }
  return rendered;
}
