"use client"

import { MouseEvent as ReactMouseEvent, ReactNode, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Filter, ChevronDown, Grid3X3, List, Plus, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  wesTableHeaderStickyClassName,
  wesTableToolbarHeaderRowClassName,
} from "@/components/ui/table"

type ViewMode = "list" | "grid"

interface TableTemplateFilterOption {
  label: string
  value: string
}

interface TableTemplateColumn<Row> {
  key: keyof Row | string
  label: string
  className?: string
  width?: number | string
  minWidth?: number | string
  maxWidth?: number | string
}

interface TableTemplatePageItem {
  label: string
  active?: boolean
  disabled?: boolean
  value?: string | number
}

interface TableTemplatePagination {
  summary: string
  pages: TableTemplatePageItem[]
  onPrev?: () => void
  onNext?: () => void
  onPageSelect?: (page: TableTemplatePageItem) => void
  prevDisabled?: boolean
  nextDisabled?: boolean
}

interface TableTemplateProps<Row> {
  rows: Row[]
  columns: TableTemplateColumn<Row>[]
  renderRow: (row: Row) => ReactNode
  loading?: boolean
  loadingRowCount?: number
  emptyState?: ReactNode
  showSearch?: boolean
  searchValue?: string
  onSearchValueChange?: (value: string) => void
  searchPlaceholder?: string
  showFilter?: boolean
  filterOptions?: TableTemplateFilterOption[]
  onFilterSelect?: (value: string) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  createButtonLabel?: string
  onCreate?: () => void
  toolbarActions?: ReactNode
  selectedCount?: number
  selectedCountLabel?: (count: number) => string
  selectedActions?: ReactNode
  leadingHeaderCell?: ReactNode
  trailingHeaderCell?: ReactNode
  pagination?: TableTemplatePagination
  tableClassName?: string
}

export function TableTemplate<Row>({
  rows,
  columns,
  renderRow,
  loading = false,
  loadingRowCount = 5,
  emptyState,
  showSearch = true,
  searchValue,
  onSearchValueChange,
  searchPlaceholder = "搜索...",
  showFilter = true,
  filterOptions = [],
  onFilterSelect,
  viewMode,
  onViewModeChange,
  createButtonLabel = "新建",
  onCreate,
  toolbarActions,
  selectedCount = 0,
  selectedCountLabel = (count) => `已选择 ${count} 项`,
  selectedActions,
  leadingHeaderCell,
  trailingHeaderCell,
  pagination,
  tableClassName,
}: TableTemplateProps<Row>) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const resizingRef = useRef<{
    key: string
    startX: number
    startWidth: number
    minWidth: number
    maxWidth: number
  } | null>(null)
  const showFilterControl = showFilter && filterOptions.length > 0
  const totalColumnCount =
    columns.length +
    (leadingHeaderCell ? 1 : 0) +
    (trailingHeaderCell ? 1 : 0)

  const resolvedColumnWidths = useMemo(() => {
    return columns.map((col) => {
      const key = String(col.key)
      const custom = columnWidths[key]
      if (typeof custom === "number" && Number.isFinite(custom)) {
        const next = Math.min(getMaxWidth(col), Math.max(getMinWidth(col), custom))
        return `${next}px`
      }
      if (typeof col.width === "number") return `${col.width}px`
      if (typeof col.width === "string") return col.width
      return undefined
    })
  }, [columns, columnWidths])

  function parsePixel(value?: number | string): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && /^\d+(\.\d+)?px$/.test(value.trim())) {
      return Number(value.replace("px", "").trim())
    }
    return undefined
  }

  function getMinWidth(col: TableTemplateColumn<Row>): number {
    return parsePixel(col.minWidth) ?? 80
  }

  function getMaxWidth(col: TableTemplateColumn<Row>): number {
    const explicitMax = parsePixel(col.maxWidth)
    if (typeof explicitMax === "number" && Number.isFinite(explicitMax)) return Math.max(120, explicitMax)
    return 720
  }

  function onResizeStart(event: ReactMouseEvent<HTMLButtonElement>, col: TableTemplateColumn<Row>) {
    event.preventDefault()
    event.stopPropagation()
    const th = event.currentTarget.closest("th")
    if (!th) return
    const key = String(col.key)
    const startWidth = th.getBoundingClientRect().width
    resizingRef.current = {
      key,
      startX: event.clientX,
      startWidth,
      minWidth: getMinWidth(col),
      maxWidth: getMaxWidth(col),
    }
    const originalUserSelect = document.body.style.userSelect
    document.body.style.userSelect = "none"
    const onMove = (e: MouseEvent) => {
      const current = resizingRef.current
      if (!current) return
      const delta = e.clientX - current.startX
      const next = Math.min(current.maxWidth, Math.max(current.minWidth, Math.round(current.startWidth + delta)))
      setColumnWidths((prev) => ({ ...prev, [current.key]: next }))
    }
    const onUp = () => {
      resizingRef.current = null
      document.body.style.userSelect = originalUserSelect
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  function onResizeReset(event: ReactMouseEvent<HTMLButtonElement>, col: TableTemplateColumn<Row>) {
    event.preventDefault()
    event.stopPropagation()
    const key = String(col.key)
    setColumnWidths((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function onResetAllColumnWidthsByContextMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setColumnWidths({})
  }

  return (
    <div className="flex-1 p-6">
      <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
        <div className="flex flex-col gap-4 border-b border-border/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-3">
            {showSearch ? (
              <div className="relative max-w-sm flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchValue}
                  onChange={(e) => onSearchValueChange?.(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-10 rounded-xl border-border/50 bg-secondary/30 pl-9 transition-colors focus:bg-background"
                />
              </div>
            ) : null}
            {showFilterControl ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-10 gap-2 rounded-xl border-border/50"
                  >
                    <Filter className="size-4" />
                    <span className="hidden sm:inline">筛选</span>
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 rounded-xl">
                  {filterOptions.map((item) => (
                    <DropdownMenuItem
                      key={item.value}
                      className="rounded-lg"
                      onClick={() => onFilterSelect?.(item.value)}
                    >
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-border/50 p-1">
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 rounded-lg px-3"
                onClick={() => onViewModeChange("list")}
              >
                <List className="size-4" />
              </Button>
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 rounded-lg px-3"
                onClick={() => onViewModeChange("grid")}
              >
                <Grid3X3 className="size-4" />
              </Button>
            </div>
            <Button
              className="h-10 gap-2 rounded-xl bg-foreground text-background hover:bg-foreground/90"
              onClick={onCreate}
            >
              <Plus className="size-4" />
              <span>{createButtonLabel}</span>
            </Button>
            {toolbarActions ? <div className="flex items-center gap-2">{toolbarActions}</div> : null}
          </div>
        </div>

        {selectedCount > 0 && (
          <div className="flex items-center gap-4 border-b border-border/50 bg-secondary/30 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              {selectedCountLabel(selectedCount)}
            </span>
            {selectedActions ? (
              <div className="flex items-center gap-2">{selectedActions}</div>
            ) : null}
          </div>
        )}

        <Table
          containerClassName="max-h-[60vh] overflow-auto"
          className={cn("table-auto", tableClassName)}
        >
          <colgroup>
            {leadingHeaderCell ? <col /> : null}
            {columns.map((col, index) => (
              <col
                key={`col-${String(col.key)}`}
                style={{
                  width: resolvedColumnWidths[index],
                  minWidth:
                    typeof col.minWidth === "number" ? `${col.minWidth}px` : col.minWidth,
                  maxWidth:
                    typeof col.maxWidth === "number" ? `${col.maxWidth}px` : col.maxWidth,
                }}
              />
            ))}
            {trailingHeaderCell ? <col /> : null}
          </colgroup>
          <TableHeader
            className={wesTableHeaderStickyClassName}
            onContextMenu={onResetAllColumnWidthsByContextMenu}
          >
            <TableRow className={wesTableToolbarHeaderRowClassName}>
              {leadingHeaderCell}
              {columns.map((col, index) => (
                <TableHead
                  key={String(col.key)}
                  className={`relative top-0 z-20 select-none backdrop-blur-sm ${col.className ?? ""}`.trim()}
                  style={{
                    width: resolvedColumnWidths[index],
                    minWidth:
                      typeof col.minWidth === "number"
                        ? `${col.minWidth}px`
                        : col.minWidth,
                    maxWidth:
                      typeof col.maxWidth === "number"
                        ? `${col.maxWidth}px`
                        : col.maxWidth,
                  }}
                >
                  <div className="pr-3">{col.label}</div>
                  <button
                    type="button"
                    aria-label={`调整列宽：${col.label}`}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-l border-white/25 opacity-0 transition-opacity hover:bg-white/15 group-hover:opacity-100"
                    onMouseDown={(event) => onResizeStart(event, col)}
                    onDoubleClick={(event) => onResizeReset(event, col)}
                    title="拖拽调整列宽，双击恢复默认宽度"
                  />
                </TableHead>
              ))}
              {trailingHeaderCell}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: loadingRowCount }).map((_, index) => (
                  <TableRow key={`loading-${index}`} className="border-border/50">
                    <TableCell colSpan={totalColumnCount}>
                      <div className="h-10 animate-pulse rounded-lg bg-muted/60" />
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {!loading && rows.length > 0 ? rows.map((row) => renderRow(row)) : null}
            {!loading && rows.length === 0 ? (
              <TableRow className={wesTableToolbarHeaderRowClassName}>
                <TableCell
                  colSpan={totalColumnCount}
                  className="py-10 text-center text-muted-foreground"
                >
                  {emptyState ?? "暂无数据"}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {pagination ? (
          <div className="flex items-center justify-between border-t border-border/50 px-4 py-3">
            <p className="text-sm text-muted-foreground">{pagination.summary}</p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg border-border/50"
                onClick={pagination.onPrev}
                disabled={pagination.prevDisabled}
              >
                上一页
              </Button>
              <div className="flex items-center gap-1">
                {pagination.pages.map((page) => (
                  <Button
                    key={`${page.label}-${page.value ?? page.label}`}
                    variant={page.active ? "secondary" : "ghost"}
                    size="sm"
                    className="size-8 rounded-lg"
                    disabled={page.disabled}
                    onClick={() => pagination.onPageSelect?.(page)}
                  >
                    {page.label}
                  </Button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg border-border/50"
                onClick={pagination.onNext}
                disabled={pagination.nextDisabled}
              >
                下一页
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
