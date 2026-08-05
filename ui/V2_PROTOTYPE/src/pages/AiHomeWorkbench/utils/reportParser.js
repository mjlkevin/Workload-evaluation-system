import { unwrap } from '../../../api/utils.js'
import { fileKind, inferCustomerNameFromFileName, firstBusinessValue, pickArray, pickObject } from './harnessPayload.js'

/**
 * 前端显式报告请求闸门（Phase 1G 口径）。
 * 「文件是上下文，用户意图才触发工作流」：只有用户文本同时命中
 * 动作动词与报告名词时才进入 Harness v1 报告流程。
 * 该正则必须与后端 apps/api/src/services/ai/chat.service.ts 的
 * isExplicitReportRequest 保持一致（见 __tests__/aiWorkbenchReportGateConsistency.test.js）。
 */
export function isExplicitReportRequest(text) {
  return /生成|输出|创建|启动/.test(text || '') && /需求解析报告|需求包|评估输入|评估草稿|报告/.test(text || '')
}

export function summarizeHomeParsedFile(file, payload) {
  const data = unwrap(payload) || {}
  const basicInfo = data.basicInfo || {}
  const requirementData = data.requirementImportData || {}
  const businessItems = [
    ...pickArray(requirementData.businessItems),
    ...pickArray(requirementData.businessNeedRows).map((item) => ({
      topic: item.title || item.category || item.businessDomain,
      description: item.businessNeed || item.solutionSuggestion,
    })),
  ].slice(0, 5)
  const moduleRows = pickArray(requirementData.productModuleRows).slice(0, 5)
  const productLines = pickArray(basicInfo.productLines).slice(0, 5)
  const sheets = pickArray(data.sourceSheets).slice(0, 8)
  const lines = [
    'AI 已完成文件解析摘要：',
    `文件：${file?.name || basicInfo.fileName || '未命名文件'}`,
    basicInfo.projectName ? `项目：${basicInfo.projectName}` : '',
    basicInfo.customerName ? `客户：${basicInfo.customerName}` : '',
    basicInfo.customerIndustry ? `行业：${basicInfo.customerIndustry}` : '',
    productLines.length ? `产品线：${productLines.join('、')}` : '',
    sheets.length ? `工作表：${sheets.join('、')}` : '',
  ].filter(Boolean)

  if (businessItems.length) {
    lines.push('业务需求：')
    businessItems.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.topic || item.title || '未命名需求'}${item.description ? `：${item.description}` : ''}`)
    })
  }
  if (moduleRows.length) {
    lines.push('模块线索：')
    moduleRows.forEach((item, index) => {
      const title = [item.productLine, item.moduleName || item.module].filter(Boolean).join(' / ') || '未命名模块'
      lines.push(`${index + 1}. ${title}${item.requirementDescription ? `：${item.requirementDescription}` : ''}`)
    })
  }
  return lines.join('\n')
}

export function buildAttachmentUnderstanding(file, payload) {
  const data = unwrap(payload) || {}
  const basicInfo = pickObject(data.basicInfo)
  const requirementData = pickObject(data.requirementImportData)
  const sourceSheets = pickArray(data.sourceSheets)
  const sourceFile = file?.name || basicInfo.fileName || '未命名文件'
  const filenameCustomer = inferCustomerNameFromFileName(sourceFile)
  const businessItems = [
    ...pickArray(requirementData.businessItems),
    ...pickArray(requirementData.businessNeedRows),
  ]
  const moduleRows = pickArray(requirementData.productModuleRows)
  const domains = [
    ...businessItems.map((item) => item.topic || item.category || item.businessDomain),
    ...moduleRows.map((item) => item.productLine || item.moduleName || item.module),
  ].filter(Boolean)
  const uniqueDomains = [...new Set(domains)].slice(0, 6)
  return {
    sourceFile,
    fileKind: fileKind(sourceFile),
    sourceSheets,
    productLines: pickArray(basicInfo.productLines).slice(0, 6),
    project: {
      projectName: basicInfo.projectName || '',
      customerName: basicInfo.customerName || filenameCustomer || '',
      industry: basicInfo.customerIndustry || basicInfo.industry || '',
    },
    businessDomains: uniqueDomains,
    extractedItemCount: businessItems.length + moduleRows.length,
    summaryText: uniqueDomains.length
      ? `模型已识别到 ${uniqueDomains.slice(0, 4).join('、')} 等业务线索，当前附件更适合作为需求线索清单，需要人工补齐项目范围与评估口径。`
      : '模型已完成附件结构解析，当前还需要人工补齐客户、项目范围与评估口径。',
  }
}

export function mergeAttachmentUnderstanding(localUnderstanding, artifactUnderstanding, reportContent) {
  const local = pickObject(localUnderstanding)
  const artifact = pickObject(artifactUnderstanding)
  const report = pickObject(reportContent)
  const localProject = pickObject(local.project)
  const artifactProject = pickObject(artifact.project)
  const reportProject = pickObject(report.project)
  const findings = pickArray(report.requirementFindings)
  return {
    ...local,
    ...artifact,
    sourceFile: artifact.sourceFile || local.sourceFile || report.sourceFile || '',
    sourceSheets: pickArray(artifact.sourceSheets).length ? pickArray(artifact.sourceSheets) : (pickArray(local.sourceSheets).length ? pickArray(local.sourceSheets) : pickArray(report.sourceSheets)),
    project: {
      projectName: firstBusinessValue(artifactProject.projectName, localProject.projectName, reportProject.projectName, report.projectName),
      customerName: firstBusinessValue(artifactProject.customerName, localProject.customerName, reportProject.customerName, report.customerName, inferCustomerNameFromFileName(artifact.sourceFile || local.sourceFile || report.sourceFile)),
      industry: firstBusinessValue(artifactProject.industry, localProject.industry, reportProject.industry, report.industry),
    },
    productLines: pickArray(artifact.productLines).length ? pickArray(artifact.productLines) : pickArray(local.productLines),
    businessDomains: pickArray(artifact.businessDomains).length
      ? pickArray(artifact.businessDomains)
      : (pickArray(local.businessDomains).length ? pickArray(local.businessDomains) : [...new Set(findings.map((item) => pickObject(item).domain || pickObject(item).moduleHint).filter(Boolean))]),
    extractedItemCount: Number(artifact.extractedItemCount || local.extractedItemCount || findings.length || 0),
    summaryText: artifact.summaryText || local.summaryText || '',
  }
}

export function findLatestHarnessV1Artifact(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const v2Artifact = pickArray(message.artifacts).find((item) => (
      item?.artifactType === 'requirement_report_v2' || item?.type === 'requirement_report_v2'
    ))
    if (v2Artifact) return null
    const v1Artifact = pickArray(message.artifacts).find((item) => (
      (item?.artifactType === 'requirement_report_v1' || item?.type === 'requirement_report_v1') && item?.harnessRunId
    ))
    if (v1Artifact) return { artifact: v1Artifact, message }
  }
  return null
}
