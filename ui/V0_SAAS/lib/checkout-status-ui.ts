export type CheckoutStatusLike = "checked_in" | "checked_out" | string | null | undefined

export function getCheckoutStatusText(status: CheckoutStatusLike): "已检入" | "已检出" | null {
  if (status === "checked_out") return "已检出"
  if (status === "checked_in") return "已检入"
  const text = String(status || "").trim()
  if (!text) return null
  if (text.includes("已检出")) return "已检出"
  if (text.includes("已检入")) return "已检入"
  return null
}

export function getCheckoutStatusBadgeClass(status: CheckoutStatusLike): string {
  const normalized = getCheckoutStatusText(status)
  if (normalized === "已检入") {
    return "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-white"
  }
  if (normalized === "已检出") {
    return "border-orange-500 bg-orange-500 text-white dark:border-orange-500 dark:bg-orange-500 dark:text-white"
  }
  return "border-border/70 bg-secondary text-secondary-foreground"
}
