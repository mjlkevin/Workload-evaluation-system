// ============================================================
// WES Agent Phase 1G — AI 工作台意图路由器
// 纯函数路由：根据用户输入、附件、Harness artifact 状态决定执行路径。
// 规则优先：显式 clientAction → 阶段边界 → 关键词 → 兜底 domain_qa。
// ============================================================

export type WorkbenchIntent =
  | "capability_discovery"
  | "domain_qa"
  | "knowledge_query"
  | "attachment_summary"
  | "attachment_qa"
  | "harness_report_generation"
  | "harness_answer_submission"
  | "wes_data_query"
  | "write_action_request"
  | "unsupported_or_out_of_scope";

export type WorkbenchIntentInput = {
  message: string;
  hasAttachment: boolean;
  hasLatestV1Artifact: boolean;
  clientAction?: string;
};

export type WorkbenchIntentResult = {
  intent: WorkbenchIntent;
  confidence: number;
  routingRule: string;
};

// 能力发现关键词
const CAPABILITY_PATTERNS = /你能做什么|能做什么|你可以做什么|帮助|你能帮我什么|你有哪些功能|你有什么能力/;
const GREETING_PATTERNS = /^(你好|您好|hello|hi|嗨|在吗)[!！。,.，\s]*$/i;

// WES 数据查询关键词
const WES_DATA_QUERY_PATTERNS = /我之前.*项目|创建过哪些项目|历史项目|我的项目|我的评估|历史评估|我创建过|待确认动作|待办动作|待确认.*评估|评估状态|项目状态/;

// 写动作关键词
const WRITE_ACTION_PATTERNS = /创建|新建|生成|进入|发布/;
const WRITE_TARGET_PATTERNS = /草稿|正式|评估记录|需求记录|项目评估|正式评估|发布|项目/;

// 报告生成关键词
const REPORT_GEN_VERB_PATTERNS = /生成|输出|创建|启动|生成需求|输出需求|创建需求|启动需求/;
const REPORT_GEN_TARGET_PATTERNS = /需求解析报告|需求包|评估输入|评估草稿|报告|v1|v2/;

// 补充报告关键词（v2）
const V2_EXPLICIT_PATTERNS = /生成\s*v2|补充.*v2|生成.*补充.*报告|生成.*需求.*报告.*v2|v2.*报告/;

// 产品知识查询关键词：只在无附件/非报告/非 WES 数据查询时进入知识库工具路由。
const PRODUCT_KNOWLEDGE_TERM_PATTERNS = /智能会计平台|金蝶云|金蝶产品|产品知识|资金管理|网上银行|融资管理|销售管理|供应链|财务云|存货核算|多组织业务往来|总账|应收|应付|采购管理|库存管理|生产管理/;
const PRODUCT_KNOWLEDGE_QUESTION_PATTERNS = /是什么|哪些模块|支持哪些|必须购买|相关模块|功能|依赖|区别|适用|场景|口径|怎么理解/;

// 显式知识库查询关键词：用户明确提到"知识库/文档/方案"等，无论是否含产品术语均路由到 knowledge_query。
const EXPLICIT_KNOWLEDGE_QUERY_PATTERNS = /知识库|知识库里|文档.*有没有|方案.*有没有|有没有.*相关.*文档|有没有.*相关.*方案|帮我看看.*知识库|查一下.*知识库|搜索.*知识库/;

// 行业知识 / 业务场景 / 痛点 / 解决方案类问题 → knowledge_query（无附件时进入知识库）
const INDUSTRY_KNOWLEDGE_PATTERNS = /行业|痛点|难点|挑战|解决方案|最佳实践|案例|经验|趋势|前景|现状|常见问题|怎么做|如何处理|如何应对|优势|劣势|机会|威胁|竞品|对标|标杆/;

/**
 * 意图路由纯函数。
 *
 * 规则优先级：
 * 1. 前端显式 clientAction（结构化卡片提交）
 * 2. 能力发现关键词
 * 3. WES 数据查询关键词
 * 4. 写动作关键词
 * 5. 报告生成关键词（区分 v1/v2）
 * 6. 有附件但无明确报告意图 → attachment_qa / attachment_summary
 * 7. 显式知识库查询（用户提到"知识库/文档/方案"）→ knowledge_query
 * 8. 无附件产品知识问题 → knowledge_query
 * 8b. 行业/业务场景知识问题（痛点、解决方案等）→ knowledge_query
 * 9. 兜底 → domain_qa
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

  // 2. 简短问候走本地能力说明，避免基础测试消耗模型额度或触发外部限流
  if (GREETING_PATTERNS.test(text)) {
    return { intent: "capability_discovery", confidence: 0.9, routingRule: "greeting_keywords" };
  }

  // 2. 能力发现
  if (CAPABILITY_PATTERNS.test(text)) {
    return { intent: "capability_discovery", confidence: 0.95, routingRule: "capability_keywords" };
  }

  // 3. WES 数据查询
  if (WES_DATA_QUERY_PATTERNS.test(text)) {
    return { intent: "wes_data_query", confidence: 0.9, routingRule: "wes_data_keywords" };
  }

  // 4. 写动作请求（创建草稿、进入正式评估、发布等）
  if (WRITE_ACTION_PATTERNS.test(text) && WRITE_TARGET_PATTERNS.test(text)) {
    // 排除"生成报告"类——那些属于报告生成
    if (!REPORT_GEN_TARGET_PATTERNS.test(text) || /草稿|正式|发布/.test(text)) {
      return { intent: "write_action_request", confidence: 0.85, routingRule: "write_action_keywords" };
    }
  }

  // 5. 明确要求生成 v2 报告（在 v1 之后）
  if (input.hasLatestV1Artifact && V2_EXPLICIT_PATTERNS.test(text)) {
    return { intent: "harness_answer_submission", confidence: 0.9, routingRule: "v2_explicit_keywords" };
  }

  // 6. 明确要求生成需求解析报告 / 需求包 / 评估输入
  if (REPORT_GEN_VERB_PATTERNS.test(text) && REPORT_GEN_TARGET_PATTERNS.test(text)) {
    // 有 v1 时，"生成报告"指代 v2 补充
    if (input.hasLatestV1Artifact) {
      return { intent: "harness_answer_submission", confidence: 0.85, routingRule: "report_generation_keywords_with_v1" };
    }
    return { intent: "harness_report_generation", confidence: 0.9, routingRule: "report_generation_keywords" };
  }

  // 7. 有附件但无明确报告意图
  if (input.hasAttachment) {
    return text
      ? { intent: "attachment_qa", confidence: 0.8, routingRule: "attachment_context" }
      : { intent: "attachment_summary", confidence: 0.8, routingRule: "attachment_context" };
  }

  // 7. 显式知识库查询：用户明确提到"知识库/文档/方案"等
  if (EXPLICIT_KNOWLEDGE_QUERY_PATTERNS.test(text)) {
    return { intent: "knowledge_query", confidence: 0.9, routingRule: "explicit_knowledge_query" };
  }

  // 8. 无附件产品知识问题：进入只读知识库查询工具
  if (PRODUCT_KNOWLEDGE_TERM_PATTERNS.test(text) && PRODUCT_KNOWLEDGE_QUESTION_PATTERNS.test(text)) {
    return { intent: "knowledge_query", confidence: 0.86, routingRule: "product_knowledge_terms" };
  }

  // 8b. 行业/业务场景知识问题（痛点、解决方案、案例等）→ 知识库查询
  if (INDUSTRY_KNOWLEDGE_PATTERNS.test(text)) {
    return { intent: "knowledge_query", confidence: 0.82, routingRule: "industry_knowledge_terms" };
  }

  // 9. 兜底：普通业务问答
  return { intent: "domain_qa", confidence: 0.65, routingRule: "default_domain_qa" };
}

// ── RP-003: 模型意图分类兜底 ──────────────────────────────────

export type ModelClassificationResult = {
  intent: string;
  confidence: number;
  reason: string;
  latencyMs: number;
};

const VALID_MODEL_INTENTS: WorkbenchIntent[] = [
  "capability_discovery",
  "domain_qa",
  "knowledge_query",
  "attachment_qa",
  "wes_data_query",
  "write_action_request",
  "unsupported_or_out_of_scope",
];

const INTENT_CLASSIFICATION_PROMPT = `你是一个意图分类器。根据用户输入，判断其意图属于以下哪一类：

- capability_discovery：询问系统能力（如"你能做什么"、"有什么功能"）
- knowledge_query：产品/行业知识问题（如"金蝶云是什么"、"制造业痛点"）
- wes_data_query：查询用户自己的项目/评估数据（如"我的项目"、"之前创建的"）
- write_action_request：创建/新建/发布等操作请求（如"帮我建一个项目"）
- domain_qa：普通业务问答，不属于以上任何类别（如"这个风险是什么意思"）
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
