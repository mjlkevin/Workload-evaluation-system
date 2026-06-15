import { Router } from "express";

import { runAgent, type ChatRunner } from "../agent/orchestrator";
import type { AgentEvent, AgentUser } from "../agent/agent.types";
import { ToolRegistry } from "../agent/tool-registry";
import { buildEstimateTool } from "../agent/tools/presales.tools";
import { defaultProviderRegistry } from "../ai/provider";
import { calculateEstimateOnly } from "../modules/estimates/estimates.module";
import { requireAuthenticated } from "../rbac/middleware";
import { getCombinedCapabilities } from "../rbac/permissions";
import { asString } from "../utils/helpers";

export interface AgentRouterDeps {
  runner?: ChatRunner;
  registry?: ToolRegistry;
}

export function createAgentRouter(deps: AgentRouterDeps = {}) {
  const router = Router();

  router.post("/chat", requireAuthenticated(), async (req, res) => {
    const message = asString(req.body?.message);
    if (!message) {
      res.status(400).json({
        code: 40001,
        message: "message 不能为空",
        data: null,
      });
      return;
    }

    const runner = deps.runner ?? defaultProviderRegistry.getDefault();
    if (!runner) {
      res.status(503).json({
        code: 50301,
        message: "AI Provider 未就绪",
        data: null,
      });
      return;
    }

    const registry = deps.registry ?? createDefaultRegistry();
    const events: Array<Record<string, unknown>> = [];
    const user: AgentUser = {
      id: req.user?.id ?? "",
      capabilities: getCombinedCapabilities(req.v2Roles ?? []),
    };

    try {
      const result = await runAgent({
        userMessage: message,
        user,
        registry,
        runner,
        onEvent: (event) => events.push(toApiEvent(event)),
        confirm: async () => req.body?.confirm === true,
      });
      res.json({
        code: 0,
        message: "ok",
        data: { result, events },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      events.push({ type: "error", error });
      res.status(500).json({
        code: 50001,
        message: "Agent 执行失败",
        data: { events },
      });
    }
  });

  return router;
}

function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(buildEstimateTool((body) => calculateEstimateOnly(body as Parameters<typeof calculateEstimateOnly>[0])));
  return registry;
}

function toApiEvent(event: AgentEvent): Record<string, unknown> {
  switch (event.kind) {
    case "tool_call":
      return { type: "tool_started", name: event.name, arguments: event.arguments };
    case "tool_result":
      return { type: "tool_finished", name: event.name, ok: event.ok, data: event.data, error: event.error };
    case "need_confirm":
      return { type: "needs_confirmation", name: event.name, arguments: event.arguments };
    case "final":
      return { type: "assistant_message", content: event.content };
  }
}

export default createAgentRouter();
