import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { LucideIcon, FolderPlus, UserPlus, FileText, Calendar } from "lucide-react"

interface QuickAction {
  icon: LucideIcon
  label: string
  description: string
  color: string
}

const quickActions: QuickAction[] = [
  {
    icon: FolderPlus,
    label: "新建项目",
    description: "创建新的工作项目",
    color: "bg-blue-500/10 text-blue-500",
  },
  {
    icon: UserPlus,
    label: "邀请成员",
    description: "邀请团队成员加入",
    color: "bg-emerald-500/10 text-emerald-500",
  },
  {
    icon: FileText,
    label: "创建文档",
    description: "撰写新的文档",
    color: "bg-amber-500/10 text-amber-500",
  },
  {
    icon: Calendar,
    label: "安排会议",
    description: "创建会议日程",
    color: "bg-purple-500/10 text-purple-500",
  },
]

interface QuickActionsProps {
  className?: string
}

export function QuickActions({ className }: QuickActionsProps) {
  return (
    <Card className={cn("border-border/40 bg-card/50 backdrop-blur-sm", className)}>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">快速操作</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {quickActions.map((action) => (
          <button
            key={action.label}
            className="flex flex-col items-start gap-3 rounded-xl border border-border/40 bg-secondary/30 p-4 text-left transition-all hover:border-border hover:bg-secondary/50"
          >
            <div className={cn("flex size-10 items-center justify-center rounded-xl", action.color)}>
              <action.icon className="size-5" />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{action.label}</p>
              <p className="text-xs text-muted-foreground">{action.description}</p>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}
