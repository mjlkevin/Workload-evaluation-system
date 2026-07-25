import { createHash } from "node:crypto";

import type { RuntimeContext, ToolConfirmation, ToolContext, ToolExecutionEvent } from "./context.types";

export function createToolContext<TPorts extends object = Record<string, never>>(input: {
  runtime: RuntimeContext;
  ports?: TPorts;
  confirmation: ToolConfirmation;
  recordEvent?: (event: ToolExecutionEvent) => void;
}): ToolContext<TPorts> {
  const confirmation = Object.freeze({
    confirmed: input.confirmation.confirmed,
    ...(input.confirmation.idempotencyKey?.trim()
      ? { idempotencyKey: input.confirmation.idempotencyKey.trim() }
      : {}),
    ...(input.confirmation.toolName?.trim()
      ? { toolName: input.confirmation.toolName.trim() }
      : {}),
    ...(input.confirmation.argumentsHash?.trim()
      ? { argumentsHash: input.confirmation.argumentsHash.trim() }
      : {}),
  });
  const ports = Object.freeze({ ...(input.ports ?? {}) }) as Readonly<TPorts>;

  return Object.freeze({
    runtime: input.runtime,
    ports,
    confirmation,
    recordEvent: input.recordEvent ?? (() => {}),
  });
}

/** 将确认绑定到规范化参数，避免确认后被替换为另一组写入参数。 */
export function hashToolArguments(args: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(args))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}
