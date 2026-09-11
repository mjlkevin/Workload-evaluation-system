import { Router } from "express";

import { runAgent, type ChatRunner } from "../agent/orchestrator";
import type { AgentEvent, AgentUser } from "../agent/agent.types";
import type { ToolRegistry } from "../agent/tool-registry";
import { createDefaultRegistry } from "../agent/default-registry";
import { createRuntimeContext } from "../agent/context/runtime-context";
import { defaultProviderRegistry } from "../ai/provider";
import { requireAuthenticated } from "../rbac/middleware";
import { getCombinedCapabilities } from "../rbac/permissions";
import { resolveActiveToolPolicy } from "../modules/system/system.repository";
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

    const authUser = req.user;
    if (!authUser) {
      res.status(401).json({
        code: 40101,
        message: "未登录",
        data: null,
      });
      return;
    }

    const events: Array<Record<string, unknown>> = [];
    const capabilities = getCombinedCapabilities(req.v2Roles ?? []);
    const user: AgentUser = {
      id: authUser.id,
      capabilities,
      // 批次 6b：策略角色可见性层需要的可信角色（服务端推导，不接受请求体传入）
      roles: req.v2Roles ?? [],
    };
    // O2 · A4：可信运行上下文注入编排循环（用户身份来自 JWT，非模型入参）
    const runtimeContext = createRuntimeContext({
      actor: {
        userId: authUser.id,
        username: authUser.username,
        roles: req.v2Roles ?? [],
        capabilities,
      },
      channel: "api",
      workflowKey: "agent_chat",
    });
    const registry = deps.registry ?? createDefaultRegistry(authUser, runtimeContext);
    // 批次 6b：注入点读取生效策略（读失败抛错 → 下方 catch 收敛为执行失败，
    // 绝不按「无策略」放行全部工具）
    const toolPolicy = await resolveActiveToolPolicy();

    try {
      // 批次 6b 返修（③）：**不传 confirm 端口**。本通道（同步 HTTP，无 Run 事件流）
      // 没有可持久化的审批闸门，编排层因此对落 ask 档的工具（写 / 外发 / 策略
      // user-confirm）一律失败关闭并回原因。
      // 此前这里是 `async () => req.body?.confirm === true`：请求体一个布尔即一次性批准
      // 本轮全部待确认调用，等于把审批判交回被审方——管理员在策略页设的「逐次确认」
      // 走这条路形同空文。请求体的 confirm 字段自此**不再被读取**（传什么都不生效）。
      const result = await runAgent({
        userMessage: message,
        user,
        registry,
        runner,
        onEvent: (event) => events.push(toApiEvent(event)),
        runtimeContext,
        toolPolicy,
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
