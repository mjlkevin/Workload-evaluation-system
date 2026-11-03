import { useId, useState } from 'react'

/** Frozen record scope is independent of template defaults; viewing the catalog never edits that scope. */
export default function FrozenAssessmentResults({ vm }) {
  const [showAll, setShowAll] = useState(false)
  const tableId = useId()
  const items = vm.skuGroups.flatMap(group => group.children)
  const selected = items.filter(item => item.included === true).length
  const unknown = items.filter(item => typeof item.included !== 'boolean').length
  const visible = showAll ? items : items.filter(item => item.included !== false || Number.isFinite(item.confirmedCustomDays))
  const available = !vm.loading && !vm.estimateError && Number.isFinite(vm.kpi?.totalDays) && Number.isFinite(vm.kpi?.baseDays)
  function calculatedDays(item) {
    if (!available) return '暂不可用'
    if (typeof item.included !== 'boolean') return '待确认'
    if (!item.included) return '未计入'
    return Number.isFinite(item.customDays) ? item.customDays : '暂不可用'
  }
  return (
    <section aria-label="原始评估结果" className="grid min-w-0 gap-4">
      {available && <section aria-label="评估计算统计">
        <dl className="m-0 grid min-w-0 gap-3 sm:grid-cols-3">
          {[
            ['总评估人天 · 实时', vm.kpi.totalDays], ['基础人天', vm.kpi.baseDays], ['已纳入实施项', `${selected} / ${items.length}`],
          ].map(([label, value]) => <div key={label} className="min-w-0 rounded-md border border-line bg-surface p-4">
            <dt className="text-sm text-ink-2">{label}</dt>
            <dd className="m-0 mt-2 break-words text-2xl font-semibold tabular-nums text-ink">{value}</dd>
          </div>)}
        </dl>
      </section>}
      <section className="grid min-w-0 gap-3 rounded-md border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-sm font-semibold">评估范围与目录</h2>
          <button type="button" className="btn btn-out" aria-pressed={showAll} aria-controls={tableId} onClick={() => setShowAll(value => !value)}>
            {showAll ? '返回评估范围' : '查看完整目录'}
          </button>
        </div>
        <p className="m-0 text-sm text-ink-2">已纳入 {selected} 项，未确认 {unknown} 项；当前展示 {visible.length} / {items.length} 项。</p>
        {!showAll && <p className="m-0 text-xs text-ink-2">默认保留已纳入、未确认及人工覆盖的条目。</p>}
        <div className="overflow-x-auto">
          <table id={tableId} className="table" aria-label="已确认评估范围">
            <thead><tr><th scope="col">实施要点</th><th scope="col">是否纳入</th><th scope="col">标准人天</th><th scope="col">人工覆盖</th><th scope="col">计算人天</th></tr></thead>
            <tbody>{visible.map(item => <tr key={item.templateItemId}>
              <td>{item.name}</td><td>{typeof item.included !== 'boolean' ? '未确认' : item.included ? '已纳入' : '未纳入'}</td>
              <td>{Number.isFinite(item.baseDays) ? item.baseDays : '未提供'}</td>
              <td>{Number.isFinite(item.confirmedCustomDays) ? item.confirmedCustomDays : '未覆盖'}</td>
              <td>{calculatedDays(item)}</td>
            </tr>)}
              {!visible.length && <tr><td colSpan={5}>当前没有已纳入、未确认或人工覆盖的条目，可查看完整目录。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
