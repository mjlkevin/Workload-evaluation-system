"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import {
  closeTeamReview,
  fetchReviewComments,
  getActiveTeamId,
  listTeamReviews,
  listUserTeams,
  postTeamReviewComment,
  type TeamReviewComment,
} from "@/lib/workload-service"

export default function ReviewDetailPage() {
  const router = useRouter()
  const params = useParams()
  const reviewId = typeof params?.reviewId === "string" ? params.reviewId : ""

  const [review, setReview] = useState<{
    reviewId: string
    globalVersionCode: string
    title: string
    status: string
    createdBy: string
    createdAt: string
    updatedAt: string
  } | null>(null)
  const [comments, setComments] = useState<TeamReviewComment[]>([])
  const [newComment, setNewComment] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [closing, setClosing] = useState(false)
  const [message, setMessage] = useState("")

  async function loadReview() {
    if (!reviewId) return
    let activeTeamId = getActiveTeamId()
    if (!activeTeamId) {
      const teams = await listUserTeams()
      if (teams.length > 0) {
        activeTeamId = teams[0].teamId
        if (typeof window !== "undefined") {
          window.localStorage.setItem("workload-team-id-v1", activeTeamId)
        }
      }
    }
    if (!activeTeamId) {
      setMessage("团队未设置，请先创建一个团队")
      return
    }
    try {
      const reviews = await listTeamReviews(activeTeamId)
      const found = reviews.find((r) => r.reviewId === reviewId)
      if (found) {
        setReview({
          reviewId: found.reviewId,
          globalVersionCode: found.globalVersionCode,
          title: found.title,
          status: found.status,
          createdBy: found.createdBy,
          createdAt: found.createdAt,
          updatedAt: found.updatedAt,
        })
      } else {
        setMessage("评审记录未找到")
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载评审详情失败")
    }
  }

  async function loadComments() {
    if (!reviewId) return
    const activeTeamId = getActiveTeamId()
    if (!activeTeamId) return
    try {
      const items = await fetchReviewComments(activeTeamId, reviewId)
      setComments(items)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadReview()
    void loadComments()
  }, [reviewId])

  async function onSubmitComment() {
    if (!review?.reviewId) return
    const content = newComment.trim()
    if (!content) return

    setSubmitting(true)
    setMessage("")
    try {
      const activeTeamId = getActiveTeamId()
      if (!activeTeamId) throw new Error("团队未设置")
      await postTeamReviewComment(activeTeamId, review.reviewId, content)
      setNewComment("")
      await loadComments()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发表评论失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function onCloseReview() {
    if (!review?.reviewId) return
    setClosing(true)
    setMessage("")
    try {
      const activeTeamId = getActiveTeamId()
      if (!activeTeamId) throw new Error("团队未设置")
      await closeTeamReview(activeTeamId, review.reviewId)
      setMessage("评审已通过")
      await loadReview()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "关闭评审失败")
    } finally {
      setClosing(false)
    }
  }

  function getInitials(userId: string) {
    return userId?.slice(0, 2).toUpperCase() || "?"
  }

  function formatTime(iso: string) {
    if (!iso) return "—"
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  return (
    <ModuleShell
      title="评审详情"
      description={`评审 ${review?.title || ""}`}
      breadcrumbs={[
        { label: "评审", href: "/dashboard/review" },
        { label: review?.title || "详情" },
      ]}
    >
      <div className="flex flex-col gap-4">
        {/* Review Info Card */}
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{review?.title || "加载中..."}</CardTitle>
              <div className="flex items-center gap-2">
                <Badge
                  variant={review?.status === "closed" ? "default" : "secondary"}
                >
                  {review?.status === "closed" ? "已通过" : "待评审"}
                </Badge>
                {review?.status === "open" && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={onCloseReview}
                    disabled={closing}
                  >
                    {closing ? "处理中..." : "通过评审"}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <span className="text-muted-foreground">总方案版本</span>
                <p className="font-medium">{review?.globalVersionCode || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">创建人</span>
                <p className="font-medium">{review?.createdBy?.slice(0, 8) || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">创建时间</span>
                <p className="font-medium">{formatTime(review?.createdAt || "")}</p>
              </div>
              <div>
                <span className="text-muted-foreground">更新时间</span>
                <p className="font-medium">{formatTime(review?.updatedAt || "")}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Comments Section */}
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">评论 ({comments.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {message ? (
              <p className="mb-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                {message}
              </p>
            ) : null}

            {/* Comment List */}
            <div className="mb-4 flex flex-col gap-4">
              {comments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">暂无评论</p>
              ) : (
                comments.map((comment) => (
                  <div key={comment.commentId} className="flex gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {getInitials(comment.authorUserId)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">
                          {comment.authorUserId?.slice(0, 8)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(comment.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{comment.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <Separator className="my-4" />

            {/* New Comment Input */}
            <div className="flex flex-col gap-2">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="输入评论内容..."
                rows={3}
                className="resize-none"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={onSubmitComment}
                  disabled={submitting || !newComment.trim()}
                >
                  {submitting ? "提交中..." : "发表评论"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Back Button */}
        <Button
          variant="outline"
          className="w-fit rounded-xl"
          onClick={() => router.push("/dashboard/review")}
        >
          返回评审列表
        </Button>
      </div>
    </ModuleShell>
  )
}
