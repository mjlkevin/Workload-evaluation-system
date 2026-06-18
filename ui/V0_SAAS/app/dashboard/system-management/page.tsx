"use client"

import { useEffect, useMemo, useState } from "react"
import { CircleHelp } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { ModuleShell } from "@/components/workload/module-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  activateImplementationDependencyRules,
  activateRequirementSystemConfig,
  activateVersionCodeRule,
  getImplementationDependencyRules,
  getRequirementSystemConfig,
  disableVersionCodeRule,
  listVersionCodeRules,
  updateImplementationDependencyRulesDraft,
  updateRequirementSystemConfigDraft,
  testRequirementKimiApiKey,
  updateVersionCodeRuleConfig,
  type ImplementationDependencyRulesConfig,
  type RequirementSystemConfig,
  type VersionCodeRuleItem,
  type VersionCodeRuleStatus,
} from "@/lib/workload-service"
import { ApiError } from "@/lib/api-client"
import { cn } from "@/lib/utils"

function toastApiWarning(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    const payload = error.details as { details?: Array<{ field: string; reason: string }> } | undefined
    const rows = payload?.details
    if (Array.isArray(rows) && rows.length > 0) {
      toast.warning(`${error.message}（${rows.map((r) => `${r.field}: ${r.reason}`).join("；")}）`)
      return
    }
    toast.warning(error.message || fallback)
    return
  }
  toast.warning(error instanceof Error ? error.message : fallback)
}

const STATUS_LABEL: Record<VersionCodeRuleStatus, string> = {
  active: "已生效",
  draft: "待生效",
  disabled: "已禁用",
}

const VERSION_FORMAT_HELP = [
  "本弹窗内只需维护「前缀之后的格式」；保存时系统会自动在开头拼接 {PREFIX}（无需手写）。",
  "{GL}: 关联总方案基础码（例如 GL001）",
  "{NN}: 2位递增序号（01, 02, 03...）",
  "{NNN}: 3位递增序号（001, 002, 003...）",
  "{YYYY}: 年份（例如 2026）",
  "{YYYYMM}: 年月（例如 202604）",
  "{MM}: 月份两位（01–12）",
  "{YYYYMMDD}: 日期（例如 20260406）",
  "{MODULE}: 模块编码（例如 IA, RQ）",
  "高级：也可在格式中显式写出 {PREFIX}，则不再自动拼接。",
]

function FormatHelpTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
          aria-label="查看编码格式占位符说明"
        >
          <CircleHelp className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-[360px] rounded-lg px-3 py-2 text-xs leading-5">
        <div className="space-y-1">
          {VERSION_FORMAT_HELP.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function QuestionHelpTooltip({ label, content }: { label: string; content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-4 items-center justify-center rounded-full border border-border/60 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`查看${label}说明`}
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-[360px] rounded-lg px-3 py-2 text-xs leading-5">
        <p>{content}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function formatDisplayTime(value: string): string {
  if (!value || value === "--") return "--"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", { hour12: false })
}

const DEFAULT_REQUIREMENT_CONFIG: RequirementSystemConfig = {
  kimiEvaluation: {
    enabled: true,
    model: "moonshot-v1-128k",
    temperature: 0.3,
    maxTokens: 4000,
    timeoutMs: 120000,
    fallbackToRule: true,
    promptProfile: "default",
    promptTemplate:
      "你是资深项目经理 + 资深实施顾问。你不是做简单 SKU 对照，而是要基于需求全量信息做综合实施评估。必须只返回 JSON。字段固定：assessmentDraft.quoteMode/productLines/userCount/orgCount/orgSimilarity/difficultyFactor/moduleItems/risks/assumptions。moduleItems 每项字段：cloudProduct/skuName/moduleName/standardDays/suggestedDays/reason。所有数值字段必须为非负数，orgSimilarity 和 difficultyFactor 范围 0-1。评估时必须综合：basicInfo（行业、规模、上线目标）、businessNeedRows（业务复杂度）、devOverviewRows（开发基线）、implementationScopeRows（组织范围与地域）、meetingNotes（隐性约束）、keyPointRows（重点风险）。reason 必须体现增加/减少人天的业务原因与实施原因，不能仅写“按模板匹配”。禁止把产品名/版本名/平台名（如金蝶AI星空、旗舰版）直接当成 SKU，必须下钻到可实施功能项。财务云、供应链云等是实施域级云产品，不得填入 skuName 并挂在金蝶AI星空下冒充 SKU；域级人天归 cloudProduct=该域名，skuName 仅写子模块。若信息不足，给出审慎估算并在 risks/assumptions 明确不确定性来源。严禁仅凭业务需求正文中出现与 SKU 同名的词、或「总账、报表、出纳」类标准功能并列枚举，就认定 suggestedDays 必须高于 standardDays；须结合该条需求完整语义与实施顾问角色做专业判断，只有存在相对标准产品交付的明确增量（如二开、深度集成、多组织推广、性能/迁移、额外培训与方案等）时才上调，并在 reason 中写清增量内容而非复述关键词。",
  },
  fileParsing: {
    enabled: true,
    model: "moonshot-v1-128k",
    allowedExtensions: [".xlsx", ".xls", ".csv"],
    maxFileSizeMb: 20,
    maxSheetCount: 20,
    strictMode: false,
    ocrEnabled: false,
  },
  kimiGeneration: {
    enabled: true,
    model: "moonshot-v1-128k",
    temperature: 0.5,
    maxTokens: 6000,
    outputStyle: "balanced",
    includeRiskHints: true,
    includeAssumptions: true,
  },
  kimiCredentials: {
    apiKey: "",
    hint: null,
    envFallbackAvailable: false,
    resolvedFrom: "none",
  },
}

function describeKimiKeySource(meta?: RequirementSystemConfig["kimiCredentials"] | null): string {
  const m = { ...DEFAULT_REQUIREMENT_CONFIG.kimiCredentials, ...(meta && typeof meta === "object" ? meta : {}) }
  if (m.resolvedFrom === "store") return `仓库密钥 ${m.hint || "（已配置）"}`
  if (m.resolvedFrom === "env") return "环境变量 KIMI_API_KEY"
  return m.envFallbackAvailable ? "未写入仓库（将尝试环境变量）" : "未配置可用密钥"
}

/** 合并接口返回，避免旧数据或异常响应缺少 kimiCredentials 等嵌套字段 */
function coerceRequirementConfig(input: Partial<RequirementSystemConfig> | undefined | null): RequirementSystemConfig {
  const d = input && typeof input === "object" ? input : {}
  return {
    ...DEFAULT_REQUIREMENT_CONFIG,
    ...d,
    kimiEvaluation: { ...DEFAULT_REQUIREMENT_CONFIG.kimiEvaluation, ...d.kimiEvaluation },
    fileParsing: { ...DEFAULT_REQUIREMENT_CONFIG.fileParsing, ...d.fileParsing },
    kimiGeneration: { ...DEFAULT_REQUIREMENT_CONFIG.kimiGeneration, ...d.kimiGeneration },
    kimiCredentials: { ...DEFAULT_REQUIREMENT_CONFIG.kimiCredentials, ...d.kimiCredentials },
  }
}

const DEFAULT_IMPLEMENTATION_DEPENDENCY_RULES: ImplementationDependencyRulesConfig = {
  schemaVersion: "1.0.0",
  source: "01_需求管理/原始需求/实施评估RR/依赖管理/depent.md",
  updatedFrom: "2026-04-10",
  mutualExclusionRules: [],
  rules: [],
}

function formatJsonContent(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return "{}"
  }
}

function parseExtensionInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
        .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`)),
    ),
  )
}

export default function SystemManagementPage() {
  const { isAdmin, user } = useAuth()
  const [rules, setRules] = useState<VersionCodeRuleItem[]>([])
  const [editingRule, setEditingRule] = useState<VersionCodeRuleItem | null>(null)
  const [editingFormat, setEditingFormat] = useState("")
  const [actingRuleId, setActingRuleId] = useState("")
  const [selectedRuleId, setSelectedRuleId] = useState("")
  const [requirementDraft, setRequirementDraft] = useState<RequirementSystemConfig>(DEFAULT_REQUIREMENT_CONFIG)
  const [requirementActive, setRequirementActive] = useState<RequirementSystemConfig>(DEFAULT_REQUIREMENT_CONFIG)
  const [requirementVersion, setRequirementVersion] = useState(1)
  const [requirementUpdatedAt, setRequirementUpdatedAt] = useState("--")
  const [requirementEffectiveAt, setRequirementEffectiveAt] = useState("--")
  const [savingRequirement, setSavingRequirement] = useState(false)
  const [activatingRequirement, setActivatingRequirement] = useState(false)
  const [testingKimiKey, setTestingKimiKey] = useState(false)
  const [testingFileParsingModel, setTestingFileParsingModel] = useState(false)
  const [testingKimiGenerationModel, setTestingKimiGenerationModel] = useState(false)
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)
  const [promptTemplateDraft, setPromptTemplateDraft] = useState("")
  const [implementationRulesDraftText, setImplementationRulesDraftText] = useState(
    formatJsonContent(DEFAULT_IMPLEMENTATION_DEPENDENCY_RULES),
  )
  const [implementationRulesActiveText, setImplementationRulesActiveText] = useState(
    formatJsonContent(DEFAULT_IMPLEMENTATION_DEPENDENCY_RULES),
  )
  const [implementationRulesVersion, setImplementationRulesVersion] = useState(1)
  const [implementationRulesUpdatedAt, setImplementationRulesUpdatedAt] = useState("--")
  const [implementationRulesEffectiveAt, setImplementationRulesEffectiveAt] = useState("--")
  const [savingImplementationRules, setSavingImplementationRules] = useState(false)
  const [activatingImplementationRules, setActivatingImplementationRules] = useState(false)

  async function loadRules(): Promise<boolean> {
    try {
      const items = await listVersionCodeRules({
        moduleKey: "all",
        keyword: "",
      })
      setRules(items)
      return true
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "加载版本号编码规则失败")
      return false
    }
  }

  async function loadRequirementConfig() {
    try {
      const data = await getRequirementSystemConfig()
      setRequirementVersion(Number(data.version || 1))
      setRequirementDraft(coerceRequirementConfig(data.draft))
      setRequirementActive(coerceRequirementConfig(data.active))
      setRequirementUpdatedAt(data.updatedAt || "--")
      setRequirementEffectiveAt(data.effectiveAt || "--")
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "加载需求模块配置失败")
    }
  }

  async function loadImplementationDependencyRulesConfig() {
    try {
      const data = await getImplementationDependencyRules()
      setImplementationRulesVersion(Number(data.version || 1))
      setImplementationRulesDraftText(formatJsonContent(data.draft || DEFAULT_IMPLEMENTATION_DEPENDENCY_RULES))
      setImplementationRulesActiveText(formatJsonContent(data.active || DEFAULT_IMPLEMENTATION_DEPENDENCY_RULES))
      setImplementationRulesUpdatedAt(data.updatedAt || "--")
      setImplementationRulesEffectiveAt(data.effectiveAt || "--")
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "加载实施评估依赖规则失败")
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    void loadRules()
    void loadRequirementConfig()
    void loadImplementationDependencyRulesConfig()
  }, [isAdmin])

  const selectedRule = useMemo(
    () => rules.find((item) => item.id === selectedRuleId) ?? null,
    [rules, selectedRuleId],
  )

  useEffect(() => {
    if (!selectedRuleId) return
    if (rules.some((item) => item.id === selectedRuleId)) return
    setSelectedRuleId("")
  }, [rules, selectedRuleId])

  function startEdit(item: VersionCodeRuleItem) {
    if (item.status !== "disabled") {
      toast.warning("仅“已禁用”状态的编码规则允许进入配置。")
      return
    }
    setEditingRule(item)
    setEditingFormat(
      item.format.startsWith("{PREFIX}")
        ? item.format.slice("{PREFIX}".length)
        : item.format,
    )
  }

  function clearEdit() {
    setEditingRule(null)
    setEditingFormat("")
  }

  async function saveConfig() {
    if (!editingRule) return
    setActingRuleId(editingRule.id)
    try {
      await updateVersionCodeRuleConfig(editingRule.id, {
        prefix: editingRule.prefix.trim().toUpperCase(),
        format: editingFormat.trim(),
      })
      toast.success("规则配置已保存，可继续执行“生效”操作。")
      clearEdit()
      await loadRules()
    } catch (error) {
      toastApiWarning(error, "保存规则配置失败")
    } finally {
      setActingRuleId("")
    }
  }

  async function onActivateRule(ruleId: string) {
    setActingRuleId(ruleId)
    try {
      await activateVersionCodeRule(ruleId)
      toast.success("编码规则已生效。")
      await loadRules()
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "规则生效失败")
    } finally {
      setActingRuleId("")
    }
  }

  async function onDisableRule(ruleId: string) {
    setActingRuleId(ruleId)
    try {
      await disableVersionCodeRule(ruleId)
      toast.success("编码规则已禁用。")
      await loadRules()
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "规则禁用失败")
    } finally {
      setActingRuleId("")
    }
  }

  async function onSaveRequirementDraft() {
    setSavingRequirement(true)
    try {
      const result = await updateRequirementSystemConfigDraft(requirementDraft)
      setRequirementVersion(Number(result.version || requirementVersion))
      setRequirementDraft(coerceRequirementConfig(result.draft ?? requirementDraft))
      setRequirementUpdatedAt(result.updatedAt || requirementUpdatedAt)
      toast.success("需求模块配置草稿已保存。")
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "保存需求模块配置失败")
    } finally {
      setSavingRequirement(false)
    }
  }

  async function onActivateRequirementDraft() {
    setActivatingRequirement(true)
    try {
      const result = await activateRequirementSystemConfig()
      setRequirementVersion(Number(result.version || requirementVersion))
      setRequirementActive(coerceRequirementConfig(result.active ?? requirementActive))
      setRequirementEffectiveAt(result.effectiveAt || requirementEffectiveAt)
      toast.success("需求模块配置已生效。")
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "需求模块配置生效失败")
    } finally {
      setActivatingRequirement(false)
    }
  }

  async function onTestKimiApiKey(overrides?: { model?: string }) {
    setTestingKimiKey(true)
    try {
      const key = (requirementDraft.kimiCredentials?.apiKey ?? "").trim()
      const model = (overrides?.model ?? requirementDraft.kimiEvaluation.model ?? "").trim()
      const result = await testRequirementKimiApiKey({
        ...(key ? { apiKey: key } : {}),
        ...(model ? { model } : {}),
      })
      const src =
        result.testedSource === "request_body"
          ? "输入框密钥"
          : result.testedSource === "draft_store"
            ? "草稿已存密钥"
            : "环境变量"
      toast.success(`连接成功（${src}，模型 ${result.model}）`)
    } catch (error) {
      toastApiWarning(error, "KIMI 连通性测试失败")
    } finally {
      setTestingKimiKey(false)
    }
  }

  async function onTestFileParsingModel() {
    setTestingFileParsingModel(true)
    try {
      const key = (requirementDraft.kimiCredentials?.apiKey ?? "").trim()
      const model = (requirementDraft.fileParsing.model ?? "").trim()
      const result = await testRequirementKimiApiKey({
        ...(key ? { apiKey: key } : {}),
        ...(model ? { model } : {}),
      })
      const src =
        result.testedSource === "request_body"
          ? "输入框密钥"
          : result.testedSource === "draft_store"
            ? "草稿已存密钥"
            : "环境变量"
      toast.success(`解析模型连通成功（${src}，模型 ${result.model}）`)
    } catch (error) {
      toastApiWarning(error, "解析模型连通性测试失败")
    } finally {
      setTestingFileParsingModel(false)
    }
  }

  async function onTestKimiGenerationModel() {
    setTestingKimiGenerationModel(true)
    try {
      const key = (requirementDraft.kimiCredentials?.apiKey ?? "").trim()
      const model = (requirementDraft.kimiGeneration.model ?? "").trim()
      const result = await testRequirementKimiApiKey({
        ...(key ? { apiKey: key } : {}),
        ...(model ? { model } : {}),
      })
      const src =
        result.testedSource === "request_body"
          ? "输入框密钥"
          : result.testedSource === "draft_store"
            ? "草稿已存密钥"
            : "环境变量"
      toast.success(`KIMI 生成模型连通成功（${src}，模型 ${result.model}）`)
    } catch (error) {
      toastApiWarning(error, "KIMI 生成模型连通性测试失败")
    } finally {
      setTestingKimiGenerationModel(false)
    }
  }

  async function onClearKimiApiKeyOverride() {
    setSavingRequirement(true)
    try {
      const result = await updateRequirementSystemConfigDraft({ kimiCredentials: { apiKey: null } })
      setRequirementVersion(Number(result.version || requirementVersion))
      setRequirementDraft(coerceRequirementConfig(result.draft ?? requirementDraft))
      setRequirementUpdatedAt(result.updatedAt || requirementUpdatedAt)
      toast.success("已清除仓库中的 API Key，将回退为环境变量 KIMI_API_KEY（若已配置）。")
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "清除失败")
    } finally {
      setSavingRequirement(false)
    }
  }

  async function onSavePromptTemplateDraft() {
    setSavingRequirement(true)
    try {
      const nextConfig: RequirementSystemConfig = {
        ...requirementDraft,
        kimiEvaluation: {
          ...requirementDraft.kimiEvaluation,
          promptTemplate: promptTemplateDraft.trim() || requirementDraft.kimiEvaluation.promptTemplate,
        },
      }
      const result = await updateRequirementSystemConfigDraft(nextConfig)
      setRequirementVersion(Number(result.version || requirementVersion))
      setRequirementDraft(coerceRequirementConfig(result.draft ?? nextConfig))
      setRequirementUpdatedAt(result.updatedAt || requirementUpdatedAt)
      setPromptEditorOpen(false)
      toast.success("提示词草稿已保存。")
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "保存提示词草稿失败")
    } finally {
      setSavingRequirement(false)
    }
  }

  async function onSaveAndActivatePromptTemplate() {
    setActivatingRequirement(true)
    try {
      const nextConfig: RequirementSystemConfig = {
        ...requirementDraft,
        kimiEvaluation: {
          ...requirementDraft.kimiEvaluation,
          promptTemplate: promptTemplateDraft.trim() || requirementDraft.kimiEvaluation.promptTemplate,
        },
      }
      const saved = await updateRequirementSystemConfigDraft(nextConfig)
      setRequirementVersion(Number(saved.version || requirementVersion))
      setRequirementDraft(coerceRequirementConfig(saved.draft ?? nextConfig))
      setRequirementUpdatedAt(saved.updatedAt || requirementUpdatedAt)

      const activated = await activateRequirementSystemConfig()
      setRequirementVersion(Number(activated.version || requirementVersion))
      setRequirementActive(coerceRequirementConfig(activated.active ?? requirementActive))
      setRequirementEffectiveAt(activated.effectiveAt || requirementEffectiveAt)
      setPromptEditorOpen(false)
      toast.success("提示词已生效，后续 KIMI 评估将按新提示词执行。")
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "提示词生效失败")
    } finally {
      setActivatingRequirement(false)
    }
  }

  async function onSaveImplementationDependencyRulesDraft() {
    setSavingImplementationRules(true)
    try {
      const parsed = JSON.parse(implementationRulesDraftText || "{}") as Partial<ImplementationDependencyRulesConfig>
      const result = await updateImplementationDependencyRulesDraft(parsed)
      setImplementationRulesVersion(Number(result.version || implementationRulesVersion))
      setImplementationRulesDraftText(formatJsonContent(result.draft || DEFAULT_IMPLEMENTATION_DEPENDENCY_RULES))
      setImplementationRulesUpdatedAt(result.updatedAt || implementationRulesUpdatedAt)
      toast.success("实施评估依赖规则草稿已保存。")
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "保存实施评估依赖规则失败")
    } finally {
      setSavingImplementationRules(false)
    }
  }

  async function onActivateImplementationDependencyRules() {
    setActivatingImplementationRules(true)
    try {
      const result = await activateImplementationDependencyRules()
      setImplementationRulesVersion(Number(result.version || implementationRulesVersion))
      setImplementationRulesActiveText(formatJsonContent(result.active || DEFAULT_IMPLEMENTATION_DEPENDENCY_RULES))
      setImplementationRulesEffectiveAt(result.effectiveAt || implementationRulesEffectiveAt)
      toast.success("实施评估依赖规则已生效。")
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : "实施评估依赖规则生效失败")
    } finally {
      setActivatingImplementationRules(false)
    }
  }

  return (
    <ModuleShell title="系统管理" breadcrumbs={[{ label: "系统管理" }]}>
      {!isAdmin ? (
        <Card className="border-border/40 bg-card/50">
          <CardContent className="p-6 text-sm text-muted-foreground">
            当前账号 `{user?.username || "unknown"}` 不是管理员，暂无权限访问系统管理。
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <div className="space-y-6">
          <Card className="gap-3 py-4 border-border/40 bg-card/50 backdrop-blur-sm">
            <CardHeader className="flex flex-col gap-2 space-y-0 px-6 pb-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <CardTitle className="text-base shrink-0">版本号编码规则</CardTitle>
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {selectedRule ? (
                  <p className="max-w-full text-xs text-muted-foreground sm:mr-auto sm:max-w-[min(100%,22rem)]">
                    {`当前选中：${selectedRule.moduleName}（${STATUS_LABEL[selectedRule.status]}）`}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => selectedRule && startEdit(selectedRule)}
                    disabled={!selectedRule || selectedRule.status !== "disabled" || actingRuleId === selectedRule?.id}
                    title={!selectedRule ? "请先选择一行" : selectedRule.status !== "disabled" ? "仅“已禁用”状态可配置" : ""}
                  >
                    配置
                  </Button>
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => selectedRule && void onActivateRule(selectedRule.id)}
                    disabled={!selectedRule || selectedRule.status === "active" || actingRuleId === selectedRule?.id}
                    title={!selectedRule ? "请先选择一行" : ""}
                  >
                    生效
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8"
                    onClick={() => selectedRule && void onDisableRule(selectedRule.id)}
                    disabled={!selectedRule || selectedRule.status === "disabled" || actingRuleId === selectedRule?.id}
                    title={!selectedRule ? "请先选择一行" : ""}
                  >
                    禁用
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-4 pt-0">
              <div className="rounded-lg border border-border/50">
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>模块</TableHead>
                      <TableHead>模块编码</TableHead>
                      <TableHead>版本前缀</TableHead>
                      <TableHead>
                        <div className="inline-flex items-center gap-1.5">
                          <span>编码格式</span>
                          <FormatHelpTooltip />
                        </div>
                      </TableHead>
                      <TableHead>示例</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>生效时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((item) => (
                      <TableRow
                        key={item.id}
                        className={cn("cursor-pointer", selectedRuleId === item.id ? "bg-primary/10" : "")}
                        onClick={() => setSelectedRuleId(item.id)}
                      >
                        <TableCell className="font-medium">{item.moduleName}</TableCell>
                        <TableCell>{item.moduleCode}</TableCell>
                        <TableCell>{item.prefix}</TableCell>
                        <TableCell>{item.format}</TableCell>
                        <TableCell>{item.sample}</TableCell>
                        <TableCell>
                          <Badge
                            variant={item.status === "disabled" ? "destructive" : "secondary"}
                            className={cn(
                              item.status === "active" &&
                                "border-emerald-300 bg-emerald-50 text-emerald-800 [a&]:hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200 dark:[a&]:hover:bg-emerald-900/40",
                              item.status === "draft" &&
                                "border-amber-200 bg-amber-50 text-amber-950 [a&]:hover:bg-amber-100/90 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-100 dark:[a&]:hover:bg-amber-950/40",
                            )}
                          >
                            {STATUS_LABEL[item.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDisplayTime(item.effectiveAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
            <CardHeader className="space-y-2 pb-3">
              <CardTitle className="text-base">模型配置</CardTitle>
              <CardDescription>
                对“需求”模块的 KIMI评估、文件解析、KIMI生成能力进行可视化配置；支持草稿保存与一键生效。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/70 p-3">
                <p className="text-xs text-muted-foreground">
                  当前配置版本：v{requirementVersion}，最近保存：{formatDisplayTime(requirementUpdatedAt)}，最近生效：
                  {formatDisplayTime(requirementEffectiveAt)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => void onSaveRequirementDraft()} disabled={savingRequirement}>
                    {savingRequirement ? "保存中..." : "保存草稿"}
                  </Button>
                  <Button size="sm" onClick={() => void onActivateRequirementDraft()} disabled={activatingRequirement}>
                    {activatingRequirement ? "生效中..." : "生效配置"}
                  </Button>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border/50 bg-background/60 p-4">
                <div className="space-y-1">
                  <Label className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <span>大模型 API Key（KIMI）</span>
                    <QuestionHelpTooltip
                      label="API Key"
                      content="用于需求导入智能解析、企业信息 KIMI 摘要、KIMI 实施评估预览等。保存至仓库的密钥优先于环境变量 KIMI_API_KEY；留空并保存其它配置不会覆盖已有密钥；「改用环境变量」可清空仓库密钥。"
                    />
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    草稿侧：{describeKimiKeySource(requirementDraft.kimiCredentials)}；生效侧：
                    {describeKimiKeySource(requirementActive.kimiCredentials)}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor="kimi-api-key-input">新密钥（可选）</Label>
                    <Input
                      id="kimi-api-key-input"
                      type="password"
                      autoComplete="off"
                      placeholder={
                        requirementDraft.kimiCredentials.hint
                          ? "留空表示不修改；填写则覆盖保存"
                          : "sk-…"
                      }
                      value={requirementDraft.kimiCredentials.apiKey}
                      onChange={(e) =>
                        setRequirementDraft((prev) => ({
                          ...prev,
                          kimiCredentials: { ...prev.kimiCredentials, apiKey: e.target.value },
                        }))
                      }
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={testingKimiKey}
                      onClick={() => void onTestKimiApiKey()}
                    >
                      {testingKimiKey ? "测试中…" : "测试连接"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={savingRequirement}
                      onClick={() => void onClearKimiApiKeyOverride()}
                    >
                      改用环境变量
                    </Button>
                  </div>
                </div>
                  <p className="text-[11px] text-muted-foreground">
                  测试连接：优先使用输入框中的密钥；若为空则依次尝试草稿已保存密钥与环境变量。请求模型与「KIMI评估 → 模型」草稿一致，缺省为服务端环境配置；需求 Excel 智能解析另见「文件解析 → 解析模型」。
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 rounded-xl border border-border/50 bg-background/60 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <span>KIMI评估启用</span>
                      <QuestionHelpTooltip
                        label="KIMI评估启用"
                        content="控制需求模块是否允许发起 KIMI 评估请求。关闭后将不触发模型评估链路。"
                      />
                    </Label>
                    <Switch
                      checked={requirementDraft.kimiEvaluation.enabled}
                      onCheckedChange={(checked) =>
                        setRequirementDraft((prev) => ({
                          ...prev,
                          kimiEvaluation: { ...prev.kimiEvaluation, enabled: checked },
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="inline-flex items-center gap-1.5">
                        <span>模型</span>
                        <QuestionHelpTooltip label="评估模型" content="用于需求评估的模型标识，决定能力与成本。示例：moonshot-v1-128k。" />
                      </Label>
                      <Input
                        value={requirementDraft.kimiEvaluation.model}
                        onChange={(e) =>
                          setRequirementDraft((prev) => ({
                            ...prev,
                            kimiEvaluation: { ...prev.kimiEvaluation, model: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="inline-flex items-center gap-1.5">
                        <span>Prompt Profile</span>
                        <QuestionHelpTooltip
                          label="Prompt Profile"
                          content="评估提示词模板档位。双击该字段可打开弹窗，查看并编辑实际提示词内容。"
                        />
                      </Label>
                      <div
                        className="space-y-1"
                        onDoubleClick={() => {
                          setPromptTemplateDraft(requirementDraft.kimiEvaluation.promptTemplate || "")
                          setPromptEditorOpen(true)
                        }}
                        title="双击打开提示词编辑弹窗"
                      >
                        <Input
                          value={requirementDraft.kimiEvaluation.promptProfile}
                          onChange={(e) =>
                            setRequirementDraft((prev) => ({
                              ...prev,
                              kimiEvaluation: { ...prev.kimiEvaluation, promptProfile: e.target.value },
                            }))
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">双击可编辑此 Profile 对应的实际提示词</p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="inline-flex items-center gap-1.5">
                        <span>Temperature</span>
                        <QuestionHelpTooltip
                          label="Temperature"
                          content="控制输出随机性，越低越稳定，越高越发散。评估场景建议使用 0.2~0.5。"
                        />
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={requirementDraft.kimiEvaluation.temperature}
                        onChange={(e) =>
                          setRequirementDraft((prev) => ({
                            ...prev,
                            kimiEvaluation: { ...prev.kimiEvaluation, temperature: Number(e.target.value || 0) },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="inline-flex items-center gap-1.5">
                        <span>最大 Tokens</span>
                        <QuestionHelpTooltip
                          label="最大 Tokens"
                          content="单次评估允许的最大生成长度。值越大可输出更详细内容，但耗时与成本更高。"
                        />
                      </Label>
                      <Input
                        type="number"
                        min={256}
                        value={requirementDraft.kimiEvaluation.maxTokens}
                        onChange={(e) =>
                          setRequirementDraft((prev) => ({
                            ...prev,
                            kimiEvaluation: { ...prev.kimiEvaluation, maxTokens: Number(e.target.value || 0) },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="inline-flex items-center gap-1.5">
                        <span>超时(ms)</span>
                        <QuestionHelpTooltip
                          label="超时"
                          content="调用模型接口的等待上限，超过后将判定超时并按配置进入失败处理。"
                        />
                      </Label>
                      <Input
                        type="number"
                        min={3000}
                        value={requirementDraft.kimiEvaluation.timeoutMs}
                        onChange={(e) =>
                          setRequirementDraft((prev) => ({
                            ...prev,
                            kimiEvaluation: { ...prev.kimiEvaluation, timeoutMs: Number(e.target.value || 0) },
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/70 px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span>失败时启用规则回退</span>
                        <QuestionHelpTooltip
                          label="规则回退"
                          content="当模型异常、超时或输出不可解析时，自动切换到规则引擎兜底，保证流程可继续。"
                        />
                      </span>
                      <Switch
                        checked={requirementDraft.kimiEvaluation.fallbackToRule}
                        onCheckedChange={(checked) =>
                          setRequirementDraft((prev) => ({
                            ...prev,
                            kimiEvaluation: { ...prev.kimiEvaluation, fallbackToRule: checked },
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      按当前表单中的「模型」发起最小对话请求校验连通性（可先改模型再测，无需先点保存草稿）。密钥与上方「大模型 API Key」规则一致。
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      disabled={testingKimiKey}
                      onClick={() => void onTestKimiApiKey()}
                    >
                      {testingKimiKey ? "测试中…" : "测试连通性"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-border/50 bg-background/60 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <span>文件解析启用</span>
                      <QuestionHelpTooltip
                        label="文件解析启用"
                        content="控制需求文件上传后是否执行解析。关闭后仅保留手工录入链路。"
                      />
                    </Label>
                    <Switch
                      checked={requirementDraft.fileParsing.enabled}
                      onCheckedChange={(checked) =>
                        setRequirementDraft((prev) => ({
                          ...prev,
                          fileParsing: { ...prev.fileParsing, enabled: checked },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="inline-flex items-center gap-1.5">
                      <span>解析模型</span>
                      <QuestionHelpTooltip
                        label="解析模型"
                        content="用于需求 Excel 智能解析（上传需求表）的 Kimi 模型 id。保存并生效后优先使用本字段；未配置时依次回退到「KIMI评估 → 模型」与服务端环境变量默认模型。"
                      />
                    </Label>
                    <Input
                      value={requirementDraft.fileParsing.model}
                      onChange={(e) =>
                        setRequirementDraft((prev) => ({
                          ...prev,
                          fileParsing: { ...prev.fileParsing, model: e.target.value },
                        }))
                      }
                      placeholder="例如 moonshot-v1-128k、kimi-k2-turbo-preview"
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      按当前「解析模型」发起最小对话请求校验连通性（可先改模型再测，无需先保存草稿）。密钥与「大模型 API Key」及 KIMI 评估测试规则一致；未填模型时服务端将回退为评估草稿中的模型。
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      disabled={testingFileParsingModel}
                      onClick={() => void onTestFileParsingModel()}
                    >
                      {testingFileParsingModel ? "测试中…" : "测试连通性"}
                    </Button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-1 md:col-span-2">
                      <Label className="inline-flex items-center gap-1.5">
                        <span>允许扩展名（逗号分隔）</span>
                        <QuestionHelpTooltip
                          label="允许扩展名"
                          content="限定可上传文件类型，多个后缀用逗号分隔。建议仅放行业务必要类型。"
                        />
                      </Label>
                      <Input
                        value={requirementDraft.fileParsing.allowedExtensions.join(",")}
                        onChange={(e) =>
                          setRequirementDraft((prev) => ({
                            ...prev,
                            fileParsing: {
                              ...prev.fileParsing,
                              allowedExtensions: parseExtensionInput(e.target.value),
                            },
                          }))
                        }
                        placeholder=".xlsx,.xls,.csv"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="inline-flex items-center gap-1.5">
                        <span>最大文件大小(MB)</span>
                        <QuestionHelpTooltip label="最大文件大小" content="单个上传文件体积上限，超出将被拒绝，避免大文件影响稳定性。" />
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        value={requirementDraft.fileParsing.maxFileSizeMb}
                        onChange={(e) =>
                          setRequirementDraft((prev) => ({
                            ...prev,
                            fileParsing: { ...prev.fileParsing, maxFileSizeMb: Number(e.target.value || 0) },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="inline-flex items-center gap-1.5">
                        <span>最大工作表数量</span>
                        <QuestionHelpTooltip
                          label="最大工作表数量"
                          content="限制单文件可解析的 Sheet 数，防止超大多表文档引起解析耗时过长。"
                        />
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        value={requirementDraft.fileParsing.maxSheetCount}
                        onChange={(e) =>
                          setRequirementDraft((prev) => ({
                            ...prev,
                            fileParsing: { ...prev.fileParsing, maxSheetCount: Number(e.target.value || 0) },
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/70 px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span>严格解析模式</span>
                        <QuestionHelpTooltip
                          label="严格解析模式"
                          content="开启后对列头、结构和字段校验更严格，不符合模板的数据会被直接拦截。"
                        />
                      </span>
                      <Switch
                        checked={requirementDraft.fileParsing.strictMode}
                        onCheckedChange={(checked) =>
                          setRequirementDraft((prev) => ({
                            ...prev,
                            fileParsing: { ...prev.fileParsing, strictMode: checked },
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/70 px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span>OCR 解析</span>
                        <QuestionHelpTooltip
                          label="OCR 解析"
                          content="用于图片或扫描件文本提取。开启后可提升非结构化文件可读性，但耗时会增加。"
                        />
                      </span>
                      <Switch
                        checked={requirementDraft.fileParsing.ocrEnabled}
                        onCheckedChange={(checked) =>
                          setRequirementDraft((prev) => ({
                            ...prev,
                            fileParsing: { ...prev.fileParsing, ocrEnabled: checked },
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-border/50 bg-background/60 p-4">
                <div className="flex items-center justify-between">
                  <Label className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <span>KIMI生成启用</span>
                    <QuestionHelpTooltip
                      label="KIMI生成启用"
                      content="控制是否启用 KIMI 对需求内容进行文案/结构化生成与补全。"
                    />
                  </Label>
                  <Switch
                    checked={requirementDraft.kimiGeneration.enabled}
                    onCheckedChange={(checked) =>
                      setRequirementDraft((prev) => ({
                        ...prev,
                        kimiGeneration: { ...prev.kimiGeneration, enabled: checked },
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="inline-flex items-center gap-1.5">
                      <span>模型</span>
                      <QuestionHelpTooltip label="生成模型" content="用于内容生成的模型标识，可按质量与成本目标切换。" />
                    </Label>
                    <Input
                      value={requirementDraft.kimiGeneration.model}
                      onChange={(e) =>
                        setRequirementDraft((prev) => ({
                          ...prev,
                          kimiGeneration: { ...prev.kimiGeneration, model: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="inline-flex items-center gap-1.5">
                      <span>Temperature</span>
                      <QuestionHelpTooltip
                        label="生成 Temperature"
                        content="控制生成发散程度。低值更稳健，高值更有创造性。"
                      />
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.1}
                      value={requirementDraft.kimiGeneration.temperature}
                      onChange={(e) =>
                        setRequirementDraft((prev) => ({
                          ...prev,
                          kimiGeneration: { ...prev.kimiGeneration, temperature: Number(e.target.value || 0) },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="inline-flex items-center gap-1.5">
                      <span>最大 Tokens</span>
                      <QuestionHelpTooltip
                        label="生成最大 Tokens"
                        content="控制单次生成长度上限，适合根据输出文档长度要求进行调节。"
                      />
                    </Label>
                    <Input
                      type="number"
                      min={256}
                      value={requirementDraft.kimiGeneration.maxTokens}
                      onChange={(e) =>
                        setRequirementDraft((prev) => ({
                          ...prev,
                          kimiGeneration: { ...prev.kimiGeneration, maxTokens: Number(e.target.value || 0) },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="inline-flex items-center gap-1.5">
                      <span>输出风格</span>
                      <QuestionHelpTooltip
                        label="输出风格"
                        content="控制文案详略：简洁/均衡/详细，影响生成内容粒度与篇幅。"
                      />
                    </Label>
                    <Select
                      value={requirementDraft.kimiGeneration.outputStyle}
                      onValueChange={(value) =>
                        setRequirementDraft((prev) => ({
                          ...prev,
                          kimiGeneration: {
                            ...prev.kimiGeneration,
                            outputStyle: value as RequirementSystemConfig["kimiGeneration"]["outputStyle"],
                          },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="concise">简洁</SelectItem>
                        <SelectItem value="balanced">均衡</SelectItem>
                        <SelectItem value="detailed">详细</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/70 px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span>包含风险提示</span>
                      <QuestionHelpTooltip
                        label="包含风险提示"
                        content="开启后输出中会附带风险点识别与注意事项，便于评审提前识别风险。"
                      />
                    </span>
                    <Switch
                      checked={requirementDraft.kimiGeneration.includeRiskHints}
                      onCheckedChange={(checked) =>
                        setRequirementDraft((prev) => ({
                          ...prev,
                          kimiGeneration: { ...prev.kimiGeneration, includeRiskHints: checked },
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/70 px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span>包含假设条件</span>
                      <QuestionHelpTooltip
                        label="包含假设条件"
                        content="开启后输出会标注前置假设与边界条件，帮助业务方理解结论成立前提。"
                      />
                    </span>
                    <Switch
                      checked={requirementDraft.kimiGeneration.includeAssumptions}
                      onCheckedChange={(checked) =>
                        setRequirementDraft((prev) => ({
                          ...prev,
                          kimiGeneration: { ...prev.kimiGeneration, includeAssumptions: checked },
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    按当前「生成 → 模型」发起最小对话请求校验连通性（可先改模型再测，无需先保存草稿）。密钥规则与上方一致；未填模型时服务端将回退为 KIMI 评估草稿中的模型。
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    disabled={testingKimiGenerationModel}
                    onClick={() => void onTestKimiGenerationModel()}
                  >
                    {testingKimiGenerationModel ? "测试中…" : "测试连通性"}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-dashed border-border/50 bg-background/40 p-3 text-xs text-muted-foreground">
                当前生效配置快照：KIMI评估({requirementActive.kimiEvaluation.enabled ? "启用" : "禁用"})，
                文件解析({requirementActive.fileParsing.enabled ? "启用" : "禁用"}，模型 {requirementActive.fileParsing.model || "—"})，
                KIMI生成({requirementActive.kimiGeneration.enabled ? "启用" : "禁用"})，
                KIMI密钥({describeKimiKeySource(requirementActive.kimiCredentials)})
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/50 backdrop-blur-sm">
            <CardHeader className="space-y-2 pb-3">
              <CardTitle className="text-base">实施评估子模块配置 - 依赖规则</CardTitle>
              <CardDescription>
                维护 SKU 依赖校验规则 JSON，支持草稿保存与生效；生效后作为实施评估模块依赖校验基线使用。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/70 p-3">
                <p className="text-xs text-muted-foreground">
                  当前规则版本：v{implementationRulesVersion}，最近保存：{formatDisplayTime(implementationRulesUpdatedAt)}，最近生效：
                  {formatDisplayTime(implementationRulesEffectiveAt)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onSaveImplementationDependencyRulesDraft()}
                    disabled={savingImplementationRules}
                  >
                    {savingImplementationRules ? "保存中..." : "保存草稿"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void onActivateImplementationDependencyRules()}
                    disabled={activatingImplementationRules}
                  >
                    {activatingImplementationRules ? "生效中..." : "生效配置"}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="implementation-rules-json">依赖规则 JSON（草稿）</Label>
                <Textarea
                  id="implementation-rules-json"
                  className="min-h-[420px] font-mono text-xs"
                  value={implementationRulesDraftText}
                  onChange={(event) => setImplementationRulesDraftText(event.target.value)}
                  placeholder='{"schemaVersion":"1.0.0","rules":[]}'
                />
              </div>

              <div className="rounded-xl border border-dashed border-border/50 bg-background/40 p-3">
                <p className="mb-2 text-xs text-muted-foreground">当前生效配置快照（只读）</p>
                <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                  {implementationRulesActiveText}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Dialog
        open={!!editingRule}
        onOpenChange={(open) => {
          if (!open) clearEdit()
        }}
      >
        <DialogContent className="sm:max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>配置版本号编码规则</DialogTitle>
            <DialogDescription>
              {editingRule
                ? `模块：${editingRule.moduleName}（${editingRule.moduleCode}）。版本前缀由规则固定，仅可维护其后的编码格式片段。`
                : "编辑规则配置"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rule-prefix-dialog">版本前缀（只读）</Label>
              <Input
                id="rule-prefix-dialog"
                value={editingRule?.prefix ?? ""}
                readOnly
                disabled
                className="cursor-not-allowed bg-muted/50 text-muted-foreground"
                title="前缀由系统按模块预设，不在此修改"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-format-dialog" className="inline-flex items-center gap-1.5">
                <span>编码格式（不含前缀）</span>
                <FormatHelpTooltip />
              </Label>
              <Input
                id="rule-format-dialog"
                value={editingFormat}
                onChange={(event) => setEditingFormat(event.target.value)}
                placeholder="例如 -{MM}-{NNN} 或 -{YYYYMMDD}-{NNN}"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={clearEdit}>
              取消
            </Button>
            <Button onClick={() => void saveConfig()} disabled={!editingRule || actingRuleId === editingRule.id}>
              保存配置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={promptEditorOpen} onOpenChange={setPromptEditorOpen}>
        <DialogContent className="sm:max-w-3xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>编辑 KIMI 评估提示词</DialogTitle>
            <DialogDescription>
              双击 Prompt Profile 打开的编辑器。保存并生效后，后端 `/api/v1/ai/kimi-assessment/preview`
              将实时使用该提示词。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="kimi-prompt-template">提示词内容</Label>
            <textarea
              id="kimi-prompt-template"
              className="min-h-56 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={promptTemplateDraft}
              onChange={(e) => setPromptTemplateDraft(e.target.value)}
              placeholder="请输入 KIMI 评估系统提示词..."
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setPromptEditorOpen(false)}>
              取消
            </Button>
            <Button variant="outline" onClick={() => void onSavePromptTemplateDraft()} disabled={savingRequirement}>
              {savingRequirement ? "保存中..." : "保存草稿"}
            </Button>
            <Button onClick={() => void onSaveAndActivatePromptTemplate()} disabled={activatingRequirement}>
              {activatingRequirement ? "生效中..." : "保存并生效"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ModuleShell>
  )
}
