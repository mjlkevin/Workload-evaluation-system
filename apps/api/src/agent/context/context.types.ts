import type { ChatMessage, ResponseFormat, ToolDefinition } from "../../ai/provider/model-provider";
import type { Capability } from "../../rbac/permissions";

export const RUNTIME_CHANNELS = ["web", "api", "replay", "regression"] as const;
export type RuntimeChannel = (typeof RUNTIME_CHANNELS)[number];

export type RuntimeActor = Readonly<{
  userId: string;
  username?: string;
  roles: readonly string[];
  capabilities: readonly Capability[];
}>;

export type RuntimeContext = Readonly<{
  requestId: string;
  traceId: string;
  actor: RuntimeActor;
  channel: RuntimeChannel;
  workflowKey: string;
  aiSessionId?: string;
  harnessRunId?: string;
  tenantId?: string;
}>;

export const CONTEXT_REF_TYPES = [
  "attachment",
  "knowledge",
  "project",
  "harness",
  "artifact",
  "standard",
] as const;
export type ContextRefType = (typeof CONTEXT_REF_TYPES)[number];
export type ContextSensitivity = "public" | "internal" | "confidential";

export type ContextRef = Readonly<{
  type: ContextRefType;
  id: string;
  version?: string;
  hash?: string;
  ownerUserId?: string;
  sensitivity: ContextSensitivity;
  includedInModel: boolean;
}>;

export type ModelContext = Readonly<{
  messages: readonly ChatMessage[];
  tools: readonly ToolDefinition[];
  responseFormat?: ResponseFormat;
  contextRefs: readonly ContextRef[];
  budget: Readonly<{ maxInputTokens?: number; maxMessages: number }>;
}>;

export type ToolExecutionEvent = Readonly<{
  type: string;
  details?: Readonly<Record<string, unknown>>;
}>;

export type ToolConfirmation = Readonly<{
  confirmed: boolean;
  idempotencyKey?: string;
  toolName?: string;
  argumentsHash?: string;
}>;

export type ToolContext<TPorts extends object = Record<string, never>> = Readonly<{
  runtime: RuntimeContext;
  ports: Readonly<TPorts>;
  confirmation: ToolConfirmation;
  recordEvent: (event: ToolExecutionEvent) => void;
}>;

export type RunState = Readonly<{
  conversation: Readonly<{ aiSessionId?: string; messageCount: number; status?: string }>;
  execution: Readonly<{ harnessRunId?: string; stage?: string; status?: string }>;
  artifacts: readonly Readonly<{ artifactId: string; type: string; version?: string; status: string }>[];
  pendingActions: readonly Readonly<{ actionId: string; actionType: string; status: string }>[];
  contextRefs: readonly ContextRef[];
}>;
