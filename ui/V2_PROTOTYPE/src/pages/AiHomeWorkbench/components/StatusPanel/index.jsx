import RunStageIndicator from './RunStageIndicator.jsx'

/**
 * 右侧工作区状态面板：会话执行链路时间线。
 * 由 components/AiWorkbench/ArtifactPanel 改造而来，行为保持一致。
 */
export default function StatusPanel({ session, sending, onConfirmAction, confirmingActionId }) {
  return (
    <RunStageIndicator
      session={session}
      sending={sending}
      onConfirmAction={onConfirmAction}
      confirmingActionId={confirmingActionId}
    />
  )
}
