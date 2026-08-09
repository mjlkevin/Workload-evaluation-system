// ============================================================
// Sprint 3B · RP-048 骨架 — 固定评测样本集
// ≥12 条样本，覆盖 ≥6 类场景
// 每条样本定义：输入 message、期望意图分类、结构断言集
// ============================================================

import type { WorkbenchIntent } from "../workbench-intent.service";

/** 单条评测样本 */
export interface EvalSample {
  /** 样本唯一标识 */
  id: string;
  /** 业务场景分类 */
  category: EvalCategory;
  /** 用户输入消息 */
  message: string;
  /** 期望命中的意图 */
  expectedIntent: WorkbenchIntent;
  /** 期望路由规则（可选，用于精确匹配） */
  expectedRoutingRule?: string;
  /** 是否需要附件上下文 */
  hasAttachment?: boolean;
  /** 是否有最新 v1 artifact */
  hasLatestV1Artifact?: boolean;
  /** 前端显式 action（可选） */
  clientAction?: string;
  /** 样本描述 */
  description: string;
}

/** 评测场景分类 */
export type EvalCategory =
  | "capability_discovery"      // 能力问法
  | "greeting"                  // 问候语
  | "explicit_report_request"   // 显式报告请求
  | "business_consultation"     // 业务咨询（WES/ERP 口径类）
  | "attachment_qa_guidance"    // 附件问答引导
  | "out_of_scope"              // 超范围请求（应被 Batch A 拦截）
  | "knowledge_query"           // 知识库查询
  | "wes_data_query";           // WES 数据查询

// ── 样本集 ──────────────────────────────────────────────────

export const EVAL_SAMPLES: EvalSample[] = [
  // ── 1. 能力问法（3 条）─────────────────────────────────────
  {
    id: "cap-001",
    category: "capability_discovery",
    message: "你会干什么",
    expectedIntent: "capability_discovery",
    expectedRoutingRule: "capability_keywords",
    description: "最直接的能力问法",
  },
  {
    id: "cap-002",
    category: "capability_discovery",
    message: "支持哪些操作",
    expectedIntent: "capability_discovery",
    expectedRoutingRule: "capability_keywords",
    description: "操作列表问法",
  },
  {
    id: "cap-003",
    category: "capability_discovery",
    message: "你能帮我干啥",
    expectedIntent: "capability_discovery",
    expectedRoutingRule: "capability_keywords",
    description: "口语化能力问法",
  },

  // ── 2. 问候语（2 条）───────────────────────────────────────
  {
    id: "greet-001",
    category: "greeting",
    message: "你好",
    expectedIntent: "capability_discovery",
    expectedRoutingRule: "greeting_keywords",
    description: "标准问候语",
  },
  {
    id: "greet-002",
    category: "greeting",
    message: "Hello!",
    expectedIntent: "capability_discovery",
    expectedRoutingRule: "greeting_keywords",
    description: "英文问候语",
  },

  // ── 3. 显式报告请求（2 条）─────────────────────────────────
  {
    id: "report-001",
    category: "explicit_report_request",
    message: "生成需求解析报告",
    expectedIntent: "harness_report_generation",
    expectedRoutingRule: "report_generation_keywords",
    description: "v1 报告生成请求（无 v1 artifact）",
  },
  {
    id: "report-002",
    category: "explicit_report_request",
    message: "帮我输出需求包",
    expectedIntent: "harness_report_generation",
    expectedRoutingRule: "report_generation_keywords",
    description: "同义词报告请求",
  },

  // ── 4. 业务咨询（2 条）─────────────────────────────────────
  {
    id: "biz-001",
    category: "business_consultation",
    message: "购买存货核算模块必须购买哪些相关模块",
    expectedIntent: "knowledge_query",
    expectedRoutingRule: "product_knowledge_terms",
    description: "ERP 模块依赖咨询",
  },
  {
    id: "biz-002",
    category: "business_consultation",
    message: "多组织业务往来怎么理解",
    expectedIntent: "knowledge_query",
    expectedRoutingRule: "product_knowledge_terms",
    description: "WES 业务口径咨询",
  },

  // ── 5. 附件问答引导（1 条）─────────────────────────────────
  {
    id: "attach-001",
    category: "attachment_qa_guidance",
    message: "这个附件里有哪些风险",
    expectedIntent: "attachment_qa",
    expectedRoutingRule: "attachment_context",
    hasAttachment: true,
    description: "附件内容问答",
  },

  // ── 6. 超范围请求（2 条）───────────────────────────────────
  {
    id: "oos-001",
    category: "out_of_scope",
    message: "帮我写一首诗",
    expectedIntent: "unsupported_or_out_of_scope",
    description: "创作类超范围请求（需模型分类兜底采纳）",
  },
  {
    id: "oos-002",
    category: "out_of_scope",
    message: "今天天气怎么样",
    expectedIntent: "unsupported_or_out_of_scope",
    description: "闲聊类超范围请求（需模型分类兜底采纳）",
  },

  // ── 7. 知识库查询（1 条）───────────────────────────────────
  {
    id: "know-001",
    category: "knowledge_query",
    message: "请查询知识库：网上银行实施边界怎么划分",
    expectedIntent: "knowledge_query",
    expectedRoutingRule: "explicit_knowledge_query",
    description: "显式知识库查询",
  },

  // ── 8. WES 数据查询（1 条）─────────────────────────────────
  {
    id: "wes-001",
    category: "wes_data_query",
    message: "我之前创建过哪些项目",
    expectedIntent: "wes_data_query",
    expectedRoutingRule: "wes_data_keywords",
    description: "用户历史项目查询",
  },
];

/** 样本统计 */
export function getSampleStats(): { total: number; categories: Record<string, number> } {
  const categories: Record<string, number> = {};
  for (const sample of EVAL_SAMPLES) {
    categories[sample.category] = (categories[sample.category] || 0) + 1;
  }
  return { total: EVAL_SAMPLES.length, categories };
}
