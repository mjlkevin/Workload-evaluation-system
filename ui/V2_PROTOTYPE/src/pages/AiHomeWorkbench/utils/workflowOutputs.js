export function getWorkflowOutputs(workflow) {
  if (!workflow) {
    return {
      title: '预期产出',
      activeTitle: '已沉淀资产',
      empty: '对话开始后，AI 将自动沉淀项目草稿、需求包、待确认问题和评估输入，供你审阅和推送到下游系统。',
      activeDesc: '本轮对话已沉淀以下结构化资产，可继续补充问题或推送到下游页面。',
      outputs: ['需求包草稿', '待确认问题', '实施评估输入', '风险假设'],
    }
  }

  if (workflow.key.includes('question')) {
    return {
      title: '预期产出',
      activeTitle: '待确认问题',
      empty: 'AI 将沉淀客户回问清单、缺失资料和影响评估口径的关键假设。',
      activeDesc: '以下问题需客户或 PM 确认后，方可推进评估。',
      outputs: ['客户回问清单', '缺失资料', '范围假设', '风险提示'],
    }
  }

  if (workflow.key.includes('assessment') || workflow.key.includes('scope')) {
    return {
      title: '预期产出',
      activeTitle: '实施评估输入',
      empty: 'AI 将沉淀模块建议、实施范围、复杂度和风险假设，便于直接进入实施评估。',
      activeDesc: '以下评估输入已就绪，可推送到实施评估模块。',
      outputs: ['模块建议', '范围边界', '复杂度依据', '风险假设'],
    }
  }

  if (workflow.key.includes('file') || workflow.key.includes('project')) {
    return {
      title: '预期产出',
      activeTitle: '需求包草稿',
      empty: 'AI 将沉淀业务主题、需求条目、待确认问题和下游评估入口。',
      activeDesc: '需求包草稿已生成，可继续补充或推送到需求管理。',
      outputs: ['业务主题', '需求条目', '待确认问题', '评估入口'],
    }
  }

  return {
    title: '预期产出',
    activeTitle: workflow.title,
    empty: `AI 将围绕「${workflow.title}」沉淀可接力的结构化结果。`,
    activeDesc: `「${workflow.title}」已生成初步结果，可继续追问或进入下游页面。`,
    outputs: ['关键结论', '待办动作', '下游入口', '风险提示'],
  }
}
