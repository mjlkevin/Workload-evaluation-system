import { fileKind, pickArray, pickObject } from '../../utils/harnessPayload.js'
import { mergeAttachmentUnderstanding } from '../../utils/reportParser.js'
import { ReportPill } from './ReportBits.jsx'

/**
 * 附件理解摘要：文件结构解析与业务线索概览。
 */
export default function EvidenceViewer({ understanding, reportContent }) {
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
