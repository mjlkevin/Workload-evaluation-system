import StatusPanel from '../StatusPanel/index.jsx'
import { ResultCard } from './ReportBits.jsx'

/**
 * 右侧工作区（inspector）：折叠条 + 执行链路时间线 + 输出资产卡片。
 */
export default function WorkspacePanel({
  collapsed,
  onToggle,
  session,
  sending,
  onConfirmAction,
  confirmingActionId,
  messageCount,
  outputState,
}) {
  return (
    <aside className={`ai-home-inspector${collapsed ? ' ai-home-inspector--collapsed' : ''}`} role="complementary" aria-label="AI 工作区" aria-expanded={!collapsed}>
      <div className="ai-home-inspector__bar">
        {!collapsed && <b>工作区</b>}
        <button
          className={`ai-home-inspector__toggle${collapsed ? ' ai-home-inspector__toggle--collapsed' : ''}`}
          type="button"
          aria-label={collapsed ? '展开工作区' : '折叠工作区'}
          title={collapsed ? '展开工作区' : '折叠工作区'}
          onClick={onToggle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
      <div className={`ai-home-inspector__content${collapsed ? ' ai-home-inspector__content--hidden' : ''}`}>
        <StatusPanel session={session} sending={sending} onConfirmAction={onConfirmAction} confirmingActionId={confirmingActionId} />
        <ResultCard title={messageCount ? outputState.activeTitle : outputState.title}>
          {messageCount ? outputState.activeDesc : outputState.empty}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {outputState.outputs.map((item) => <span key={item} className="tag wes-output-tag">{item}</span>)}
          </div>
        </ResultCard>
      </div>
    </aside>
  )
}
