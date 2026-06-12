export const AI_HOME_PRESETS = {
  sales: {
    key: 'sales',
    label: '销售员',
    headline: '从客户材料启动新项目需求评估',
    systemPrompt: '你是销售员的 AI 工作助手。帮助用户从客户资料、会议纪要或口述中识别商机背景、客户痛点、初步需求范围和下一步跟进动作。',
    placeholder: '上传客户材料，或描述客户背景、痛点和想评估的项目范围。',
    emptyHint: '可以上传客户资料、会议纪要、需求 Excel，AI 会先整理商机背景和售前待确认问题。',
    workflows: [
      { key: 'new_project_from_file', title: '上传材料创建新项目', desc: '解析客户资料并生成新项目草稿' },
      { key: 'sales_questions', title: '生成售前待确认问题', desc: '提炼需要向客户确认的关键信息' },
      { key: 'customer_summary', title: '生成客户沟通摘要', desc: '形成销售跟进纪要和下一步动作' },
    ],
  },
  pre_sales: {
    key: 'pre_sales',
    label: '售前顾问',
    headline: '解析原始需求，生成可评估需求包',
    systemPrompt: '你是售前顾问的 AI 工作助手。帮助用户解析 Excel、Word、PDF 或访谈纪要，识别业务需求及问题，生成需求包、模块建议、风险假设和实施评估输入。',
    placeholder: '附上原始需求文件，让 AI 识别业务需求及问题并生成实施评估输入。',
    emptyHint: '可以上传原始需求文档，AI 会生成业务主题、待确认问题和评估草稿。',
    workflows: [
      { key: 'parse_requirement_file', title: '解析需求文件', desc: '识别业务需求及问题一览' },
      { key: 'confirm_questions', title: '生成待确认问题', desc: '提炼售前需要回问客户的问题' },
      { key: 'assessment_seed', title: '生成实施评估输入', desc: '沉淀模块建议、范围和风险假设' },
    ],
  },
  delivery: {
    key: 'delivery',
    label: '交付顾问',
    headline: '拉取待评估需求包，补充实施评估',
    systemPrompt: '你是交付顾问的 AI 工作助手。帮助用户拉取待详细评估需求包，补充实施范围、人天、复杂度、依赖、风险和交付假设。',
    placeholder: '输入要评估的需求包，或让 AI 拉取待你详细评估的需求。',
    emptyHint: '可以从待办中选择需求包，AI 会辅助补充实施范围、人天和风险。',
    workflows: [
      { key: 'pull_pending_requirement_pack', title: '拉取待评估需求包', desc: '查看分配给你的需求包' },
      { key: 'implementation_scope', title: '补充实施范围', desc: '梳理模块范围、复杂度和依赖' },
      { key: 'pm_summary', title: '生成 PM 评估摘要', desc: '形成项目经理可接力的评估摘要' },
    ],
  },
  pm: {
    key: 'pm',
    label: '项目经理',
    headline: '接力评估包，检查交付物和项目风险',
    systemPrompt: '你是项目经理的 AI 工作助手。帮助用户接力评估包，检查范围、人天、WBS、交付物、项目风险和 PMO 审核准备。',
    placeholder: '让 AI 拉取待接力评估包，或输入你想检查的交付风险。',
    emptyHint: '可以查看待接力评估包，生成交付叙事和交付物。',
    workflows: [
      { key: 'pm_handoff', title: '查看待接力评估包', desc: '拉取需要 PM 接手的评估包' },
      { key: 'delivery_narrative', title: '生成交付叙事', desc: '整理范围、计划、风险和验收路径' },
      { key: 'generate_deliverables', title: '生成交付物', desc: '生成 PM 侧交付物草稿' },
    ],
  },
  pmo: {
    key: 'pmo',
    label: 'PMO',
    headline: '审核交付物规范度与完整性',
    systemPrompt: '你是 PMO 的 AI 工作助手。帮助用户审核交付物齐全性、规范性、方法论完整性，并生成驳回意见或封版检查建议。',
    placeholder: '让 AI 拉取待审核包，或输入你要检查的交付物问题。',
    emptyHint: '可以查看待审核包，自动检查交付物和方法论完整性。',
    workflows: [
      { key: 'pmo_reviews', title: '查看待审核包', desc: '拉取 PMO 待审核事项' },
      { key: 'auto_review', title: '自动审核', desc: '检查交付物齐全性和规范性' },
      { key: 'seal_check', title: '封版检查', desc: '生成封版前检查建议' },
    ],
  },
  dev: {
    key: 'dev',
    label: '开发顾问',
    headline: '评估开发范围、复杂度和技术风险',
    systemPrompt: '你是开发顾问的 AI 工作助手。帮助用户识别开发范围、接口、报表、集成复杂度和技术风险。',
    placeholder: '输入开发需求或接口说明，让 AI 帮你拆解开发评估点。',
    emptyHint: '可以上传开发需求说明，AI 会辅助拆解开发条目和风险。',
    workflows: [
      { key: 'dev_scope', title: '拆解开发范围', desc: '识别接口、报表、集成和二开点' },
      { key: 'dev_risk', title: '识别技术风险', desc: '分析系统集成和数据迁移风险' },
      { key: 'dev_summary', title: '生成开发评估摘要', desc: '形成开发顾问评估说明' },
    ],
  },
  admin: {
    key: 'admin',
    label: '管理视角',
    headline: '查看全局队列、异常流程与系统治理建议',
    systemPrompt: '你是管理员的 AI 工作助手。帮助用户查看全局项目队列、异常流程、角色配置和系统治理建议。',
    placeholder: '询问全局项目状态、异常流程、角色配置或系统治理建议。',
    emptyHint: '可以查看全局待办、异常项目和用户角色配置情况。',
    workflows: [
      { key: 'global_queue', title: '查看全局待办', desc: '汇总各角色待处理事项' },
      { key: 'exception_projects', title: '检查异常项目', desc: '识别超期、缺资料和流程卡点' },
      { key: 'manage_roles', title: '管理业务角色', desc: '进入用户管理补齐业务角色' },
    ],
  },
}

export function getAiHomePreset(role) {
  return AI_HOME_PRESETS[role] || AI_HOME_PRESETS.pre_sales
}
