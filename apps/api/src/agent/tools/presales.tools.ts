import type { AgentTool } from "../agent.types";

/** 底层估算函数签名（对应 estimates.usecase.calculateEstimateOnly） */
export type EstimateFn = (body: Record<string, unknown>) => unknown | Promise<unknown>;

/** 实施初估工具（读操作） */
export function buildEstimateTool(calculate: EstimateFn): AgentTool {
  return {
    name: "estimate_implementation",
    description: "对已确认的需求包做实施工作量初估，返回分模块人天与合计",
    parameters: {
      type: "object",
      properties: {
        items: { type: "array", description: "需求条目数组（来自已确认的需求包）" },
      },
      required: ["items"],
    },
    capability: "estimates:create",
    mutates: false,
    category: "estimate",
    discoverable: false,
    async execute(args) {
      return calculate(args);
    },
  };
}
