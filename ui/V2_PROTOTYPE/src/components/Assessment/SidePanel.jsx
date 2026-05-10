import React from 'react'
import AiCopilot from './AiCopilot.jsx'

export default function SidePanel({ kpi, summary, aiCopilot }) {
  const ratio = kpi.baseDays > 0 ? Math.round((kpi.baseDays / kpi.totalDays) * 100) : 0

  return (
    <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
      {/* Donut card */}
      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
          padding: 16,
          boxShadow: 'var(--shadow-1)',
        }}
      >
        <div style={{ display: 'grid', placeItems: 'center', gap: 10, marginBottom: 10 }}>
          {/* CSS conic-gradient donut */}
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: `conic-gradient(var(--brand) 0 ${ratio}%, var(--line) 0 100%)`,
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 10,
                borderRadius: '50%',
                background: '#fff',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                {ratio}%
              </span>
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>基础包占比</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--ink-3)' }}>
          <span>总人天</span>
          <b className="mono">{kpi.totalDays}</b>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
          <span>基础人天</span>
          <b className="mono">{kpi.baseDays}</b>
        </div>
      </div>

      {/* AI Copilot */}
      {aiCopilot && <AiCopilot data={aiCopilot} />}

      {/* Verify card */}
      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
          padding: 16,
          boxShadow: 'var(--shadow-1)',
        }}
      >
        <h4 style={{ margin: '0 0 10px', fontSize: 14 }}>校验摘要</h4>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', display: 'grid', gap: 6 }}>
          <div className="mono">规则版本：<span>{summary.ruleVersion}</span></div>
          <div className="mono">流水线版本：<span>{summary.pipelineVersion}</span></div>
          <div className="mono">最近运行：<span>{summary.lastRun}</span></div>
        </div>
      </div>
    </div>
  )
}
