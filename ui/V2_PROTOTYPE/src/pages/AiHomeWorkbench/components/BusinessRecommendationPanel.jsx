import { useEffect, useId, useRef, useState } from 'react'
import { listExecutionCatalog, recommendBusinessExecutions } from '../../../api/businessExecutions.js'

const invalid = '推荐结果已失效，请重新获取或手动选择。'
function authorizedCards(response, catalog) {
  if (!response || !['recommended', 'no_match'].includes(response.outcome) || !Array.isArray(response.items)
    || response.items.length > 3 || (response.outcome === 'no_match') !== (response.items.length === 0)) throw Error(invalid)
  const seen = new Set()
  return response.items.map(item => {
    if (!item || !['skill', 'workflow'].includes(item.kind) || typeof item.id !== 'string' || !item.id
      || typeof item.versionId !== 'string' || !item.versionId) throw Error(invalid)
    const key = `${item.kind}:${item.id}`
    const current = catalog.find(entry => entry.kind === item.kind && entry.id === item.id && entry.versionId === item.versionId)
    if (!current || seen.has(key)) throw Error(invalid)
    seen.add(key)
    return { kind: current.kind, id: current.id, versionId: current.versionId, name: current.name, description: current.description }
  })
}
/** Discovery only. Selecting a card rechecks the catalog before the existing explicit start form is populated. */
export default function BusinessRecommendationPanel({ scope, disabled, onSelect, onDirty }) {
  const [goal, setGoal] = useState('')
  const [cards, setCards] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [goalError, setGoalError] = useState(false)
  const [noMatch, setNoMatch] = useState(false)
  const sequence = useRef(0), locked = useRef(false), alive = useRef(false), unavailable = useRef(disabled)
  unavailable.current = disabled
  const goalId = useId(), errorId = useId()
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++ } }, [])
  useEffect(() => {
    if (disabled) { sequence.current++; locked.current = false; setBusy(false) }
  }, [disabled])
  function edit(value) {
    sequence.current++; locked.current = false
    setGoal(value); setCards([]); setBusy(false); setError(''); setGoalError(false); setNoMatch(false)
    onDirty()
  }
  async function perform(selecting) {
    if (unavailable.current || locked.current) return
    if (!selecting && (!goal.trim() || goal.length > 4000)) {
      setGoalError(true); setError('请填写业务目标，最多4000字。'); return
    }
    const request = ++sequence.current, token = scope.capture()
    const current = () => alive.current && request === sequence.current && scope.current(token) && !unavailable.current
    locked.current = true; setBusy(true); setError(''); setGoalError(false); setNoMatch(false)
    if (!selecting) setCards([])
    try {
      if (selecting) {
        const fresh = await listExecutionCatalog()
        if (current()) onSelect(selecting, fresh, token)
      } else {
        const response = await recommendBusinessExecutions(goal.trim())
        if (!current()) return
        const fresh = await listExecutionCatalog()
        if (!current()) return
        const items = authorizedCards(response, fresh)
        setCards(items); setNoMatch(!items.length)
      }
    } catch (err) {
      if (current()) setError(err?.message === invalid ? invalid : '推荐暂不可用，请重试或手动选择。')
    } finally {
      if (current()) { locked.current = false; setBusy(false) }
    }
  }
  return (
    <section aria-label="推荐 Skill 或工作流" aria-busy={busy} className="grid min-w-0 gap-3 rounded-md border border-line bg-bg-soft p-3">
      <label htmlFor={goalId} className="text-sm font-medium">本次业务目标</label>
      <textarea id={goalId} className="input min-h-20 resize-y py-2" maxLength={4000} value={goal}
        disabled={disabled} aria-invalid={goalError} aria-describedby={goalError ? errorId : undefined} onChange={event => edit(event.target.value)} />
      <button type="button" className="btn btn-out justify-self-start" disabled={disabled || busy} onClick={() => perform()}>获取推荐</button>
      {busy && <p role="status" className="m-0 text-sm text-ink-2">{cards.length ? '正在核对当前目录…' : '正在获取推荐…'}</p>}
      {noMatch && <p role="status" className="m-0 text-sm text-ink-2">请补充希望完成的业务目标，或继续普通对话。</p>}
      {error && <p id={errorId} role="alert" className="m-0 text-sm text-err-ink">{error}</p>}
      {!!cards.length && <ul className="m-0 grid list-none gap-2 p-0">
        {cards.map(item => <li key={`${item.kind}:${item.id}`} className="grid min-w-0 gap-2 rounded-md border border-line bg-surface p-3">
          <h3 className="m-0 break-words text-sm font-semibold">{item.name}</h3>
          <p className="m-0 break-words text-sm text-ink-2">{item.description}</p>
          <button type="button" className="btn btn-out justify-self-start" disabled={disabled || busy} onClick={() => perform(item)}>选择并补齐输入</button>
        </li>)}
      </ul>}
    </section>
  )
}
