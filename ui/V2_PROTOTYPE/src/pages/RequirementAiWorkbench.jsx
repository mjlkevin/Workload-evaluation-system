import React, { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import useRequirementAiWorkbench from '../hooks/useRequirementAiWorkbench.js'

const STYLE = `
.aiw-page{height:calc(100vh - var(--workspace-tabs-height,36px));min-height:720px;display:grid;grid-template-rows:72px minmax(0,1fr);background:var(--bg);overflow:hidden}
.aiw-top{background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;padding:0 24px}
.aiw-crumb{font-size:12px;color:var(--ink-3)}
.aiw-top h1{margin:3px 0 0;font-size:20px;line-height:1.15;font-weight:850}
.aiw-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.aiw-grid{min-height:0;display:grid;grid-template-columns:260px minmax(0,1fr) 340px}
.aiw-left,.aiw-right{min-height:0;overflow:auto;background:#fff}
.aiw-left{border-right:1px solid var(--line)}
.aiw-right{border-left:1px solid var(--line)}
.aiw-panel-title{height:46px;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid var(--line);font-weight:800;font-size:13px}
.aiw-panel-body{padding:14px 16px;display:grid;gap:12px}
.aiw-file{border:1px solid var(--line);border-radius:10px;background:var(--bg-soft);padding:12px}
.aiw-file .name{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13px}
.aiw-file .meta{margin-top:6px;font-size:11px;color:var(--ink-3);line-height:1.55}
.aiw-sheet,.aiw-topic,.aiw-accepted{border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px}
.aiw-sheet b,.aiw-topic b,.aiw-accepted b{font-size:12.5px}
.aiw-sheet p,.aiw-topic span,.aiw-accepted p{margin:4px 0 0;font-size:11.5px;color:var(--ink-3);line-height:1.5}
.aiw-topic.on{border-color:color-mix(in oklab,var(--brand) 42%, var(--line));background:var(--brand-soft)}
.aiw-chat{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:linear-gradient(180deg,#fff 0%,var(--bg) 100%)}
.aiw-chat-head{height:46px;display:flex;align-items:center;gap:10px;padding:0 18px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.88);backdrop-filter:saturate(140%) blur(10px)}
.aiw-chat-head .hint{margin-left:auto;font-size:12px;color:var(--ink-3)}
.aiw-scroll{min-height:0;overflow:auto;padding:20px 24px 22px;display:flex;flex-direction:column;gap:16px}
.aiw-msg{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;max-width:1000px;width:100%}
.aiw-msg.user{align-self:flex-end;grid-template-columns:minmax(0,1fr) 34px;max-width:820px}
.aiw-avatar{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-weight:850;color:#fff;background:linear-gradient(135deg,var(--brand),var(--accent));font-size:12px}
.aiw-msg.user .aiw-avatar{grid-column:2;background:linear-gradient(135deg,#344054,#111827)}
.aiw-bubble{border:1px solid var(--line);background:#fff;border-radius:12px;box-shadow:var(--shadow-1);overflow:hidden}
.aiw-msg.user .aiw-bubble{grid-column:1;background:var(--brand);color:#fff;border-color:transparent}
.aiw-pad{padding:13px 15px}
.aiw-text{font-size:13px;line-height:1.7}
.aiw-attach{margin-top:10px;border:1px solid rgba(255,255,255,.35);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.12)}
.aiw-doc{width:32px;height:32px;border-radius:7px;background:#fff;color:var(--brand);display:grid;place-items:center;font-weight:850}
.aiw-ai-title{display:flex;align-items:center;gap:8px;font-weight:850;font-size:13.5px;margin-bottom:8px}
.aiw-parse{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}
.aiw-tile{border:1px solid var(--line);border-radius:8px;background:var(--bg-soft);padding:10px}
.aiw-tile .num{font-size:20px;font-weight:850;line-height:1}.aiw-tile .lb{margin-top:5px;font-size:11px;color:var(--ink-3);font-family:var(--font-mono)}
.aiw-result{border-top:1px solid var(--line)}
.aiw-preview{border-top:1px solid var(--line);padding:12px 15px 15px;display:grid;gap:10px;background:#fff}
.aiw-preview-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:850;font-size:13.5px}
.aiw-preview-table{width:100%;border-collapse:collapse;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}
.aiw-preview-table th,.aiw-preview-table td{border-bottom:1px solid var(--line);padding:8px 9px;font-size:12px;text-align:left;vertical-align:top}
.aiw-preview-table th{background:var(--bg-soft);color:var(--ink-3);font-family:var(--font-mono);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}
.aiw-preview-table .num{text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.aiw-preview-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.aiw-preview-box{border:1px solid var(--line);border-radius:8px;background:var(--bg-soft);padding:10px}
.aiw-preview-box b{font-size:12px}.aiw-preview-box ul{margin:6px 0 0;padding-left:18px;color:var(--ink-2);font-size:12px;line-height:1.6}
.aiw-result-head{padding:14px 15px;background:linear-gradient(135deg,#fff,var(--bg-soft));display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;border-bottom:1px solid var(--line)}
.aiw-result-head h3{margin:0;font-size:15px}.aiw-result-head p{margin:7px 0 0;font-size:13px;color:var(--ink-2);line-height:1.65}
.aiw-scores{display:grid;grid-template-columns:repeat(2,72px);gap:8px;align-content:start}
.aiw-score{border:1px solid var(--line);border-radius:8px;background:#fff;padding:7px 8px;text-align:center}.aiw-score .v{font-size:17px;font-weight:850}.aiw-score .k{font-size:10px;color:var(--ink-3);font-family:var(--font-mono)}
.aiw-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:12px 15px}
.aiw-field{border:1px solid var(--line);border-radius:8px;background:#fff;min-height:96px;overflow:hidden}.aiw-field:hover{border-color:color-mix(in oklab,var(--brand) 45%, var(--line));box-shadow:0 0 0 2px color-mix(in oklab,var(--brand-soft) 70%, transparent)}
.aiw-field .k{padding:8px 10px;border-bottom:1px solid var(--line);font-size:10.5px;color:var(--ink-3);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.06em;background:var(--bg-soft)}
.aiw-field .v{padding:9px 10px;font-size:12.5px;line-height:1.62;color:var(--ink-2)}
.aiw-field-actions{display:flex;gap:5px;flex-wrap:wrap;padding:0 10px 10px}
.aiw-mini{height:24px;border-radius:6px;border:1px solid var(--line);background:#fff;color:var(--ink-2);font-size:11px;font-weight:700;padding:0 8px;cursor:pointer;font-family:inherit}
.aiw-mini:hover,.aiw-mini.on{border-color:var(--brand);color:var(--brand);background:var(--brand-soft)}.aiw-mini.pri{background:var(--brand);border-color:var(--brand);color:#fff}.aiw-mini.warn{border-color:color-mix(in oklab,var(--warn) 45%, var(--line));color:var(--warn-ink);background:var(--warn-soft)}
.aiw-foot{padding:10px 15px;border-top:1px solid var(--line);display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--bg-soft)}
.aiw-source{margin-left:auto;color:var(--ink-3);font-size:11px;font-family:var(--font-mono)}
.aiw-feedback{margin:0 15px 14px;border:1px solid color-mix(in oklab,var(--brand) 34%, var(--line));border-radius:10px;background:color-mix(in oklab,var(--brand-soft) 50%, #fff);overflow:hidden}
.aiw-feedback-hd{padding:9px 11px;border-bottom:1px solid var(--line);font-size:12px;font-weight:850}.aiw-feedback-bd{padding:10px 11px;display:grid;gap:8px;font-size:12.5px;line-height:1.65}.aiw-feedback-bd div{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#fff}
.aiw-composer{padding:12px 18px;border-top:1px solid var(--line);background:#fff;display:grid;gap:8px}
.aiw-quick-row{display:flex;gap:8px;flex-wrap:wrap}.aiw-quick{height:26px;border:1px solid var(--line);border-radius:999px;background:var(--bg-soft);padding:0 10px;font-size:11.5px;color:var(--ink-2);font-weight:700}
.aiw-compose-box{border:1px solid var(--line-2);border-radius:12px;background:#fff;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:end;gap:10px;padding:10px;box-shadow:var(--shadow-1)}
.aiw-attach-btn,.aiw-send{width:36px;height:36px;border-radius:9px;border:1px solid var(--line);background:var(--bg-soft);font-weight:850;cursor:pointer}.aiw-send{background:var(--brand);border-color:var(--brand);color:#fff}
.aiw-compose-box textarea{border:0;outline:0;resize:none;min-height:38px;max-height:110px;font:inherit;font-size:13px;line-height:1.6;color:var(--ink)}
.aiw-card{border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden}.aiw-card h3{margin:0;padding:12px 14px;border-bottom:1px solid var(--line);font-size:13px}.aiw-card .bd{padding:12px 14px;display:grid;gap:10px}
.aiw-accepted .top{display:flex;align-items:center;gap:8px;justify-content:space-between}.aiw-question{border-left:3px solid var(--warn);background:var(--warn-soft);border-radius:8px;padding:9px 10px;font-size:12px;line-height:1.55}
.aiw-trace{display:grid;grid-template-columns:64px minmax(0,1fr);gap:8px;font-size:12px;border-bottom:1px dashed var(--line);padding-bottom:8px}.aiw-trace:last-child{border-bottom:0;padding-bottom:0}.aiw-trace .k{color:var(--ink-3);font-family:var(--font-mono)}
.aiw-empty{border:1px dashed var(--line-2);border-radius:12px;background:#fff;padding:22px;display:grid;gap:12px;place-items:start;box-shadow:var(--shadow-1)}
.aiw-empty h2{margin:0;font-size:18px}.aiw-empty p{margin:0;color:var(--ink-2);font-size:13px;line-height:1.7;max-width:620px}
.aiw-empty-actions{display:flex;gap:8px;flex-wrap:wrap}
.aiw-muted{color:var(--ink-3);font-size:12px;line-height:1.55}
.aiw-module-list{border-top:1px solid var(--line);padding:12px 15px 15px;display:grid;gap:10px;background:#fff}
.aiw-module-card{border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden}
.aiw-module-card .hd{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:12px 13px;border-bottom:1px solid var(--line);background:var(--bg-soft)}
.aiw-module-card h3{margin:0;font-size:14px}.aiw-module-card p{margin:6px 0 0;font-size:12.5px;line-height:1.65;color:var(--ink-2)}
.aiw-module-days{display:grid;grid-template-columns:repeat(2,62px);gap:8px}.aiw-module-days div{border:1px solid var(--line);border-radius:8px;background:#fff;text-align:center;padding:6px}.aiw-module-days b{display:block;font-size:15px}.aiw-module-days span{display:block;font-size:10px;color:var(--ink-3);font-family:var(--font-mono)}
.aiw-module-meta{display:flex;gap:8px;flex-wrap:wrap;padding:10px 13px;border-bottom:1px solid var(--line)}
.aiw-module-actions{display:flex;gap:6px;flex-wrap:wrap;padding:10px 13px;background:#fff}
.aiw-toast{position:fixed;right:24px;bottom:24px;background:#111827;color:#fff;border-radius:10px;padding:10px 14px;font-size:12.5px;box-shadow:var(--shadow-3);opacity:0;transform:translateY(8px);transition:.18s;z-index:80}.aiw-toast.show{opacity:1;transform:translateY(0)}
@media (max-width:1260px){.aiw-grid{grid-template-columns:220px minmax(0,1fr)}.aiw-right{display:none}.aiw-parse{grid-template-columns:repeat(2,minmax(0,1fr))}.aiw-fields{grid-template-columns:1fr}}
@media (max-width:900px){.aiw-page{height:auto;overflow:visible}.aiw-grid{display:block}.aiw-left{display:none}.aiw-top{height:auto;align-items:flex-start;padding:16px;flex-direction:column}.aiw-actions{margin-left:0;justify-content:flex-start}.aiw-chat{min-height:calc(100vh - 72px)}.aiw-scroll{padding:16px}.aiw-msg,.aiw-msg.user{max-width:none}.aiw-result-head{grid-template-columns:1fr}}
`

function Badge({ type = 'draft', children }) {
  return <span className={`bdg ${type}`}><span className="dot"/>{children}</span>
}

function EmptyState({ onChooseFile }) {
  return (
    <article className="aiw-empty">
      <h2>上传原始需求文件，生成对话式评估结果</h2>
      <p>当前还没有 AI 评估结果。请在底部输入框附上 Excel、Word、PDF 或文本文件，并发送分析指令。页面会根据后端解析和评估结果生成消息卡片，不再默认展示固定案例。</p>
      <div className="aiw-empty-actions">
        <button className="btn btn-pri" type="button" onClick={onChooseFile}>选择文件</button>
      </div>
    </article>
  )
}

function MissingVersionState({ latestRequirement }) {
  return (
    <article className="aiw-empty">
      <h2>需求版本不存在</h2>
      <p>当前链接中的需求版本 ID 在后端版本库中找不到，可能是本地数据被重置、版本被删除，或你打开的是旧链接。请返回需求列表选择当前存在的需求版本。</p>
      <div className="aiw-empty-actions">
        {latestRequirement?.id && <Link className="btn btn-pri" to={`/requirements/${latestRequirement.id}/ai-evaluation`}>打开最新需求版本</Link>}
        <Link className="btn btn-pri" to="/requirements">返回需求列表</Link>
      </div>
    </article>
  )
}

function ParseSummaryMessage({ summary }) {
  if (!summary) return null
  const isModelResult = String(summary.mode || summary.model || '').toLowerCase() === 'model'
  return (
    <article className="aiw-msg">
      <div className="aiw-avatar">AI</div>
      <div className="aiw-bubble"><div className="aiw-pad">
        <div className="aiw-ai-title">模型识别完成 <Badge type={isModelResult ? 'ci' : 'draft'}>{isModelResult ? '模型结果' : '待复核'}</Badge></div>
        <div className="aiw-text">已完成原始文件解析，以下摘要来自模型理解结果，将作为本轮评估预览的输入。</div>
        <div className="aiw-parse">
          {[
            [summary.rawRows || 0, '原始需求行'],
            [summary.topics || 0, '业务主题'],
            [summary.integrationRisks || 0, '接口/二开风险'],
            [summary.confirmQuestions || 0, '待确认问题'],
          ].map(([num, label]) => <div className="aiw-tile" key={label}><div className="num">{num}</div><div className="lb">{label}</div></div>)}
        </div>
      </div></div>
    </article>
  )
}

function AssessmentPreviewPanel({ preview, onAccept, onAction }) {
  const draft = preview?.assessmentDraft || {}
  const meta = preview?.meta || {}
  const moduleItems = Array.isArray(draft.moduleItems) ? draft.moduleItems.slice(0, 8) : []
  const risks = Array.isArray(draft.risks) ? draft.risks : []
  const assumptions = Array.isArray(draft.assumptions) ? draft.assumptions : []
  const totalSuggested = moduleItems.reduce((sum, item) => sum + (Number(item.suggestedDays) || 0), 0)

  if (!preview || !Object.keys(draft).length) return null

  return (
    <>
      <section className="aiw-module-list">
        <div className="aiw-preview-head">
          实施评估结果
          <Badge type={meta.mode === 'model' ? 'ci' : 'draft'}>{meta.model || meta.mode || '规则/模型'}</Badge>
          <span style={{color:'var(--ink-3)',fontSize:12,fontWeight:600}}>建议人天合计：{Math.round(totalSuggested * 10) / 10}</span>
        </div>
        {moduleItems.length > 0 ? moduleItems.map((item, index) => {
          const title = item.skuName || item.moduleName || item.cloudProduct || `评估项 ${index + 1}`
          const acceptPayload = {
            title,
            tag: '来自 AI 评估',
            desc: `${item.cloudProduct || '未分组'} · 建议 ${item.suggestedDays ?? 0} 人天。${item.reason || ''}`,
          }
          return (
            <div className="aiw-module-card" key={`${item.cloudProduct || ''}-${title}-${index}`}>
              <div className="hd">
                <div>
                  <h3>{title}</h3>
                  <p>{item.reason || '后端暂未返回评估理由。'}</p>
                </div>
                <div className="aiw-module-days">
                  <div><b>{item.standardDays ?? '—'}</b><span>标准</span></div>
                  <div><b>{item.suggestedDays ?? '—'}</b><span>建议</span></div>
                </div>
              </div>
              <div className="aiw-module-meta">
                <Badge type="co">{item.cloudProduct || '未识别云产品'}</Badge>
                <Badge>{item.moduleName || '模块待确认'}</Badge>
              </div>
              <div className="aiw-module-actions">
                <button type="button" className="aiw-mini" onClick={() => onAction('ask', title)}>提问</button>
                <button type="button" className="aiw-mini warn" onClick={() => onAction('revise', title)}>修正</button>
                <button type="button" className="aiw-mini" onClick={() => onAction('confirm', title)}>加入待确认</button>
                <button type="button" className="aiw-mini pri" onClick={() => onAccept(acceptPayload)}>采纳</button>
              </div>
            </div>
          )
        }) : (
          <div className="aiw-muted">后端评估结果中暂未返回模块项，请调整指令后重新发送。</div>
        )}
      </section>
      <section className="aiw-preview">
        <div className="aiw-preview-list">
          <div className="aiw-preview-box">
            <b>风险提示</b>
            <ul>{(risks.length ? risks : ['后端暂未返回风险提示']).slice(0, 5).map((risk) => <li key={risk}>{risk}</li>)}</ul>
          </div>
          <div className="aiw-preview-box">
            <b>前提假设</b>
            <ul>{(assumptions.length ? assumptions : ['后端暂未返回前提假设']).slice(0, 5).map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
          </div>
        </div>
      </section>
    </>
  )
}

function EmptyCard({ children }) {
  return <div className="aiw-muted">{children}</div>
}

function SourcePanel({ selectedFile, savedSourceFile, parseSummary }) {
  const sourceName = selectedFile?.name || savedSourceFile?.name || parseSummary?.fileName
  return (
    <section className="aiw-card">
      <h3>来源依据</h3>
      <div className="bd">
        <div className="aiw-trace"><div className="k">文件</div><div>{sourceName || '尚未上传文件'}</div></div>
        <div className="aiw-trace"><div className="k">来源</div><div>{parseSummary ? '后端解析摘要' : '等待解析'}</div></div>
        <button className="btn btn-out" type="button" disabled={!parseSummary}>打开原始行预览</button>
      </div>
    </section>
  )
}

function UserThreadMessage({ message }) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : []
  return (
    <article className="aiw-msg user">
      <div className="aiw-bubble"><div className="aiw-pad">
        <div className="aiw-text">{message.content}</div>
        {attachments.map((attachment) => (
          <div className="aiw-attach" key={attachment.id || attachment.name}>
            <div className="aiw-doc">{String(attachment.name || 'FILE').split('.').pop()?.slice(0, 3).toUpperCase() || 'FILE'}</div>
            <div><b>{attachment.name || '已上传文件'}</b><div style={{fontSize:11,opacity:.78}}>{attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB · 已附加` : '已附加'}</div></div>
          </div>
        ))}
      </div></div>
      <div className="aiw-avatar">我</div>
    </article>
  )
}

function AssistantTextMessage({ message }) {
  return (
    <article className="aiw-msg">
      <div className="aiw-avatar">AI</div>
      <div className="aiw-bubble"><div className="aiw-pad">
        <div className="aiw-text">{message.content}</div>
      </div></div>
    </article>
  )
}

function ThreadMessage({ message, artifacts, onAccept, onAction }) {
  if (message.role === 'user') return <UserThreadMessage message={message} />
  if (message.type === 'parse_summary') {
    return <ParseSummaryMessage summary={artifacts?.[message.artifactId]} />
  }
  if (message.type === 'assessment_preview') {
    return (
      <article className="aiw-msg">
        <div className="aiw-avatar">AI</div>
        <div className="aiw-bubble">
          <AssessmentPreviewPanel preview={artifacts?.[message.artifactId]} onAccept={onAccept} onAction={onAction} />
        </div>
      </article>
    )
  }
  if (message.type === 'error') {
    return (
      <article className="aiw-msg">
        <div className="aiw-avatar">AI</div>
        <div className="aiw-bubble"><div className="aiw-pad"><div className="aiw-text" style={{color:'var(--err)'}}>后端分析暂未完成：{message.content}</div></div></div>
      </article>
    )
  }
  return <AssistantTextMessage message={message} />
}

export default function RequirementAiWorkbench() {
  const { id } = useParams()
  const navigate = useNavigate()
  const {
    accepted,
    acceptEvaluationInput,
    analyze,
    analysisRequest,
    artifacts,
    chooseFile,
    composer,
    confirmationQuestions,
    createAssessmentDraft,
    creatingAssessment,
    draftPersistError,
    error,
    errorScope,
    exportConversation,
    feedbackOpen,
    feedbackRecords,
    fileInputRef,
    handleResultAction,
    lastPreview,
    latestRequirement,
    loadStatus,
    loading,
    loadingSaved,
    onFileChange,
    parseSummary,
    messages,
    saveEvaluationDraft,
    savedSourceFile,
    saving,
    selectedFile,
    setComposer,
    toast,
    versionRecord,
  } = useRequirementAiWorkbench({ requirementId: id })

  const moduleItems = Array.isArray(lastPreview?.assessmentDraft?.moduleItems)
    ? lastPreview.assessmentDraft.moduleItems
    : []
  const topics = useMemo(() => {
    const names = moduleItems
      .map((item) => item.cloudProduct || item.moduleName || item.skuName)
      .filter(Boolean)
    return Array.from(new Set(names)).slice(0, 8)
  }, [moduleItems])
  const sourceName = selectedFile?.name || savedSourceFile?.name || parseSummary?.fileName
  const isMissingVersion = loadStatus === 'not_found'
  const hasThreadMessages = messages.length > 0
  const hasConversation = Boolean(hasThreadMessages || parseSummary || lastPreview || selectedFile || analysisRequest)
  const versionCode = versionRecord?.versionCode || latestRequirement?.versionCode || '需求版本'
  const checkoutLabel = versionRecord?.checkoutStatus === 'checked_out' ? '已检出' : '已检入'

  async function pushToAssessment() {
    const record = await createAssessmentDraft()
    if (record?.id) navigate(`/assessments/${record.id}`)
  }

  return (
    <div className="aiw-page">
      <style>{STYLE}</style>
      <header className="aiw-top">
        <div>
          <div className="aiw-crumb">工作台 / 需求 / 对话式需求评估台</div>
          <h1>需求 AI 评估 <Badge type={versionRecord?.checkoutStatus === 'checked_out' ? 'co' : 'ci'}>{checkoutLabel}</Badge> <Badge>{versionCode}</Badge></h1>
        </div>
        <div className="aiw-actions">
          <Link className="btn btn-ghost" to={`/requirements/${id}`}>返回详情</Link>
          <button className="btn btn-ghost" type="button" onClick={exportConversation}>导出对话</button>
          {loadingSaved && <span className="bdg draft"><span className="dot"/>加载草稿...</span>}
          {error && errorScope === 'load' && <span className="bdg warn"><span className="dot"/>历史草稿未加载</span>}
          <button className="btn btn-out" type="button" onClick={saveEvaluationDraft} disabled={saving || loadingSaved || isMissingVersion}>{saving ? '保存中...' : '保存草稿'}</button>
          <button className="btn btn-pri" type="button" onClick={pushToAssessment} disabled={loading || creatingAssessment || !lastPreview || isMissingVersion}>{loading ? '分析中...' : creatingAssessment ? '生成中...' : '生成实施评估草稿'}</button>
        </div>
      </header>

      <section className="aiw-grid">
        <aside className="aiw-left">
          <div className="aiw-panel-title">原始资料</div>
          <div className="aiw-panel-body">
            <div className="aiw-file">
              <div className="name"><span>📎</span><span>{sourceName || '尚未上传原始文件'}</span></div>
              <div className="meta">{selectedFile ? '已附加，点击发送后解析' : parseSummary ? '已完成后端解析' : '等待用户从对话框附加文件'}</div>
            </div>
            {parseSummary ? (
              <>
                <div className="aiw-sheet"><b>解析模式</b><p>{parseSummary.mode || '后端解析'}</p></div>
                <div className="aiw-sheet"><b>原始需求行</b><p>{parseSummary.rawRows || 0} 行</p></div>
                <div className="aiw-sheet"><b>业务主题</b><p>{parseSummary.topics || 0} 个</p></div>
                <div className="aiw-sheet"><b>待确认问题</b><p>{parseSummary.confirmQuestions || 0} 个</p></div>
              </>
            ) : (
              <div className="aiw-sheet"><b>上传后自动识别</b><p>文件解析成功后，这里会显示真实摘要。</p></div>
            )}
          </div>
          <div className="aiw-panel-title">AI 识别主题</div>
          <div className="aiw-panel-body">
            {topics.length ? topics.map((title, index) => <div className={`aiw-topic ${index === 0 ? 'on' : ''}`} key={title}><b>{title}</b><span>来自后端评估结果</span></div>) : <EmptyCard>生成评估结果后展示识别主题。</EmptyCard>}
          </div>
        </aside>

        <section className="aiw-chat">
          <div className="aiw-chat-head">
            <Badge type="brd">文件驱动对话</Badge>
            <Badge>{parseSummary ? (parseSummary.model || parseSummary.mode || '模型结果') : '等待模型分析'}</Badge>
            <span className="hint">在 AI 渲染出的评估结果上直接提问、修正、采纳</span>
          </div>
          {/* ISS-2026-08-18-005（档 1）：persist 失败页面级可见横幅——状态位而非 toast，
              连续操作失败只置一次位；提示用户草稿未落盘，刷新前请勿关闭页面。 */}
          {draftPersistError && (
            <div style={{
              margin: '0 16px',
              padding: '8px 12px',
              borderRadius: 'var(--r-md)',
              background: 'var(--bg-soft)',
              border: '1px solid var(--line)',
              color: 'var(--err)',
              fontSize: 12,
            }}>
              草稿保存失败：{draftPersistError}，已保留在当前页面，刷新前请勿关闭
            </div>
          )}
          <div className="aiw-scroll">
            {isMissingVersion ? <MissingVersionState latestRequirement={latestRequirement} /> : !hasConversation && <EmptyState onChooseFile={chooseFile} />}
            {hasThreadMessages ? messages.map((message) => (
              <ThreadMessage
                artifacts={artifacts}
                key={message.id}
                message={message}
                onAccept={acceptEvaluationInput}
                onAction={handleResultAction}
              />
            )) : (analysisRequest || selectedFile || sourceName) && (
              <article className="aiw-msg user">
                <div className="aiw-bubble"><div className="aiw-pad">
                  <div className="aiw-text">{analysisRequest || composer}</div>
                  {sourceName && <div className="aiw-attach"><div className="aiw-doc">{sourceName.split('.').pop()?.slice(0, 3).toUpperCase() || 'FILE'}</div><div><b>{sourceName}</b><div style={{fontSize:11,opacity:.78}}>{selectedFile ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB · 已附加` : '来自已保存草稿'}</div></div></div>}
                </div></div>
                <div className="aiw-avatar">我</div>
              </article>
            )}

            {!hasThreadMessages && <ParseSummaryMessage summary={parseSummary} />}

            {!hasThreadMessages && lastPreview && (
              <article className="aiw-msg">
                <div className="aiw-avatar">AI</div>
                <div className="aiw-bubble">
                  <AssessmentPreviewPanel preview={lastPreview} onAccept={acceptEvaluationInput} onAction={handleResultAction} />
                  {feedbackOpen && (
                    <div className="aiw-feedback">
                      <div className="aiw-feedback-hd">锚点反馈</div>
                      <div className="aiw-feedback-bd">
                        <div><b>用户反馈：</b>已记录到右侧反馈记录，可继续基于该评估项追问或修正。</div>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            )}
            {error && errorScope !== 'load' && (
              <article className="aiw-msg">
                <div className="aiw-avatar">AI</div>
                <div className="aiw-bubble"><div className="aiw-pad"><div className="aiw-text" style={{color:'var(--err)'}}>后端分析暂未完成：{error}</div></div></div>
              </article>
            )}
          </div>
          <div className="aiw-composer">
            <div className="aiw-quick-row">
              {['重新分析选中结果', '生成售前待确认问题', '生成 PM 评估摘要', '导出分析纪要'].map((x) => <button type="button" className="aiw-quick" key={x}>{x}</button>)}
            </div>
            <div className="aiw-compose-box">
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.pdf,.docx,.txt" style={{display:'none'}} onChange={onFileChange} disabled={isMissingVersion} />
              <button className="aiw-attach-btn" type="button" onClick={chooseFile} disabled={isMissingVersion}>＋</button>
              <textarea rows="1" value={composer} onChange={(event) => setComposer(event.target.value)} />
              <button className="aiw-send" type="button" onClick={analyze} disabled={loading || isMissingVersion}>{loading ? '…' : '➤'}</button>
            </div>
          </div>
        </section>

        <aside className="aiw-right">
          <div className="aiw-panel-title">沉淀结果</div>
          <div className="aiw-panel-body">
            <section className="aiw-card">
              <h3>已采纳评估输入</h3>
              <div className="bd">
                {accepted.length ? accepted.map((item, index) => <div className="aiw-accepted" key={`${item.title}-${index}`}><div className="top"><b>{item.title}</b><span className="tag ok">{item.tag}</span></div><p>{item.desc}</p></div>) : <EmptyCard>尚未采纳评估输入。</EmptyCard>}
              </div>
            </section>
            <section className="aiw-card">
              <h3>待确认问题</h3>
              <div className="bd">
                {confirmationQuestions.length ? confirmationQuestions.map((q) => <div className="aiw-question" key={q}>{q}</div>) : <EmptyCard>在评估卡片中点击“加入待确认”后显示。</EmptyCard>}
              </div>
            </section>
            <section className="aiw-card">
              <h3>反馈记录</h3>
              <div className="bd">
                {feedbackRecords.length ? feedbackRecords.map((record, index) => (
                  <div className="aiw-trace" key={`${record.key}-${index}`}><div className="k">{record.key}</div><div>{record.value}</div></div>
                )) : <EmptyCard>对评估结果提问或修正后显示。</EmptyCard>}
              </div>
            </section>
            <SourcePanel selectedFile={selectedFile} savedSourceFile={savedSourceFile} parseSummary={parseSummary} />
          </div>
        </aside>
      </section>
      <div className={`aiw-toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
