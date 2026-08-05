import { unwrap } from '../../../api/utils.js'

export function pickArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

export function pickObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function fileKind(fileOrName) {
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name
  const ext = String(name || 'FILE').split('.').pop()?.trim().toUpperCase()
  return ext && ext !== name ? ext.slice(0, 4) : 'FILE'
}

export function fileSizeLabel(size) {
  if (!size) return ''
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export function normalizePendingText(value) {
  return String(value || '').trim()
}

export function stripPendingMarker(value) {
  return normalizePendingText(value)
    .replace(/[（(]\s*待确认\s*[）)]/g, '')
    .replace(/[（(]\s*待补充\s*[）)]/g, '')
    .replace(/待确认|待补充/g, '')
    .trim()
}

export function isPendingBusinessValue(value) {
  const text = normalizePendingText(value)
  return !text || /^(待确认|待补充|未明确|未知|无)$/.test(text)
}

export function firstBusinessValue(...values) {
  for (const value of values) {
    const text = stripPendingMarker(value)
    if (text && !isPendingBusinessValue(text)) return text
  }
  return ''
}

export function isFilledBusinessValue(value) {
  const text = stripPendingMarker(value)
  return Boolean(text) && !isPendingBusinessValue(text)
}

export function inferCustomerNameFromFileName(fileName) {
  const name = normalizePendingText(fileName)
    .replace(/\.[^.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name) return ''
  const firstSegment = name.split(/[-_—–·：:（(]/)[0]?.trim()
  if (!firstSegment || firstSegment.length < 2 || firstSegment.length > 18) return ''
  if (!/[\u4e00-\u9fa5]/.test(firstSegment)) return ''
  if (/需求|清单|模板|评估|申请|项目|工作量|实施/.test(firstSegment)) return ''
  return firstSegment
}

const FIELD_LABELS = {
  customerName: '客户名称',
  projectName: '项目名称',
  industry: '所属行业',
  projectScope: '项目范围',
  requirementDetails: '需求明细',
  sourceSheets: '工作表内容',
  businessScope: '业务范围',
  moduleScope: '模块范围',
  organizationScope: '组织范围',
  implementationScope: '实施范围',
}

export function fieldDisplayLabel(field) {
  const key = normalizePendingText(field)
  return FIELD_LABELS[key] || key || '待补充信息'
}

export function buildHarnessParseResult(file, payload) {
  const data = unwrap(payload) || {}
  const basicInfo = pickObject(data.basicInfo)
  const requirementData = pickObject(data.requirementImportData)
  const sourceSheets = pickArray(data.sourceSheets)
  const businessItems = [
    ...pickArray(requirementData.businessItems).map((item) => ({
      sourceSheet: item.sourceSheet || item.sheetName || '',
      sourceCell: item.sourceCell || item.cell || '',
      category: item.topic || item.category || item.businessDomain || '业务需求',
      text: [item.topic || item.title || item.businessDomain, item.description || item.businessNeed || item.solutionSuggestion].filter(Boolean).join('：'),
      metadata: item,
    })),
    ...pickArray(requirementData.businessNeedRows).map((item) => ({
      sourceSheet: item.sourceSheet || item.sheetName || '',
      sourceCell: item.sourceCell || item.cell || '',
      category: item.category || item.businessDomain || '业务需求',
      text: [item.title || item.category || item.businessDomain, item.businessNeed || item.solutionSuggestion].filter(Boolean).join('：'),
      metadata: item,
    })),
    ...pickArray(requirementData.productModuleRows).map((item) => ({
      sourceSheet: item.sourceSheet || item.sheetName || '',
      sourceCell: item.sourceCell || item.cell || '',
      category: item.productLine || '模块线索',
      text: [item.productLine, item.moduleName || item.module, item.requirementDescription].filter(Boolean).join(' / '),
      metadata: item,
    })),
  ].filter((item) => item.text)

  return {
    sourceFile: file?.name || basicInfo.fileName || '未命名文件',
    sheets: sourceSheets,
    summary: {
      projectName: basicInfo.projectName || '',
      customerName: basicInfo.customerName || '',
      industry: basicInfo.customerIndustry || basicInfo.industry || '',
    },
    items: businessItems,
  }
}
