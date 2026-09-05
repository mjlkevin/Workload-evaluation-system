import { TOOL_CALL_STATUS } from '../../utils/messageFormatter.js'

/**
 * 单个工具调用 chip（批次 0.5 · ③ 建形，批次 1b 挂上审批决策）。
 *
 * 批次 1b 的口径：写工具的「等你确认」不长成模态弹窗——弹窗会把正在流式输出的
 * 回答挡在身后。它就是这个 chip 多出来的一截：要批准的是哪个工具、带着什么参数、
 * 点下去会发生什么，全部就地摊开。参数只可能来自同 callId 的 tool.call.started
 * 那一份（服务端约束②：审批事件不带第二份参数）。
 */
export default function ToolCallChip({
  call,
  streaming,
  onApprove,
  onReject,
  actionState,
}) {
  const approval = call.approval
  const awaiting = call.status === TOOL_CALL_STATUS.AWAITING_APPROVAL
  const argEntries = awaiting || call.status === TOOL_CALL_STATUS.REJECTED
    ? formatToolCallArgs(approval?.arguments)
    : []
  const pending = actionState?.pending === true
  const error = actionState?.error

  return (
    <span
      className="inline-flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-bg-soft px-1.5 py-0.5 text-[11px] text-ink-2"
      data-tool-call={call.name}
    >
      <code className="border-0 bg-transparent p-0 font-mono text-ink">{call.name}</code>
      {call.source === 'list_tools' && <em className="not-italic text-ink-3">· 经发现</em>}
      {argEntries.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5" aria-label="待批准参数">
          {argEntries.map((entry) => (
            <span key={entry.key} className="inline-flex items-center gap-0.5 text-ink-3">
              <span className="font-mono">{entry.key}=</span>
              <span title={entry.value} className="text-ink">{entry.value}</span>
            </span>
          ))}
        </span>
      )}
      <ToolCallStatusTag call={call} streaming={streaming} pending={pending} />
      {awaiting && (
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            aria-label={`同意 ${call.name}`}
            disabled={pending}
            onClick={() => onApprove?.(call)}
            className="btn btn-pri inline-flex min-h-[22px] cursor-pointer items-center rounded-md px-2 py-0.5 text-[11px]"
            style={{ height: 22 }}
          >
            {pending ? '提交中…' : '同意'}
          </button>
          <button
            type="button"
            aria-label={`拒绝 ${call.name}`}
            disabled={pending}
            onClick={() => onReject?.(call)}
            className="btn btn-out inline-flex min-h-[22px] cursor-pointer items-center rounded-md px-2 py-0.5 text-[11px]"
            style={{ height: 22 }}
          >
            拒绝
          </button>
        </span>
      )}
      {error && (
        <em role="alert" className="not-italic text-err">{error}</em>
      )}
    </span>
  )
}

/**
 * 工具调用状态标签：开始 → 等你确认 →（已同意）执行中 → 完成 / 失败 / 已拒绝。
 * 存量数据无 status 时不渲染任何标签，保持批次 0.5 之前的行为。
 */
function ToolCallStatusTag({ call, streaming, pending }) {
  const elapsed = formatToolCallElapsed(call.elapsedMs)
  if (call.status === TOOL_CALL_STATUS.AWAITING_APPROVAL) {
    return (
      <em className="not-italic font-bold text-warn-ink">
        · {pending ? '已提交，等待服务端受理…' : '等你确认'}
      </em>
    )
  }
  if (call.status === TOOL_CALL_STATUS.REJECTED) {
    return <em className="not-italic text-ink-3">· 已拒绝</em>
  }
  if (call.status === TOOL_CALL_STATUS.RUNNING) {
    // 流已结束却仍残留 running，只说明本轮未收到终态帧，不臆造「运行中」。
    if (!streaming && !call.approval) return null
    const label = call.approval?.approved ? '已同意 · 执行中' : '运行中'
    return <em className="not-italic text-brand">· {label}{elapsed ? ` ${elapsed}` : ''}</em>
  }
  if (call.status === TOOL_CALL_STATUS.COMPLETED) {
    return <em className="not-italic text-ink-3">· 已完成{elapsed ? ` ${elapsed}` : ''}</em>
  }
  if (call.status === TOOL_CALL_STATUS.FAILED) {
    return (
      <em className="not-italic text-warn">
        · 失败{elapsed ? ` ${elapsed}` : ''}{call.errorPreview ? ` · ${call.errorPreview}` : ''}
      </em>
    )
  }
  return null
}

/**
 * 参数摘要：只挑标量字段、最多 4 个、单值截到 60 字符。
 * 按钮旁要的是「我要批准的是不是这件事」，不是把整个 JSON 摊给用户；
 * 完整参数始终在服务端那一份事件里，本处只做可读投影。
 */
const MAX_ARG_ROWS = 4
const MAX_ARG_VALUE_CHARS = 60

export function formatToolCallArgs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const source = value.args && typeof value.args === 'object' && !Array.isArray(value.args)
    ? { ...value, ...value.args }
    : value
  const rows = []
  for (const [key, item] of Object.entries(source)) {
    if (rows.length >= MAX_ARG_ROWS) break
    if (item === null || item === undefined) continue
    const type = typeof item
    if (type !== 'string' && type !== 'number' && type !== 'boolean') continue
    const text = String(item)
    if (!text.trim()) continue
    rows.push({ key, value: text.length > MAX_ARG_VALUE_CHARS ? `${text.slice(0, MAX_ARG_VALUE_CHARS - 1)}…` : text })
  }
  return rows
}

/** 耗时可读化：< 1s 用毫秒，其余保留一位小数秒 */
function formatToolCallElapsed(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}
