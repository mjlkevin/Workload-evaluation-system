import React from 'react'

export default function KpiCards({ kpi, dsl }) {
  const safeKpi = kpi || {}
  const {
    totalDays = 0,
    baseDays = 0,
    userIncrementDays = 0,
    difficultyIncrementDays = 0,
    orgIncrementDays = 0,
    selectedCount = 0,
    totalItemCount = 0,
    cloudDistribution = [],
  } = safeKpi
  const increments = [
    { label: '基础', value: baseDays, flex: baseDays, color: 'oklch(0.78 0.14 262)' },
    { label: '用户', value: userIncrementDays, flex: userIncrementDays, color: 'oklch(0.69 0.18 45)' },
    { label: '难度', value: difficultyIncrementDays, flex: difficultyIncrementDays, color: 'oklch(0.66 0.10 195)' },
    { label: '组织', value: orgIncrementDays, flex: orgIncrementDays, color: 'oklch(0.66 0.10 195)' },
  ].filter((x) => x.value > 0)

  const totalFlex = increments.reduce((s, x) => s + x.flex, 0) || 1

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.6fr 1fr 1fr 1fr',
        gap: 12,
        marginBottom: 14,
      }}
    >
      {/* 主结果卡 */}
      <div
        style={{
          background: 'linear-gradient(135deg, oklch(0.42 0.14 262) 0%, oklch(0.32 0.12 262) 100%)',
          color: '#fff',
          border: 0,
          borderRadius: 'var(--r-lg, 12px)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <span style={{ fontSize: 11, color: 'oklch(0.85 0.04 262)', fontWeight: 500 }}>总评估人天 · 实时</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 38, color: '#fff', fontWeight: 700 }}>
              {totalDays}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 10.5,
                fontWeight: 600,
                background: 'oklch(0.69 0.18 45)',
                color: '#fff',
              }}
            >
              +{baseDays > 0 ? Math.round(((totalDays - baseDays) / baseDays) * 100) : 0}% vs 标准
            </span>
          </div>
        </div>

        {/* waterfall */}
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              display: 'flex',
              height: 10,
              borderRadius: 999,
              overflow: 'hidden',
              gap: 2,
            }}
          >
            {increments.map((inc, i) => (
              <div
                key={i}
                style={{
                  flex: inc.flex,
                  background: inc.color,
                  minWidth: 4,
                }}
                title={`${inc.label} ${inc.value > 0 ? '+' : ''}${inc.value}`}
              />
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10.5,
              marginTop: 6,
              color: 'oklch(0.85 0.04 262)',
            }}
          >
            {increments.map((inc, i) => (
              <span key={i}>
                {inc.label} <b style={{ color: '#fff' }}>{inc.value > 0 && inc.label !== '基础' ? '+' : ''}{inc.value}</b>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 辅助卡 1：勾选条目 */}
      <div
        style={{
          background: 'var(--surface, #fff)',
          border: '1px solid var(--line, #e5e7eb)',
          borderRadius: 'var(--r-lg, 12px)',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--ink-3, #6b7280)', fontWeight: 500 }}>勾选条目 / 基础</span>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink, #1f2937)', marginTop: 2 }}>
          {selectedCount}
          <small style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 500 }}> / {totalItemCount}</small>
        </div>
        <div
          style={{
            height: 3,
            background: 'var(--bg-2, #e5e7eb)',
            borderRadius: 999,
            marginTop: 8,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${(selectedCount / Math.max(1, totalItemCount)) * 100}%`,
              background: 'var(--brand, #4f46e5)',
            }}
          />
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 4 }}>
          已选 1 SKU · 1 模块
        </span>
      </div>

      {/* 辅助卡 2：云产品分布 */}
      <div
        style={{
          background: 'var(--surface, #fff)',
          border: '1px solid var(--line, #e5e7eb)',
          borderRadius: 'var(--r-lg, 12px)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--ink-3, #6b7280)', fontWeight: 500, marginBottom: 10 }}>云产品工作量</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flex: 1 }}>
          {/* conic-gradient donut */}
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: `conic-gradient(var(--brand, #4f46e5) 0 ${cloudDistribution[0]?.percentage || 0}%, var(--accent, #f59e0b) 0 100%)`,
              position: 'relative',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 12,
                borderRadius: '50%',
                background: 'var(--surface)',
              }}
            />
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.7 }}>
            {cloudDistribution.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: i === 0 ? 'var(--brand, #4f46e5)' : 'var(--accent, #f59e0b)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: 'var(--ink-2)' }}>{c.name} {c.percentage}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 辅助卡 3：DSL 校验 */}
      <div
        style={{
          background: 'var(--surface, #fff)',
          border: '1px solid var(--line, #e5e7eb)',
          borderRadius: 'var(--r-lg, 12px)',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--ink-3, #6b7280)', fontWeight: 500 }}>DSL 依赖校验</span>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: dsl?.passed ? 'var(--ok, #10b981)' : 'var(--err, #dc2626)',
            marginTop: 2,
          }}
        >
          {dsl?.passed ? '✓ 通过' : `⚠ ${dsl?.issues?.length || 0} 条`}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6, fontSize: 10.5, color: 'var(--ink-3)' }}>
          <span>{dsl?.issues?.filter((i) => i.blocking).length || 0} 条阻断</span>
          <span>{dsl?.issues?.filter((i) => !i.blocking).length || 0} 条警告</span>
        </div>
      </div>
    </div>
  )
}
