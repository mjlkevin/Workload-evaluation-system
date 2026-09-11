import type { AgentTool } from "../agent.types";
import { CAPABILITY_FACTS, formatCapabilityFacts } from "../../services/ai/workbench-capability-facts";

/**
 * 批次 4：能力清单工具（capability_discovery 正则退役的承接方）。
 *
 * 退役前：`你会干什么|能做什么|帮助…` 之类的词表在意图路由里猜「用户想要能力清单」，
 * 命中即交静态 handler，模型被绕过。实取到的误伤（`routeWorkbenchIntent` 直调）：
 *   · 「产品帮助文档在哪里？」   → capability_discovery（命中「帮助」）
 *   · 「这个需求你能做什么样的拆解？」 → capability_discovery（命中「能做什么」）
 * 这类句子要的是一件事，不是自我介绍——该由模型判断，不该由词表猜。
 *
 * 退役后：模型自己决定何时调用本工具。保留的唯一不可替代之物是**事实源**：
 * 回答「你能做什么」必须只依据 CAPABILITY_FACTS（与代码实现严格对齐、禁止写入未实现能力），
 * 因此把该表作为工具产出交给模型，而不是把路由关键词留在正则里。
 */
export const DESCRIBE_CAPABILITIES_TOOL_NAME = "describe_capabilities";

export function buildDescribeCapabilitiesTool(): AgentTool {
  return {
    name: DESCRIBE_CAPABILITIES_TOOL_NAME,
    description:
      "获取 AI 工作台当前真实能力清单（唯一事实源）。用户询问系统能做什么、有哪些功能、如何求助时调用；回答必须只依据本工具返回的条目，不得承诺清单之外的能力。",
    parameters: { type: "object", properties: {} },
    capability: "estimates:read",
    mutates: false,
    // 非 discovery 类：discovery 会被 listFullToolsFor 排除，工作台模型因此调不到它
    category: "capability",
    // discoverable：不进默认注入集，由 list_tools 按需发现（工作台走全量注入，仍可调用）
    discoverable: true,
    async execute() {
      return {
        groundingRule: "只可复述以下条目，禁止新增未实现的能力承诺；写操作须经用户确认后才执行。",
        facts: formatCapabilityFacts(),
        capabilityIds: CAPABILITY_FACTS.map((fact) => fact.id),
      };
    },
  };
}
