import { useEffect, useState } from 'react'

/* ─────────────────────────────────────────────────────────
 * LoadingState — pixel-grid loader，思考中 / 长任务执行中占位
 * Phase 1 首个 Tailwind 验证用例：布局/尺寸/颜色/字体走 Tailwind
 * utility class（bg-ink / text-ink-3 走 @theme 桥接的设计变量）；
 * 每格动画的 delay 因元素而异，无法静态提取成类名，保留内联 style。
 * ───────────────────────────────────────────────────────── */

const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3)
  const c = i % 3
  return (c + Math.abs(r - 1)) * 90
})

function useElapsed() {
  const [ds, setDs] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100)
    return () => clearInterval(t)
  }, [])
  const total = ds / 10
  if (total < 60) return `${total.toFixed(1)}s`
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`
}

export default function LoadingState({ label = '正在调用模型并组织回复' } = {}) {
  const elapsed = useElapsed()

  return (
    <div className="flex w-fit items-center gap-2.5">
      <span aria-hidden="true" className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {CHEVRON_DELAYS.map((delay, i) => (
          <span
            key={i}
            className="size-1 rounded-[1px] bg-ink opacity-15 animate-pixel-on"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span
        className="bg-[linear-gradient(90deg,var(--color-ink-3)_35%,var(--color-ink)_50%,var(--color-ink-3)_65%)] bg-[length:200%_100%] bg-clip-text text-[13px] font-medium text-transparent animate-shimmer"
      >
        {label}
      </span>
      <span className="font-mono text-[12px] text-ink-3 tabular-nums">
        {elapsed}
      </span>
    </div>
  )
}
