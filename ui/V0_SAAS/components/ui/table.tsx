'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

/** 表头/单元格右侧竖线栅格，全局统一，避免在各页重复拼接 Tailwind */
export const wesTableCellGridClassName =
  '[&_th]:border-r [&_th]:border-border/50 [&_thead_th]:border-border/40 [&_th:last-child]:border-r-0 [&_td]:border-r [&_td]:border-border/50 [&_td:last-child]:border-r-0'

/** 滚动区域内粘性表头（含打印时回落为静态） */
export const wesTableHeaderStickyClassName =
  'sticky top-0 z-20 backdrop-blur-sm print:static print:z-auto'

/** 工具栏式表头行：与数据行 hover 区分，避免表头行出现斑马 hover */
export const wesTableToolbarHeaderRowClassName = 'border-border/50 hover:bg-transparent'

/** 高密度数据表（多列清单、方案列表等） */
export const wesTableDensityCompactClassName =
  '[&_th]:!h-auto [&_th]:!min-h-0 [&_th]:!px-1.5 [&_th]:!py-1.5 [&_th]:!text-xs [&_th]:!font-medium [&_th]:!leading-tight [&_td]:!p-1.5 [&_td]:!text-xs [&_td]:leading-tight'

export type WesTableDensity = 'default' | 'compact'

function Table({
  className,
  containerClassName,
  density = 'default',
  children,
  ...props
}: React.ComponentProps<'table'> & {
  containerClassName?: string
  /** default：标准行高；compact：更小表头/单元格内边距与字号 */
  density?: WesTableDensity
}) {
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
    if (cell.hasAttribute('data-skip-table-preview')) return
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
    <>
      <div className="relative w-full min-w-0 max-w-full overflow-hidden rounded-md border border-border/50">
        <div
          ref={containerRef}
          data-slot="table-container"
          className={cn('w-full min-w-0 overflow-x-auto', containerClassName)}
        >
          <table
            ref={tableRef}
            data-slot="table"
            className={cn(
              'w-full min-w-full caption-bottom text-sm',
              wesTableCellGridClassName,
              density === 'compact' ? wesTableDensityCompactClassName : null,
              className,
            )}
            onClick={handleTableClick}
            {...props}
          >
            {children}
          </table>
        </div>
      </div>
      {preview ? (
        <div
          ref={previewRef}
          className="fixed z-50 rounded-lg border border-border bg-popover p-3 text-sm leading-6 shadow-xl"
          style={{ top: preview.top, left: preview.left, maxWidth: preview.maxWidth }}
        >
          <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-popover-foreground">{preview.text}</div>
        </div>
      ) : null}
    </>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        'text-foreground shadow-sm [&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent',
        className,
      )}
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
    const tableEl = table
    const colIndex = Array.from(th.parentElement.children).indexOf(th)
    if (colIndex < 0) return
    const isLastColumn = colIndex === th.parentElement.children.length - 1
    const container = tableEl.closest('[data-slot="table-container"]') as HTMLElement | null

    const startX = event.clientX
    const startWidth = th.getBoundingClientRect().width
    const containerWidth = container?.clientWidth || tableEl.getBoundingClientRect().width
    const baseTableWidth = Math.max(containerWidth, tableEl.getBoundingClientRect().width, tableEl.scrollWidth)
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth || 0 : 0
    const maxColumnWidth = Math.max(320, Math.round(viewportWidth * 0.55) || 560)
    const maxTableWidth = Math.max(1600, Math.round(viewportWidth * 2.2) || 2200)
    const cells = Array.from(tableEl.querySelectorAll(`tr > *:nth-child(${colIndex + 1})`)) as HTMLElement[]
    tableEl.style.tableLayout = 'fixed'
    tableEl.style.minWidth = `${Math.min(baseTableWidth, maxTableWidth)}px`

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
        tableEl.style.minWidth = `${nextTableWidth}px`
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
        'relative h-auto min-h-0 border-b border-border/70 bg-muted/80 px-2 py-2 text-left align-middle text-sm font-medium text-foreground whitespace-nowrap dark:bg-muted/50 [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    >
      {props.children}
      <span
        aria-hidden="true"
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none hover:bg-foreground/10"
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
