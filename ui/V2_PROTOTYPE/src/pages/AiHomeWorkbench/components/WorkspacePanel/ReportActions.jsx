/**
 * 报告卡片动作区：Harness 下一步动作确认按钮与 v1→v2 补充提交。
 */
export default function ReportActions({
  artifact,
  nextActionItems,
  isHarnessReport,
  isV2HarnessReport,
  confirmingActionId,
  onAction,
  submitState,
  supplementAnswers,
  submitStructuredSupplement,
}) {
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(nextActionItems.length ? nextActionItems : [{ label: '补充项目信息' }, { label: '生成待确认问题' }, { label: '进入正式评估' }]).map((action) => {
          const actionKey = `${artifact.harnessRunId || ''}-${action.actionType || action.label}`
          const isConfirming = confirmingActionId === actionKey
          return (
            <button
              key={action.actionType || action.label}
              className="btn btn-out"
              type="button"
              style={{ height: 30 }}
              disabled={!isV2HarnessReport || !action.actionType || isConfirming}
              title={
                isV2HarnessReport && action.actionType
                  ? '点击确认该 Harness 下一步动作'
                  : '下一阶段接入 Harness 动作确认后启用'
              }
              onClick={isV2HarnessReport && action.actionType ? () => onAction?.(artifact, action) : undefined}
            >
              {isConfirming ? '确认中…' : action.label}
            </button>
          )
        })}
      </div>
      {isHarnessReport && !isV2HarnessReport && (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-pri"
            type="button"
            onClick={submitStructuredSupplement}
            disabled={submitState.loading || !supplementAnswers.length}
            style={{ height: 32 }}
          >
            {submitState.loading ? '生成中…' : '提交补充并生成 v2'}
          </button>
          <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
            {supplementAnswers.length ? `待提交 ${supplementAnswers.length} 项补充` : '双击字段后可提交补充'}
          </span>
          {submitState.error && <span role="alert" style={{ color: 'var(--err)', fontSize: 12 }}>{submitState.error}</span>}
        </div>
      )}
    </>
  )
}
