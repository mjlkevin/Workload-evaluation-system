import { randomUUID } from "node:crypto";

import type { RuntimeContext } from "./context.types";

export type CreateRuntimeContextInput = Omit<RuntimeContext, "requestId" | "traceId" | "actor"> & {
  requestId?: string;
  traceId?: string;
  actor: {
    userId: string;
    username?: string;
    roles: readonly string[];
    capabilities: RuntimeContext["actor"]["capabilities"];
  };
};

export function createRuntimeContext(input: CreateRuntimeContextInput): RuntimeContext {
  const userId = input.actor.userId.trim();
  if (!userId) throw new Error("RuntimeContext 缺少可信用户");

  const actor = Object.freeze({
    userId,
    ...(input.actor.username?.trim() ? { username: input.actor.username.trim() } : {}),
    roles: Object.freeze([...input.actor.roles]),
    capabilities: Object.freeze([...input.actor.capabilities]),
  });

  return Object.freeze({
    requestId: input.requestId?.trim() || randomUUID(),
    traceId: input.traceId?.trim() || randomUUID(),
    actor,
    channel: input.channel,
    workflowKey: input.workflowKey.trim() || "free_chat",
    ...(input.aiSessionId?.trim() ? { aiSessionId: input.aiSessionId.trim() } : {}),
    ...(input.harnessRunId?.trim() ? { harnessRunId: input.harnessRunId.trim() } : {}),
    ...(input.tenantId?.trim() ? { tenantId: input.tenantId.trim() } : {}),
  });
}
