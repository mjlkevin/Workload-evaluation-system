import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

interface Activity {
  id: string
  user: {
    name: string
    avatar?: string
  }
  action: string
  target: string
  time: string
  type: "create" | "update" | "comment" | "complete"
}

interface ActivityTimelineProps {
  activities: Activity[]
  className?: string
}

const typeColors = {
  create: "bg-blue-500",
  update: "bg-amber-500",
  comment: "bg-muted-foreground",
  complete: "bg-emerald-500",
}

export function ActivityTimeline({ activities, className }: ActivityTimelineProps) {
  return (
    <Card className={cn("border-border/40 bg-card/50 backdrop-blur-sm", className)}>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">最近活动</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        {activities.map((activity, index) => (
          <div key={activity.id} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Timeline line */}
            {index !== activities.length - 1 && (
              <div className="absolute left-4 top-10 h-[calc(100%-24px)] w-px bg-border" />
            )}
            
            {/* Avatar with indicator */}
            <div className="relative">
              <Avatar className="size-8">
                {activity.user.avatar ? (
                  <AvatarImage src={activity.user.avatar} alt={activity.user.name} />
                ) : null}
                <AvatarFallback className="bg-secondary text-xs">
                  {activity.user.name.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card",
                  typeColors[activity.type]
                )}
              />
            </div>

            {/* Content */}
            <div className="flex-1 space-y-1">
              <p className="text-sm">
                <span className="font-medium">{activity.user.name}</span>
                <span className="text-muted-foreground"> {activity.action} </span>
                <span className="font-medium">{activity.target}</span>
              </p>
              <p className="text-xs text-muted-foreground">{activity.time}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
