import {
  CONTEXT_REF_TYPES,
  type ContextRef,
  type ContextRefType,
  type ContextSensitivity,
} from "./context.types";

const DEFAULT_SENSITIVITY: Record<ContextRefType, ContextSensitivity> = {
  attachment: "confidential",
  knowledge: "internal",
  project: "confidential",
  harness: "confidential",
  artifact: "confidential",
  standard: "internal",
};

export function createContextRef(input: {
  type: ContextRefType;
  id: string;
  version?: string;
  hash?: string;
  ownerUserId?: string;
  sensitivity?: ContextSensitivity;
  includedInModel?: boolean;
}): ContextRef {
  const id = input.id.trim();
  if (!id) throw new Error("上下文引用 id 不能为空");

  return Object.freeze({
    type: input.type,
    id,
    ...(input.version?.trim() ? { version: input.version.trim() } : {}),
    ...(input.hash?.trim() ? { hash: input.hash.trim() } : {}),
    ...(input.ownerUserId?.trim() ? { ownerUserId: input.ownerUserId.trim() } : {}),
    sensitivity: input.sensitivity ?? DEFAULT_SENSITIVITY[input.type],
    includedInModel: input.includedInModel ?? false,
  });
}

export function parseLegacyContextRef(value: string): ContextRef {
  const separator = value.indexOf(":");
  const rawType = separator >= 0 ? value.slice(0, separator) : "";
  const id = separator >= 0 ? value.slice(separator + 1) : "";
  if (!CONTEXT_REF_TYPES.includes(rawType as ContextRefType)) {
    throw new Error(`不支持的上下文引用类型: ${rawType || "empty"}`);
  }
  return createContextRef({ type: rawType as ContextRefType, id });
}

export function toLegacyContextRef(ref: ContextRef): string {
  return `${ref.type}:${ref.id}`;
}
