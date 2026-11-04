import { describe, expect, it } from 'vitest'
import { mapSessionMessages, sameMessageList } from '../pages/AiHomeWorkbench/utils/messageFormatter.js'
import { buildBusinessConversationEntries as build, groupBusinessConversationEntries as group, businessEntryDomId } from '../pages/AiHomeWorkbench/utils/businessMessageTimeline.js'

const time = second => `2026-11-04T00:00:${String(second).padStart(2, '0')}.000Z`
const source = runId => ({ runId, deduplicationKey: `${runId}:user:1`, eventType: 'user_message' })
const anchor = (runId = 'r1') => ({ id: `chat-${runId}`, role: 'user', text: '执行：真实任务', createdAt: time(1), projectionSource: source(runId) })
const event = (id, kind, extra = {}) => ({ id, kind, role: ['answer', 'decision'].includes(kind) ? 'user' : 'assistant', title: id, status: 'succeeded', runId: 'r1', ...extra })
function run(entries, extra = {}) {
  const { execution = {}, ...fields } = extra
  return { runId: 'r1', sessionId: 's1', status: 'completed', createdAt: time(1), businessExecution: {
    kind: 'workflow', target: { name: '真实任务', versionId: 'v1' }, input: { description: '用户的完整业务描述' }, steps: [], results: {},
    timeline: { version: 1, rootRunId: 'r1', coverage: 'complete', unavailable: [], entries }, ...execution,
  }, ...fields }
}
const business = entries => entries.filter(item => item.type === 'business')

describe('business start projection source', () => {
  it('allowlists exactly three source fields and does not leak private metadata', () => {
    const [message] = mapSessionMessages({ sessionId: 's1', messages: [{ messageId: 'm', role: 'user', content: '执行任务', metadata: {
      projectionSource: { ...source('r1'), privateProof: 'must-not-copy' }, privateProof: 'must-not-copy', harnessRunId: 'wrong',
    } }] })
    expect(message.projectionSource).toEqual(source('r1'))
    expect(message).not.toHaveProperty('metadata')
    expect(message).not.toHaveProperty('harnessRunId')
    expect(JSON.stringify(message)).not.toContain('must-not-copy')
  })
  it.each([{}, { ...source('r1'), runId: 3 }, { ...source('r1'), deduplicationKey: 'wrong' }, { ...source('r1'), eventType: 'other' }])('rejects invalid source %j', projectionSource => {
    const [message] = mapSessionMessages({ messages: [{ role: 'user', content: '文本', metadata: { projectionSource } }] })
    expect(message.projectionSource).toBeUndefined()
  })
  it('detects an arriving source on hydration even when chat text has not changed', () => {
    const message = { id: 'm', role: 'user', text: '同文' }
    expect(sameMessageList([message], [{ ...message, projectionSource: source('r1') }])).toBe(false)
  })
})

describe('business conversation projection', () => {
  it('keeps ordinary messages, attachments, tools and copy properties by identity', () => {
    const chat = { id: 'chat', role: 'assistant', text: '普通聊天', file: { name: '真实附件.xlsx' }, toolCalls: [{ name: 'query' }], copyText: '可复制' }
    expect(build([chat], [])[0]).toBe(chat)
    expect(build([chat], [])).toEqual([chat])
  })
  it('anchors only by validated projection source and includes frozen input without inventing files', () => {
    const fake = { id: 'fake', role: 'user', text: '执行：真实任务', harnessRunId: 'r1', createdAt: time(0) }
    const actual = anchor()
    const result = build([fake, actual], [run([event('stage-a', 'stage')])])
    expect(result.indexOf(actual)).toBeLessThan(result.findIndex(item => item.kind === 'input'))
    const input = result.find(item => item.kind === 'input')
    expect(input.content).toEqual({ description: '用户的完整业务描述' })
    expect(input.role).toBe('user')
    expect(input).not.toHaveProperty('file')
    expect(result[0]).toBe(fake)
  })
  it('preserves causal workflow occurrences, questions, answers and false decisions', () => {
    const events = [event('stage:op:0', 'stage', { stepId: 'review', iteration: 0 }), event('q1', 'question'),
      event('a1', 'answer', { content: { selectedItemIds: [] } }), event('c1', 'confirmation'),
      event('d1', 'decision', { status: 'rejected', content: { approved: false } }), event('stage:op:1', 'stage', { stepId: 'review', iteration: 1 })]
    const result = business(build([anchor()], [run(events)]))
    expect(result.filter(item => item.kind !== 'input').map(item => item.sourceId)).toEqual(events.map(item => item.id))
    expect(result.find(item => item.kind === 'decision')).toMatchObject({ status: 'rejected', content: { approved: false } })
    expect(new Set(result.map(item => item.id)).size).toBe(result.length)
  })
  it('shows one standalone final output with citations, unmatched items and draft links intact', () => {
    const output = { requirements: [{ id: 'REQ-001', citations: ['line:3'] }], unmatched: ['库存'], draftUrl: '/draft/42' }
    const result = business(build([], [run([event('s', 'stage'), event('out', 'result', { content: output })], { execution: { kind: 'skill', results: { output } } })]))
    expect(result.filter(item => item.kind === 'result')).toHaveLength(1)
    expect(result.find(item => item.final)).toMatchObject({ content: output, kind: 'result' })
  })
  it('coalesces retry prefixes but keeps failed history and isolates unrelated roots', () => {
    const prefix = [event('s', 'stage'), event('done', 'result', { content: '阶段事实' })]
    const parent = run([...prefix, event('bad', 'failure', { status: 'failed' })], { status: 'failed' })
    const child = run([...prefix, event('decision-2', 'decision', { runId: 'r2', status: 'approved' })], { runId: 'r2', createdAt: time(5) })
    const other = run([event('s', 'stage')], { runId: 'other', createdAt: time(6), execution: { timeline: { version: 1, rootRunId: 'other', coverage: 'complete', unavailable: [], entries: [event('s', 'stage')] } } })
    const result = business(build([anchor()], [child, parent, other]))
    expect(result.filter(item => item.rootRunId === 'r1' && item.sourceId === 's')).toHaveLength(1)
    expect(result.some(item => item.sourceId === 'bad')).toBe(true)
    expect(result.some(item => item.sourceId === 'decision-2')).toBe(true)
    expect(result.filter(item => item.sourceId === 's')).toHaveLength(2)
  })
  it('retains repeated failures from distinct physical attempts without duplicating the inherited successful prefix', () => {
    const prefix = [event('stage:prefix:0', 'stage', { stageId: 'stage:prefix:0' })]
    const failure = event('failure:write:0', 'failure', { stageId: 'stage:write:0', status: 'failed', content: { code: 'WRITE_FAILED' } })
    const parent = run([...prefix, failure], { status: 'failed' })
    const child = run([...prefix, { ...failure, runId: 'r2' }], { runId: 'r2', status: 'failed', createdAt: time(5) })
    const entries = business(build([], [child, parent]))
    expect(entries.filter(entry => entry.kind === 'failure').map(entry => entry.runId)).toEqual(['r1', 'r2'])
    expect(entries.filter(entry => entry.kind === 'stage')).toHaveLength(1)
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length)
    expect(entries.filter(entry => entry.kind === 'failure').every(entry => entry.stageId === 'stage:write:0')).toBe(true)
  })
  it('retains real failed legacy parent receipts when the retry has a successful timeline', () => {
    const parent = run([], { status: 'failed', execution: { timeline: undefined, results: { steps: [
      { stepId: 'prefix', status: 'succeeded', output: '旧成功前缀' }, { stepId: 's', status: 'failed', code: 'TOOL_DENIED' },
    ] } } })
    const child = run([event('succeeded-stage', 'stage', { runId: 'r2', stepId: 's' })], { runId: 'r2', createdAt: time(5) })
    const records = business(build([], [child, parent]))
    expect(records.find(item => item.kind === 'failure')).toMatchObject({ runId: 'r1', stepId: 's', status: 'failed', content: { code: 'TOOL_DENIED' } })
    expect(records.filter(item => item.kind === 'stage')).toHaveLength(1)
    expect(records.some(item => item.content === '旧成功前缀')).toBe(false)
    expect(records.some(item => ['question', 'answer', 'decision'].includes(item.kind))).toBe(false)
  })
  it('preserves server order through timestamp ties and clock reversals without synthesizing stage timestamps', () => {
    const first = anchor()
    const chat = { id: 'later', role: 'assistant', text: '继续聊天', createdAt: time(3) }
    const events = [event('s', 'stage'), event('q', 'question', { occurredAt: time(4) }), event('a', 'answer', { occurredAt: time(2) }), event('s2', 'stage')]
    const result = build([first, chat], [run(events)])
    expect(business(result).filter(item => item.kind !== 'input').map(item => item.sourceId)).toEqual(['s', 'q', 'a', 's2'])
    expect(result.find(item => item.sourceId === 's')).not.toHaveProperty('occurredAt')
    expect(result.find(item => item.sourceId === 's2')).not.toHaveProperty('createdAt')
    expect(build([first, chat], [run(events)])).toEqual(result)
  })
  it('is stable on equal run timestamps independent of API run ordering', () => {
    const a = run([event('s', 'stage')])
    const b = run([], { runId: 'r2', execution: { timeline: { version: 1, rootRunId: 'r2', entries: [event('s', 'stage')], coverage: 'complete', unavailable: [] } } })
    expect(build([], [a, b])).toEqual(build([], [b, a]))
  })
  it('interleaves different roots by actual occurrence while retaining each root causal order', () => {
    const a = run([event('a', 'stage', { occurredAt: time(40) })])
    const b = run([], { runId: 'r2', createdAt: time(2), execution: { timeline: { version: 1, rootRunId: 'r2', coverage: 'complete', unavailable: [], entries: [event('b', 'stage', { occurredAt: time(20), runId: 'r2' })] } } })
    expect(business(build([], [a, b])).filter(item => item.kind === 'stage').map(item => item.sourceId)).toEqual(['b', 'a'])
  })
  it('filters other session runs and has no remembered state across refresh or session reset', () => {
    const own = run([event('s', 'stage')])
    const foreign = run([], { runId: 'foreign', sessionId: 's2' })
    const result = build([anchor()], [own, foreign], { sessionId: 's1' })
    expect(business(result).every(item => item.runId === 'r1')).toBe(true)
    expect(build([], [], { sessionId: 's2' })).toEqual([])
    expect(build([anchor()], [own], { sessionId: 's1' })).toEqual(result)
  })
  it('exposes missing, unsupported and empty histories explicitly without fabricated questions', () => {
    for (const timeline of [undefined, { version: 2 }, { version: 1, rootRunId: 'r1', entries: [], coverage: 'partial', unavailable: ['state_missing'] }]) {
      const result = business(build([], [run([], { execution: { timeline } })]))
      expect(result.some(item => item.kind === 'coverage' && item.coverage === 'partial')).toBe(true)
      expect(result.some(item => ['question', 'confirmation', 'answer'].includes(item.kind))).toBe(false)
    }
  })
  it('does not invent a physical source run when partial history has no receipt origin', () => {
    const fact = event('s', 'stage'); delete fact.runId
    const result = business(build([], [run([fact])]))
    expect(result.find(item => item.kind === 'stage')).not.toHaveProperty('runId')
    expect(result.find(item => item.kind === 'stage')?.currentRunId).toBe('r1')
  })
  it('keeps read-only legacy result facts when no timeline is available', () => {
    const legacy = run([], { execution: { timeline: undefined, steps: [{ id: 'real', name: '实际旧阶段' }],
      results: { steps: [{ stepId: 'real', status: 'succeeded', output: { requirementId: 'REQ-9' } }], effects: [{ toolName: 'old_tool', result: { draftUrl: '/draft/old' } }] } } })
    const records = business(build([], [legacy]))
    expect(records.find(item => item.kind === 'stage')?.title).toBe('实际旧阶段')
    expect(records.some(item => item.content?.requirementId === 'REQ-9')).toBe(true)
    expect(records.some(item => item.toolName === 'old_tool' && item.content?.draftUrl === '/draft/old')).toBe(true)
    expect(records.some(item => item.kind === 'question')).toBe(false)
  })
  it('groups stage details without swallowing independently visible historical user records', () => {
    const events = [event('s', 'stage', { stageId: 's' }), event('tool', 'tool_result', { stageId: 's', content: { result: 4 } }), event('a', 'answer', { stageId: 's', content: false })]
    const result = group(build([], [run(events)]))
    const stage = result.find(item => item.kind === 'stage')
    expect(stage.details.map(item => item.sourceId)).toEqual(['tool'])
    expect(result.some(item => item.kind === 'tool_result')).toBe(false)
    expect(result.find(item => item.kind === 'answer').content).toBe(false)
    expect(businessEntryDomId(stage)).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/)
    expect(businessEntryDomId(stage)).toBe(businessEntryDomId(stage))
  })
})

describe('pending descriptors remain server owned', () => {
  const pending = { kind: 'userInput', runId: 'r1', stepId: 'review', actionId: 'action', contentHash: 'hash', prompt: '请选择范围', displayInput: { items: [] }, outputSchema: { type: 'object' } }
  const question = event('q', 'question', { stepId: 'review', status: 'pending', content: { prompt: pending.prompt, displayInput: pending.displayInput } })
  const waiting = (status, descriptor = pending) => run([question], { status, execution: { currentStep: { id: 'review' }, pendingInput: descriptor } })
  it('attaches only the current matching actionable descriptor', () => {
    const result = business(build([], [waiting('waiting')]))
    expect(result.find(item => item.kind === 'question').pending).toBe(pending)
    expect(result.filter(item => item.pending)).toHaveLength(1)
  })
  it.each(['completed', 'cancelled', 'failed', 'running'])('never restores forms on a %s run', status => {
    expect(business(build([], [waiting(status)])).some(item => item.pending)).toBe(false)
  })
  it('rejects stale step, run and missing action identities', () => {
    for (const descriptor of [{ ...pending, stepId: 'old' }, { ...pending, runId: 'old' }, { ...pending, actionId: '' }]) {
      expect(business(build([], [waiting('waiting', descriptor)])).some(item => item.pending)).toBe(false)
    }
  })
  it('displays a changed current prompt separately and leaves the historical question intact', () => {
    const actual = { ...pending, prompt: '刷新后的新问题' }
    const result = business(build([], [waiting('waiting', actual)]))
    expect(result.find(item => item.sourceId === 'q')?.pending).toBeUndefined()
    expect(result.find(item => item.current)?.pending).toBe(actual)
  })
  it('never restores a parent wait after a newer retry has cancelled', () => {
    const child = run([question], { runId: 'r2', status: 'cancelled', createdAt: time(5), execution: { currentStep: { id: 'review' }, pendingInput: { ...pending, runId: 'r2' } } })
    expect(business(build([], [waiting('waiting'), child])).some(item => item.pending)).toBe(false)
  })
  it('accepts the production input descriptor which intentionally has no runId', () => {
    const { runId: _, ...actual } = pending
    expect(business(build([], [waiting('waiting', actual)])).find(item => item.kind === 'question')?.pending).toBe(actual)
  })
  it('preserves the actual current pending question even if history is unavailable', () => {
    const { runId: _, ...actual } = pending
    const result = business(build([], [run([], { status: 'waiting', execution: { timeline: undefined, currentStep: { id: 'review' }, pendingInput: actual } })]))
    expect(result.find(item => item.current)?.pending).toBe(actual)
    expect(result.find(item => item.current)?.content).toEqual({ prompt: actual.prompt, displayInput: actual.displayInput })
  })
  it.each(['pending', 'approved', 'rejected'])('retains the production native operation descriptor in %s state', status => {
    const operation = { actionId: 'native-action', operationId: 'write-1', stepId: 'review', toolName: 'actual_tool', parameters: { title: '范围' }, confirmationHash: 'actual-hash', status }
    const confirmation = event('native-question', 'confirmation', { stepId: 'review', operationId: 'write-1', toolName: 'actual_tool', status: status === 'pending' ? 'pending' : 'answered', content: { toolName: 'actual_tool', parameters: operation.parameters } })
    const result = business(build([], [run([confirmation], { status: 'waiting', execution: { currentStep: { id: 'review' }, pendingOperation: operation } })]))
    expect(result.find(item => item.kind === 'confirmation')?.pending).toBe(operation)
    expect(result.filter(item => item.pending)).toHaveLength(1)
  })
})
