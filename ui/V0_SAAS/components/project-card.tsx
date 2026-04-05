"use client"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { MoreHorizontal, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface ProjectCardProps {
  name: string
  description: string
  progress: number
  status: "进行中" | "已完成" | "暂停" | "待开始"
  dueDate: string
  members: Array<{
    name: string
    avatar?: string
  }>
  className?: string
}

const statusStyles = {
  "进行中": "bg-blue-500/10 text-blue-500 border-blue-500/20",
  "已完成": "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  "暂停": "bg-amber-500/10 text-amber-500 border-amber-500/20",
  "待开始": "bg-muted text-muted-foreground border-border",
}

export function ProjectCard({
  name,
  description,
  progress,
  status,
  dueDate,
  members,
  className,
}: ProjectCardProps) {
  return (
    <Card
      className={cn(
        "group border-border/40 bg-card/50 backdrop-blur-sm transition-all hover:border-border hover:shadow-lg",
        className
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div className="space-y-1.5">
          <h3 className="font-semibold leading-none tracking-tight">{name}</h3>
          <p className="text-sm text-muted-foreground line-clamp-1">{description}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg opacity-0 transition-opacity group-hover:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-xl">
            <DropdownMenuItem className="rounded-lg">查看详情</DropdownMenuItem>
            <DropdownMenuItem className="rounded-lg">编辑项目</DropdownMenuItem>
            <DropdownMenuItem className="rounded-lg text-destructive">删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className={cn("rounded-lg border", statusStyles[status])}>
            {status}
          </Badge>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="size-3.5" />
            <span>{dueDate}</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">进度</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex -space-x-2">
            {members.slice(0, 4).map((member, index) => (
              <Avatar key={index} className="size-7 border-2 border-card">
                {member.avatar ? (
                  <AvatarImage src={member.avatar} alt={member.name} />
                ) : null}
                <AvatarFallback className="bg-secondary text-[10px]">
                  {member.name.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
            ))}
            {members.length > 4 && (
              <div className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-secondary text-[10px] font-medium">
                +{members.length - 4}
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{members.length} 成员</span>
        </div>
      </CardContent>
    </Card>
  )
}
