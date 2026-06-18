import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-strong-${index}`}>{part.slice(2, -2)}</strong>
    }
    return <React.Fragment key={`${keyPrefix}-text-${index}`}>{part}</React.Fragment>
  })
}

function parseMarkdownBlocks(text) {
  const blocks = []
  const paragraphLines = []
  let currentList = null

  function flushParagraph() {
    const paragraph = paragraphLines.join(' ').trim()
    if (paragraph) blocks.push({ type: 'paragraph', text: paragraph })
    paragraphLines.length = 0
  }

  function flushList() {
    if (currentList?.items.length) blocks.push(currentList)
    currentList = null
  }

  text.replace(/\r\n/g, '\n').split('\n').forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      return
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/)
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/)
    const listType = orderedMatch ? 'orderedList' : unorderedMatch ? 'unorderedList' : null

    if (listType) {
      flushParagraph()
      if (!currentList || currentList.type !== listType) {
        flushList()
        currentList = { type: listType, items: [] }
      }
      currentList.items.push(orderedMatch?.[1] || unorderedMatch?.[1])
      return
    }

    flushList()
    paragraphLines.push(line)
  })

  flushParagraph()
  flushList()
  return blocks.length ? blocks : [{ type: 'paragraph', text }]
}

function RichAiMessage({ text }) {
  return (
    <div className="ai-message-rich">
      {parseMarkdownBlocks(text).map((block, blockIndex) => {
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

        return (
          <p key={`paragraph-${blockIndex}`}>
            {renderInlineMarkdown(block.text, `paragraph-${blockIndex}`)}
          </p>
        )
      })}
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

function RequirementAnalysisReportCard({ artifact, onAction, confirmingActionId = '' }) {
  const content = pickObject(artifact?.content)
  const isLegacyReport = artifact?.type === 'requirement_analysis_report'
  const isV2HarnessReport = artifact?.artifactType === 'requirement_report_v2' || artifact?.type === 'requirement_report_v2'
  const isHarnessReport = isV2HarnessReport || artifact?.artifactType === 'requirement_report_v1' || artifact?.type === 'requirement_report_v1'
  if (!artifact || (!isLegacyReport && !isHarnessReport)) return null
  const title = artifact.title || (isV2HarnessReport ? '需求解析报告 v2' : '需求解析报告')
  const project = pickObject(content.project)
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
  const answeredQuestions = isHarnessReport
    ? pickArray(content.answeredQuestions).map((item) => {
      const row = pickObject(item)
      return [row.question, row.answer].filter(Boolean).join('：')
    })
    : []
  return (
    <section style={{
      marginTop: 12,
      border: '1px solid var(--line)',
      borderRadius: 10,
      background: '#fff',
      overflow: 'hidden',
      color: 'var(--ink)',
    }}>
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
            <b style={{ display: 'block', marginTop: 4, fontSize: 12.5 }}>{project.projectName || content.projectName || '待补充'}</b>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-soft)' }}>
            <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>客户</span>
            <b style={{ display: 'block', marginTop: 4, fontSize: 12.5 }}>{project.customerName || content.customerName || '待补充'}</b>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, background: 'var(--bg-soft)' }}>
            <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11 }}>行业</span>
            <b style={{ display: 'block', marginTop: 4, fontSize: 12.5 }}>{project.industry || content.industry || '待补充'}</b>
          </div>
        </div>
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
          <ReportList title="缺失/模糊信息" items={missingItems} />
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
      </div>
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
      return {
        id: message.messageId || `${session.sessionId}-${index}`,
        role: message.role,
        text: message.content || '',
        file: file ? { name: file.name, size: file.size, type: file.type } : undefined,
        artifacts,
      }
    })
    .filter((message) => message.text)
}

function sameMessageList(left, right) {
  if (left.length !== right.length) return false
  return left.every((message, index) => (
    message.role === right[index]?.role &&
    message.text === right[index]?.text &&
    message.file?.name === right[index]?.file?.name &&
    message.file?.size === right[index]?.file?.size &&
    message.file?.type === right[index]?.file?.type &&
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
  const fileInputRef = useRef(null)
  const activeWorkflow = workflowsByKey.get(activeWorkflowKey)
  const centerTitle = activeWorkflow?.title || preset.headline
  const centerHint = activeWorkflow?.desc || preset.emptyHint
  const outputState = getWorkflowOutputs(activeWorkflow)

  useEffect(() => {
    loadSessions().catch(() => {})
  }, [loadSessions])

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
      const successText = project.projectId || assessmentDraft.recordId
        ? [
            `已生成项目评估草稿：${project.projectName || project.projectId || '未命名项目'}`,
            assessmentDraft.versionCode ? `实施评估草稿：${assessmentDraft.versionCode}` : '',
            '请在传统工作台中人工确认/编辑后再进入正式评估。',
          ].filter(Boolean).join('\n')
        : `已确认「${action.label || action.actionType}」，Harness Run 阶段已推进。`
      setMessages((prev) => [...prev, {
        id: `ai-harness-action-${Date.now()}`,
        role: 'assistant',
        text: successText,
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
      if (!project || !activeSession) return
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
    } finally {
      setConfirmingActionId('')
    }
  }

  async function sendMessage() {
    const text = composer.trim()
    if ((!text && !selectedFile) || sending) return
    const fileSnapshot = selectedFile
      ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type }
      : null
    const userMessage = { role: 'user', text: text || '请解析这个文件并启动工作流。', file: fileSnapshot }
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
    const harnessV1Context = !selectedFile && text ? findLatestHarnessV1Artifact(messages) : null

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
          message.id === loadingId ? { ...message, text: '正在提取文件结构并创建 Harness 运行' } : message
        )))
        const parsed = await apiClient.upload('/ai/parse-basic-info?allowLocalFallback=true', formData, { suppressUnauthorizedRedirect: true })
        outboundFile = {
          ...fileSnapshot,
          parsedSummary: summarizeHomeParsedFile(selectedFile, parsed),
        }
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
        if (reportArtifact) reportArtifact.harnessRunId = run.harnessRunId
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
      if (harnessV1Context) {
        const runId = harnessV1Context.artifact.harnessRunId
        setMessages((prev) => prev.map((message) => (
          message.id === loadingId ? { ...message, text: '正在保存补充信息并生成需求解析报告 v2' } : message
        )))
        await submitHarnessAnswers(runId, {
          answers: [{ field: 'user_chat_supplement', value: text, source: 'user_chat' }],
        })
        const reportDetail = await generateHarnessReportV2(runId, { force: false })
        const v2Artifact = pickArray(reportDetail?.artifacts).find((artifact) => artifact.artifactType === 'requirement_report_v2')
        if (v2Artifact) v2Artifact.harnessRunId = runId
        const assistantMessage = {
          id: `ai-harness-v2-${Date.now()}`,
          role: 'assistant',
          text: '已生成《需求解析报告 v2》，可点击下方动作继续推进。',
          artifacts: v2Artifact ? [v2Artifact] : [],
          model: pickArray(reportDetail?.modelRuns).at(-1)?.model,
        }
        setMessages((prev) => prev.map((message) => (
          message.id === loadingId ? assistantMessage : message
        )))
        if (activeSession) {
          const artifactId = v2Artifact?.harnessArtifactId || v2Artifact?.artifactId || `harness-art-v2-${Date.now()}`
          upsertSession({
            ...activeSession,
            messages: [
              ...(Array.isArray(activeSession.messages) ? activeSession.messages : []),
              {
                messageId: `harness-user-v2-${Date.now()}`,
                role: 'user',
                content: userMessage.text,
                createdAt: new Date().toISOString(),
              },
              {
                messageId: `harness-ai-v2-${Date.now()}`,
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
        return
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
        const sessionMessages = withCurrentUserFile(mapSessionMessages(data.session), userMessage)
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
                text: data.answer || 'AI 已收到，但暂未返回有效内容。',
                model: data.model,
              }
            : message
        )))
      }
    } catch (err) {
      setMessages((prev) => prev.map((message) => (
        message.id === loadingId
          ? {
              id: loadingId,
              role: 'assistant',
              text: err.status === 401
                ? '登录已过期，请重新登录后继续发送。你的草稿已保留在当前对话里。'
                : `AI 对话暂未完成：${err.message || '请求失败'}`,
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

  async function copyDraft() {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    const draft = draftBeforeLogin || lastUserMessage?.text || ''
    if (draft) await navigator.clipboard?.writeText?.(draft)
  }

  function goLogin() {
    window.location.href = '/login'
  }

  return (
    <div className="ai-home-workbench" data-testid="ai-home-workbench" style={{ display: 'grid', gap: 16, height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <aside className="ai-home-rail" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        <section style={{ ...panel, padding: 16 }}>
          <RoleBadge>{preset.label}</RoleBadge>
          <h2 style={{ margin: '12px 0 8px', fontSize: 18, lineHeight: 1.35 }}>{preset.headline}</h2>
          <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.7 }}>{preset.emptyHint}</p>
        </section>

        <SessionRail
          sessions={sessions}
          activeSessionId={activeSession?.sessionId}
          onSelect={selectSession}
          onNew={startNewSession}
          onDelete={requestDeleteSession}
        />

        <section style={{ ...panel, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', fontSize: 13, fontWeight: 800 }}>推荐工作流</div>
          <div style={{ padding: 10, display: 'grid', gap: 8 }}>
            {preset.workflows.map((workflow) => (
              <button
                key={workflow.key}
                type="button"
                onClick={() => startWorkflow(workflow)}
                aria-pressed={activeWorkflowKey === workflow.key}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: activeWorkflowKey === workflow.key ? '1px solid var(--accent)' : '1px solid var(--line)',
                  borderRadius: 8,
                  background: activeWorkflowKey === workflow.key ? 'var(--accent-soft)' : '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <b style={{ display: 'block', fontSize: 12.5, color: 'var(--ink)' }}>{workflow.title}</b>
                <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{workflow.desc}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section style={{ ...panel, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ minHeight: 48, padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <RoleBadge>AI 工作台</RoleBadge>
          <span style={{ color: 'var(--ink-3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preset.systemPrompt}</span>
          {loadingSessions && <span className="tag" style={{ marginLeft: 'auto' }}>加载会话</span>}
        </div>

        <div data-testid="ai-home-message-pane" style={{ flex: 1, minHeight: 0, padding: 18, overflowY: 'auto', background: 'linear-gradient(180deg,#fff,var(--bg-soft))' }}>
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
              return (
                <article key={message.id || `${message.role}-${index}`} style={{ display: 'flex', gap: 10, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  {!isUser && <div style={{ width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,var(--brand),var(--accent))', color: '#fff', fontWeight: 800 }}>AI</div>}
                  <div style={{ maxWidth: '76%', padding: 14, borderRadius: 12, border: message.error ? '1px solid color-mix(in oklab, var(--err) 28%, var(--line))' : '1px solid var(--line)', background: isUser ? 'var(--brand)' : message.error ? '#fff7f7' : '#fff', color: isUser ? '#fff' : message.error ? 'var(--err)' : 'var(--ink)', boxShadow: 'var(--shadow-1)' }}>
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
                        : <RichAiMessage text={message.text} />
                    )}
                    {!isUser && !message.error && pickArray(message.artifacts).map((artifact) => (
                      <RequirementAnalysisReportCard
                        key={artifact.artifactId || artifact.title}
                        artifact={artifact}
                        onAction={handleHarnessAction}
                        confirmingActionId={confirmingActionId}
                      />
                    ))}
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
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.pdf,.docx,.txt" style={{ display: 'none' }} onChange={(event) => attachFile(event.target.files?.[0] || null)} />
              <button className="btn btn-out" type="button" onClick={chooseFile} aria-label={selectedFile ? '替换附件' : '附加文件'} title={selectedFile ? '替换附件' : '附加文件'} style={{ height: 36, minWidth: 40 }}>＋</button>
              <textarea
                rows="1"
                aria-label="AI 工作台输入"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={preset.placeholder}
                style={{ flex: 1, border: 0, outline: 'none', resize: 'vertical', height: 54, minHeight: 38, maxHeight: 120, padding: '8px 4px', fontFamily: 'inherit', fontSize: 13, lineHeight: '18px', overflowY: 'auto' }}
              />
              <button className="btn btn-pri" type="button" onClick={sendMessage} disabled={sending} aria-label="发送消息" title="发送消息" style={{ height: 36, minWidth: 44 }}>{sending ? '…' : '➤'}</button>
            </div>
          </div>
        </div>
      </section>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        <ArtifactPanel session={activeSession} onConfirmAction={confirmPendingAction} confirmingActionId={confirmingActionId} />
        <ResultCard title={outputState.title}>
          {messages.length ? '当前对话已生成初步工作流结果，可继续补充问题或进入下游页面。' : outputState.empty}
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            {outputState.outputs.map((item) => <span key={item} className="tag">{item}</span>)}
          </div>
        </ResultCard>
        <ResultCard title="当前文件">
          {selectedFile ? <AttachmentCard file={selectedFile} compact /> : '尚未上传文件'}
        </ResultCard>
        <ResultCard title="快捷入口">
          <div style={{ display: 'grid', gap: 8 }}>
            <Link className="btn btn-out" to="/requirements">需求列表</Link>
            <Link className="btn btn-out" to="/assessments">实施评估</Link>
            {preset.key === 'admin' && <Link className="btn btn-out" to="/users">用户管理</Link>}
          </div>
        </ResultCard>
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
    </div>
  )
}
