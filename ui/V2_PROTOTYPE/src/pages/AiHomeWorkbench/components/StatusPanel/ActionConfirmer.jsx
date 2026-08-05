import PendingActionCard from '../../../../components/AiWorkbench/PendingActionCard.jsx'

/**
 * 待确认动作列表：AI 建议创建项目/推送评估时等待用户确认。
 */
export default function ActionConfirmer({ pendingActions, onConfirmAction, confirmingActionId }) {
  if (!pendingActions.length) return null
  return (
    <>
      {pendingActions.map((action) => (
        <PendingActionCard
          key={action.actionId || action.title}
          action={action}
          onConfirm={onConfirmAction}
          confirming={confirmingActionId === (action.actionId || action.title)}
        />
      ))}
    </>
  )
}
