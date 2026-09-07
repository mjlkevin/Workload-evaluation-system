import InteractiveFormCard from '../../../../components/AiWorkbench/InteractiveFormCard.jsx'
import { pendingInteractiveForms } from '../../utils/messageFormatter.js'

/**
 * 批次 9 · ask_user 控件挂载点。
 *
 * 控件本身（InteractiveFormCard）早就存在且不改一行：本组件只负责把「一条工具痕迹」
 * 翻译成「一次可提交的提问」，并把提交动作交给上层——因为恢复 Run 走的是
 * POST /ai-runs/:runId/inputs，不是发消息。
 *
 * 气泡内与刷新后的托盘共用本组件：两处若各写一份提交逻辑，
 * 一定会出现「一边提交走 inputs、另一边还在发聊天消息」的分叉。
 */
export default function AskUserForm({ calls, actionState, disabled, onSubmit }) {
  const pending = pendingInteractiveForms(calls).filter(
    // 已提交过的立即撤下：worker 续跑前事件流还停在 awaiting_input，
    // 控件继续摆着只会诱导用户再点一次（那一次会撞上 409）。
    (call) => !actionState?.[call.input?.actionId]?.submitted,
  )
  if (!pending.length) return null

  return (
    <div className="flex flex-col gap-2">
      {pending.map((call) => {
        const actionId = call.input?.actionId
        const state = actionId ? actionState?.[actionId] : undefined
        return (
          <div key={`${actionId || call.name}-${call.input?.formBlock?.blockId || ''}`}>
            <InteractiveFormCard
              formBlock={call.input.formBlock}
              disabled={disabled || Boolean(state?.pending)}
              onSubmit={(messageText, detail) => onSubmit?.(call, messageText, detail?.values ?? {})}
            />
            {state?.pending && <p style={{ fontSize: 12, marginTop: 4 }}>提交中…</p>}
            {state?.error && (
              <p role="alert" style={{ fontSize: 12, marginTop: 4, color: 'var(--err)' }}>
                {state.error}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
