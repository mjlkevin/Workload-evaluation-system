import ToolCallChip from './ToolCallChip.jsx'
import { TOOL_CALL_STATUS } from '../../utils/messageFormatter.js'

/**
 * 本轮 Run 的工具痕迹托盘（批次 1b）。
 *
 * 它补的是刷新后的那段真空：异步 Run 的会话消息要到本轮收尾才落库，
 * 而写工具是在半路挂起的——重新打开会话时消息区里什么都没有，
 * 「在等你确认」这件事就没有落脚处。痕迹本身不新建副本，
 * 内容由「按 run 读取工具事件」的只读接口重建，与气泡内的 chip 同一个归约。
 *
 * 刻意不是弹窗：弹窗会盖住正在流式输出的回答（工单口径）。
 */
export default function RunToolTray({ calls, toolActionState, onApprove, onReject }) {
  const list = Array.isArray(calls) ? calls.filter((call) => call && (call.name || call.approval)) : []
  if (!list.length) return null
  const hasAwaiting = list.some((call) => call.status === TOOL_CALL_STATUS.AWAITING_APPROVAL)

  return (
    <div
      role="group"
      aria-label={hasAwaiting ? '等待你确认的写操作' : '本轮工具调用痕迹'}
      className={`m-0 mt-0 flex flex-col gap-1.5 rounded-md border px-3 py-2 text-xs ${
        hasAwaiting ? 'border-warn/50 bg-warn-soft' : 'border-line bg-bg-soft'
      }`}
      style={{ margin: '0 20px' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[12px] text-ink">{hasAwaiting ? '这个任务在等你确认' : '本轮工具调用'}</b>
        {hasAwaiting && (
          <span className="text-ink-3">不点就一直等着——系统不会替你决定，也不会超时自动放行</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((call, idx) => (
          <ToolCallChip
            key={`${call.name || 'tool'}-${idx}`}
            call={call}
            streaming
            onApprove={onApprove}
            onReject={onReject}
            actionState={call.approval?.actionId ? toolActionState?.[call.approval.actionId] : undefined}
          />
        ))}
      </div>
    </div>
  )
}
