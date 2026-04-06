"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type CardProps = React.ComponentProps<"div"> & {
  collapsible?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  collapsedSummary?: React.ReactNode
}

function isInteractiveTarget(target: HTMLElement) {
  return Boolean(target.closest("input, textarea, select, button, a, label, [role='button'], [contenteditable='true']"))
}

function Card({
  className,
  collapsible = true,
  collapsed,
  onCollapsedChange,
  collapsedSummary,
  onDoubleClick,
  children,
  ...props
}: CardProps) {
  const cardRef = React.useRef<HTMLDivElement>(null)
  const [innerCollapsed, setInnerCollapsed] = React.useState(false)
  const [summaryTitle, setSummaryTitle] = React.useState("信息卡片")
  const [summaryDesc, setSummaryDesc] = React.useState("")
  const isCollapsed = collapsed ?? innerCollapsed

  React.useEffect(() => {
    if (!cardRef.current) return
    const titleNode = cardRef.current.querySelector("[data-slot='card-title']")
    const descNode = cardRef.current.querySelector("[data-slot='card-description']")
    const valueNodes = Array.from(cardRef.current.querySelectorAll("input, textarea, select")) as Array<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
    const titleText = titleNode?.textContent?.trim()
    const descText = descNode?.textContent?.trim()
    const pickedValues: string[] = []
    for (const node of valueNodes) {
      let value = ""
      if (node instanceof HTMLSelectElement) {
        value = node.options[node.selectedIndex]?.text?.trim() || ""
      } else {
        value = node.value?.trim() || ""
      }
      if (value && value !== "请选择" && value !== "请选择版本回读") {
        pickedValues.push(value)
      }
      if (pickedValues.length >= 3) break
    }

    setSummaryTitle(titleText || "信息卡片")
    if (pickedValues.length > 0) {
      setSummaryDesc(pickedValues.join(" / "))
      return
    }
    setSummaryDesc(descText || "暂无关键字段内容")
  }, [children])

  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    onDoubleClick?.(event)
    if (event.defaultPrevented || !collapsible) return
    const target = event.target as HTMLElement
    if (isInteractiveTarget(target)) return
    // Prevent nested collapsible cards from toggling parent cards.
    event.stopPropagation()
    const next = !isCollapsed
    if (collapsed === undefined) {
      setInnerCollapsed(next)
    }
    onCollapsedChange?.(next)
  }

  return (
    <div
      ref={cardRef}
      data-slot="card"
      data-collapsed={isCollapsed ? "true" : "false"}
      className={cn(
        "bg-card text-card-foreground flex min-w-0 flex-col gap-6 rounded-xl border py-6 shadow-sm transition-all duration-300",
        isCollapsed &&
          "gap-1.5 py-1.5 border-border/70 bg-secondary/20 shadow-sm dark:bg-secondary/10",
        className,
      )}
      onDoubleClick={handleDoubleClick}
      {...props}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-6 transition-[max-height,opacity,transform] duration-300 ease-out",
          isCollapsed
            ? "max-h-0 overflow-hidden opacity-0 -translate-y-1 pointer-events-none"
            : "max-h-none min-h-0 overflow-visible opacity-100 translate-y-0",
        )}
      >
        {children}
      </div>
      <div
        className={cn(
          "overflow-hidden px-6 transition-[max-height,opacity,transform] duration-300 ease-out",
          isCollapsed ? "max-h-20 opacity-100 translate-y-0" : "max-h-0 opacity-0 -translate-y-1 pointer-events-none",
        )}
      >
        {collapsedSummary ? (
          <div className="rounded-md border border-border/70 bg-background/90 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 overflow-x-auto">{collapsedSummary}</div>
              <span className="shrink-0 rounded-full bg-blue-500/12 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                双击展开
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-border/70 bg-background/80 px-3 py-1.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2">
                <p className="shrink-0 truncate text-sm font-semibold text-blue-700 dark:text-blue-300">{summaryTitle}</p>
                <p className="truncate text-xs text-muted-foreground">{summaryDesc}</p>
              </div>
              <span className="shrink-0 rounded-full bg-blue-500/12 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                已收起
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid min-w-0 auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
