import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { summarizeCompanyProfile } from '../api/ai.js'
import CompanyLookupDialog from '../components/AiWorkbench/CompanyLookupDialog.jsx'
import InteractiveFormCard from '../components/AiWorkbench/InteractiveFormCard.jsx'
import { apiClient } from '../api/client.js'
import {
  bindHarnessFile,
  confirmHarnessAction,
  createHarnessRun,
  generateHarnessReportV1,
  generateHarnessReportV2,
  submitHarnessAnswers,
  submitHarnessParseResult,
} from '../api/harness.js'
import { unwrap } from '../api/utils.js'
import ArtifactPanel from '../components/AiWorkbench/ArtifactPanel.jsx'
import SessionRail from '../components/AiWorkbench/SessionRail.jsx'
import { useAiSessions } from '../hooks/useAiSessions.js'
import { getAiHomePreset } from './aiHomePresets.js'

const panel = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  background: '#fff',
  boxShadow: 'var(--shadow-1)',
}

const WORKSPACE_PANEL_COLLAPSED_KEY = 'wes-ai-workspace-panel-collapsed'

/* ── Copy Session ID Icon ── */
function CopySessionIdButton({ sessionId }) {
  const [copied, setCopied] = useState(false)
  if (!sessionId) return null
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sessionId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard API not available */
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? '已复制 Session ID' : '复制 Session ID（用于问题反馈）'}
      aria-label="复制 Session ID"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        border: '1px solid var(--line)',
        borderRadius: 4,
        background: copied ? 'var(--ok-soft)' : 'transparent',
        color: copied ? 'var(--ok)' : 'var(--ink-3)',
        cursor: 'pointer',
        fontSize: 12,
        padding: 0,
        transition: 'all 0.15s ease',
      }}
    >
      {copied ? '✓' : ''}
    </button>
  )
}

function CopyMessageButton({ text }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard API not available */
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ai-copy-btn"
      title={copied ? '已复制' : '复制消息'}
      aria-label="复制消息"
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        border: '1px solid var(--line)',
        borderRadius: 4,
        background: copied ? 'var(--ok-soft)' : 'var(--bg-soft)',
        color: copied ? 'var(--ok)' : 'var(--ink-3)',
        cursor: 'pointer',
        fontSize: 12,
        padding: 0,
        zIndex: 1,
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

function readWorkspacePanelCollapsed() {
  try {
    return localStorage.getItem(WORKSPACE_PANEL_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

function RoleBadge({ children }) {
  return <span className="bdg brd" style={{ fontSize: 11, padding: '2px 8px' }}><span className="dot" />{children}</span>
}

function ResultCard({ title, children }) {
  return (
    <section style={{ ...panel, overflow: 'hidden' }}>
      <h3 style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--line)', fontSize: 13 }}>{title}</h3>
      <div style={{ padding: 14, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7 }}>{children}</div>
    </section>
  )
}

function getWorkflowOutputs(workflow) {
  if (!workflow) {
    return {
      title: '沉淀结果',
      empty: '对话开始后，这里会沉淀项目草稿、需求包、待确认问题和评估输入。',
      outputs: ['需求包草稿', '待确认问题', '实施评估输入', '风险假设'],
    }
  }

  if (workflow.key.includes('question')) {
    return {
      title: '待确认问题',
      empty: '将沉淀客户回问清单、缺失资料和影响评估口径的关键假设。',
      outputs: ['客户回问清单', '缺失资料', '范围假设', '风险提示'],
    }
  }

  if (workflow.key.includes('assessment') || workflow.key.includes('scope')) {
    return {
      title: '实施评估输入',
      empty: '将沉淀模块建议、实施范围、复杂度和风险假设，便于进入实施评估。',
      outputs: ['模块建议', '范围边界', '复杂度依据', '风险假设'],
    }
  }

  if (workflow.key.includes('file') || workflow.key.includes('project')) {
    return {
      title: '需求包草稿',
      empty: '将沉淀业务主题、需求条目、待确认问题和下游评估入口。',
      outputs: ['业务主题', '需求条目', '待确认问题', '评估入口'],
    }
  }

  return {
    title: workflow.title,
    empty: `将围绕「${workflow.title}」沉淀可接力的结构化结果。`,
    outputs: ['关键结论', '待办动作', '下游入口', '风险提示'],
  }
}

function LoadingDots() {
  return (
    <span className="ai-home-loading-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

function fileKind(fileOrName) {
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name
  const ext = String(name || 'FILE').split('.').pop()?.trim().toUpperCase()
  return ext && ext !== name ? ext.slice(0, 4) : 'FILE'
}

function fileSizeLabel(size) {
  if (!size) return ''
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function markdownLinkBaseUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'http://localhost'
}

function normalizeMarkdownHref(href) {
  const trimmed = String(href || '').trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null
  try {
    const parsed = new URL(trimmed, markdownLinkBaseUrl())
    if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return trimmed
    }
  } catch {
    return null
  }
  return null
}

function pickArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function pickObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function findLatestHarnessV1Artifact(messages) {
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

function isExplicitReportRequest(text) {
  return /生成|输出|创建|启动/.test(text || '') && /需求解析报告|需求包|评估输入|评估草稿|报告/.test(text || '')
}

function summarizeHomeParsedFile(file, payload) {
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

function buildHarnessParseResult(file, payload) {
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

function buildAttachmentUnderstanding(file, payload) {
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

function mergeAttachmentUnderstanding(localUnderstanding, artifactUnderstanding, reportContent) {
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

function normalizePendingText(value) {
  return String(value || '').trim()
}

function stripPendingMarker(value) {
  return normalizePendingText(value)
    .replace(/[（(]\s*待确认\s*[）)]/g, '')
    .replace(/[（(]\s*待补充\s*[）)]/g, '')
    .replace(/待确认|待补充/g, '')
    .trim()
}

function isPendingBusinessValue(value) {
  const text = normalizePendingText(value)
  return !text || /^(待确认|待补充|未明确|未知|无)$/.test(text)
}

function firstBusinessValue(...values) {
  for (const value of values) {
    const text = stripPendingMarker(value)
    if (text && !isPendingBusinessValue(text)) return text
  }
  return ''
}

function isFilledBusinessValue(value) {
  const text = stripPendingMarker(value)
  return Boolean(text) && !isPendingBusinessValue(text)
}

function inferCustomerNameFromFileName(fileName) {
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

function fieldDisplayLabel(field) {
  const key = normalizePendingText(field)
  return FIELD_LABELS[key] || key || '待补充信息'
}

function AttachmentCard({ file, state = 'pending', onRemove, compact = false, inverted = false }) {
  if (!file?.name) return null
  const kind = fileKind(file)
  const size = fileSizeLabel(file.size)
  const status = state === 'sent' ? '已发送' : '已附加，将随下一条消息发送'
  const meta = [kind, size, status].filter(Boolean).join(' · ')

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '40px minmax(0,1fr) auto',
        alignItems: 'center',
        gap: 10,
        padding: compact ? '8px 10px' : '9px 10px',
        border: inverted ? '1px solid rgba(255,255,255,.28)' : '1px solid var(--line)',
        borderRadius: 10,
        background: inverted ? 'rgba(255,255,255,.14)' : 'var(--bg-soft)',
        boxShadow: compact || inverted ? 'none' : '0 1px 0 rgba(15,23,42,.03)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 40,
          height: 34,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          background: inverted ? 'rgba(255,255,255,.18)' : '#fff',
          border: inverted ? '1px solid rgba(255,255,255,.26)' : '1px solid var(--line)',
          color: inverted ? '#fff' : 'var(--brand)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 850,
        }}
      >
        {kind}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 750, color: inverted ? '#fff' : 'var(--ink)' }}>
          {file.name}
        </div>
        <div style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: inverted ? 'rgba(255,255,255,.78)' : 'var(--ink-3)' }}>
          {meta}
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          aria-label="移除附件"
          title="移除附件"
          onClick={onRemove}
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: '#fff',
            color: 'var(--ink-2)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}

function renderInlineMarkdown(text, keyPrefix) {
  /* Support: **bold**, *italic*, `inline code`, [text](url) */
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  const parts = text.split(tokenRegex)
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-strong-${index}`}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      return <em key={`${keyPrefix}-em-${index}`}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyPrefix}-code-${index}`} className="ai-inline-code">{part.slice(1, -1)}</code>
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      const safeHref = normalizeMarkdownHref(linkMatch[2])
      if (!safeHref) {
        return (
          <span key={`${keyPrefix}-blocked-link-${index}`} className="ai-md-link-blocked" title="不安全链接已禁用">
            {linkMatch[1]}
          </span>
        )
      }
      return <a key={`${keyPrefix}-link-${index}`} href={safeHref} target="_blank" rel="noopener noreferrer" className="ai-md-link">{linkMatch[1]}</a>
    }
    return <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>
  })
}

function parseGuidedOptionLine(line) {
  const namedMatch = line.match(/^选项\s*([A-Za-z0-9一二三四五六七八九十]+)\s*[：:]\s*(.+)$/)
  if (namedMatch) {
    const label = `选项${namedMatch[1].toUpperCase()}`
    const text = namedMatch[2].trim()
    return {
      label,
      text,
      submitText: `启动${label}：${text}`,
    }
  }

  const numberedMatch = line.match(/^(\d+)[.、]\s+(.+)$/)
  if (numberedMatch) {
    const text = numberedMatch[2].trim()
    return {
      label: `问题${numberedMatch[1]}`,
      text,
      submitText: text,
    }
  }

  return null
}

function shouldPromoteOrderedListToOptions(previousBlock, items) {
  if (!previousBlock || previousBlock.type !== 'paragraph') return false
  if (items.length < 2 || items.length > 6) return false
  return /(选项|请选择|选择|回复|启动|以下问题|关键问题|待确认问题|补充问题|下一步|回复.*数字|输入.*编号|对应.*编号|建议.*操作|推荐.*方案|您可以)/.test(previousBlock.text)
}

function normalizeInteractiveOptionBlocks(blocks) {
  return blocks.map((block, index) => {
    if (block.type !== 'orderedList' || !shouldPromoteOrderedListToOptions(blocks[index - 1], block.items)) {
      return block
    }
    return {
      type: 'optionList',
      items: block.items.map((item, itemIndex) => ({
        label: `问题${itemIndex + 1}`,
        text: item,
        submitText: item,
      })),
    }
  })
}

function splitMarkdownTableRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.includes('|')) return null
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
  return cells.length > 1 ? cells : null
}

function isMarkdownTableSeparator(line, expectedCells) {
  const cells = splitMarkdownTableRow(line)
  if (!cells || cells.length !== expectedCells) return false
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))
}

function parseMarkdownBlocks(text) {
  const blocks = []
  const paragraphLines = []
  let currentList = null
  let currentOptions = null
  let codeFence = null // { lang, lines }

  function flushParagraph() {
    const paragraph = paragraphLines.join(' ').trim()
    if (paragraph) blocks.push({ type: 'paragraph', text: paragraph })
    paragraphLines.length = 0
  }

  function flushList() {
    if (currentList?.items.length) blocks.push(currentList)
    currentList = null
  }

  function flushCode() {
    if (codeFence) {
      blocks.push({ type: 'codeBlock', lang: codeFence.lang, text: codeFence.lines.join('\n') })
      codeFence = null
    }
  }

  function flushOptions() {
    if (currentOptions?.items.length) blocks.push(currentOptions)
    currentOptions = null
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    /* Fenced code block toggle */
    const fenceMatch = rawLine.match(/^```(\w*)/)
    if (fenceMatch) {
      if (codeFence) {
        flushCode()
      } else {
        flushParagraph()
        flushList()
        flushOptions()
        codeFence = { lang: fenceMatch[1] || '', lines: [] }
      }
      continue
    }
    if (codeFence) {
      codeFence.lines.push(rawLine)
      continue
    }

    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      flushOptions()
      continue
    }

    const tableHeaders = splitMarkdownTableRow(line)
    const nextLine = lines[index + 1]?.trim() || ''
    if (tableHeaders && isMarkdownTableSeparator(nextLine, tableHeaders.length)) {
      flushParagraph()
      flushList()
      flushOptions()

      const rows = []
      index += 2
      for (; index < lines.length; index += 1) {
        const rowCells = splitMarkdownTableRow(lines[index].trim())
        if (!rowCells || isMarkdownTableSeparator(lines[index], tableHeaders.length)) {
          index -= 1
          break
        }
        rows.push(tableHeaders.map((_, cellIndex) => rowCells[cellIndex] || ''))
      }

      blocks.push({ type: 'table', headers: tableHeaders, rows })
      continue
    }

    const guidedOption = parseGuidedOptionLine(line)
    if (guidedOption && /^选项\s*/.test(line)) {
      flushParagraph()
      flushList()
      if (!currentOptions) currentOptions = { type: 'optionList', items: [] }
      currentOptions.items.push(guidedOption)
      continue
    }

    /* Headings: # ... ###### */
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      flushOptions()
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] })
      continue
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/)
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/)
    const listType = orderedMatch ? 'orderedList' : unorderedMatch ? 'unorderedList' : null

    if (listType) {
      flushParagraph()
      flushOptions()
      if (!currentList || currentList.type !== listType) {
        flushList()
        currentList = { type: listType, items: [] }
      }
      currentList.items.push(orderedMatch?.[1] || unorderedMatch?.[1])
      continue
    }

    flushList()
    flushOptions()
    paragraphLines.push(line)
  }

  flushParagraph()
  flushList()
  flushOptions()
  flushCode()
  return normalizeInteractiveOptionBlocks(blocks.length ? blocks : [{ type: 'paragraph', text }])
}

function InteractiveOptionCard({ block, disabled, onSelect }) {
  return (
    <div className="ai-option-group" role="group" aria-label="AI 回复选项">
      {block.items.map((item, index) => (
        <button
          key={`${item.label}-${item.text}-${index}`}
          className="ai-option-card"
          type="button"
          disabled={disabled}
          onClick={() => onSelect?.(item.submitText)}
          title={`${item.label}：${item.text}`}
        >
          <span>{item.label}</span>
          <b>{item.text}</b>
        </button>
      ))}
    </div>
  )
}

function RichAiMessage({ text, optionDisabled = false, onOptionSelect }) {
  const blocks = parseMarkdownBlocks(text)
  return (
    <div className="ai-message-rich">
      {blocks.map((block, blockIndex) => {
        if (block.type === 'optionList') {
          return (
            <InteractiveOptionCard
              key={`options-${blockIndex}`}
              block={block}
              disabled={optionDisabled}
              onSelect={onOptionSelect}
            />
          )
        }

        if (block.type === 'orderedList' || block.type === 'unorderedList') {
          const ListTag = block.type === 'orderedList' ? 'ol' : 'ul'
          return (
            <ListTag key={`list-${blockIndex}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`item-${blockIndex}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `item-${blockIndex}-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          )
        }

        if (block.type === 'table') {
          const previousBlock = blocks[blockIndex - 1]
          const tableLabel = previousBlock?.type === 'heading' ? previousBlock.text : 'AI 回复表格'
          return (
            <div key={`table-${blockIndex}`} className="ai-md-table-wrap">
              <table className="ai-md-table" aria-label={tableLabel}>
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={`table-head-${blockIndex}-${headerIndex}`} scope="col">
                        {renderInlineMarkdown(header, `table-head-${blockIndex}-${headerIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`table-row-${blockIndex}-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`table-cell-${blockIndex}-${rowIndex}-${cellIndex}`}>
                          {renderInlineMarkdown(cell, `table-cell-${blockIndex}-${rowIndex}-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }

        if (block.type === 'heading') {
          const HeadingTag = `h${Math.min(block.level, 4)}`
          return (
            <HeadingTag key={`heading-${blockIndex}`} className={`ai-md-h${block.level}`}>
              {renderInlineMarkdown(block.text, `heading-${blockIndex}`)}
            </HeadingTag>
          )
        }

        if (block.type === 'codeBlock') {
          return (
            <pre key={`code-${blockIndex}`} className="ai-code-block">
              <code>{block.text}</code>
            </pre>
          )
        }

        return (
          <p key={`paragraph-${blockIndex}`}>
            {renderInlineMarkdown(block.text, `paragraph-${blockIndex}`)}
          </p>
        )
      })}
    </div>
  )
}

function KnowledgeTraceChip({ knowledgeTool }) {
  if (!knowledgeTool) return null
  const confidenceLabel = knowledgeTool.confidence === 'high' ? '高置信' : '低置信'
  const retrievalLabel = `retrievalTriggered=${knowledgeTool.retrievalTriggered ? 'true' : 'false'}`
  // 判断是否为真实知识库检索结果
  const isRealRetrieval = knowledgeTool.available && knowledgeTool.retrievalTriggered && knowledgeTool.confidence === 'high'
  const isUnavailable = !knowledgeTool.available
  const hasFallback = Boolean(knowledgeTool.fallbackReason)
  return (
    <div className="ai-message-trace" aria-label="知识库参考">
      <span>{isRealRetrieval ? '知识库参考' : '模型通用知识'}</span>
      {knowledgeTool.model && <code>{knowledgeTool.model}</code>}
      <span>{retrievalLabel}</span>
      <span>{confidenceLabel}</span>
      {knowledgeTool.fallbackReason && <span>{knowledgeTool.fallbackReason}</span>}
      {isUnavailable && <span style={{ color: 'var(--warn, #f59e0b)' }}>知识库未配置</span>}
      {hasFallback && !isUnavailable && <span style={{ color: 'var(--warn, #f59e0b)' }}>检索未命中</span>}
    </div>
  )
}

function ReportPill({ children, tone = 'soft' }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      minHeight: 24,
      padding: '2px 8px',
      borderRadius: 7,
      border: tone === 'warn' ? '1px solid #fed7aa' : '1px solid var(--line)',
      background: tone === 'warn' ? '#fff7ed' : 'var(--bg-soft)',
      color: tone === 'warn' ? '#9a3412' : 'var(--ink-2)',
      fontSize: 11.5,
      fontWeight: 700,
    }}>
      {children}
    </span>
  )
}

function ReportList({ title, items, empty = '待补充' }) {
  const rows = pickArray(items)
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: '#fff', minWidth: 0 }}>
      <b style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>{title}</b>
      {rows.length ? (
        <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 6, color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.55 }}>
          {rows.map((item, index) => <li key={`${title}-${index}`}>{String(item)}</li>)}
        </ul>
      ) : (
        <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{empty}</span>
      )}
    </div>
  )
}

function AttachmentUnderstandingPanel({ understanding, reportContent }) {
  const content = pickObject(reportContent)
  const data = mergeAttachmentUnderstanding(understanding, null, content)
  const project = pickObject(data.project)
  const sheets = pickArray(data.sourceSheets)
  const domains = pickArray(data.businessDomains)
  const findings = pickArray(content.requirementFindings)
  const itemCount = Number(findings.length || data.extractedItemCount || 0)
  if (!data.sourceFile && !sheets.length && !domains.length && !itemCount) return null
  const summary = data.summaryText || (domains.length
    ? `模型已识别到 ${domains.slice(0, 4).join('、')} 等线索，建议先确认客户主体、项目范围和关键口径。`
    : '模型已完成附件结构解析，建议先确认客户主体、项目范围和关键口径。')

  const metricStyle = {
    border: '1px solid rgba(37,99,235,.18)',
    borderRadius: 8,
    padding: '9px 10px',
    background: '#fff',
    minWidth: 0,
  }
  return (
    <section style={{ border: '1px solid #bfdbfe', borderRadius: 10, background: 'linear-gradient(180deg,#eff6ff,#fff)', overflow: 'hidden' }}>
      <div style={{ padding: '11px 12px', borderBottom: '1px solid #dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <b style={{ display: 'block', fontSize: 13.5 }}>附件理解摘要</b>
          <span style={{ display: 'block', marginTop: 3, color: 'var(--ink-3)', fontSize: 11.5 }}>{data.sourceFile || content.sourceFile || '需求附件'}</span>
        </div>
        <ReportPill>{data.fileKind || fileKind(data.sourceFile || content.sourceFile)}</ReportPill>
      </div>
      <div style={{ padding: 12, display: 'grid', gap: 10 }}>
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.65 }}>{summary}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
          <div style={metricStyle}>
            <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>工作表</span>
            <b style={{ display: 'block', marginTop: 3, fontSize: 12.5 }}>工作表 {sheets.length || 0} 张</b>
          </div>
          <div style={metricStyle}>
            <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>业务线索</span>
            <b style={{ display: 'block', marginTop: 3, fontSize: 12.5 }}>业务线索 {itemCount || findings.length || 0} 条</b>
          </div>
          <div style={metricStyle}>
            <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>疑似客户</span>
            <b style={{ display: 'block', marginTop: 3, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.customerName || pickObject(content.project).customerName || content.customerName || '待确认'}</b>
          </div>
          <div style={metricStyle}>
            <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>疑似项目</span>
            <b style={{ display: 'block', marginTop: 3, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.projectName || pickObject(content.project).projectName || content.projectName || '待确认'}</b>
          </div>
        </div>
        {(sheets.length > 0 || domains.length > 0 || pickArray(data.productLines).length > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {sheets.slice(0, 6).map((item) => <ReportPill key={`summary-sheet-${item}`}>表：{item}</ReportPill>)}
            {domains.slice(0, 6).map((item) => <ReportPill key={`summary-domain-${item}`}>{item}</ReportPill>)}
            {pickArray(data.productLines).slice(0, 4).map((item) => <ReportPill key={`summary-line-${item}`}>{item}</ReportPill>)}
          </div>
        )}
      </div>
    </section>
  )
}

function inlineEditLabel(label) {
  return /^[A-Za-z0-9_]/.test(String(label || '')) ? `编辑 ${label}` : `编辑${label}`
}

function InlineEditableValue({ label, fieldKey, value, placeholder = '双击补充', editingKey, onStartEdit, onChange, onFinishEdit, multiline = false, variant = 'plain' }) {
  const displayValue = normalizePendingText(value)
  const isEditing = editingKey === fieldKey
  const isFieldVariant = variant === 'field'
  const commonStyle = {
    width: '100%',
    border: '1px solid var(--accent)',
    borderRadius: 7,
    padding: '6px 8px',
    fontFamily: 'inherit',
    fontSize: 12.5,
    lineHeight: 1.45,
    outline: 'none',
    background: '#fff',
  }
  if (isEditing) {
    const InputTag = multiline ? 'textarea' : 'input'
    return (
      <InputTag
        aria-label={inlineEditLabel(label)}
        autoFocus
        rows={multiline ? 2 : undefined}
        value={displayValue}
        onChange={(event) => onChange(fieldKey, event.target.value)}
        onBlur={() => onFinishEdit(fieldKey)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onFinishEdit(fieldKey)
          }
          if (event.key === 'Escape') onFinishEdit(fieldKey)
        }}
        style={multiline ? { ...commonStyle, resize: 'vertical', minHeight: 58 } : commonStyle}
      />
    )
  }
  return (
    <button
      type="button"
      aria-label={`${label} ${displayValue || placeholder} 双击编辑`}
      title="双击编辑"
      onClick={(event) => {
        if (event.detail >= 2) onStartEdit(fieldKey)
      }}
      onDoubleClick={() => onStartEdit(fieldKey)}
      style={{
        display: 'block',
        width: '100%',
        minHeight: isFieldVariant ? 34 : 24,
        marginTop: 4,
        padding: isFieldVariant ? '7px 9px' : 0,
        border: isFieldVariant ? '1px dashed var(--line-2, #cbd5e1)' : 0,
        borderRadius: isFieldVariant ? 8 : 0,
        background: isFieldVariant ? (displayValue ? '#fff' : 'var(--bg-soft)') : 'transparent',
        textAlign: 'left',
        color: displayValue ? 'var(--ink)' : 'var(--ink-3)',
        fontFamily: 'inherit',
        fontSize: 12.5,
        fontWeight: displayValue ? 750 : 700,
        cursor: 'text',
        lineHeight: 1.5,
      }}
    >
      {displayValue || placeholder}
    </button>
  )
}

function RequirementAnalysisReportCard({ artifact, onAction, confirmingActionId = '', onSubmitSupplement }) {
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
  const baseDraft = useMemo(() => {
    const coreProject = pickObject(content.project)
    const missingAnswerMap = {}
    const questionAnswerMap = {}
    editableMissingFields.forEach((item) => {
      const row = pickObject(item)
      const key = row.field || row.reason
      if (key) missingAnswerMap[key] = ''
    })
    pickArray(content.clarificationQuestions).forEach((item) => {
      const row = pickObject(item)
      const key = row.question || row.reason
      if (key) questionAnswerMap[key] = ''
    })
    return {
      projectName: firstBusinessValue(coreProject.projectName, content.projectName, understandingProject.projectName),
      customerName: firstBusinessValue(coreProject.customerName, content.customerName, understandingProject.customerName, inferCustomerNameFromFileName(content.sourceFile)),
      industry: firstBusinessValue(coreProject.industry, content.industry, understandingProject.industry),
      location: '',
      enterpriseProfile: '',
      enterpriseRevenue: '',
      itStatus: '',
      missingAnswers: missingAnswerMap,
      questionAnswers: questionAnswerMap,
    }
  }, [artifactIdentity])
  const [draft, setDraft] = useState(baseDraft)
  const [dirtyFields, setDirtyFields] = useState({})
  const [editingKey, setEditingKey] = useState('')
  const [lookupState, setLookupState] = useState({ loading: false, candidates: [], error: '', selectedName: '', dialogOpen: false })
  const [submitState, setSubmitState] = useState({ loading: false, error: '' })

  useLayoutEffect(() => {
    setDraft(baseDraft)
    setDirtyFields({})
    setEditingKey('')
    setLookupState({ loading: false, candidates: [], error: '', selectedName: '', dialogOpen: false })
    setSubmitState({ loading: false, error: '' })
  }, [baseDraft])

  if (!artifact || (!isLegacyReport && !isHarnessReport)) return null

  function updateDraftValue(fieldKey, value) {
    setDraft((prev) => {
      if (fieldKey.startsWith('missing:')) {
        const key = fieldKey.slice('missing:'.length)
        return { ...prev, missingAnswers: { ...prev.missingAnswers, [key]: value } }
      }
      if (fieldKey.startsWith('question:')) {
        const key = fieldKey.slice('question:'.length)
        return { ...prev, questionAnswers: { ...prev.questionAnswers, [key]: value } }
      }
      return { ...prev, [fieldKey]: value }
    })
    setDirtyFields((prev) => ({ ...prev, [fieldKey]: true }))
  }

  function finishDraftEdit() {
    setEditingKey('')
  }

  function applyCompanyProfile(profile, selectedName = '') {
    const nextValues = {
      customerName: profile.customerName || profile.displayName || selectedName || draft.customerName,
      industry: profile.customerIndustry || profile.industry || draft.industry,
      location: profile.location || draft.location,
      enterpriseProfile: profile.enterpriseProfile || draft.enterpriseProfile,
      enterpriseRevenue: profile.enterpriseRevenue || draft.enterpriseRevenue,
      itStatus: profile.itStatus || draft.itStatus,
    }
    setDraft((prev) => ({ ...prev, ...nextValues }))
    setDirtyFields((prev) => ({
      ...prev,
      customerName: true,
      industry: Boolean(nextValues.industry) || prev.industry,
      location: Boolean(nextValues.location) || prev.location,
      enterpriseProfile: Boolean(nextValues.enterpriseProfile) || prev.enterpriseProfile,
      enterpriseRevenue: Boolean(nextValues.enterpriseRevenue) || prev.enterpriseRevenue,
      itStatus: Boolean(nextValues.itStatus) || prev.itStatus,
    }))
    setLookupState({ loading: false, candidates: [], error: '', selectedName: nextValues.customerName || selectedName })
  }

  async function lookupCustomer() {
    const customerName = stripPendingMarker(draft.customerName || project.customerName || content.customerName)
    if (!customerName) {
      setLookupState({ loading: false, candidates: [], error: '请先补充客户简称或名称片段', selectedName: lookupState.selectedName })
      return
    }
    setLookupState((prev) => ({ ...prev, loading: true, error: '', candidates: [] }))
    try {
      const profile = await summarizeCompanyProfile({
        customerName,
        customerIndustry: stripPendingMarker(draft.industry),
      })
      const candidates = pickArray(profile?.disambiguationCandidates)
      if (profile?.mode === 'disambiguation' && candidates.length) {
        setLookupState({ loading: false, candidates, error: '', selectedName: '', dialogOpen: true })
      } else {
        applyCompanyProfile(profile || {}, profile?.customerName || customerName)
      }
    } catch (err) {
      setLookupState({ loading: false, candidates: [], error: `客户主体检索失败：${err.message || '请求失败'}`, selectedName: '' })
    }
  }

  async function selectCustomerCandidate(candidate) {
    const displayName = candidate.displayName || candidate.customerName || candidate.name || candidate.title || ''
    if (!displayName) return
    const customerName = stripPendingMarker(draft.customerName || displayName)
    setLookupState((prev) => ({ ...prev, loading: true, error: '' }))
    try {
      const profile = await summarizeCompanyProfile({
        customerName: customerName || displayName,
        customerIndustry: stripPendingMarker(draft.industry),
        disambiguationChoice: {
          displayName,
          summary: candidate.summary || candidate.description || '',
        },
      })
      applyCompanyProfile({ ...candidate, ...profile, customerName: profile?.customerName || displayName }, displayName)
      setLookupState((prev) => ({ ...prev, dialogOpen: false }))
    } catch (err) {
      applyCompanyProfile({ ...candidate, customerName: displayName }, displayName)
      setLookupState((prev) => ({ ...prev, loading: false, error: `主体详情补全失败：${err.message || '请求失败'}`, dialogOpen: false }))
    }
  }

  function buildSupplementAnswers() {
    const answers = []
    const add = (field, value, extra = {}) => {
      const text = normalizePendingText(value)
      if (!text) return
      answers.push({ field, value: text, source: 'structured_card_inline', ...extra })
    }
    const addBusiness = (field, value) => add(field, stripPendingMarker(value))
    if (dirtyFields.projectName || isFilledBusinessValue(draft.projectName)) addBusiness('projectName', draft.projectName)
    if (dirtyFields.customerName || isFilledBusinessValue(draft.customerName)) addBusiness('customerName', draft.customerName)
    if (dirtyFields.industry || isFilledBusinessValue(draft.industry)) addBusiness('industry', draft.industry)
    if (dirtyFields.location) add('location', draft.location)
    if (dirtyFields.enterpriseProfile) add('enterpriseProfile', draft.enterpriseProfile)
    if (dirtyFields.enterpriseRevenue) add('enterpriseRevenue', draft.enterpriseRevenue)
    if (dirtyFields.itStatus) add('itStatus', draft.itStatus)
    Object.entries(draft.missingAnswers || {}).forEach(([field, value]) => add(field, value))
    Object.entries(draft.questionAnswers || {}).forEach(([field, value]) => add(field, value))
    return answers
  }

  async function submitStructuredSupplement() {
    const answers = buildSupplementAnswers()
    if (!answers.length || !onSubmitSupplement) return
    setSubmitState({ loading: true, error: '' })
    try {
      await onSubmitSupplement(artifact, answers)
      setSubmitState({ loading: false, error: '' })
    } catch (err) {
      setSubmitState({ loading: false, error: `提交补充失败：${err.message || '请求失败'}` })
    }
  }

  const supplementAnswers = buildSupplementAnswers()
  return (
    <section style={{
      marginTop: 12,
      border: '1px solid var(--line)',
      borderRadius: 10,
      background: '#fff',
      overflow: 'hidden',
      color: 'var(--ink)',
    }}>
      {isHarnessReport && (
        <div style={{ padding: 14, borderBottom: '1px solid var(--line)' }}>
          <AttachmentUnderstandingPanel understanding={artifact.fileUnderstanding || artifact.understanding} reportContent={content} />
        </div>
      )}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--ink-3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {content.sourceFile || '需求文件'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isLegacyReport && <ReportPill>历史产物，非 Harness 生成</ReportPill>}
          <ReportPill tone="warn">待补充 {pickArray(missingItems).length || 0} 项</ReportPill>
        </div>
      </div>
      <div style={{ padding: 14, display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-soft)' }}>
            <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>项目</span>
            <InlineEditableValue
              label="项目"
              fieldKey="projectName"
              value={draft.projectName}
              editingKey={editingKey}
              onStartEdit={setEditingKey}
              onChange={updateDraftValue}
              onFinishEdit={finishDraftEdit}
            />
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>客户</span>
              {isHarnessReport && !isV2HarnessReport && (
                <button className="btn btn-out" type="button" onClick={lookupCustomer} disabled={lookupState.loading} style={{ marginLeft: 'auto', height: 28, padding: '0 12px', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {lookupState.loading && <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--line)', borderTopColor: 'var(--brand)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
                  {lookupState.loading ? '检索中…' : '检索主体'}
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </button>
              )}
            </div>
            <InlineEditableValue
              label="客户"
              fieldKey="customerName"
              value={draft.customerName}
              editingKey={editingKey}
              onStartEdit={setEditingKey}
              onChange={updateDraftValue}
              onFinishEdit={finishDraftEdit}
            />
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-soft)' }}>
            <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>行业</span>
            <InlineEditableValue
              label="行业"
              fieldKey="industry"
              value={draft.industry}
              editingKey={editingKey}
              onStartEdit={setEditingKey}
              onChange={updateDraftValue}
              onFinishEdit={finishDraftEdit}
            />
          </div>
        </div>
        {(lookupState.error || lookupState.selectedName || draft.location || draft.enterpriseProfile || draft.itStatus) && (
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: '#fff', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <b style={{ fontSize: 12 }}>客户主体确认</b>
              {lookupState.selectedName && <ReportPill tone="warn">已选择主体：{lookupState.selectedName}</ReportPill>}
            </div>
            {lookupState.error && <div role="alert" style={{ color: 'var(--err)', fontSize: 12 }}>{lookupState.error}</div>}
            {(draft.location || draft.enterpriseProfile || draft.enterpriseRevenue || draft.itStatus) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, color: 'var(--ink-2)', fontSize: 12 }}>
                {draft.location && <span>地区：{draft.location}</span>}
                {draft.enterpriseRevenue && <span>规模：{draft.enterpriseRevenue}</span>}
                {draft.itStatus && <span>信息化：{draft.itStatus}</span>}
                {draft.enterpriseProfile && <span style={{ gridColumn: '1 / -1' }}>画像：{draft.enterpriseProfile}</span>}
              </div>
            )}
          </div>
        )}
        {(productLines.length > 0 || sourceSheets.length > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {productLines.map((item) => <ReportPill key={`line-${item}`}>{item}</ReportPill>)}
            {sourceSheets.map((item) => <ReportPill key={`sheet-${item}`}>表：{item}</ReportPill>)}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 10 }}>
          <ReportList title="需求识别" items={needItems} />
          <ReportList title="模块线索" items={moduleItems} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: '#fff', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <b style={{ display: 'block', fontSize: 12 }}>缺失/模糊信息</b>
              <span style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>双击待填写区域维护</span>
            </div>
            {(editableMissingFields.length || questions.length) ? (
              <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflowY: 'auto', paddingRight: 2 }}>
                {editableMissingFields.map((item, index) => {
                  const row = pickObject(item)
                  const field = row.field || `缺失信息 ${index + 1}`
                  const label = fieldDisplayLabel(field)
                  return (
                    <div key={`missing-edit-${field}-${index}`} style={{ display: 'grid', gap: 6, color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.55, border: '1px solid var(--line)', borderRadius: 8, padding: 9, background: 'var(--bg-soft)' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <b style={{ color: 'var(--ink)' }}>{label}</b>
                        {field !== label && <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{field}</span>}
                      </div>
                      {row.reason && <span style={{ color: 'var(--ink-3)' }}>{row.reason}</span>}
                      <InlineEditableValue
                        label={label}
                        fieldKey={`missing:${field}`}
                        value={draft.missingAnswers?.[field] || ''}
                        placeholder="双击填写"
                        editingKey={editingKey}
                        onStartEdit={setEditingKey}
                        onChange={updateDraftValue}
                        onFinishEdit={finishDraftEdit}
                        multiline
                        variant="field"
                      />
                    </div>
                  )
                })}
                {questions.map((item, index) => {
                  const row = pickObject(item)
                  const field = row.question || `待确认问题 ${index + 1}`
                  return (
                    <div key={`question-edit-${field}-${index}`} style={{ display: 'grid', gap: 6, color: 'var(--ink-2)', fontSize: 12, lineHeight: 1.55, border: '1px solid var(--line)', borderRadius: 8, padding: 9, background: 'var(--bg-soft)' }}>
                      <b style={{ color: 'var(--ink)' }}>{field}</b>
                      {row.reason && <span style={{ color: 'var(--ink-3)' }}>{row.reason}</span>}
                      <InlineEditableValue
                        label={` ${field}`.trimStart()}
                        fieldKey={`question:${field}`}
                        value={draft.questionAnswers?.[field] || ''}
                        placeholder="双击回答"
                        editingKey={editingKey}
                        onStartEdit={setEditingKey}
                        onChange={updateDraftValue}
                        onFinishEdit={finishDraftEdit}
                        multiline
                        variant="field"
                      />
                    </div>
                  )
                })}
              </div>
            ) : (
              <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>待补充</span>
            )}
          </div>
          <ReportList title="风险假设" items={risks} />
        </div>
        {isV2HarnessReport && answeredQuestions.length > 0 && (
          <ReportList title="已确认信息" items={answeredQuestions} />
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(nextActionItems.length ? nextActionItems : [{ label: '补充项目信息' }, { label: '生成待确认问题' }, { label: '进入正式评估' }]).map((action) => {
            const actionKey = `${artifact.harnessRunId || ''}-${action.actionType || action.label}`
            const isConfirming = confirmingActionId === actionKey
            return (
              <button
                key={action.actionType || action.label}
                className="btn btn-out"
                type="button"
                style={{ height: 30 }}
                disabled={!isV2HarnessReport || !action.actionType || isConfirming}
                title={
                  isV2HarnessReport && action.actionType
                    ? '点击确认该 Harness 下一步动作'
                    : '下一阶段接入 Harness 动作确认后启用'
                }
                onClick={isV2HarnessReport && action.actionType ? () => onAction?.(artifact, action) : undefined}
              >
                {isConfirming ? '确认中…' : action.label}
              </button>
            )
          })}
        </div>
        {isHarnessReport && !isV2HarnessReport && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-pri"
              type="button"
              onClick={submitStructuredSupplement}
              disabled={submitState.loading || !supplementAnswers.length}
              style={{ height: 32 }}
            >
              {submitState.loading ? '生成中…' : '提交补充并生成 v2'}
            </button>
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              {supplementAnswers.length ? `待提交 ${supplementAnswers.length} 项补充` : '双击字段后可提交补充'}
            </span>
            {submitState.error && <span role="alert" style={{ color: 'var(--err)', fontSize: 12 }}>{submitState.error}</span>}
          </div>
        )}
      </div>
      <CompanyLookupDialog
        open={lookupState.dialogOpen}
        loading={lookupState.loading}
        candidates={lookupState.candidates}
        error={lookupState.error}
        onClose={() => setLookupState((prev) => ({ ...prev, dialogOpen: false, candidates: [], error: '' }))}
        onSelect={selectCustomerCandidate}
      />
    </section>
  )
}

function ConfirmDialog({ title, message, detail, error = '', confirmLabel = '确认', cancelLabel = '取消', confirming = false, onCancel, onConfirm }) {
  return (
    <div
      role="presentation"
      onClick={(event) => event.target === event.currentTarget && !confirming && onCancel?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'rgba(15,23,42,0.42)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-home-confirm-title"
        style={{
          width: 'min(440px, 100%)',
          background: '#fff',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          boxShadow: '0 24px 64px rgba(15,23,42,0.24)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--err-soft)',
            color: 'var(--err)',
            fontWeight: 900,
          }}>!</span>
          <strong id="ai-home-confirm-title" style={{ fontSize: 14 }}>{title}</strong>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 10 }}>
          <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.7 }}>{message}</p>
          {detail && (
            <div style={{
              padding: '10px 12px',
              borderRadius: 'var(--r-md)',
              background: 'var(--bg-soft)',
              border: '1px solid var(--line)',
              color: 'var(--ink)',
              fontSize: 12.5,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {detail}
            </div>
          )}
          <p style={{ margin: 0, color: 'var(--err)', fontSize: 12 }}>删除后不可恢复。</p>
          {error && (
            <div role="alert" style={{
              padding: '9px 11px',
              borderRadius: 'var(--r-md)',
              background: 'var(--err-soft)',
              border: '1px solid #fecaca',
              color: 'var(--err)',
              fontSize: 12,
              lineHeight: 1.55,
            }}>
              {error}
            </div>
          )}
        </div>
        <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', background: 'var(--bg-soft)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn btn-out" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={onCancel} disabled={confirming}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-dan" style={{ height: 30, fontSize: 12, padding: '0 14px' }} onClick={onConfirm} disabled={confirming}>
            {confirming ? '删除中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 清理消息文本中残留的 formBlock JSON 代码块。
 * 当后端未能成功提取 formBlock 或会话数据为历史存储时，
 * 防止 JSON 以代码块形式渲染到前端。
 */
function stripFormBlockJson(text) {
  if (!text) return text
  let cleaned = text
  // 移除包含 formBlock 的 fenced code block（```json ... ``` 或 ``` ... ```）
  cleaned = cleaned.replace(/```(?:json)?\s*\n?\s*\{[\s\S]*?"formBlock"[\s\S]*?\}\s*\n?\s*```/gi, '')
  // 处理截断无闭合 ``` 的情况：从 {"formBlock": 开始到文本末尾
  const formBlockStart = cleaned.search(/\{\s*"formBlock"\s*:/)
  if (formBlockStart >= 0) {
    cleaned = cleaned.slice(0, formBlockStart)
  }
  return cleaned.trim()
}

function mapSessionMessages(session) {
  if (!Array.isArray(session?.messages)) return []
  const attachmentsById = new Map((Array.isArray(session.attachments) ? session.attachments : [])
    .filter((attachment) => attachment?.attachmentId && attachment?.name)
    .map((attachment) => [attachment.attachmentId, attachment]))
  const artifactsById = new Map((Array.isArray(session.artifacts) ? session.artifacts : [])
    .filter((artifact) => artifact?.artifactId)
    .map((artifact) => [artifact.artifactId, artifact]))
  return session.messages
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .map((message, index) => {
      const file = (Array.isArray(message.attachmentIds) ? message.attachmentIds : [])
        .map((attachmentId) => attachmentsById.get(attachmentId))
        .find(Boolean)
      const artifacts = (Array.isArray(message.artifactIds) ? message.artifactIds : [])
        .map((artifactId) => artifactsById.get(artifactId))
        .filter(Boolean)
      const metadata = pickObject(message.metadata)
      const formBlock = pickObject(metadata.formBlock)
      const knowledgeTool = normalizeKnowledgeTool(metadata.knowledgeTool)
      return {
        id: message.messageId || `${session.sessionId}-${index}`,
        role: message.role,
        text: stripFormBlockJson(message.content || ''),
        file: file ? { name: file.name, size: file.size, type: file.type } : undefined,
        artifacts,
        formBlock: formBlock.blockId ? formBlock : undefined,
        knowledgeTool,
      }
    })
    .filter((message) => message.text)
}

function normalizeClientFormBlock(value) {
  const formBlock = pickObject(value)
  return formBlock.blockId && formBlock.title && Array.isArray(formBlock.fields) ? formBlock : undefined
}

function normalizeKnowledgeTool(value) {
  const knowledgeTool = pickObject(value)
  if (knowledgeTool.toolId !== 'knowledge_base.query_product_knowledge') return undefined
  return {
    ...knowledgeTool,
    model: knowledgeTool.model || '',
    available: knowledgeTool.available === true,
    confidence: knowledgeTool.confidence === 'high' ? 'high' : 'low',
    retrievalTriggered: knowledgeTool.retrievalTriggered === true,
    fallbackReason: knowledgeTool.fallbackReason || '',
    contextRef: knowledgeTool.contextRef || '',
  }
}

function attachFormBlockToLatestAssistant(messages, formBlock) {
  const normalized = normalizeClientFormBlock(formBlock)
  if (!normalized) return messages
  const assistantIndex = [...messages].reverse().findIndex((message) => message.role === 'assistant' && !message.loading && !message.error)
  if (assistantIndex < 0) return messages
  const targetIndex = messages.length - 1 - assistantIndex
  return messages.map((message, index) => (
    index === targetIndex ? { ...message, formBlock: normalized } : message
  ))
}

function attachKnowledgeToolToLatestAssistant(messages, knowledgeTool) {
  const normalized = normalizeKnowledgeTool(knowledgeTool)
  if (!normalized) return messages
  const assistantIndex = [...messages].reverse().findIndex((message) => message.role === 'assistant' && !message.loading && !message.error)
  if (assistantIndex < 0) return messages
  const targetIndex = messages.length - 1 - assistantIndex
  return messages.map((message, index) => (
    index === targetIndex ? { ...message, knowledgeTool: normalized } : message
  ))
}

function sameMessageList(left, right) {
  if (left.length !== right.length) return false
  return left.every((message, index) => (
    message.role === right[index]?.role &&
    message.text === right[index]?.text &&
    message.file?.name === right[index]?.file?.name &&
    message.file?.size === right[index]?.file?.size &&
    message.file?.type === right[index]?.file?.type &&
    message.file?.parsedSummary === right[index]?.file?.parsedSummary &&
    message.formBlock?.blockId === right[index]?.formBlock?.blockId &&
    message.knowledgeTool?.contextRef === right[index]?.knowledgeTool?.contextRef &&
    (message.artifacts || []).map((artifact) => artifact.artifactId).join(',') === (right[index]?.artifacts || []).map((artifact) => artifact.artifactId).join(',')
  ))
}

function withCurrentUserFile(sessionMessages, userMessage) {
  if (!userMessage?.file) return sessionMessages
  const lastUserIndex = sessionMessages.map((message) => message.role).lastIndexOf('user')
  if (lastUserIndex < 0) return sessionMessages
  return sessionMessages.map((message, index) => (
    index === lastUserIndex && message.text === userMessage.text
      ? { ...message, file: userMessage.file }
      : message
  ))
}

function mergePreservedLocalFileMessages(previousMessages, sessionMessages) {
  const preserved = previousMessages.filter((message) => (
    message.file?.name && !sessionMessages.some((item) => item.file?.name === message.file.name && item.text === message.text)
  ))
  return preserved.length ? [...preserved, ...sessionMessages] : sessionMessages
}

export default function AiHomeWorkbench({ currentUser }) {
  const preset = useMemo(() => getAiHomePreset(currentUser?.businessRole), [currentUser?.businessRole])
  const workflowsByKey = useMemo(() => new Map(preset.workflows.map((workflow) => [workflow.key, workflow])), [preset.workflows])
  const {
    sessions,
    activeSession,
    loadingSessions,
    sessionsError,
    clearSessionsError,
    loadSessions,
    createSession,
    deleteSession,
    upsertSession,
    setActiveSession,
  } = useAiSessions()
  const [composer, setComposer] = useState('')
  const [draftBeforeLogin, setDraftBeforeLogin] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [messages, setMessages] = useState([])
  const [activeWorkflowKey, setActiveWorkflowKey] = useState('')
  const [sending, setSending] = useState(false)
  const [confirmingActionId, setConfirmingActionId] = useState('')
  const [deleteTargetSession, setDeleteTargetSession] = useState(null)
  const [deletingSessionId, setDeletingSessionId] = useState('')
  const [deleteSessionError, setDeleteSessionError] = useState('')
  const [workspacePanelCollapsed, setWorkspacePanelCollapsed] = useState(readWorkspacePanelCollapsed)
  const fileInputRef = useRef(null)
  const messagePaneRef = useRef(null)
  const [workbenchCompanyLookupOpen, setWorkbenchCompanyLookupOpen] = useState(false)
  const [workbenchCompanyLookupLoading, setWorkbenchCompanyLookupLoading] = useState(false)
  const [workbenchCompanyCandidates, setWorkbenchCompanyCandidates] = useState([])
  const [workbenchCompanyLookupError, setWorkbenchCompanyLookupError] = useState('')
  const activeWorkflow = workflowsByKey.get(activeWorkflowKey)
  const centerTitle = activeWorkflow?.title || preset.headline
  const centerHint = activeWorkflow?.desc || preset.emptyHint
  const outputState = getWorkflowOutputs(activeWorkflow)

  useEffect(() => {
    loadSessions().catch(() => {})
  }, [loadSessions])

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_PANEL_COLLAPSED_KEY, workspacePanelCollapsed ? 'true' : 'false')
    } catch {
      // localStorage may be unavailable in private or embedded contexts.
    }
  }, [workspacePanelCollapsed])

  useLayoutEffect(() => {
    const pane = messagePaneRef.current
    if (!pane || typeof pane.scrollTo !== 'function') return
    pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' })
  }, [messages.length, sending])

  useEffect(() => {
    if (activeSession?.workflowKey && !activeWorkflowKey) {
      setActiveWorkflowKey(activeSession.workflowKey === 'free_chat' ? '' : activeSession.workflowKey)
    }
  }, [activeSession?.workflowKey, activeWorkflowKey])

  useEffect(() => {
    if (sending || !activeSession) return
    const sessionMessages = mapSessionMessages(activeSession)
    setMessages((prev) => {
      if (prev.some((message) => message.loading || message.error || message.action)) return prev
      if (sessionMessages.length === 0 && prev.length > 0) return prev
      const mergedMessages = mergePreservedLocalFileMessages(prev, sessionMessages)
      return sameMessageList(prev, mergedMessages) ? prev : mergedMessages
    })
  }, [activeSession, sending])

  function chooseFile() {
    fileInputRef.current?.click()
  }

  async function createStandardDraftFromFile(file) {
    const session = activeSession || await createSession({
      title: file.name,
      domain: 'standard_governance',
      workflowKey: 'standard_governance',
      status: 'standard_review',
    })
    const payload = await apiClient.post(`/ai-sessions/${session.sessionId}/standard-drafts`, {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    }, { suppressUnauthorizedRedirect: true })
    const data = unwrap(payload)
    if (data?.session) upsertSession(data.session)
  }

  function attachFile(file) {
    setSelectedFile(file || null)
    if (file && activeWorkflowKey === 'standard_governance') {
      createStandardDraftFromFile(file).catch((err) => {
        setMessages((prev) => [...prev, {
          id: `standard-error-${Date.now()}`,
          role: 'assistant',
          text: `标准文件解析暂未完成：${err.message || '请求失败'}`,
          error: true,
        }])
      })
    }
  }

  function removeSelectedFile() {
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function startWorkflow(workflow) {
    setActiveWorkflowKey(workflow.key)
    setComposer(`${workflow.title}：${workflow.desc}`)
  }

  function startNewSession() {
    setActiveSession(null)
    setMessages([])
    setActiveWorkflowKey('')
  }

  function selectSession(session) {
    setActiveSession(session)
    setActiveWorkflowKey(session?.workflowKey && session.workflowKey !== 'free_chat' ? session.workflowKey : '')
  }

  async function openWorkbenchCompanyLookup(prefillName) {
    setWorkbenchCompanyLookupOpen(true)
    setWorkbenchCompanyLookupLoading(true)
    setWorkbenchCompanyCandidates([])
    setWorkbenchCompanyLookupError('')
    // RP-008: 优先使用 suggestedAction 传入的客户名，其次从 session linkedRecords 推断
    const linkedCustomer = activeSession?.linkedRecords?.customerName || ''
    const customerName = stripPendingMarker(prefillName || linkedCustomer) || '客户'
    try {
      const profile = await summarizeCompanyProfile({ customerName })
      const candidates = pickArray(profile?.disambiguationCandidates)
      if (profile?.mode === 'disambiguation' && candidates.length) {
        setWorkbenchCompanyCandidates(candidates)
      } else if (profile?.customerName) {
        setWorkbenchCompanyCandidates([{
          displayName: profile.customerName,
          industry: profile.customerIndustry || '',
          location: profile.location || '',
          summary: profile.enterpriseProfile || '',
        }])
      }
    } catch (err) {
      setWorkbenchCompanyLookupError(`客户主体检索失败：${err.message || '请求失败'}`)
    } finally {
      setWorkbenchCompanyLookupLoading(false)
    }
  }

  function handleWorkbenchCompanySelect(candidate) {
    const displayName = candidate.displayName || candidate.customerName || candidate.name || candidate.title || '候选主体'
    setWorkbenchCompanyLookupOpen(false)
    setWorkbenchCompanyCandidates([])
    setWorkbenchCompanyLookupError('')
    setMessages((prev) => [...prev, {
      id: `company-selected-${Date.now()}`,
      role: 'assistant',
      text: `已选择客户主体：${displayName}`,
    }])
  }

  function requestDeleteSession(session) {
    if (!session?.sessionId) return
    setDeleteSessionError('')
    setDeleteTargetSession(session)
  }

  async function handleHarnessAction(artifact, action) {
    if (!artifact?.harnessRunId || !action?.actionType || confirmingActionId) return
    const actionKey = `${artifact.harnessRunId}-${action.actionType}`
    setConfirmingActionId(actionKey)
    try {
      const result = await confirmHarnessAction(artifact.harnessRunId, action.actionType, { confirmed: true, actionType: action.actionType })
      const project = result?.event?.output?.project || {}
      const assessmentDraft = result?.event?.output?.assessmentDraft || {}
      const hasDraft = project.projectId || assessmentDraft.recordId
      const successText = hasDraft
        ? [
            `已生成项目评估草稿：${project.projectName || project.projectId || '未命名项目'}`,
            assessmentDraft.versionCode ? `实施评估草稿：${assessmentDraft.versionCode}` : '',
            '请在传统工作台中人工确认/编辑后再进入正式评估。',
          ].filter(Boolean).join('\n')
        : `已确认「${action.label || action.actionType}」，Harness Run 阶段已推进。`
      const actions = hasDraft && assessmentDraft.recordId
        ? [
            { label: '查看评估草稿', to: `/assessments/${encodeURIComponent(assessmentDraft.recordId)}` },
            { label: '返回实施评估列表', to: '/assessments' },
          ]
        : undefined
      setMessages((prev) => [...prev, {
        id: `ai-harness-action-${Date.now()}`,
        role: 'assistant',
        text: successText,
        actions,
      }])
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: `ai-harness-action-err-${Date.now()}`,
        role: 'assistant',
        text: `动作确认失败：${err.message || '请求失败'}`,
        error: true,
      }])
    } finally {
      setConfirmingActionId('')
    }
  }

  async function handleStructuredSupplement(artifact, answers) {
    const runId = artifact?.harnessRunId
    if (!runId || !answers?.length) return
    const loadingId = `ai-harness-inline-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setSending(true)
    setMessages((prev) => [...prev, {
      id: loadingId,
      role: 'assistant',
      text: '正在保存卡片补充信息并生成需求解析报告 v2',
      loading: true,
    }])
    try {
      await submitHarnessAnswers(runId, { answers })
      const reportDetail = await generateHarnessReportV2(runId, { force: false })
      const v2Artifact = pickArray(reportDetail?.artifacts).find((item) => item.artifactType === 'requirement_report_v2')
      if (v2Artifact) v2Artifact.harnessRunId = runId
      const assistantMessage = {
        id: `ai-harness-v2-inline-${Date.now()}`,
        role: 'assistant',
        text: '已基于卡片补充信息生成《需求解析报告 v2》。',
        artifacts: v2Artifact ? [v2Artifact] : [],
        model: pickArray(reportDetail?.modelRuns).at(-1)?.model,
      }
      setMessages((prev) => prev.map((message) => (
        message.id === loadingId ? assistantMessage : message
      )))
      if (activeSession) {
        const artifactId = v2Artifact?.harnessArtifactId || v2Artifact?.artifactId || `harness-art-v2-inline-${Date.now()}`
        upsertSession({
          ...activeSession,
          messages: [
            ...(Array.isArray(activeSession.messages) ? activeSession.messages : []),
            {
              messageId: `harness-user-inline-${Date.now()}`,
              role: 'user',
              content: `卡片补充信息：${answers.map((item) => `${item.field}=${item.value}`).join('；')}`,
              createdAt: new Date().toISOString(),
            },
            {
              messageId: `harness-ai-v2-inline-${Date.now()}`,
              role: 'assistant',
              content: assistantMessage.text,
              artifactIds: v2Artifact ? [artifactId] : [],
              createdAt: new Date().toISOString(),
            },
          ],
          artifacts: v2Artifact
            ? [
                ...(Array.isArray(activeSession.artifacts) ? activeSession.artifacts : []),
                {
                  artifactId,
                  type: v2Artifact.artifactType || v2Artifact.type,
                  ...v2Artifact,
                },
              ]
            : (Array.isArray(activeSession.artifacts) ? activeSession.artifacts : []),
          updatedAt: new Date().toISOString(),
        })
      }
    } catch (err) {
      setMessages((prev) => prev.map((message) => (
        message.id === loadingId
          ? {
              id: loadingId,
              role: 'assistant',
              text: `卡片补充暂未完成：${err.message || '请求失败'}`,
              error: true,
            }
          : message
      )))
      throw err
    } finally {
      setSending(false)
    }
  }

  async function confirmDeleteSession() {
    const session = deleteTargetSession
    if (!session?.sessionId || deletingSessionId) return
    setDeleteSessionError('')
    setDeletingSessionId(session.sessionId)
    try {
      await deleteSession(session.sessionId)
      if (activeSession?.sessionId === session.sessionId) {
        setMessages([])
        setActiveWorkflowKey('')
      }
      setDeleteTargetSession(null)
    } catch (err) {
      setDeleteSessionError(`删除失败：${err.message || '请求失败'}`)
    } finally {
      setDeletingSessionId('')
    }
  }

  async function confirmPendingAction(action) {
    if (action?.actionType !== 'create_project_evaluation') return
    if (confirmingActionId) return
    setConfirmingActionId(action.actionId || action.title || 'confirming')
    const payload = action.payload || {}
    try {
      const response = await apiClient.post('/project-evaluations', {
        projectName: payload.projectName || activeSession?.title || '未命名项目评估',
        customerName: payload.customerName || '',
        industry: payload.industry || '',
        currentStage: payload.currentStage || 'project_discovery',
        projectStatus: 'draft',
        createdFromSessionId: activeSession?.sessionId,
      }, { suppressUnauthorizedRedirect: true })
      const project = unwrap(response)?.project
      if (!project) throw new Error('接口未返回项目记录')
      if (activeSession) {
        upsertSession({
          ...activeSession,
          pendingActions: (activeSession.pendingActions || []).map((item) => (
            item.actionId === action.actionId ? { ...item, status: 'executed', result: { projectId: project.projectId } } : item
          )),
          linkedRecords: {
            ...(activeSession.linkedRecords || {}),
            projectId: project.projectId,
            projectName: project.projectName,
          },
          updatedAt: new Date().toISOString(),
        })
      }
      setMessages((prev) => [...prev, {
        id: `project-created-${Date.now()}`,
        role: 'assistant',
        text: `项目已创建并关联：${project.projectName || project.projectId}`,
      }])
      window.dispatchEvent(new CustomEvent('wes-project-evaluation-created', { detail: { project } }))
    } catch (err) {
      const detailReason = err.details?.[0]?.reason || ''
      const errorText = err.status === 401
        ? '项目创建失败：登录已过期，请重新登录后再确认创建。'
        : err.status === 403
          ? `项目创建失败：权限不足${detailReason ? `（${detailReason}）` : ''}。请联系管理员开通项目创建权限。`
          : `项目创建失败：${err.message || '请求失败'}`
      setMessages((prev) => [...prev, {
        id: `project-create-error-${Date.now()}`,
        role: 'assistant',
        text: errorText,
        error: true,
      }])
    } finally {
      setConfirmingActionId('')
    }
  }

  async function sendMessage(messageOverride) {
    const text = (typeof messageOverride === 'string' ? messageOverride : composer).trim()
    if ((!text && !selectedFile) || sending) return
    const fileSnapshot = selectedFile
      ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type }
      : null
    const userMessage = {
      id: `ai-user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: 'user',
      text: text || '请解析这个文件并启动工作流。',
      file: fileSnapshot,
    }
    const loadingId = `ai-loading-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const loadingMessage = {
      id: loadingId,
      role: 'assistant',
      text: selectedFile ? '正在解析文件并调用 AI 深度分析' : '正在理解你的问题',
      loading: true,
    }
    const baseOutboundMessages = messages
      .filter((message) => !message.loading && !message.error)
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.text,
        attachments: message.file ? [message.file] : [],
      }))

    setMessages((prev) => [...prev, userMessage, loadingMessage])
    setComposer('')
    removeSelectedFile()
    setDraftBeforeLogin(text)
    setSending(true)
    try {
      let outboundFile = fileSnapshot
      if (selectedFile) {
        const formData = new FormData()
        formData.append('file', selectedFile)
        setMessages((prev) => prev.map((message) => (
          message.id === loadingId ? { ...message, text: '正在提取文件结构' } : message
        )))
        const parsed = await apiClient.upload('/ai/parse-basic-info?allowLocalFallback=true', formData, { suppressUnauthorizedRedirect: true })
        const localAttachmentUnderstanding = buildAttachmentUnderstanding(selectedFile, parsed)
        outboundFile = {
          ...fileSnapshot,
          parsedSummary: summarizeHomeParsedFile(selectedFile, parsed),
        }
        userMessage.file = outboundFile
        setMessages((prev) => prev.map((message) => (
          message.id === userMessage.id ? { ...message, file: outboundFile } : message
        )))
        // Phase 1G: 只有明确报告生成请求才进入 Harness v1 流程
        if (isExplicitReportRequest(text || '')) {
          const workflowKey = activeWorkflowKey || activeSession?.workflowKey || 'parse_requirement_file'
        const session = activeSession || await createSession({
          title: text.slice(0, 40) || fileSnapshot?.name || 'AI 工作台会话',
          workflowKey,
          status: workflowKey === 'free_chat' ? 'temporary_chat' : 'rough_estimate',
        })
        setMessages((prev) => prev.map((message) => (
          message.id === loadingId ? { ...message, text: '正在沉淀 evidence 并调用大模型生成需求解析报告' } : message
        )))
        const createdRun = await createHarnessRun({
          title: fileSnapshot.name,
          mode: 'interactive',
          aiSessionId: session?.sessionId,
        })
        const run = createdRun?.run || createdRun
        const bound = await bindHarnessFile(run.harnessRunId, {
          attachmentId: `${Date.now()}-${fileSnapshot.name}`,
          fileName: fileSnapshot.name,
          fileSize: fileSnapshot.size,
          mimeType: fileSnapshot.type,
          role: 'requirement_source',
        })
        await submitHarnessParseResult(run.harnessRunId, {
          fileId: bound?.file?.harnessFileId,
          ...buildHarnessParseResult(selectedFile, parsed),
        })
        const reportDetail = await generateHarnessReportV1(run.harnessRunId, { force: false })
        const reportArtifact = pickArray(reportDetail?.artifacts).find((artifact) => artifact.artifactType === 'requirement_report_v1')
        const understandingArtifact = pickArray(reportDetail?.artifacts).find((artifact) => artifact.artifactType === 'file_understanding')
        if (reportArtifact) {
          reportArtifact.harnessRunId = run.harnessRunId
          reportArtifact.fileUnderstanding = mergeAttachmentUnderstanding(
            localAttachmentUnderstanding,
            pickObject(understandingArtifact?.content),
            pickObject(reportArtifact?.content),
          )
        }
        const assistantMessage = {
          id: `ai-harness-${Date.now()}`,
          role: 'assistant',
          text: '已生成《需求解析报告 v1》，请先补充关键缺失信息。',
          artifacts: reportArtifact ? [reportArtifact] : [],
          model: pickArray(reportDetail?.modelRuns).at(-1)?.model,
        }
        setMessages((prev) => prev.map((message) => (
          message.id === loadingId ? assistantMessage : message
        )))
        if (session) {
          const attachmentId = `harness-att-${Date.now()}`
          const artifactId = reportArtifact?.harnessArtifactId || reportArtifact?.artifactId || `harness-art-${Date.now()}`
          upsertSession({
            ...session,
            title: session.title || fileSnapshot.name,
            messages: [
              ...(Array.isArray(session.messages) ? session.messages : []),
              {
                messageId: `harness-user-${Date.now()}`,
                role: 'user',
                content: userMessage.text,
                attachmentIds: [attachmentId],
                createdAt: new Date().toISOString(),
              },
              {
                messageId: `harness-ai-${Date.now()}`,
                role: 'assistant',
                content: assistantMessage.text,
                artifactIds: reportArtifact ? [artifactId] : [],
                createdAt: new Date().toISOString(),
              },
            ],
            attachments: [
              ...(Array.isArray(session.attachments) ? session.attachments : []),
              {
                attachmentId,
                name: fileSnapshot.name,
                size: fileSnapshot.size,
                type: fileSnapshot.type,
                createdAt: new Date().toISOString(),
              },
            ],
            artifacts: reportArtifact
              ? [
                  ...(Array.isArray(session.artifacts) ? session.artifacts : []),
                  {
                    artifactId,
                    type: reportArtifact.artifactType || reportArtifact.type,
                    ...reportArtifact,
                  },
                ]
              : (Array.isArray(session.artifacts) ? session.artifacts : []),
            updatedAt: new Date().toISOString(),
          })
        }
        return
        }
      }
      const outboundMessages = [
        ...baseOutboundMessages,
        {
          role: 'user',
          content: userMessage.text,
          attachments: outboundFile ? [outboundFile] : [],
        },
      ]
      const workflowKey = activeWorkflowKey || activeSession?.workflowKey || 'free_chat'
      const session = activeSession || await createSession({
        title: text.slice(0, 40) || fileSnapshot?.name || 'AI 工作台会话',
        workflowKey,
        status: workflowKey === 'free_chat' ? 'temporary_chat' : 'rough_estimate',
      })
      const payload = await apiClient.post('/ai/home-workbench/chat', {
        sessionId: session?.sessionId,
        workflowKey,
        messages: outboundMessages,
      }, { suppressUnauthorizedRedirect: true })
      const data = unwrap(payload) || {}
      if (data.session) {
        upsertSession(data.session)
        let sessionMessages = withCurrentUserFile(mapSessionMessages(data.session), userMessage)
        sessionMessages = attachFormBlockToLatestAssistant(sessionMessages, data.formBlock)
        sessionMessages = attachKnowledgeToolToLatestAssistant(sessionMessages, data.trace?.knowledgeTool)
        // Phase 1G: 附加 suggestedActions 到最后一条助手消息
        if (data.suggestedActions?.length && sessionMessages.length) {
          const lastAssistantIndex = [...sessionMessages].reverse().findIndex((m) => m.role === 'assistant')
          if (lastAssistantIndex >= 0) {
            const idx = sessionMessages.length - 1 - lastAssistantIndex
            sessionMessages[idx] = { ...sessionMessages[idx], suggestedActions: data.suggestedActions, intent: data.intent }
          }
        }
        if (sessionMessages.length) {
          setMessages((prev) => {
            const mergedMessages = mergePreservedLocalFileMessages(prev, sessionMessages)
            return sameMessageList(prev, mergedMessages) ? prev : mergedMessages
          })
        }
      } else {
        setMessages((prev) => prev.map((message) => (
          message.id === loadingId
            ? {
                id: loadingId,
                role: 'assistant',
                text: stripFormBlockJson(data.answer || 'AI 已收到，但暂未返回有效内容。'),
                model: data.model,
                suggestedActions: data.suggestedActions || [],
                intent: data.intent,
                formBlock: normalizeClientFormBlock(data.formBlock),
                knowledgeTool: normalizeKnowledgeTool(data.trace?.knowledgeTool),
              }
            : message
        )))
      }
    } catch (err) {
      // RP-025: 从 API 响应 details 中提取真实错误原因
      const apiReason = err.details?.[0]?.reason || ''
      const errorText = err.status === 401
        ? '登录已过期，请重新登录后继续发送。你的草稿已保留在当前对话里。'
        : apiReason === 'kimi_rate_limited'
          ? 'AI 服务当前繁忙（接口限流），请稍后重试。'
          : apiReason === 'required_or_env_missing'
            ? 'AI 服务未配置 API 密钥，请联系管理员在系统管理中配置。'
            : `AI 对话暂未完成：${err.message || '请求失败'}`
      setMessages((prev) => prev.map((message) => (
        message.id === loadingId
          ? {
              id: loadingId,
              role: 'assistant',
              text: errorText,
              error: true,
              action: err.status === 401 ? 'login_required' : undefined,
            }
          : message
      )))
    } finally {
      setSending(false)
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return
    event.preventDefault()
    sendMessage()
  }

  function handleInteractiveOptionSelect(optionText) {
    if (!optionText || sending) return
    setComposer(optionText)
    sendMessage(optionText)
  }

  function handleInteractiveFormSubmit(messageText) {
    if (!messageText || sending) return
    setComposer(messageText)
    sendMessage(messageText)
  }

  async function copyDraft() {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    const draft = draftBeforeLogin || lastUserMessage?.text || ''
    if (draft) await navigator.clipboard?.writeText?.(draft)
  }

  function goLogin() {
    window.location.href = '/login'
  }

  return (
    <div className={`ai-home-workbench${workspacePanelCollapsed ? ' ai-home-workbench--inspector-collapsed' : ''}`} data-testid="ai-home-workbench" style={{ display: 'grid', gap: 12, height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <aside className="ai-home-rail" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        <section style={{ ...panel, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RoleBadge>{preset.label}</RoleBadge>
            <h2 style={{ margin: 0, fontSize: 14, lineHeight: 1.35, fontWeight: 700 }}>{preset.headline}</h2>
          </div>
          <p style={{ margin: '6px 0 0', color: 'var(--ink-3)', fontSize: 11.5, lineHeight: 1.6 }}>{preset.emptyHint}</p>
        </section>

        <SessionRail
          sessions={sessions}
          activeSessionId={activeSession?.sessionId}
          onSelect={selectSession}
          onNew={startNewSession}
          onDelete={requestDeleteSession}
        />

        <section style={{ ...panel, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 800, color: 'var(--ink-2)', flexShrink: 0 }}>工作流模板</div>
          <div className="ai-workflow-list" style={{ padding: 8, display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto', minHeight: 0 }}>
            {preset.workflows.map((workflow) => {
              const isActive = activeWorkflowKey === workflow.key
              return (
                <button
                  key={workflow.key}
                  type="button"
                  onClick={() => startWorkflow(workflow)}
                  title={`${workflow.title}：${workflow.desc}`}
                  aria-pressed={isActive}
                  aria-label={isActive ? `${workflow.title}（当前任务）` : workflow.title}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                    borderRadius: 8,
                    background: isActive ? 'var(--accent-soft)' : '#fff',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    position: 'relative',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {isActive && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }} aria-hidden>●</span>}
                    <b style={{ display: 'block', fontSize: 12, color: 'var(--ink)' }}>{workflow.title}</b>
                  </span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>{workflow.desc}</span>
                </button>
              )
            })}
          </div>
        </section>
      </aside>

      <section style={{ ...panel, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ minHeight: 44, padding: '8px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <RoleBadge>AI 工作台</RoleBadge>
          <CopySessionIdButton sessionId={activeSession?.sessionId} />
          {loadingSessions && <span className="tag" style={{ marginLeft: 'auto' }}>加载会话</span>}
          {sessionsError && (
            <div role="alert" style={{ marginLeft: 'auto', color: 'var(--err)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{sessionsError}</span>
              <button type="button" className="btn btn-out" style={{ height: 28 }} onClick={clearSessionsError}>关闭</button>
            </div>
          )}
        </div>

        <div ref={messagePaneRef} data-testid="ai-home-message-pane" style={{ flex: 1, minHeight: 0, padding: 18, overflowY: 'auto', background: 'linear-gradient(180deg,#fff,var(--bg-soft))' }}>
          {!messages.length && (
            <div style={{ border: '1px dashed var(--line)', borderRadius: 12, padding: 28, background: '#fff' }}>
              {activeWorkflow && <RoleBadge>当前工作流：{activeWorkflow.title}</RoleBadge>}
              <h2 style={{ margin: activeWorkflow ? '12px 0 8px' : '0 0 8px', fontSize: 22 }}>{centerTitle}</h2>
              <p style={{ margin: '0 0 16px', color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.8 }}>{centerHint}</p>
              {activeWorkflow && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                  {outputState.outputs.map((item) => <span key={item} className="tag brd">{item}</span>)}
                </div>
              )}
              <button className="btn btn-pri" type="button" onClick={chooseFile}>选择文件</button>
            </div>
          )}

          <div style={{ display: 'grid', gap: 14 }}>
            {messages.map((message, index) => {
              const isUser = message.role === 'user'
              const hasArtifacts = !isUser && !message.error && pickArray(message.artifacts).length > 0
              return (
                <article key={message.id || `${message.role}-${index}`} style={{ display: 'flex', gap: 10, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  {!isUser && <div style={{ width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,var(--brand),var(--accent))', color: '#fff', fontWeight: 800 }}>AI</div>}
                  <div className="ai-bubble-wrap" style={{ width: hasArtifacts ? 'min(100%, 1080px)' : undefined, maxWidth: hasArtifacts ? 'calc(100% - 44px)' : '76%', padding: 14, borderRadius: 12, border: message.error ? '1px solid color-mix(in oklab, var(--err) 28%, var(--line))' : '1px solid var(--line)', background: isUser ? 'var(--brand)' : message.error ? '#fff7f7' : '#fff', color: isUser ? '#fff' : message.error ? 'var(--err)' : 'var(--ink)', boxShadow: 'var(--shadow-1)', position: 'relative' }}>
                    {!isUser && !message.loading && !message.error && message.text && (
                      <CopyMessageButton text={message.text} />
                    )}
                    {message.loading ? (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.7 }}>{message.text}</div>
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 12 }}>
                          <LoadingDots />
                          <span>正在调用模型并组织回复</span>
                        </div>
                      </div>
                    ) : (
                      isUser || message.error
                        ? <div style={{ fontSize: 13, lineHeight: 1.7 }}>{message.text}</div>
                        : <RichAiMessage text={message.text} optionDisabled={sending} onOptionSelect={handleInteractiveOptionSelect} />
                    )}
                    {!isUser && !message.error && message.knowledgeTool && (
                      <KnowledgeTraceChip knowledgeTool={message.knowledgeTool} />
                    )}
                    {!isUser && !message.error && message.formBlock && (
                      <InteractiveFormCard
                        formBlock={message.formBlock}
                        disabled={sending}
                        onSubmit={handleInteractiveFormSubmit}
                      />
                    )}
                    {!isUser && !message.error && pickArray(message.artifacts).map((artifact) => (
                      <RequirementAnalysisReportCard
                        key={artifact.harnessArtifactId || artifact.artifactId || artifact.title}
                        artifact={artifact}
                        onAction={handleHarnessAction}
                        onSubmitSupplement={handleStructuredSupplement}
                        confirmingActionId={confirmingActionId}
                      />
                    ))}
                    {!isUser && !message.error && pickArray(message.suggestedActions).length > 0 && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        {message.suggestedActions.map((action) => {
                          const actionKey = action.id || action.actionId || action.actionType
                          const isConfirmingSuggestedAction = confirmingActionId === actionKey
                          return (
                            <button
                              key={actionKey}
                              className="btn btn-out"
                              type="button"
                              disabled={action.disabled || isConfirmingSuggestedAction}
                              onClick={() => {
                                if (action.actionType === 'company_lookup') {
                                  openWorkbenchCompanyLookup(action.payload?.customerName)
                                } else if (action.actionType === 'generate_requirement_report') {
                                  setComposer('请基于当前附件生成需求解析报告')
                                } else if (action.actionType === 'submit_structured_answers') {
                                  setComposer('请生成补充后的需求解析报告 v2')
                                } else if (action.actionType === 'open_project_list') {
                                  setComposer('我之前创建过哪些项目？')
                                } else if (action.actionType === 'create_project_evaluation') {
                                  confirmPendingAction({
                                    actionType: 'create_project_evaluation',
                                    actionId: actionKey,
                                    payload: action.payload || {},
                                  })
                                } else if (action.actionType === 'send_message') {
                                  setComposer(action.label)
                                }
                              }}
                              style={{ height: 30 }}
                            >
                              {isConfirmingSuggestedAction ? '执行中…' : action.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {!isUser && !message.error && message.actions && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        {message.actions.map((action) => (
                          <Link
                            key={action.label}
                            className={action.primary ? 'btn btn-pri' : 'btn btn-out'}
                            style={{ height: 30 }}
                            to={action.to}
                          >
                            {action.label}
                          </Link>
                        ))}
                      </div>
                    )}
                    {message.file && <div style={{ marginTop: 10 }}><AttachmentCard file={message.file} state="sent" compact inverted={isUser} /></div>}
                    {message.action === 'login_required' && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        <button className="btn btn-pri" type="button" onClick={goLogin} style={{ height: 30 }}>重新登录</button>
                        <button className="btn btn-out" type="button" onClick={copyDraft} style={{ height: 30 }}>复制草稿</button>
                      </div>
                    )}
                  </div>
                  {isUser && <div style={{ width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--brand-soft)', color: 'var(--brand-ink)', fontWeight: 800 }}>我</div>}
                </article>
              )
            })}
          </div>
        </div>

        <div style={{ padding: 14, borderTop: '1px solid var(--line)', background: '#fff' }}>
          <div style={{ display: 'grid', gap: 8, border: '1px solid var(--line)', borderRadius: 12, padding: 8 }}>
            {selectedFile && <AttachmentCard file={selectedFile} onRemove={removeSelectedFile} />}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, minHeight: 54 }}>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.pdf,.docx,.txt" style={{ display: 'none' }} onChange={(event) => attachFile(event.target.files?.[0] || null)} />
              <button className="btn btn-out" type="button" onClick={chooseFile} aria-label={selectedFile ? '替换附件' : '附加文件'} title={selectedFile ? '替换附件' : '附加文件'} style={{ height: 36, minWidth: 40 }}>＋</button>
              <textarea
                rows="3"
                aria-label="AI 工作台输入"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={preset.placeholder}
                style={{ flex: 1, border: 0, outline: 'none', resize: 'vertical', minHeight: 54, maxHeight: 180, padding: '8px 4px', fontFamily: 'inherit', fontSize: 13, lineHeight: '18px', overflowY: 'auto' }}
              />
              <button className="btn btn-pri" type="button" onClick={sendMessage} disabled={sending} aria-label="发送消息" title="发送消息" style={{ height: 36, minWidth: 44 }}>{sending ? '…' : '➤'}</button>
            </div>
          </div>
        </div>
      </section>

      <aside className="ai-home-inspector" role="complementary" aria-label="AI 工作区" aria-expanded={!workspacePanelCollapsed}>
        <div className="ai-home-inspector__bar">
          {!workspacePanelCollapsed && <b>工作区</b>}
          <button
            className="ai-home-inspector__toggle"
            type="button"
            aria-label={workspacePanelCollapsed ? '展开工作区' : '折叠工作区'}
            title={workspacePanelCollapsed ? '展开工作区' : '折叠工作区'}
            onClick={() => setWorkspacePanelCollapsed((value) => !value)}
          >
            <span aria-hidden="true">{workspacePanelCollapsed ? '<' : '>'}</span>
          </button>
        </div>
        {!workspacePanelCollapsed && (
          <>
            <ArtifactPanel session={activeSession} onConfirmAction={confirmPendingAction} confirmingActionId={confirmingActionId} />
            <ResultCard title={outputState.title}>
              {messages.length ? '当前对话已生成初步工作流结果，可继续补充问题或进入下游页面。' : outputState.empty}
              <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                {outputState.outputs.map((item) => <span key={item} className="tag">{item}</span>)}
              </div>
            </ResultCard>
            <ResultCard title={selectedFile ? '当前文件' : '快捷入口'}>
              {selectedFile ? (
                <>
                  <AttachmentCard file={selectedFile} compact />
                  <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                    <Link className="btn btn-out" to="/requirements" style={{ fontSize: 12 }}>需求列表</Link>
                    <Link className="btn btn-out" to="/assessments" style={{ fontSize: 12 }}>实施评估</Link>
                    {preset.key === 'admin' && <Link className="btn btn-out" to="/users" style={{ fontSize: 12 }}>用户管理</Link>}
                  </div>
                </>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  <Link className="btn btn-out" to="/requirements">需求列表</Link>
                  <Link className="btn btn-out" to="/assessments">实施评估</Link>
                  {preset.key === 'admin' && <Link className="btn btn-out" to="/users">用户管理</Link>}
                </div>
              )}
            </ResultCard>
          </>
        )}
      </aside>
      {deleteTargetSession && (
        <ConfirmDialog
          title="删除会话"
          message="确定要彻底删除这个 AI 会话吗？"
          detail={deleteTargetSession.title || '未命名会话'}
          error={deleteSessionError}
          confirmLabel="确认删除"
          confirming={deletingSessionId === deleteTargetSession.sessionId}
          onCancel={() => {
            if (deletingSessionId) return
            setDeleteSessionError('')
            setDeleteTargetSession(null)
          }}
          onConfirm={confirmDeleteSession}
        />
      )}
      <CompanyLookupDialog
        open={workbenchCompanyLookupOpen}
        loading={workbenchCompanyLookupLoading}
        candidates={workbenchCompanyCandidates}
        error={workbenchCompanyLookupError}
        onClose={() => {
          setWorkbenchCompanyLookupOpen(false)
          setWorkbenchCompanyCandidates([])
          setWorkbenchCompanyLookupError('')
        }}
        onSelect={handleWorkbenchCompanySelect}
      />
    </div>
  )
}
