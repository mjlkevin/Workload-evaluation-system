import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { LucideIcon, TrendingDown, TrendingUp } from "lucide-react"

interface StatCardProps {
  title: string
  value: string
  change?: {
    value: string
    type: "increase" | "decrease"
  }
  icon: LucideIcon
  className?: string
}

export function StatCard({ title, value, change, icon: Icon, className }: StatCardProps) {
  return (
    <Card className={cn("border-border/40 bg-card/50 backdrop-blur-sm", className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-semibold tracking-tight">{value}</p>
            {change && (
              <div className="flex items-center gap-1.5">
                {change.type === "increase" ? (
                  <TrendingUp className="size-4 text-emerald-500" />
                ) : (
                  <TrendingDown className="size-4 text-rose-500" />
                )}
                <span
                  className={cn(
                    "text-sm font-medium",
                    change.type === "increase" ? "text-emerald-500" : "text-rose-500"
                  )}
                >
                  {change.value}
                </span>
                <span className="text-sm text-muted-foreground">较上周</span>
              </div>
            )}
          </div>
          <div className="flex size-12 items-center justify-center rounded-2xl bg-secondary">
            <Icon className="size-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
