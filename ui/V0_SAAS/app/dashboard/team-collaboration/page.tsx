"use client"

import { useCallback, useEffect, useState } from "react"
import { ModuleShell } from "@/components/workload/module-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  addTeamMemberToTeam,
  closeTeamReview,
  createTeamAndBindPlan,
  createTeamReviewForPlan,
  fetchReviewComments,
  fetchTeamDetail,
  getActiveTeamId,
  getTeamBindings,
  getTeamPlanOptions,
  listTeamReviews,
  postTeamReviewComment,
  setActiveTeamId,
  type TeamRecordSummary,
  type TeamReviewComment,
} from "@/lib/workload-service"
import type { TeamPlanBinding } from "@/lib/workload-types"
import { useAuth } from "@/hooks/use-auth"

const TEAM_ROLES = ["manager", "implementer", "presale", "sales"] as const

type ReviewRow = {
  reviewId: string
  globalVersionCode: string
  title: string
  status: string
  updatedAt: string
}

export default function TeamCollaborationPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<TeamPlanBinding[]>([])
  const [globalVersionCode, setGlobalVersionCode] = useState("")
  const [newTeamName, setNewTeamName] = useState("")
  const [binding, setBinding] = useState(false)
  const [message, setMessage] = useState("")

  const [teamIdInput, setTeamIdInput] = useState("")
  const [teamDetail, setTeamDetail] = useState<TeamRecordSummary | null>(null)
  const [memberUserId, setMemberUserId] = useState("")
  const [memberRole, setMemberRole] = useState<string>("implementer")
  const [memberBusy, setMemberBusy] = useState(false)

  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [reviewGlCode, setReviewGlCode] = useState("")
  const [reviewTitle, setReviewTitle] = useState("")
  const [reviewBusy, setReviewBusy] = useState(false)

  const [selectedReviewId, setSelectedReviewId] = useState("")
  const [comments, setComments] = useState<TeamReviewComment[]>([])
  const [commentText, setCommentText] = useState("")
  const [commentBusy, setCommentBusy] = useState(false)

  const activeTeamId = teamDetail?.teamId || getActiveTeamId()

  const loadBindings = useCallback(() => {
    void getTeamBindings().then(setRows)
  }, [])

  const loadReviews = useCallback(
    async (tid: string) => {
      if (!tid) {
        setReviews([])
        return
      }
      try {
        const items = await listTeamReviews(tid)
        setReviews(
          items.map((x) => ({
            reviewId: x.reviewId,
            globalVersionCode: x.globalVersionCode,
            title: x.title,
            status: x.status,
            updatedAt: x.updatedAt,
          })),
        )
      } catch {
        setReviews([])
      }
    },
    [],
  )

  const refreshTeam = useCallback(
    async (overrideTeamId?: string) => {
      const id = (overrideTeamId || teamIdInput.trim() || getActiveTeamId()).trim()
      if (!id) {
        setTeamDetail(null)
        setMessage("请填写团队 ID 或先通过下方绑定生成团队")
        return
      }
      setMessage("")
      try {
        const detail = await fetchTeamDetail(id)
        setTeamDetail(detail)
        setTeamIdInput(detail.teamId)
        setActiveTeamId(detail.teamId)
        await loadReviews(detail.teamId)
      } catch (e) {
        setTeamDetail(null)
        setMessage(e instanceof Error ? e.message : "加载团队失败")
      }
    },
    [teamIdInput, loadReviews],
  )

  useEffect(() => {
    const stored = getActiveTeamId()
    if (stored) setTeamIdInput(stored)
  }, [])

  useEffect(() => {
    loadBindings()
    void getTeamPlanOptions().then((items) => {
      if (!items.length) return
      setGlobalVersionCode((prev) => prev || items[0].globalVersionCode)
      setReviewGlCode((prev) => prev || items[0].globalVersionCode)
    })
  }, [loadBindings])

  useEffect(() => {
    const tid = teamIdInput.trim() || getActiveTeamId()
    if (tid) {
      void loadReviews(tid)
    }
  }, [teamIdInput, loadReviews])

  async function onBindPlan() {
    setBinding(true)
    setMessage("")
    try {
      const result = await createTeamAndBindPlan(globalVersionCode, newTeamName)
      setMessage(`绑定成功：${result.globalVersionCode} -> 新团队(${result.teamId})`)
      setActiveTeamId(result.teamId)
      await refreshTeam(result.teamId)
      loadBindings()
      setNewTeamName("")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "绑定失败")
    } finally {
      setBinding(false)
    }
  }

  async function onApplyTeamId() {
    setActiveTeamId(teamIdInput.trim())
    await refreshTeam()
  }

  async function onAddMember() {
    const tid = activeTeamId
    if (!tid) {
      setMessage("请先加载有效团队")
      return
    }
    setMemberBusy(true)
    setMessage("")
    try {
      const next = await addTeamMemberToTeam(tid, memberUserId, memberRole)
      setTeamDetail(next)
      setMemberUserId("")
      setMessage("成员已更新")
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "添加成员失败")
    } finally {
      setMemberBusy(false)
    }
  }

  async function onCreateReview() {
    const tid = activeTeamId
    if (!tid) {
      setMessage("请先加载有效团队")
      return
    }
    const code = reviewGlCode.trim()
    if (!code) {
      setMessage("请填写总方案版本号")
      return
    }
    setReviewBusy(true)
    setMessage("")
    try {
      await createTeamReviewForPlan(tid, code, reviewTitle.trim() || undefined)
      setReviewTitle("")
      await loadReviews(tid)
      setMessage("评审已创建")
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "创建评审失败")
    } finally {
      setReviewBusy(false)
    }
  }

  async function onCloseReview(rid: string) {
    const tid = activeTeamId
    if (!tid) return
    setReviewBusy(true)
    setMessage("")
    try {
      await closeTeamReview(tid, rid)
      await loadReviews(tid)
      setMessage("评审已关闭")
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "关闭失败")
    } finally {
      setReviewBusy(false)
    }
  }

  async function onLoadComments() {
    const tid = activeTeamId
    const rid = selectedReviewId.trim()
    if (!tid || !rid) {
      setMessage("请选择评审")
      return
    }
    setCommentBusy(true)
    setMessage("")
    try {
      const items = await fetchReviewComments(tid, rid)
      setComments(items)
    } catch (e) {
      setComments([])
      setMessage(e instanceof Error ? e.message : "加载评论失败")
    } finally {
      setCommentBusy(false)
    }
  }

  async function onPostComment() {
    const tid = activeTeamId
    const rid = selectedReviewId.trim()
    if (!tid || !rid) {
      setMessage("请选择评审")
      return
    }
    const text = commentText.trim()
    if (!text) {
      setMessage("评论内容不能为空")
      return
    }
    setCommentBusy(true)
    setMessage("")
    try {
      await postTeamReviewComment(tid, rid, text)
      setCommentText("")
      const items = await fetchReviewComments(tid, rid)
      setComments(items)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "发表评论失败")
    } finally {
      setCommentBusy(false)
    }
  }

  return (
    <ModuleShell
      title="团队协同"
      description="团队、成员、方案绑定、评审与评论（对接 /api/v1/teams）。"
      breadcrumbs={[{ label: "团队协同" }]}
    >
      {message ? (
        <p className="mb-4 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">当前团队</CardTitle>
            <p className="text-xs text-muted-foreground">
              登录用户：<span className="font-mono">{user?.username || "—"}</span>（添加成员时需填写对方用户 ID）
            </p>
            <div className="flex flex-col gap-2 pt-2 lg:flex-row lg:items-center">
              <Input
                className="font-mono text-xs"
                value={teamIdInput}
                onChange={(e) => setTeamIdInput(e.target.value)}
                placeholder="团队 UUID（可粘贴或绑定后自动填入）"
              />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="rounded-xl" onClick={() => void onApplyTeamId()}>
                  设为当前并加载
                </Button>
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => void refreshTeam()}>
                  刷新
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {teamDetail ? (
              <>
                <p className="text-sm">
                  <span className="text-muted-foreground">名称</span> {teamDetail.name}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户 ID</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>加入时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teamDetail.members.map((m) => (
                      <TableRow key={m.userId}>
                        <TableCell className="font-mono text-xs">{m.userId}</TableCell>
                        <TableCell>{m.role}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.joinedAt}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex flex-col gap-2 border-t border-border/40 pt-4 lg:flex-row lg:items-end">
                  <Input
                    className="font-mono text-xs lg:max-w-xs"
                    value={memberUserId}
                    onChange={(e) => setMemberUserId(e.target.value)}
                    placeholder="成员 userId"
                  />
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={memberRole}
                    onChange={(e) => setMemberRole(e.target.value)}
                  >
                    {TEAM_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <Button type="button" className="rounded-xl" disabled={memberBusy} onClick={() => void onAddMember()}>
                    {memberBusy ? "提交中..." : "添加/更新成员"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">仅 manager 可添加成员；首个创建者一般为 manager。</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">尚未加载团队。可先「新建团队并绑定」或粘贴已有 teamId。</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">团队与方案绑定</CardTitle>
            <div className="flex flex-col gap-2 lg:flex-row">
              <Input
                value={globalVersionCode}
                onChange={(e) => setGlobalVersionCode(e.target.value)}
                placeholder="总方案版本号（GL-... 或 GLOBAL-...）"
              />
              <Input
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="新团队名称"
              />
              <Button className="rounded-xl" onClick={() => void onBindPlan()} disabled={binding}>
                {binding ? "绑定中..." : "新建团队并绑定"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>团队</TableHead>
                  <TableHead>绑定总方案版本</TableHead>
                  <TableHead>负责人</TableHead>
                  <TableHead>成员数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.teamName}-${row.globalVersion}`}>
                    <TableCell className="font-medium">{row.teamName}</TableCell>
                    <TableCell>{row.globalVersion}</TableCell>
                    <TableCell>{row.owner}</TableCell>
                    <TableCell>{row.memberCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">评审</CardTitle>
            <div className="flex flex-col gap-2 lg:flex-row">
              <Input
                value={reviewGlCode}
                onChange={(e) => setReviewGlCode(e.target.value)}
                placeholder="总方案版本号"
              />
              <Input
                value={reviewTitle}
                onChange={(e) => setReviewTitle(e.target.value)}
                placeholder="标题（可选）"
              />
              <Button
                type="button"
                className="rounded-xl"
                disabled={reviewBusy}
                onClick={() => void onCreateReview()}
              >
                创建评审
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>reviewId</TableHead>
                  <TableHead>总方案</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((r) => (
                  <TableRow key={r.reviewId}>
                    <TableCell className="max-w-[140px] truncate font-mono text-xs">{r.reviewId}</TableCell>
                    <TableCell>{r.globalVersionCode}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell>{r.status}</TableCell>
                    <TableCell className="text-right">
                      {r.status === "open" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-lg"
                          disabled={reviewBusy}
                          onClick={() => void onCloseReview(r.reviewId)}
                        >
                          关闭
                        </Button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">评审评论</CardTitle>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <select
                className="h-9 min-w-[240px] rounded-md border border-input bg-background px-2 text-sm"
                value={selectedReviewId}
                onChange={(e) => setSelectedReviewId(e.target.value)}
              >
                <option value="">选择评审</option>
                {reviews.map((r) => (
                  <option key={r.reviewId} value={r.reviewId}>
                    {r.title} · {r.globalVersionCode}
                  </option>
                ))}
              </select>
              <Button type="button" variant="secondary" className="rounded-xl" onClick={() => void onLoadComments()}>
                加载评论
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2 text-sm">
              {comments.map((c) => (
                <li key={c.commentId} className="rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {c.createdAt} · <span className="font-mono">{c.authorUserId}</span>
                  </div>
                  <div className="whitespace-pre-wrap pt-1">{c.content}</div>
                </li>
              ))}
            </ul>
            <Textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="输入评论内容"
              rows={3}
            />
            <Button type="button" className="rounded-xl" disabled={commentBusy} onClick={() => void onPostComment()}>
              {commentBusy ? "提交中..." : "发表评论"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </ModuleShell>
  )
}
