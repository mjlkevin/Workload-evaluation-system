import React from 'react'

/**
 * CompanyLookupDialog — 检索客户主体弹窗
 *
 * 交互流程：
 *   打开 → loading spinner → 候选列表 → 用户选择 → 关闭
 *
 * Props:
 *   open        {boolean}  是否显示弹窗
 *   loading     {boolean}  是否正在检索
 *   candidates  {Array}    候选企业列表 [{ displayName, summary, industry, location, ... }]
 *   error       {string}   错误信息
 *   onClose     {Function} 关闭弹窗
 *   onSelect    {Function} 选择候选 (candidate) => void
 */
export default function CompanyLookupDialog({ open, loading, candidates, error, onClose, onSelect }) {
  if (!open) return null

  return (
    <div
      role="presentation"
      onClick={(event) => event.target === event.currentTarget && !loading && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'rgba(15,23,42,0.42)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-lookup-title"
        style={{
          width: 'min(520px, 100%)',
          maxHeight: 'min(520px, 80vh)',
          background: '#fff',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          boxShadow: '0 24px 64px rgba(15,23,42,0.24)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 标题栏 */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          cursor: 'default',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              display: 'grid',
              placeItems: 'center',
              background: 'var(--brand-soft)',
              color: 'var(--brand)',
              fontWeight: 900,
              fontSize: 14,
            }}>🔍</span>
            <strong id="company-lookup-title" style={{ fontSize: 14 }}>检索客户主体</strong>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭检索主体弹窗"
            title="关闭"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--ink-3)',
              fontSize: 18,
              lineHeight: 1,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* 内容区 */}
        <div style={{ padding: 18, overflowY: 'auto', flex: 1, display: 'grid', gap: 12 }}>
          {/* Loading 态 */}
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0' }}>
              <div style={{
                width: 32,
                height: 32,
                border: '3px solid var(--line)',
                borderTopColor: 'var(--brand)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>正在检索近似企业…</span>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* 错误态 */}
          {!loading && error && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0' }}>
              <span style={{ color: 'var(--err)', fontSize: 13, textAlign: 'center' }}>{error}</span>
              <button
                type="button"
                className="btn btn-out"
                onClick={onClose}
                style={{ height: 30, fontSize: 12, padding: '0 16px' }}
              >
                关闭
              </button>
            </div>
          )}

          {/* 空结果态 */}
          {!loading && !error && candidates.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0' }}>
              <span style={{ fontSize: 28 }}>🔎</span>
              <span style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center' }}>未找到近似企业，请尝试更具体的关键词</span>
              <button
                type="button"
                className="btn btn-out"
                onClick={onClose}
                style={{ height: 30, fontSize: 12, padding: '0 16px' }}
              >
                关闭
              </button>
            </div>
          )}

          {/* 候选列表 */}
          {!loading && !error && candidates.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              {candidates.map((candidate, index) => {
                const displayName = candidate.displayName || candidate.customerName || candidate.name || candidate.title || `候选主体 ${index + 1}`
                const summary = candidate.summary || candidate.description || ''
                const meta = [candidate.industry, candidate.location].filter(Boolean).join(' · ')
                return (
                  <button
                    key={`${displayName}-${index}`}
                    type="button"
                    onClick={() => onSelect(candidate)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 4,
                      padding: '12px 14px',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-md)',
                      background: '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                      minHeight: 'auto',
                      height: 'auto',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--brand)'
                      e.currentTarget.style.boxShadow = '0 0 0 1px var(--brand-soft)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--line)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>{displayName}</span>
                    {summary && (
                      <span style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{summary}</span>
                    )}
                    {meta && (
                      <span style={{ fontSize: 11, color: 'var(--ink-3)', background: 'var(--bg-soft)', padding: '2px 8px', borderRadius: 999 }}>{meta}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
