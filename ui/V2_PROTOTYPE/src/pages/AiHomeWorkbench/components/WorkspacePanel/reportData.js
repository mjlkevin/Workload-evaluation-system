import { pickArray, pickObject } from '../../utils/harnessPayload.js'

/**
 * 需求解析报告卡片的数据提取：把 artifact.content 归一化为
 * 展示与编辑所需的字段集合（兼容 legacy 报告与 Harness v1/v2）。
 */
export function extractReportCardData(artifact) {
  const content = pickObject(artifact?.content)
  const isLegacyReport = artifact?.type === 'requirement_analysis_report'
  const isV2HarnessReport = artifact?.artifactType === 'requirement_report_v2' || artifact?.type === 'requirement_report_v2'
  const isHarnessReport = isV2HarnessReport || artifact?.artifactType === 'requirement_report_v1' || artifact?.type === 'requirement_report_v1'
  const title = artifact.title || (isV2HarnessReport ? '需求解析报告 v2' : '需求解析报告')
  const artifactIdentity = artifact?.harnessArtifactId || artifact?.artifactId || artifact?.title || title
  const project = pickObject(content.project)
  const understandingProject = pickObject(pickObject(artifact?.fileUnderstanding).project)
  const productLines = pickArray(content.productLines)
  const sourceSheets = pickArray(content.sourceSheets)
  const findings = pickArray(content.requirementFindings)
  const missingFields = pickArray(content.missingFields)
  const questions = pickArray(content.clarificationQuestions)
  const risks = isHarnessReport
    ? pickArray(content.risks).map((item) => {
        const row = pickObject(item)
        return [row.title, row.assumption, row.impact].filter(Boolean).join('：')
      })
    : pickArray(content.risks)
  const nextActionItems = pickArray(content.nextActions).map((item) => {
    if (typeof item === 'string') return { label: item, actionType: item }
    const row = pickObject(item)
    return { label: row.label || row.actionType || '下一步', actionType: row.actionType || row.label }
  })
  const needItems = isHarnessReport
    ? findings.map((item) => {
        const row = pickObject(item)
        return [row.domain, row.scenario, row.moduleHint].filter(Boolean).join(' / ')
      })
    : content.needs
  const moduleItems = isHarnessReport
    ? findings.map((item) => pickObject(item).moduleHint).filter(Boolean)
    : content.modules
  const missingItems = isHarnessReport
    ? [
        ...missingFields.map((item) => {
          const row = pickObject(item)
          return [row.field, row.reason].filter(Boolean).join('：')
        }),
        ...questions.map((item) => {
          const row = pickObject(item)
          return [row.question, row.reason].filter(Boolean).join('：')
        }),
      ]
    : content.missingItems
  const editableMissingFields = missingFields.length
    ? missingFields
    : pickArray(content.missingItems).map((item, index) => {
        if (typeof item === 'string') return { field: item }
        const row = pickObject(item)
        return { field: row.field || row.label || row.name || `缺失信息 ${index + 1}`, reason: row.reason || row.description || '' }
      })
  const answeredQuestions = isHarnessReport
    ? pickArray(content.answeredQuestions).map((item) => {
      const row = pickObject(item)
      return [row.question, row.answer].filter(Boolean).join('：')
    })
    : []

  return {
    content,
    isLegacyReport,
    isV2HarnessReport,
    isHarnessReport,
    title,
    artifactIdentity,
    project,
    understandingProject,
    productLines,
    sourceSheets,
    findings,
    missingFields,
    questions,
    risks,
    nextActionItems,
    needItems,
    moduleItems,
    missingItems,
    editableMissingFields,
    answeredQuestions,
  }
}
