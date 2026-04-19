"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { generateInviteCode, getInviteCodes } from "@/lib/workload-service"
import type { InviteCodeItem } from "@/lib/workload-types"

/** 与 `apps/api/src/routes/index.ts` 挂载一致，前缀均为 `/api/v1`（另含根级 `GET /downloads/:fileName`） */
const endpointCatalog: Array<{
  group: string
  description: string
  paths: string[]
}> = [
  {
    group: "Health",
    description: "存活探针",
    paths: ["GET /api/v1/health"],
  },
  {
    group: "Auth",
    description: "登录注册、会话、用户与推荐码（用户/角色/状态部分仅管理员）",
    paths: [
      "POST /api/v1/auth/login",
      "POST /api/v1/auth/register",
      "GET /api/v1/auth/me",
      "POST /api/v1/auth/logout",
      "GET /api/v1/auth/users",
      "PATCH /api/v1/auth/users/:userId/role",
      "PATCH /api/v1/auth/users/:userId/status",
      "GET /api/v1/auth/invite-codes",
      "POST /api/v1/auth/invite-codes/generate",
    ],
  },
  {
    group: "Templates",
    description: "实施评估模板列表、详情与导入（JSON / Excel）",
    paths: [
      "GET /api/v1/templates",
      "GET /api/v1/templates/:templateId",
      "POST /api/v1/templates/import-json",
      "POST /api/v1/templates/import-excel",
    ],
  },
  {
    group: "Rule sets",
    description: "生效规则集与元数据、JSON 导入",
    paths: ["GET /api/v1/rule-sets/active", "GET /api/v1/rule-sets/meta", "POST /api/v1/rule-sets/import-json"],
  },
  {
    group: "Estimates",
    description: "人天计算、带导出计算、Excel/PDF 导出、实施依赖规则（生效）",
    paths: [
      "POST /api/v1/estimates/calculate",
      "POST /api/v1/estimates/calculate-and-export",
      "POST /api/v1/estimates/export/excel",
      "POST /api/v1/estimates/export/pdf",
      "GET /api/v1/estimates/dependency-rules/active",
    ],
  },
  {
    group: "Sessions",
    description: "匿名/会话态试算链路",
    paths: ["POST /api/v1/sessions/start", "POST /api/v1/sessions/:sessionId/calculate"],
  },
  {
    group: "Exports",
    description: "导出历史列表（归属鉴权）",
    paths: ["GET /api/v1/exports/history"],
  },
  {
    group: "Downloads",
    description: "导出文件下载（需登录且校验归属，非 /api/v1 前缀）",
    paths: ["GET /downloads/:fileName"],
  },
  {
    group: "Versions",
    description: "各模块版本记录、检出/检入/撤销/升版、强制解锁、按类型编码删除",
    paths: [
      "GET /api/v1/versions",
      "POST /api/v1/versions",
      "PATCH /api/v1/versions/:recordId/status",
      "DELETE /api/v1/versions/:type/:versionCode",
      "POST /api/v1/versions/:id/checkout",
      "PATCH /api/v1/versions/:id/save-draft",
      "POST /api/v1/versions/:id/checkin",
      "POST /api/v1/versions/:id/undo-checkout",
      "POST /api/v1/versions/:id/promote",
      "PATCH /api/v1/versions/:id/force-unlock",
    ],
  },
  {
    group: "AI",
    description: "需求基本情况解析、企业简介摘要、Kimi 实施评估预览、评估草稿 Markdown 导出（供 Agent 转 PDF）、对话补全",
    paths: [
      "POST /api/v1/ai/parse-basic-info",
      "POST /api/v1/ai/company-profile-summary",
      "POST /api/v1/ai/kimi-assessment/preview",
      "POST /api/v1/ai/kimi-assessment/export-markdown",
      "POST /api/v1/ai/chat",
    ],
  },
  {
    group: "Teams",
    description: "团队创建与详情、成员、方案绑定、评审与评论（与 `team.routes.ts` 一致）",
    paths: [
      "POST /api/v1/teams",
      "GET /api/v1/teams/:teamId",
      "POST /api/v1/teams/:teamId/members",
      "PATCH /api/v1/teams/:teamId/members/:userId",
      "DELETE /api/v1/teams/:teamId/members/:userId",
      "GET /api/v1/teams/:teamId/plans",
      "PATCH /api/v1/teams/:teamId/plans/:globalVersionCode/binding",
      "POST /api/v1/teams/:teamId/reviews",
      "GET /api/v1/teams/:teamId/reviews",
      "PATCH /api/v1/teams/:teamId/reviews/:reviewId/status",
      "GET /api/v1/teams/:teamId/reviews/:reviewId/comments",
      "POST /api/v1/teams/:teamId/reviews/:reviewId/comments",
    ],
  },
  {
    group: "WBS",
    description: "基于最新总方案版本派生的只读 WBS 列表",
    paths: ["GET /api/v1/wbs"],
  },
  {
    group: "System",
    description: "版本号规则、需求子模块配置、实施评估依赖规则（草稿/生效）",
    paths: [
      "GET /api/v1/system/version-code-rules",
      "PATCH /api/v1/system/version-code-rules/:ruleId/config",
      "POST /api/v1/system/version-code-rules/:ruleId/activate",
      "POST /api/v1/system/version-code-rules/:ruleId/disable",
      "GET /api/v1/system/requirement-settings",
      "PATCH /api/v1/system/requirement-settings/draft",
      "POST /api/v1/system/requirement-settings/activate",
      "POST /api/v1/ai/kimi-api-key/test",
      "GET /api/v1/system/implementation-dependency-rules",
      "PATCH /api/v1/system/implementation-dependency-rules/draft",
      "POST /api/v1/system/implementation-dependency-rules/activate",
    ],
  },
]

export default function ApiKeysPage() {
  const [inviteCodes, setInviteCodes] = useState<InviteCodeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const { isAdmin, user } = useAuth()

  function loadInviteCodes() {
    void getInviteCodes().then(setInviteCodes)
  }

  useEffect(() => {
    if (!isAdmin) return
    loadInviteCodes()
  }, [isAdmin])

  async function onGenerateInviteCode() {
    setLoading(true)
    setMessage("")
    try {
      const created = await generateInviteCode()
      setMessage(`已生成推荐码：${created.code}`)
      loadInviteCodes()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成推荐码失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModuleShell
      title="API"
      description="后端 Workload API 接入说明、接口目录与推荐码；业务接口默认 JWT（Authorization: Bearer）。"
      breadcrumbs={[{ label: "API" }]}
    >
      {!isAdmin ? (
        <Card className="border-border/40 bg-card/50">
          <CardContent className="p-6 text-sm text-muted-foreground">
            当前账号 `{user?.username || "unknown"}` 不是管理员，暂无权限访问 API 管理页。
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">推荐码</CardTitle>
              <Button className="rounded-xl" size="sm" onClick={onGenerateInviteCode} disabled={!isAdmin || loading}>
                {loading ? "生成中..." : "生成推荐码"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {message ? (
              <p className="mb-3 rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                {message}
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inviteCodes.map((item) => (
                  <TableRow key={item.code}>
                    <TableCell className="font-medium">{item.code}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === "active" ? "secondary" : "outline"}>{item.status}</Badge>
                    </TableCell>
                    <TableCell>{item.createdAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">接入与契约</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Base URL：</span>
              本地默认 <span className="font-mono text-xs">http://127.0.0.1:3000</span>（与 <span className="font-mono text-xs">npm run dev:api</span>{" "}
              一致；生产以部署为准）。
            </p>
            <p>
              <span className="font-medium text-foreground">鉴权：</span>
              业务接口使用 <span className="font-mono text-xs">Authorization: Bearer &lt;token&gt;</span>，通过{" "}
              <span className="font-mono text-xs">POST /api/v1/auth/login</span> 获取；勿使用已废弃的 <span className="font-mono text-xs">X-Role</span>{" "}
              作为鉴权手段。
            </p>
            <p>
              <span className="font-medium text-foreground">响应：</span>
              统一为 <span className="font-mono text-xs">{"{ code, message, data }"}</span>；字段与示例以仓库{" "}
              <span className="font-mono text-xs">docs/openapi.yaml</span> 为准（OpenAPI 未覆盖的以路由实现为准，如部分{" "}
              <span className="font-mono text-xs">/system/*</span>、<span className="font-mono text-xs">/ai/*</span>）。
            </p>
            <p>
              <span className="font-medium text-foreground">上传：</span>
              部分接口为 <span className="font-mono text-xs">multipart/form-data</span>（如模板 Excel、需求基本情况解析）。
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/50 backdrop-blur-sm xl:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">接口目录（当前后端路由）</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">分组</TableHead>
                  <TableHead className="min-w-[200px]">说明</TableHead>
                  <TableHead>路径</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpointCatalog.map((block) => (
                  <TableRow key={block.group}>
                    <TableCell className="align-top font-medium text-foreground">{block.group}</TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">{block.description}</TableCell>
                    <TableCell className="align-top">
                      <ul className="list-none space-y-1 font-mono text-[11px] leading-snug text-foreground/90">
                        {block.paths.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ModuleShell>
  )
}
