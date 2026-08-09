// ============================================================
// O10 Batch B: 能力事实表 —— 单一事实源
// 列出 AI 工作台当前真实能力，与代码实现严格对齐。
// 禁止写入未实现能力。
// ============================================================

export interface CapabilityFact {
  id: string;
  category: string;
  description: string;
  details?: string[];
  requiresConfirm?: boolean;
}

export const CAPABILITY_FACTS: CapabilityFact[] = [
  {
    id: "attachment_parse",
    category: "文件处理",
    description: "上传需求文件（Excel/Word/PDF），自动解析业务需求、模块线索和客户信息",
    details: [
      "支持 Excel、Word、PDF 格式",
      "解析后仅作为会话上下文，不会自动触发报告生成",
      "可在上传后对附件内容进行问答",
    ],
  },
  {
    id: "attachment_qa",
    category: "文件处理",
    description: "对上传的附件内容进行问答",
    details: [
      "例如询问多组织业务往来包含哪些模块",
      "基于附件解析结果进行针对性回答",
    ],
  },
  {
    id: "report_v1",
    category: "报告生成",
    description: "明确要求时，生成《需求解析报告 v1》",
    details: [
      "识别需求、风险和待确认问题",
      "需要用户明确请求才会生成",
      "生成后可在会话中查看和继续补充",
    ],
  },
  {
    id: "report_v2",
    category: "报告生成",
    description: "在 v1 报告基础上，通过结构化卡片提交补充信息并生成《需求解析报告 v2》",
    details: [
      "需先完成 v1 报告生成",
      "通过交互式表单收集补充信息",
      "基于补充信息生成更完整的 v2 报告",
    ],
  },
  {
    id: "wes_data_query",
    category: "数据查询",
    description: "查询你之前创建过的项目和评估记录（仅限你有权限的数据）",
    details: [
      "按项目状态筛选：草稿、评审中、已发布等",
      "查看待确认动作和评估状态",
      "数据按用户权限隔离",
    ],
  },
  {
    id: "business_qa",
    category: "业务咨询",
    description: "回答 WES/ERP/金蝶业务咨询",
    details: [
      "模块依赖关系",
      "评估口径解释",
      "风险含义说明",
      "产品功能咨询",
    ],
  },
  {
    id: "knowledge_query",
    category: "知识库",
    description: "查询产品知识库和行业解决方案",
    details: [
      "产品方案与实施边界",
      "行业痛点与最佳实践",
      "司库与银企相关知识",
    ],
  },
  {
    id: "write_action",
    category: "写操作",
    description: "对于写动作（创建草稿、进入正式评估），给出待确认动作，确认后才会执行",
    details: [
      "创建项目评估草稿",
      "进入正式评估流程",
      "所有写操作均需用户确认",
    ],
    requiresConfirm: true,
  },
  {
    id: "agent_tools",
    category: "Agent 工具",
    description: "集成 8 项 Agent 工具能力",
    details: [
      "C139 商机评估",
      "售前估算助手",
      "合同风险分析",
      "金蝶售前分析",
      "客户需求分析",
      "项目评估",
      "变更管理",
      "开发评估",
    ],
  },
];

/**
 * 将能力事实表格式化为结构化文本，供模型消费或降级回复使用。
 */
export function formatCapabilityFacts(): string {
  const lines: string[] = [];
  for (const fact of CAPABILITY_FACTS) {
    lines.push(`【${fact.category}】${fact.description}`);
    if (fact.details) {
      for (const detail of fact.details) {
        lines.push(`  · ${detail}`);
      }
    }
    if (fact.requiresConfirm) {
      lines.push(`  · ⚠️ 此操作需要用户确认后才会执行`);
    }
  }
  return lines.join("\n");
}

/**
 * 获取能力事实表的精简版本（用于降级回复）。
 */
export function formatCapabilityFactsBrief(): string {
  return CAPABILITY_FACTS.map((f, i) => `${i + 1}. ${f.description}`).join("\n");
}
