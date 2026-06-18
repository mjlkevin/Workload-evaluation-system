import React from 'react'

export default function DaysCell({ value }) {
  let color = 'var(--ink, #1f2937)'
  let prefix = ''

  if (value > 10) {
    color = 'var(--err, #dc2626)'
    prefix = '⚠ '
  } else if (value >= 6) {
    color = 'oklch(0.50 0.14 50)'
  }

  return (
    <span
      className="mono"
      style={{
        fontWeight: 600,
        color,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {prefix}{value}
    </span>
  )
}
