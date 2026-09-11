// ============================================================
// WES Agent Phase 1G — AI 工作台意图路由器
// 纯函数路由：根据用户输入、附件、Harness artifact 状态决定执行路径。
// 规则优先：显式 clientAction → 阶段边界 → 关键词 → 兜底 domain_qa。
//
// 批次 4 · 正则意图退役（对应雷达文档 §三③「按谁发起分」）：
// 本文件只保留**发起人不是「一句话」**的规则。判据是发起方式，不是规则好坏：
//  · 前端结构化动作（clientAction = 按钮）→ 保留
//  · 服务端可判定的结构事实（本轮有已解析附件）→ 保留
//  · 锚定全串的寒暄（不是语义判断，且要在模型不可用时仍能应答）→ 保留
//  · 靠词表猜「这句话想用哪个能力」→ 一律退役，交回模型 + 工具
// 退役明细与逐条依据见各规则的删除处注释，以及
// 03_技术设计/系统演进/实现与文档对齐说明.md。
// ============================================================

export type WorkbenchIntent =
  | "capability_discovery"
  | "domain_qa"
  | "attachment_summary"
  | "attachment_qa"
  | "harness_report_generation"
  | "harness_answer_submission"
  | "unsupported_or_out_of_scope";

export type WorkbenchIntentInput = {
  message: string;
  hasAttachment: boolean;
  /**
   * 批次 4 移除 `hasLatestV1Artifact`：它原先只被 v2 / 报告两条词表规则读，
   * 规则退役后没有幸存规则再需要它。「会话已有 v1」这个事实没有消失——它经
   * `buildWorkbenchContext` 进入模型上下文（见 model-answer 的【已有 v1 报告】段），
   * 由模型判断该追问还是该补充，而不是由路由猜。
   */
  clientAction?: string;
  /**
   * 批次 1c · 缺陷二：本会话是否处在一场还没结束的工具交互里。
   * 由服务端从已落库的会话记录判定（见 hasOngoingWorkbenchToolInteraction），
   * **不接受前端传入**——前端能表达的只有「我想跳过路由」，而那等于把路由权交出去。
   */
  hasOngoingToolInteraction?: boolean;
};

export type WorkbenchIntentResult = {
  intent: WorkbenchIntent;
  confidence: number;
  routingRule: string;
};

// 寒暄白名单（**保留**，批次 4 判据：它不猜语义）。
// 锚定全串 `^(…)[!！。,.，\s]*$`：只有「整句就是一句寒暄」才命中，不存在被长句夹带命中的形态，
// 与下面那些被退役的词表规则有结构差别。保留的第二条理由是可用性的：能力清单是**唯一**
// 在模型不可用时仍能给出静态降级应答（model: "rule-static"）的路径，而寒暄正是限流/缺 Key
// 时用户的第一句话。退役它不会让模型判断得更好，只会把第一句换成一次分类调用 + 可能拒答。
const GREETING_PATTERNS = /^(你好|您好|hello|hi|嗨|在吗)[!！。,.，\s]*$/i;

// ── 批次 4 退役记录（对应雷达文档 §三③：需理解自然语言的 → 交模型选工具）──────────
//
// 以下 5 组词表规则已整体删除，不留兜底、不改写为「更聪明的正则」。它们共同的失效形态
// 是「一个子串把整句话劫走」，架构侧 `routeWorkbenchIntent` 直取实证的三例（退役前）：
//   · 「产品帮助文档在哪里？」           → capability_keywords（命中「帮助」）
//   · 「这个需求你能做什么样的拆解？」    → capability_keywords（命中「能做什么」）
//   · 「评估状态怎么流转？」             → wes_data_keywords（命中「评估状态」，
//                                          而 handler 只会把用户的项目列表吐回来）
// 承接方逐条如下：
//   capability_keywords   → describe_capabilities 工具（CAPABILITY_FACTS 仍作为唯一事实源，
//                           由模型自行决定何时取用）
//   wes_data_keywords     → 已注册的 project_list / estimate_history 工具
//   knowledge_*_keywords  → 已注册的 knowledge_query 工具
//                           （本批同时把它从 `profiles[0]` 收口为按业务角色路由，
//                             见 agent/default-registry.ts）
//   report_generation_keywords / v2_explicit_keywords
//                         → command：前端按钮 clientAction
//                           generate_requirement_report / submit_structured_answers
//                           （下方第 1 步仍在，那才是「用户明确要系统做一件事」的入口）；
//                           有附件时的真实生成闸门在各对话通道的 isExplicitReportRequest，
//                           本路由从未参与过那次生成。

/** 判定只读会话消息的两个字段；其余字段（正文、时间戳…）原样放行，不做形状要求 */
export type WorkbenchSessionTurn = {
  readonly role?: unknown;
  readonly metadata?: unknown;
  readonly [key: string]: unknown;
};

/**
 * （批次 1c · 缺陷二）服务端判定：本会话是否处在一场还没结束的工具交互里。
 *
 * 依据 = **已落库会话记录里最后一条 assistant 消息是否由工具路径产出**
 * （其 metadata.toolCalls 非空）。三个候选依据里只有这一条在真实链路上可达且够用：
 *
 *  · 「最近一个 run 处于 waiting」/「最近一轮有未闭合的 tool.call.*」（未闭合只在
 *    waiting 时成立，两条同生同灭）——查不到也不该查：库里
 *    `harness_runs_active_workbench_session_unique` 规定同一会话同时只能有一个活跃
 *    workbench_chat Run，而 waiting 属活跃态。所以 Run 停在 waiting 期间用户再发消息，
 *    提交入口 POST /api/v1/ai-sessions/:sessionId/runs（submitRunHandler）直接 409
 *    SESSION_HAS_ACTIVE_RUN（前端原样回显「该会话存在进行中的任务，请等待完成后再发送」），
 *    这句话根本进不了 dispatch。基于它写分支即死代码。
 *  · 本条判据跨 Run 成立，且三条通道（异步 Run / 同步非流式 / 同步流式）都在 assistant
 *    消息 metadata.toolCalls 这同一个字段上留痕，一份实现覆盖全部入口。
 *
 * 窗口只有一轮：下一轮若没有工具调用，本判定即回落 false，不会把正则路由长期关掉。
 * （原句写「17 个正则 handler」，沿用雷达文档 §七 的旧口径；批次 4 已把该口径退役到
 *   只剩寒暄与附件两条非语义规则，实数考证见本文件顶部。）读的是会话记录，不新增任何查询。
 */
export function hasOngoingWorkbenchToolInteraction(
  messages: readonly WorkbenchSessionTurn[] | null | undefined,
): boolean {
  if (!Array.isArray(messages)) return false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    const toolCalls = (message.metadata as { toolCalls?: unknown } | undefined)?.toolCalls;
    // 形状异常（不是数组）按「本轮没发生工具调用」处理：宁可多走一次正则路由，
    // 也不要把一个读不懂的字段当成放行的理由。
    return Array.isArray(toolCalls) && toolCalls.length > 0;
  }
  return false;
}

/**
 * 意图路由纯函数。
 *
 * 批次 4 之后只剩四条规则，且**没有一条是在读「这句话想干什么」**：
 * 1. 前端显式 clientAction（结构化卡片提交 / 报告按钮）——发起人点的是按钮
 * 1b. 进行中的工具交互 → 整条正则路由让位，交回模型（批次 1c，见下方第 1b 步注释）
 * 2. 锚定全串的寒暄（`GREETING_PATTERNS`）
 * 3. 本轮有已解析附件（服务端结构事实）→ attachment_qa / attachment_summary
 * 4. 其余一律 → 兜底 domain_qa，由模型 + 工具决定用哪个能力
 *
 * 曾经的第 2/3/4/6/7/7b/8 步（能力词表、WES 数据词表、报告词表、知识库词表）
 * 已整体删除，依据与承接方见文件上方的退役记录。
 */
export function routeWorkbenchIntent(input: WorkbenchIntentInput): WorkbenchIntentResult {
  const text = (input.message || "").trim().toLowerCase();

  // 1. 前端显式 clientAction 优先
  if (input.clientAction === "submit_structured_answers") {
    return { intent: "harness_answer_submission", confidence: 1, routingRule: "client_action" };
  }
  if (input.clientAction === "generate_requirement_report") {
    return { intent: "harness_report_generation", confidence: 1, routingRule: "client_action" };
  }

  // 1b.（批次 1c · 缺陷二）进行中的工具交互：整条正则路由让位，交回模型 + 工具路径。
  // 刻意排在 clientAction 之后、其余关键词之前：结构化卡片提交是按钮而非一句话，
  // 语义已经确定，不该被本短路改道；而关键词规则恰恰是本题里会误判的那一层。
  //
  // 之所以必须让位：这里的话是**上一轮工具交互的延续**，不是新提问。真实会话
  // 830bdb17 里，用户答「客户名称：深圳蓝海集团； 客户行业：综合集团；」因含「行业」
  // 二字命中 industry_knowledge_terms，被交给正则 handler 答了一段知识库检索，
  // 模型从未收到这句回答——多轮交互就此断在半路。这类残缺短句恰恰最不该由关键词判。
  //
  // 刻意**不复用** routingRule "default_domain_qa"：那个值是 RP-003 模型二次分类的
  // 触发口（dispatch 只在它上面调 classifyIntentWithModel），而一句只剩「客户行业：
  // 综合集团」的补充信息极易被分类器判成 unsupported_or_out_of_scope 直接拒答——
  // 那就是换一个地方重演同一个劫走。
  if (input.hasOngoingToolInteraction) {
    return { intent: "domain_qa", confidence: 1, routingRule: "ongoing_tool_interaction" };
  }

  // 2. 简短问候走本地能力说明，避免基础测试消耗模型额度或触发外部限流
  if (GREETING_PATTERNS.test(text)) {
    return { intent: "capability_discovery", confidence: 0.9, routingRule: "greeting_keywords" };
  }

  // 3.（批次 1a 退役）写动作请求不再由正则截走。
  // 原规则命中「写动作词 + 写目标词」即判 write_action_request 并交给静态 handler，
  // 结果是「帮我创建一个ERP项目」这类话**根本到不了模型**——工具与审批闸门在它之后
  // 永远不会被走到。退役后这类话落兜底 domain_qa，由模型决定调用 create_project，
  // 再经批次 1a 的执行前审批闸门（workbench-tool-approval）确认才真正写库。
  //
  // 4.（批次 4 退役）能力词表 / WES 数据词表 / 报告词表 / 知识库词表同批撤除，
  // 失效形态与批次 1a 同源——正则抢在模型之前定完了能力，工具就永远没机会被选中。
  // 逐条依据与承接方见文件顶部的退役记录。
  //
  // 5. 本轮有已解析附件：服务端结构事实，不是语义判断 → 附件问答 / 附件摘要
  if (input.hasAttachment) {
    return text
      ? { intent: "attachment_qa", confidence: 0.8, routingRule: "attachment_context" }
      : { intent: "attachment_summary", confidence: 0.8, routingRule: "attachment_context" };
  }

  // 6. 兜底：交模型 + 工具自行决定用哪个能力
  return { intent: "domain_qa", confidence: 0.65, routingRule: "default_domain_qa" };
}

// ── RP-003: 模型意图分类兜底 ──────────────────────────────────

export type ModelClassificationResult = {
  intent: string;
  confidence: number;
  reason: string;
  latencyMs: number;
};

// 批次 4：词汇表随正则同步收缩。knowledge_query / wes_data_query 已无生产方，
// 且分类结果本就只采纳 unsupported_or_out_of_scope（RP-049 Batch A），留着它们
// 只是让模型每次都往两个没人接的桶里投票。
const VALID_MODEL_INTENTS: WorkbenchIntent[] = [
  "capability_discovery",
  "domain_qa",
  "attachment_qa",
  "unsupported_or_out_of_scope",
];

const INTENT_CLASSIFICATION_PROMPT = `你是一个意图分类器。根据用户输入，判断其意图属于以下哪一类：

- capability_discovery：询问系统能力（如"你能做什么"、"有什么功能"）
- domain_qa：普通业务问答——含产品/行业知识咨询、查询用户自己的项目或评估数据、以及一切需要动用工具才能回答的问题
- unsupported_or_out_of_scope：无关闲聊、乱码、空白、与系统完全无关的请求（如"今天天气怎样"、"帮我写一首诗"）

只输出 JSON，格式为：{"intent":"xxx","confidence":0.8,"reason":"简短理由"}
confidence 范围 0-1，低于 0.5 表示非常不确定。`;

export { INTENT_CLASSIFICATION_PROMPT };

/**
 * RP-003: 当规则路由兜底到 default_domain_qa 时，调用模型二次分类。
 * 失败或低置信时返回 null，调用方降级回 domain_qa。
 */
export async function classifyIntentWithModel(
  message: string,
  modelChat: (params: { systemPrompt: string; userContent: string }) => Promise<{ answer: string; rawContent: string }>,
): Promise<ModelClassificationResult | null> {
  const startedAt = Date.now();
  try {
    const result = await modelChat({
      systemPrompt: INTENT_CLASSIFICATION_PROMPT,
      userContent: message || "",
    });
    const latencyMs = Math.max(0, Date.now() - startedAt);

    // 从 answer 或 rawContent 中提取 JSON
    const text = (result.answer || result.rawContent || "").trim();
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const intent = typeof parsed.intent === "string" ? parsed.intent : "";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const reason = typeof parsed.reason === "string" ? parsed.reason : "";

    // 验证 intent 合法性
    if (!VALID_MODEL_INTENTS.includes(intent as WorkbenchIntent)) return null;

    return { intent, confidence, reason, latencyMs };
  } catch {
    return null;
  }
}
