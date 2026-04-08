'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

function Table({
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<'table'> & { containerClassName?: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const tableRef = React.useRef<HTMLTableElement>(null)
  const previewRef = React.useRef<HTMLDivElement>(null)
  const [preview, setPreview] = React.useState<{
    text: string
    top: number
    left: number
    maxWidth: number
  } | null>(null)

  React.useEffect(() => {
    const table = tableRef.current
    if (!table) return
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth || 0 : 0
    const maxSafeTableWidth = Math.max(1600, Math.round(viewportWidth * 2.2))
    const currentMinWidth = Number((table.style.minWidth || '').replace('px', '').trim())
    if (Number.isFinite(currentMinWidth) && currentMinWidth > maxSafeTableWidth) {
      table.style.minWidth = `${maxSafeTableWidth}px`
    }

    const headerCells = Array.from(table.querySelectorAll('thead th'))
    if (!headerCells.length) return

    // 默认按内容估算列宽，并对长文本列做上限控制，避免盲目拉宽。
    const allRows = Array.from(table.querySelectorAll('tr'))
    for (let colIndex = 0; colIndex < headerCells.length; colIndex += 1) {
      const columnCells = allRows
        .map((row) => row.children.item(colIndex) as HTMLElement | null)
        .filter(Boolean) as HTMLElement[]
      if (!columnCells.length) continue

      const textSamples = columnCells
        .filter((cell) => !cell.querySelector('input, textarea, select, button, [role="button"]'))
        .map((cell) => (cell.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 24)

      if (!textSamples.length) continue
      const maxLength = Math.max(...textSamples.map((t) => t.length))
      const targetWidth = Math.max(96, Math.min(320, maxLength * 9 + 36))
      columnCells.forEach((cell) => {
        if ((cell as HTMLElement).dataset.manualWidth === '1') return
        ;(cell as HTMLElement).style.width = `${targetWidth}px`
        ;(cell as HTMLElement).style.maxWidth = `${targetWidth}px`
      })
    }
  }, [children])

  React.useEffect(() => {
    if (!preview) return
    function onDocClick(event: MouseEvent) {
      const target = event.target as HTMLElement
      if (previewRef.current?.contains(target)) return
      setPreview(null)
    }
    function onEsc(event: KeyboardEvent) {
      if (event.key === 'Escape') setPreview(null)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [preview])

  function handleTableClick(event: React.MouseEvent<HTMLTableElement>) {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select, button, [role="button"], a')) return
    const cell = target.closest('td') as HTMLTableCellElement | null
    if (!cell) return
    const text = (cell.textContent || '').trim()
    if (text.length < 20) return
    const rect = cell.getBoundingClientRect()
    const maxWidth = Math.min(560, Math.max(320, Math.floor(window.innerWidth * 0.45)))
    const left = Math.min(rect.left, window.innerWidth - maxWidth - 16)
    setPreview({
      text,
      top: rect.bottom + 8,
      left: Math.max(12, left),
      maxWidth,
    })
  }

  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className={cn("relative w-full min-w-0 max-w-full overflow-x-auto", containerClassName)}
    >
      <table
        ref={tableRef}
        data-slot="table"
        className={cn(
          'w-full min-w-full caption-bottom text-sm [&_th]:border-r [&_th]:border-border/50 [&_th:last-child]:border-r-0 [&_td]:border-r [&_td]:border-border/50 [&_td:last-child]:border-r-0',
          className,
        )}
        onClick={handleTableClick}
        {...props}
      >
        {children}
      </table>
      {preview ? (
        <div
          ref={previewRef}
          className="fixed z-50 rounded-lg border border-border bg-popover p-3 text-sm leading-6 shadow-xl"
          style={{ top: preview.top, left: preview.left, maxWidth: preview.maxWidth }}
        >
          <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-popover-foreground">{preview.text}</div>
        </div>
      ) : null}
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  function onStartResize(event: React.MouseEvent<HTMLSpanElement>) {
    event.preventDefault()
    event.stopPropagation()
    const th = event.currentTarget.closest('th') as HTMLTableCellElement | null
    const table = th?.closest('table') as HTMLTableElement | null
    if (!th || !table || !th.parentElement) return
    const colIndex = Array.from(th.parentElement.children).indexOf(th)
    if (colIndex < 0) return
    const isLastColumn = colIndex === th.parentElement.children.length - 1
    const container = table.closest('[data-slot="table-container"]') as HTMLElement | null

    const startX = event.clientX
    const startWidth = th.getBoundingClientRect().width
    const containerWidth = container?.clientWidth || table.getBoundingClientRect().width
    const baseTableWidth = Math.max(containerWidth, table.getBoundingClientRect().width, table.scrollWidth)
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth || 0 : 0
    const maxColumnWidth = Math.max(320, Math.round(viewportWidth * 0.55) || 560)
    const maxTableWidth = Math.max(1600, Math.round(viewportWidth * 2.2) || 2200)
    const cells = Array.from(table.querySelectorAll(`tr > *:nth-child(${colIndex + 1})`)) as HTMLElement[]
    table.style.tableLayout = 'fixed'
    table.style.minWidth = `${Math.min(baseTableWidth, maxTableWidth)}px`

    function onMove(moveEvent: MouseEvent) {
      const nextWidth = Math.min(maxColumnWidth, Math.max(88, startWidth + (moveEvent.clientX - startX)))
      cells.forEach((cell) => {
        cell.style.width = `${nextWidth}px`
        cell.style.minWidth = `${nextWidth}px`
        cell.style.maxWidth = `${nextWidth}px`
        cell.dataset.manualWidth = '1'
      })
      if (isLastColumn) {
        const delta = nextWidth - startWidth
        const nextTableWidth = Math.min(maxTableWidth, Math.max(containerWidth, Math.round(baseTableWidth + delta)))
        table.style.minWidth = `${nextTableWidth}px`
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-foreground relative h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    >
      {props.children}
      <span
        aria-hidden="true"
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none"
        onMouseDown={onStartResize}
      />
    </th>
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-2 align-middle whitespace-nowrap overflow-hidden text-ellipsis [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
