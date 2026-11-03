import { useState } from 'react'

const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string'
const list = (value, check) => Array.isArray(value) && value.every(check)
export const isRequirementReport = value => record(value)
  && list(value.requirements, item => record(item) && text(item.id) && text(item.title) && text(item.description)
    && text(item.role) && text(item.action) && text(item.object) && list(item.constraints, text)
    && list(item.openQuestions, text) && list(item.assumptions, text)
    && list(item.sources, quote => record(quote) && text(quote.quote) && text(quote.sourceId)))
  && list(value.relations, relation => record(relation) && text(relation.kind)
    && text(relation.leftId) && text(relation.rightId) && text(relation.reason))
export const isCatalog = value => record(value?.template) && text(value.template.templateName)
  && list(value.template.items, item => record(item) && text(item.templateItemId) && text(item.itemName))
const isMatching = value => record(value)
  && list(value.matches, item => record(item) && text(item.reqId) && list(item.templateItemIds, text)
    && text(item.rationale) && text(item.scope))
  && list(value.unmatched, item => record(item) && text(item.reqId) && text(item.reason))
  && list(value.aiAdjustments, item => record(item) && text(item.reqId) && typeof item.proposedDays === 'number'
    && Number.isFinite(item.proposedDays) && text(item.basis))
const names = {
  title: '名称', name: '名称', description: '说明', requirements: '需求明细', params: '计算参数',
  report: '需求报告', matching: '实施匹配', answers: '补充回答', selectedItemIds: '已选范围',
  templateId: '模板', userCount: '用户数量', orgCount: '组织数量', difficultyFactor: '难度系数', orgSimilarityFactor: '组织相似系数',
}
const traceKeys = ['reportDigest', 'requirementReportDigest', 'snapshotDigest', 'matchingDigest', 'confirmation',
  'operationId', 'runId', 'templateVersion', 'ruleVersion', 'templateId', 'ruleSetId', 'versionCode',
  'projectVersionCode', 'projectId', 'assessmentId', 'resultLink']

export function Collapsed({ title, children, summaryClassName = 'text-xs text-ink-2' }) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className={summaryClassName}>{title}</summary>
      {open && children}
    </details>
  )
}
function Lines({ title, values }) {
  return (
    <div className="grid min-w-0 gap-1">
      <h5 className="m-0 text-xs font-medium">{title}</h5>
      {values?.length ? (
        <ul className="m-0 grid gap-1 pl-5">
          {values.map((value, i) => <li className="break-words" key={i}>{value}</li>)}
        </ul>
      ) : <span className="text-xs text-ink-2">无</span>}
    </div>
  )
}
function RequirementReport({ report }) {
  return (
    <section aria-label="需求报告" className="grid min-w-0 gap-3">
      <h4 className="m-0 text-sm font-semibold">需求报告</h4>
      {report.requirements.map(item => (
        <article key={item.id} className="grid min-w-0 gap-2 rounded-md border border-line p-3 text-sm">
          <h5 className="m-0 break-words text-sm font-semibold">{item.id} · {item.title}</h5>
          <p className="m-0 whitespace-pre-wrap break-words">{item.description}</p>
          <p className="m-0 break-words text-xs text-ink-2">角色：{item.role || '待补充'}；动作：{item.action || '待补充'}；对象：{item.object || '待补充'}</p>
          <Lines title="约束" values={item.constraints} />
          <Lines title="待澄清问题" values={item.openQuestions} />
          <Lines title="待核实假设" values={item.assumptions} />
          <div className="grid gap-1">
            <h5 className="m-0 text-xs font-medium">原文引用</h5>
            {item.sources.map((source, i) => (
              <blockquote key={i} className="m-0 grid gap-1 border-l border-line pl-3">
                <p className="m-0 whitespace-pre-wrap break-words">{source.quote}</p>
                <cite className="break-words text-xs not-italic text-ink-2">{source.sourceId} · {source.start}–{source.end}</cite>
              </blockquote>
            ))}
          </div>
        </article>
      ))}
      <Lines title="重复与冲突" values={report.relations.map(relation => `${relation.kind === 'conflict' ? '冲突' : relation.kind === 'duplicate' ? '重复' : relation.kind}：${relation.leftId} / ${relation.rightId} · ${relation.reason}`)} />
    </section>
  )
}
function Matching({ matching, context }) {
  const requirementName = id => {
    const item = context.report?.requirements.find(item => item.id === id)
    return item ? `${id} · ${item.title}` : id
  }
  const itemName = id => {
    const item = context.catalog?.template.items.find(item => item.templateItemId === id)
    return item ? `${item.itemName} · ${id}` : id
  }
  return (
    <section aria-label="实施匹配" className="grid min-w-0 gap-3 text-sm">
      <h4 className="m-0 text-sm font-semibold">实施匹配</h4>
      <p className="m-0">已匹配 {matching.matches.length} 项；未匹配 {matching.unmatched.length} 项</p>
      {matching.matches.map((item, i) => (
        <div key={i} className="grid min-w-0 gap-1 rounded-md border border-line p-3">
          <h5 className="m-0 text-sm font-medium">{requirementName(item.reqId)}</h5>
          <span className="text-xs text-ink-2">{item.scope === 'include' ? '建议纳入' : '待核实'}</span>
          <ul className="m-0 pl-5">
            {item.templateItemIds.map(id => <li className="break-words" key={id}>{itemName(id)}</li>)}
          </ul>
          <p className="m-0 break-words">{item.rationale}</p>
        </div>
      ))}
      <div className="grid gap-2">
        <h5 className="m-0 text-sm font-medium">未匹配需求</h5>
        {matching.unmatched.length ? matching.unmatched.map((item, i) => (
          <div key={i} className="grid gap-1 rounded-md bg-warn-soft p-3 text-warn-ink">
            <span className="break-words">{requirementName(item.reqId)}</span>
            <p className="m-0 break-words">{item.reason}</p>
          </div>
        )) : <span className="text-xs text-ink-2">无</span>}
      </div>
      <Collapsed title="匹配参数与追溯">
        <BusinessValue value={Object.fromEntries(Object.entries(matching).filter(([key]) => !['matches', 'unmatched', 'aiAdjustments'].includes(key)))} context={context} traceDetail />
      </Collapsed>
      {!!matching.aiAdjustments.length && (
        <div className="grid gap-2">
          <h5 className="m-0 text-sm font-medium">AI 建议工期（未计入正式计算）</h5>
          {matching.aiAdjustments.map((item, i) => (
            <p key={i} className="m-0 break-words">{requirementName(item.reqId)}：{item.proposedDays} 人天 · {item.basis}</p>
          ))}
        </div>
      )}
    </section>
  )
}
export default function BusinessValue({ value, depth = 0, context = {}, nativeDraft = false, traceDetail = false }) {
  if (value === undefined || value === null) return <span className="text-ink-2">暂无内容</span>
  if (typeof value !== 'object') {
    return <span className="whitespace-pre-wrap break-words">{typeof value === 'boolean' ? value ? '是' : '否' : String(value)}</span>
  }
  if (depth > 6) {
    return <Collapsed title="展开详细内容"><pre className="whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre></Collapsed>
  }
  if (isRequirementReport(value)) return <RequirementReport report={value} />
  context = { ...context,
    ...(isRequirementReport(value.report) ? { report: value.report }
      : isRequirementReport(value.requirements?.report) ? { report: value.requirements.report } : {}),
    ...(isCatalog(value.catalog) ? { catalog: value.catalog } : {}),
  }
  if (isMatching(value)) return <Matching matching={value} context={context} />
  if (isCatalog(value)) {
    return (
      <Collapsed title={`实施目录：${value.template.templateName}（${value.template.items.length} 项）`}>
        <BusinessValue value={value.template} depth={depth + 1} context={context} />
        <BusinessValue value={Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'template'))} depth={depth + 1} context={context} traceDetail />
      </Collapsed>
    )
  }
  if (Array.isArray(value)) {
    return value.length ? (
      <ol className="m-0 grid min-w-0 gap-2 pl-5">
        {value.map((entry, index) => <li key={index}><BusinessValue value={entry} depth={depth + 1} context={context} /></li>)}
      </ol>
    ) : <span className="text-ink-2">无</span>
  }
  const draft = nativeDraft && text(value.assessmentId) && value.assessmentId.trim()
  const trace = traceDetail ? [] : Object.entries(value).filter(([key]) => traceKeys.includes(key))
  const fields = Object.entries(value).filter(([key]) => !trace.some(([field]) => field === key) && !(draft && key === 'totalDays'))
  return (
    <div className="grid min-w-0 gap-3">
      {draft && (
        <div className="grid gap-2 rounded-md bg-ok-soft p-3 text-sm text-ok-ink">
          <a className="font-medium underline" href={`/assessments/${encodeURIComponent(value.assessmentId)}`}>打开评估草稿</a>
          {typeof value.totalDays === 'number' && Number.isFinite(value.totalDays) && value.totalDays >= 0 && (
            <p className="m-0">正式计算工期：{value.totalDays} 人天</p>
          )}
        </div>
      )}
      <dl className="m-0 grid min-w-0 gap-2">
        {fields.map(([key, entry]) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-ink-2">{names[key] || key}</dt>
            <dd className="m-0 min-w-0 text-sm">
              {key === 'sources' && Array.isArray(entry) ? (
                <Collapsed title={`原始材料（${entry.length}）`}>
                  <BusinessValue value={entry} depth={depth + 1} context={context} />
                </Collapsed>
              ) : <BusinessValue value={entry} depth={depth + 1} context={context} />}
            </dd>
          </div>
        ))}
      </dl>
      {!!trace.length && (
        <Collapsed title="追溯信息">
          <BusinessValue value={Object.fromEntries(trace)} depth={depth + 1} context={context} traceDetail />
        </Collapsed>
      )}
    </div>
  )
}
