import { normalizeProjectionSource } from './messageFormatter.js'

const kinds = new Set(['stage', 'question', 'answer', 'confirmation', 'decision', 'tool_result', 'result', 'failure'])
const owns = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined
const key = (root, id) => `business:${encodeURIComponent(root)}:${encodeURIComponent(id)}`
const byRun = (a, b) => (stamp(a.createdAt) ?? 0) - (stamp(b.createdAt) ?? 0)
  || (stamp(a.updatedAt) ?? 0) - (stamp(b.updatedAt) ?? 0) || a.runId.localeCompare(b.runId)
const validTimeline = timeline => timeline?.version === 1 && typeof timeline.rootRunId === 'string'
  && timeline.rootRunId && Array.isArray(timeline.entries)

/**
 * Pure, read-only projection of public server facts. Ordinary message objects pass through by identity.
 * Business records: {type:'business',kind,id,sourceId,rootRunId,currentRunId,runId?,role,title,status,content?,
 * stageId?,occurredAt?,detail?,final?,pending?,coverage?,unavailable?,target}.
 * No timestamp is invented. `pending` is the current server descriptor, never historical timeline state.
 * Callers should pass the active sessionId; the two-argument form accepts already session-scoped runs.
 */
export function buildBusinessConversationEntries(messages = [], runs = [], { sessionId } = {}) {
  const chat = Array.isArray(messages) ? messages : []
  const groups = new Map()
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run?.runId || !run.businessExecution || (sessionId !== undefined && run.sessionId !== sessionId)) continue
    const timeline = run.businessExecution.timeline
    const root = validTimeline(timeline) ? timeline.rootRunId : run.runId
    const group = groups.get(root) ?? []
    group.push(run); groups.set(root, group)
  }
  const buckets = Array.from({ length: chat.length + 1 }, () => [])
  for (const [root, attempts] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    attempts.sort(byRun)
    const anchorIndex = chat.findIndex(message => {
      const source = normalizeProjectionSource(message.projectionSource)
      return message.role === 'user' && source && attempts.some(run => run.runId === source.runId)
    })
    let slot = anchorIndex >= 0 ? anchorIndex + 1 : chronologicalSlot(chat, attempts[0].createdAt)
    let orderTime = stamp(chat[anchorIndex]?.createdAt) ?? stamp(attempts[0].createdAt) ?? 0
    const records = projectGroup(root, attempts)
    for (const entry of records) {
      // Server causal order wins even when physical clocks disagree or stages have no timestamp.
      if (entry.occurredAt) {
        slot = Math.max(slot, chronologicalSlot(chat, entry.occurredAt))
        orderTime = Math.max(orderTime, stamp(entry.occurredAt))
      }
      buckets[slot].push({ entry, root, orderTime })
    }
  }
  return buckets.flatMap((bucket, index) => [
    ...bucket.sort((a, b) => a.orderTime - b.orderTime || a.root.localeCompare(b.root)).map(item => item.entry),
    ...(index < chat.length ? [chat[index]] : []),
  ])
}

function chronologicalSlot(messages, occurredAt) {
  const time = stamp(occurredAt)
  if (time === undefined) return messages.length
  let slot = 0
  messages.forEach((message, index) => { if (stamp(message.createdAt) <= time) slot = index + 1 })
  return slot
}

function projectGroup(root, attempts) {
  const current = attempts.at(-1), execution = current.businessExecution
  const common = { type: 'business', rootRunId: root, currentRunId: current.runId, target: execution.target }
  const make = (id, fields) => ({ ...common, id: key(root, id), sourceId: id, ...fields })
  const olderFailures = attempts.slice(0, -1).filter(run => !validTimeline(run.businessExecution.timeline))
    .flatMap(run => (run.businessExecution.results?.steps ?? []).flatMap((receipt, index) => receipt.status === 'failed' ? [{
      id: `legacy:${run.runId}:step:${receipt.stepId}:${index}:failure`, kind: 'failure', role: 'assistant',
      runId: run.runId, stepId: receipt.stepId, title: '阶段未完成', status: receipt.status,
      ...(receipt.code ? { content: { code: receipt.code } } : {}),
    }] : []))
  const entries = [...olderFailures, ...mergeCausalEntries(attempts),
    ...(validTimeline(execution.timeline) && execution.timeline.entries.length ? [] : legacyResults(current))]
  const records = []
  // This is the frozen business input, not a new chat message or an invented uploaded file.
  if (owns(execution, 'input')) records.push(make('$input', { kind: 'input', runId: current.runId, role: 'user', title: '任务输入', status: 'recorded', content: execution.input }))
  for (const entry of entries) {
    if (entry.kind === 'result' && owns(execution.results, 'output') && same(entry.content, execution.results.output)) continue
    const fields = { kind: entry.kind, role: entry.role, title: entry.title, status: entry.status }
    for (const field of ['runId', 'stepId', 'stepType', 'operationId', 'iteration', 'ordinal', 'toolName', 'content', 'stageId']) {
      if (owns(entry, field)) fields[field] = entry[field]
    }
    if (stamp(entry.occurredAt) !== undefined) fields.occurredAt = entry.occurredAt
    if (entry.kind === 'tool_result' || entry.kind === 'result') fields.detail = true
    records.push(make(entry.id, fields))
  }
  attachPending(records, current, make)
  if (owns(execution.results, 'output')) records.push(make('$output', {
    kind: 'result', runId: current.runId, role: 'assistant', title: '执行结果', status: current.status, final: true, content: execution.results.output,
  }))
  const unavailable = [...new Set(attempts.flatMap(run => {
    const timeline = run.businessExecution.timeline
    return validTimeline(timeline) ? timeline.unavailable ?? [] : [timeline ? 'unsupported_history' : 'timeline_missing']
  }))]
  const incomplete = attempts.some(run => !validTimeline(run.businessExecution.timeline)
    || run.businessExecution.timeline.coverage !== 'complete' || !run.businessExecution.timeline.entries.length)
  if (incomplete || unavailable.length) records.push(make('$coverage', {
    kind: 'coverage', runId: current.runId, role: 'system', title: '部分执行记录不可用', status: 'unavailable', coverage: 'partial', unavailable,
  }))
  return records
}

// Old API snapshots still contain real receipt/effect results. Expose only those facts, never planned waits.
function legacyResults(run) {
  const execution = run.businessExecution, entries = []
  for (const [index, receipt] of (execution.results?.steps ?? []).entries()) {
    const id = `legacy:${run.runId}:step:${receipt.stepId}:${index}`
    const definition = execution.steps?.find(step => step.id === receipt.stepId)
    const common = { runId: run.runId, stepId: receipt.stepId, stageId: id, role: 'assistant', status: receipt.status }
    entries.push({ ...common, id, kind: 'stage', title: definition?.name || receipt.stepId })
    const content = owns(receipt, 'output') ? receipt.output : receipt.result
    if (content !== undefined) entries.push({ ...common, id: `${id}:result`, kind: 'result', title: '阶段结果', content })
    if (receipt.code) entries.push({ ...common, id: `${id}:failure`, kind: 'failure', title: '阶段未完成', content: { code: receipt.code } })
  }
  for (const [index, effect] of (execution.results?.effects ?? []).entries()) {
    entries.push({ id: `legacy:${run.runId}:effect:${index}`, runId: run.runId, kind: 'tool_result', role: 'assistant',
      title: '已完成操作', status: 'succeeded', toolName: effect.toolName, content: effect.result })
  }
  return entries
}

/** Union causal constraints, not timestamps. New snapshots replace facts with the same root-local id. */
function mergeCausalEntries(attempts) {
  const facts = new Map(), edges = new Map(), incoming = new Map()
  for (const run of attempts) {
    const timeline = run.businessExecution.timeline
    if (!validTimeline(timeline)) continue
    let previous
    for (const entry of timeline.entries) {
      if (!entry || typeof entry.id !== 'string' || !kinds.has(entry.kind)) continue
      if (!facts.has(entry.id)) { edges.set(entry.id, new Set()); incoming.set(entry.id, 0) }
      facts.set(entry.id, entry)
      if (previous && previous !== entry.id && !edges.get(previous).has(entry.id)) {
        edges.get(previous).add(entry.id); incoming.set(entry.id, incoming.get(entry.id) + 1)
      }
      previous = entry.id
    }
  }
  const result = [], remaining = new Set(facts.keys())
  while (remaining.size) {
    const next = [...remaining].find(id => incoming.get(id) === 0)
    // Conflicting historical order cannot justify inventing a new causal sequence.
    if (next === undefined) break
    result.push(facts.get(next)); remaining.delete(next)
    for (const id of edges.get(next)) incoming.set(id, incoming.get(id) - 1)
  }
  return [...result, ...[...remaining].map(id => facts.get(id))]
}

function attachPending(records, run, make) {
  const execution = run.businessExecution
  if (run.status !== 'waiting' || !execution.currentStep?.id) return
  for (const [channel, pending] of [['input', execution.pendingInput], ['operation', execution.pendingOperation]]) {
    if (!pending?.actionId || (pending.runId !== undefined && pending.runId !== run.runId) || pending.stepId !== execution.currentStep.id) continue
    const operation = channel === 'operation'
    if (operation && (!pending.operationId || !['pending', 'approved', 'rejected'].includes(pending.status))) continue
    const kind = operation || pending.kind === 'confirmation' ? 'confirmation' : pending.kind === 'userInput' ? 'question' : undefined
    if (!kind) continue
    const match = records.findLast(entry => entry.kind === kind && (entry.status === 'pending' || operation && entry.status === 'answered') && entry.runId === run.runId
      && entry.stepId === pending.stepId && (operation
        ? entry.operationId === pending.operationId && entry.toolName === pending.toolName && same(entry.content?.parameters, pending.parameters)
        : entry.content?.prompt === pending.prompt && same(entry.content?.displayInput, pending.displayInput)))
    if (match) match.pending = pending
    else records.push(make(`$pending:${pending.actionId}`, {
      kind, role: 'assistant', runId: run.runId, stepId: pending.stepId, title: pending.prompt || '请确认业务操作', status: 'pending',
      current: true, pending, content: operation ? { toolName: pending.toolName, parameters: pending.parameters } : { prompt: pending.prompt, displayInput: pending.displayInput },
    }))
  }
}

/** Optional renderer adapter: details go into their stage's collapsed section; user history stays visible. */
export function groupBusinessConversationEntries(entries) {
  const stages = new Map(entries.filter(entry => entry.type === 'business' && entry.kind === 'stage')
    .map(entry => [key(entry.rootRunId, entry.stageId ?? entry.sourceId), { ...entry, details: [] }]))
  return entries.flatMap(entry => {
    if (entry.type !== 'business') return [entry]
    if (entry.kind === 'stage') return [stages.get(key(entry.rootRunId, entry.stageId ?? entry.sourceId))]
    const stage = entry.stageId && stages.get(key(entry.rootRunId, entry.stageId))
    if (entry.detail && stage) { stage.details.push(entry); return [] }
    return [entry]
  })
}

/** Code-point encoding is deterministic, DOM-safe and collision-free, including non-ASCII server IDs. */
export function businessEntryDomId(entry) {
  return `business-${Array.from(entry.id).map(character => character.codePointAt(0).toString(16)).join('-')}`
}
