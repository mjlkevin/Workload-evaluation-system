import { useEffect, useState } from 'react'
import { listExecutionCatalog } from '../../../../api/businessExecutions.js'

export default function ComposerTaskPicker({ query, activeIndex, setActiveIndex, onSelect, onItems, listId }) {
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setCatalog([])
    Promise.resolve().then(() => listExecutionCatalog())
      .then(items => { if (active) setCatalog(items) })
      .catch(() => { if (active) setError('技能清单加载失败，请重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])
  const term = query.toLocaleLowerCase()
  const items = catalog.filter(item => `${item.name} ${item.description || ''} ${item.kind === 'skill' ? 'Skill 技能' : 'Workflow 流程'}`.toLocaleLowerCase().includes(term))
  // The parent handles keyboard input without moving focus out of the editor.
  const signature = JSON.stringify(items)
  useEffect(() => { onItems(items); setActiveIndex(0) }, [signature])
  return <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-lg border border-line bg-surface shadow-lg" aria-label="技能清单">
    <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-ink-3"><span>Skill / 流程</span><span>↑↓ 选择 · Enter 确定 · Esc 关闭</span></div>
    {loading && <p role="status" className="m-0 px-3 py-3 text-sm text-ink-2">正在加载技能…</p>}
    {error && <div role="alert" className="px-3 py-3 text-sm text-err-ink">{error}<button type="button" className="btn btn-out ml-2" onClick={() => setReload(value => value + 1)}>重试加载技能</button></div>}
    {!loading && !error && !items.length && <p role="status" className="m-0 px-3 py-3 text-sm text-ink-2">没有匹配的 Skill 或流程</p>}
    <div id={listId} role="listbox" aria-label="Skill 和流程" aria-busy={loading} className="max-h-64 overflow-y-auto p-1">
      {items.map((item, index) => <button key={`${item.kind}:${item.id}`} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex} type="button" tabIndex={-1}
        className={`flex w-full min-w-0 flex-col gap-1 rounded-md border-0 px-3 py-2 text-left text-sm text-ink ${index === activeIndex ? 'bg-brand-soft' : 'bg-surface hover:bg-bg-soft'}`}
        onMouseEnter={() => setActiveIndex(index)} onMouseDown={event => event.preventDefault()} onClick={() => onSelect(item)}>
        <span className="flex min-w-0 items-center gap-2"><span className="shrink-0 text-xs text-ink-3">{item.kind === 'skill' ? 'Skill' : '流程'}</span><span className="break-words font-medium">{item.name}</span></span>
        {item.description && <span className="line-clamp-2 break-words text-xs text-ink-2">{item.description}</span>}
      </button>)}
    </div>
  </div>
}
