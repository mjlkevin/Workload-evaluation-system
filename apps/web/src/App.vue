<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Directive } from "vue";
import kimiLogoUrl from "./assets/kimi-logo.png";

type PageKey =
  | "dashboard"
  | "requirementImport"
  | "assessment"
  | "devAssessment"
  | "resourceCost"
  | "wbs"
  | "review"
  | "userManagement"
  | "apiKeys";

type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
  details?: Array<{ field: string; reason: string }>;
  requestId?: string;
};

type TemplateOption = {
  templateId: string;
  templateVersion: string;
  templateName: string;
};

type TemplateSheet = {
  sheetId: string;
  sheetName: string;
};

type TemplateItem = {
  templateItemId: string;
  itemName: string;
  standardDays: number;
  sheetName?: string;
  cloudProduct?: string;
  skuName?: string;
  appGroup?: string;
  deliveryModule?: string;
  deliveryPoint?: string;
  deliveryDesc?: string;
  evalDesc?: string;
};

type TemplateDetail = {
  templateId: string;
  templateVersion: string;
  templateName: string;
  items: TemplateItem[];
  sheets?: TemplateSheet[];
};

type RuleSetActive = {
  ruleSetId: string;
  baseRule: {
    difficultyFactorList: number[];
    userCountTiers?: Array<{ min: number; max: number; factor: number }>;
    userIncrementRounding?: "none" | "ceil_int";
  };
  orgIncrementRule?: {
    enabled: boolean;
    factor?: number;
  };
};

type CalculateResult = {
  totalDays: number;
  baseDays: number;
  userIncrementDays: number;
  difficultyIncrementDays: number;
  orgIncrementDays: number;
  pipelineVersion: string;
  ruleVersion: string;
};

type ExportResult = {
  totalDays: number;
  downloadUrl: string;
  expireAt: string;
};

type ExportHistoryItem = {
  fileName: string;
  size: number;
  modifiedAt: string;
  downloadUrl: string;
};

type ResourceCostRow = {
  rowId: string;
  role: string;
  personType: string;
  orgName: string;
  name: string;
  consultantLevel: string;
  product: string;
  moduleTask: string;
  unitCost: number;
  plannedDays: number;
  plannedCost: number;
  trafficCount: number;
  trafficUnitCost: number;
  stayDays: number;
  stayUnitCost: number;
  allowanceDays: number;
  allowanceUnitCost: number;
  travelCostTotal: number;
  monthDays: number[];
};

type DevAssessmentRow = {
  rowId: string;
  businessDomain: string;
  moduleName: string;
  moduleBrief: string;
  functionDesc: string;
  devType: "功能开发" | "报表开发" | "集成开发";
  estimateBasis: string;
  codingDays: number;
};

type ChartSlice = {
  label: string;
  value: number;
  color: string;
  percent: number;
};

type RingSegment = ChartSlice & {
  dasharray: string;
  dashoffset: number;
};

type DashboardBasicInfo = {
  customerName: string;
  projectName: string;
  opportunityNo: string;
  customerIndustry: string;
  enterpriseRevenue: string;
  itStatus: string;
  expectedGoLive: string;
  enterpriseProfile: string;
  projectBackgroundNeeds: string;
  projectGoals: string;
};

type RequirementValuePropositionRow = {
  rowId: string;
  summary: string;
  refinedContent: string;
  originalDemand: string;
  interviewOutline: string;
};

type RequirementBusinessNeedRow = {
  rowId: string;
  businessDomain: string;
  category: string;
  businessNeed: string;
  proposer: string;
  title: string;
  preSalesIncluded: string;
  standardImplemented: string;
  solutionSuggestion: string;
  requiresCustomDev: string;
};

type RequirementDevOverviewRow = {
  rowId: string;
  businessDomain: string;
  moduleName: string;
  moduleBrief: string;
  functionDesc: string;
  solutionSuggestion: string;
  codingDays: number;
  estimateBasis: string;
};

type RequirementProductModuleRow = {
  rowId: string;
  productDomain: string;
  moduleName: string;
  subModule: string;
  userCount: string;
  implementationOrgCount: string;
  pilotOrgCount: string;
  partyBLead: string;
  partyALead: string;
};

type RequirementImplementationScopeRow = {
  rowId: string;
  companyName: string;
  companyType: string;
  moduleScope: string;
  location: string;
  implementationMode: string;
  note: string;
};

type RequirementKeyPointRow = {
  rowId: string;
  analysisCategory: string;
  subItem: string;
  detail: string;
  note: string;
};

type RequirementImportData = {
  valuePropositionRows: RequirementValuePropositionRow[];
  businessNeedRows: RequirementBusinessNeedRow[];
  devOverviewRows: RequirementDevOverviewRow[];
  productModuleRows: RequirementProductModuleRow[];
  implementationScopeRows: RequirementImplementationScopeRow[];
  meetingNotes: string;
  keyPointRows: RequirementKeyPointRow[];
};

type FrontAuthUser = {
  id: string;
  username: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt: string;
};

type UserMgmtStatus = FrontAuthUser["status"];

type InviteCodeRecord = {
  code: string;
  status: "active" | "used";
  createdAt: string;
  usedAt?: string;
  usedByUserId?: string;
  usedByUsername?: string;
};

const currentPage = ref<PageKey>("dashboard");
const pageSubtitle = computed(() => {
  if (currentPage.value === "dashboard") return "全局方案概览与版本关系追踪";
  if (currentPage.value === "requirementImport") return "需求结构化导入、企业画像与字段回填";
  if (currentPage.value === "assessment") return "实施工作量评估、规则计算与实时预览";
  if (currentPage.value === "devAssessment") return "开发工作量估算与实施范围联动";
  if (currentPage.value === "resourceCost") return "资源排布、差旅核算与成本归集";
  if (currentPage.value === "wbs") return "交付分解结构设计与任务拆解";
  if (currentPage.value === "review") return "评审结论沉淀与问题闭环";
  if (currentPage.value === "userManagement") return "用户、角色与推荐码管理";
  return "API 调用能力与接入说明";
});
const sidebarCollapsed = ref(false);
const dashboardAnalysisExpanded = ref(true);
/** 评估页顶部「参数 + 预览」大块是否展开 */
const assessmentToolbarExpanded = ref(true);
const assessmentStickyOpacity = ref(1);
const assessmentAutoCollapsed = ref(false);
const assessmentManualExpandOverride = ref(false);
const AUTO_COLLAPSE_SCROLL_THRESHOLD = 140;
const MIN_STICKY_OPACITY = 0.18;
const NEXT_CLOUD_COLLAPSE_TRIGGER_OFFSET = 120;
const lastAssessmentScrollTop = ref(0);
const cloudCardRefs = ref<Record<string, HTMLElement | null>>({});
const initLoading = ref(false);
const exporting = ref(false);
const error = ref("");

const templateOptions = ref<TemplateOption[]>([]);
const templateDetail = ref<TemplateDetail | null>(null);
const activeRuleSet = ref<RuleSetActive | null>(null);
const difficultyOptions = ref<number[]>([0, 0.1, 0.2, 0.3]);
const selectedSheet = ref("");
/** 已选中的云产品标签（多选），为空时下方不展示大容器 */
const selectedCloudNames = ref<string[]>([]);
const cloudTagsCollapsed = ref(true);
/** 模块评估大面板：折叠后仅保留标题与工具栏 */
const moduleAssessmentPanelExpanded = ref(true);
/** 多组织推广估算面板 */
const multiOrgPanelExpanded = ref(true);
/** 云产品栏「全选/全不选」切换：false 显示「全选」并执行全选；true 显示「全不选」并执行全不选 */
const cloudTagsSheetBulkShowsDeselect = ref(false);
const multiOrgRowSeed = ref(1);
const multiOrgRows = ref<MultiOrgRow[]>([]);
const multiOrgOrgTypeOptions = ["总公司", "子公司", "分公司", "事业部", "其他"] as const;
const multiOrgDeliveryStrategyOptions = ["主站实施", "逐个推广", "集中推广", "远程支持"] as const;

watch(selectedSheet, () => {
  cloudTagsSheetBulkShowsDeselect.value = false;
  applyMultiOrgDraftForSheet(selectedSheet.value);
});

const presetModeOptions = ["简单纯财", "标准财务供应链", "标准财务供应链生产", "研产供销一体化", "标准PLM"] as const;
type PresetMode = (typeof presetModeOptions)[number];
const selectedPresetMode = ref<PresetMode | "">("");
const presetModeConfigs: Record<PresetMode, { templateItemIds: string[] }> = {
  简单纯财: {
    // 来自用户提供的 estimate-1774492409230.xlsx
    templateItemIds: ["item-16", "item-19", "item-21", "item-24", "item-27", "item-30", "item-41", "item-42"]
  },
  标准财务供应链: {
    // 来自用户提供的 estimate-1774493711566.xlsx
    templateItemIds: [
      "item-16",
      "item-19",
      "item-21",
      "item-24",
      "item-27",
      "item-30",
      "item-41",
      "item-42",
      "item-44",
      "item-60",
      "item-61",
      "item-62",
      "item-66",
      "item-67",
      "item-68",
      "item-69",
      "item-74",
      "item-75",
      "item-76"
    ]
  },
  标准财务供应链生产: {
    // 来自用户提供的 estimate-1774494435787.xlsx（标准财务供应链制造）
    templateItemIds: [
      "item-16",
      "item-19",
      "item-21",
      "item-24",
      "item-27",
      "item-30",
      "item-41",
      "item-42",
      "item-44",
      "item-46",
      "item-60",
      "item-61",
      "item-62",
      "item-66",
      "item-67",
      "item-68",
      "item-69",
      "item-74",
      "item-75",
      "item-76",
      "item-94",
      "item-97",
      "item-99"
    ]
  },
  研产供销一体化: {
    // 来自用户提供的 estimate-1774537946495.xlsx
    templateItemIds: [
      "item-16",
      "item-19",
      "item-21",
      "item-24",
      "item-27",
      "item-30",
      "item-41",
      "item-42",
      "item-44",
      "item-46",
      "item-60",
      "item-61",
      "item-62",
      "item-66",
      "item-67",
      "item-68",
      "item-69",
      "item-74",
      "item-75",
      "item-76",
      "item-94",
      "item-97",
      "item-99",
      "item-126",
      "item-127",
      "item-128",
      "item-129",
      "item-131",
      "item-137"
    ]
  },
  标准PLM: {
    templateItemIds: []
  }
};
const itemSelection = ref<Record<string, boolean>>({});
const customModeEnabled = ref(false);
const itemCustomDays = ref<Record<string, number | undefined>>({});
type ModeDraft = {
  selectedCloudNames: string[];
  itemSelection: Record<string, boolean>;
  customModeEnabled: boolean;
  itemCustomDays: Record<string, number | undefined>;
  versionCode?: string;
  updatedAt: number;
};
type MultiOrgScopeFlags = {
  finance: boolean;
  scm: boolean;
  mfg: boolean;
  plm: boolean;
  mes: boolean;
  omni: boolean;
};
type MultiOrgRow = {
  rowId: string;
  orgName: string;
  orgType: string;
  location: string;
  deliveryStrategy: string;
  userCount: number | null;
  scope: MultiOrgScopeFlags;
  otherBusinessDays: number;
  difficultyFactor: number;
};
type MultiOrgScopeDef = {
  key: keyof MultiOrgScopeFlags;
  label: string;
  cloudName: string;
};
type MultiOrgDraft = {
  updatedAt: number;
  rows: MultiOrgRow[];
};
const MODE_DRAFT_STORAGE_KEY = "workload-mode-drafts-v1";
const MULTI_ORG_DRAFT_STORAGE_KEY = "workload-multi-org-drafts-v1";
const RESOURCE_DRAFT_STORAGE_KEY = "workload-resource-drafts-v1";
const GLOBAL_PLAN_STORAGE_KEY = "workload-global-plan-drafts-v1";
const DEV_ASSESSMENT_DRAFT_STORAGE_KEY = "workload-dev-assessment-drafts-v1";
const REQUIREMENT_IMPORT_DRAFT_STORAGE_KEY = "workload-requirement-import-drafts-v1";
const TABLE_COLUMN_WIDTH_STORAGE_KEY = "workload-table-column-widths-v1";
const TABLE_COLUMN_MIN_WIDTH = 68;
type TableColumnWidthMemory = Record<string, Record<string, number>>;
const tableColumnWidthMemory = ref<TableColumnWidthMemory>({});
const tableResizeCleanupMap = new WeakMap<HTMLTableElement, () => void>();
let tableColumnWidthMemoryLoaded = false;
const COLLAPSIBLE_HINT_HOVER_DELAY_MS = 5000;
const TABLE_LONG_TEXTAREA_COLLAPSED_HEIGHT_PX = 52;
const TABLE_LONG_TEXTAREA_EXPANDED_MIN_HEIGHT_PX = 140;
const modeDrafts = ref<Record<string, ModeDraft>>({});
const multiOrgDrafts = ref<Record<string, MultiOrgDraft>>({});
type ResourceDraft = {
  versionCode: string;
  updatedAt: number;
  selectedEstimateVersionCode: string;
  includeTravel: boolean;
  monthCount: number;
  rows: ResourceCostRow[];
  rowSkuSelections: Record<string, string[]>;
};
const resourceDrafts = ref<Record<string, ResourceDraft>>({});
const currentResourceVersionCode = ref("");
type GlobalPlanDraft = {
  versionCode: string;
  createdAt?: number;
  updatedAt: number;
  reviewedAt?: number;
  assessmentVersionCode: string;
  resourceVersionCode: string;
  requirementImportVersionCode?: string;
  devAssessmentVersionCode?: string;
  wbsVersionCode?: string;
  reviewVersionCode?: string;
  basicInfo?: DashboardBasicInfo;
  requirementImportData?: RequirementImportData;
};
const globalPlanDrafts = ref<Record<string, GlobalPlanDraft>>({});
const selectedGlobalPlanVersionCode = ref("");
const selectedMyEvaluationVersionCode = ref("");
const createPlanGuideVisible = ref(false);
const plannedGlobalPlanVersionCode = ref("");
const planGuideProjectName = ref("");
const planGuideCreatedAt = ref<number | null>(null);
const planPreviewVisible = ref(false);
const planPreviewVersionCode = ref("");
const previewSectionExpanded = ref<Record<"requirement" | "assessment" | "resource" | "dev", boolean>>({
  requirement: false,
  assessment: false,
  resource: false,
  dev: false
});
const selectedGlobalAssessmentVersionCode = ref("");
const selectedGlobalResourceVersionCode = ref("");
const selectedGlobalRequirementImportVersionCode = ref("");
type ResourceDraftOption = {
  versionCode: string;
  updatedAt: number;
  selectedEstimateVersionCode: string;
};
type DevAssessmentDraft = {
  versionCode: string;
  updatedAt: number;
  selectedEstimateVersionCode: string;
  evaluator: string;
  evaluateDate: string;
  rows: DevAssessmentRow[];
  rowSkuSelections: Record<string, string[]>;
};
const devAssessmentDrafts = ref<Record<string, DevAssessmentDraft>>({});
const currentDevAssessmentVersionCode = ref("");
const selectedDevAssessmentEstimateVersionCode = ref("");
type RequirementImportDraft = {
  versionCode: string;
  updatedAt: number;
  basicInfo: DashboardBasicInfo;
  requirementImportData: RequirementImportData;
};
const requirementImportDrafts = ref<Record<string, RequirementImportDraft>>({});
const currentRequirementImportVersionCode = ref("");
const collapsibleHintVisible = ref<Record<string, boolean>>({});
const collapsibleHintPointer = ref<Record<string, { x: number; y: number }>>({});
const collapsibleHoverTimers = new Map<string, ReturnType<typeof setTimeout>>();
const collapsibleHideTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveNotice = ref("");
let saveNoticeTimer: ReturnType<typeof setTimeout> | null = null;
const exportHistory = ref<ExportHistoryItem[]>([]);
const historyPage = ref(1);
const historyTotal = ref(0);

function loadTableColumnWidthMemory(): void {
  if (tableColumnWidthMemoryLoaded) return;
  tableColumnWidthMemoryLoaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(TABLE_COLUMN_WIDTH_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as TableColumnWidthMemory;
    if (parsed && typeof parsed === "object") {
      tableColumnWidthMemory.value = parsed;
    }
  } catch {
    tableColumnWidthMemory.value = {};
  }
}

function saveTableColumnWidthMemory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TABLE_COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(tableColumnWidthMemory.value));
  } catch {
    // localStorage 不可用时忽略持久化失败
  }
}

function getTableColumnWidth(tableKey: string, colIndex: number): number | null {
  const tableMemory = tableColumnWidthMemory.value[tableKey];
  if (!tableMemory) return null;
  const width = Number(tableMemory[String(colIndex)]);
  return Number.isFinite(width) ? width : null;
}

function setTableColumnWidth(tableKey: string, colIndex: number, width: number): void {
  tableColumnWidthMemory.value = {
    ...tableColumnWidthMemory.value,
    [tableKey]: {
      ...(tableColumnWidthMemory.value[tableKey] || {}),
      [String(colIndex)]: Math.max(TABLE_COLUMN_MIN_WIDTH, Math.round(width))
    }
  };
}

type TableLeafHeader = {
  colIndex: number;
  cell: HTMLTableCellElement;
  defaultWidth: number;
};

function collectTableLeafHeaders(tableEl: HTMLTableElement): TableLeafHeader[] {
  const thead = tableEl.tHead;
  if (!thead) return [];
  const rows = Array.from(thead.rows);
  if (rows.length === 0) return [];
  const matrix: Array<Array<HTMLTableCellElement | undefined>> = rows.map(() => []);

  rows.forEach((row, rowIndex) => {
    let col = 0;
    for (const cell of Array.from(row.cells)) {
      while (matrix[rowIndex][col]) col += 1;
      const colSpan = Math.max(1, cell.colSpan || 1);
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      const rowEnd = Math.min(rows.length, rowIndex + rowSpan);
      for (let r = rowIndex; r < rowEnd; r += 1) {
        for (let c = col; c < col + colSpan; c += 1) {
          matrix[r][c] = cell as HTMLTableCellElement;
        }
      }
      col += colSpan;
    }
  });

  const lastRow = matrix[rows.length - 1] || [];
  const leaves: TableLeafHeader[] = [];
  for (let colIndex = 0; colIndex < lastRow.length; colIndex += 1) {
    const cell = lastRow[colIndex];
    if (!cell) continue;
    if (colIndex > 0 && lastRow[colIndex - 1] === cell) continue;
    if ((cell.colSpan || 1) !== 1) continue;
    const measuredWidth = Math.round(cell.getBoundingClientRect().width || cell.offsetWidth || 96);
    leaves.push({
      colIndex,
      cell,
      defaultWidth: Math.max(TABLE_COLUMN_MIN_WIDTH, measuredWidth)
    });
  }
  return leaves;
}

function ensureResizableColgroup(tableEl: HTMLTableElement, colCount: number): HTMLTableColElement[] {
  let colgroup = tableEl.querySelector(":scope > colgroup[data-resizable='true']") as HTMLTableColElement | null;
  if (!colgroup) {
    colgroup = document.createElement("colgroup") as HTMLTableColElement;
    colgroup.setAttribute("data-resizable", "true");
    tableEl.insertBefore(colgroup, tableEl.firstChild);
  }
  while (colgroup.children.length < colCount) {
    colgroup.appendChild(document.createElement("col"));
  }
  while (colgroup.children.length > colCount) {
    colgroup.removeChild(colgroup.lastChild as ChildNode);
  }
  return Array.from(colgroup.children) as HTMLTableColElement[];
}

function setupResizableTable(tableEl: HTMLTableElement, tableKey: string): void {
  loadTableColumnWidthMemory();

  const oldCleanup = tableResizeCleanupMap.get(tableEl);
  if (oldCleanup) oldCleanup();

  const leaves = collectTableLeafHeaders(tableEl);
  if (leaves.length === 0) return;

  const totalColumns = leaves.reduce((max, item) => Math.max(max, item.colIndex + 1), 0);
  const cols = ensureResizableColgroup(tableEl, totalColumns);
  tableEl.classList.add("table-resizable-enabled");
  tableEl.querySelectorAll(".table-col-resize").forEach((node) => node.remove());
  tableEl.querySelectorAll("th.table-resizable-th").forEach((th) => th.classList.remove("table-resizable-th"));

  const defaultWidthMap = new Map<number, number>();
  for (const leaf of leaves) {
    defaultWidthMap.set(leaf.colIndex, leaf.defaultWidth);
    const width = getTableColumnWidth(tableKey, leaf.colIndex) ?? leaf.defaultWidth;
    const safeWidth = Math.max(TABLE_COLUMN_MIN_WIDTH, Math.round(width));
    if (cols[leaf.colIndex]) {
      cols[leaf.colIndex].style.width = `${safeWidth}px`;
    }
    leaf.cell.classList.add("table-resizable-th");
    const handle = document.createElement("span");
    handle.className = "table-col-resize";
    handle.dataset.colIndex = String(leaf.colIndex);
    handle.style.position = "absolute";
    handle.style.top = "0";
    handle.style.right = "-4px";
    handle.style.width = "8px";
    handle.style.height = "100%";
    handle.style.cursor = "col-resize";
    handle.style.userSelect = "none";
    handle.style.zIndex = "2";
    handle.style.background = "linear-gradient(to right, transparent 3px, #dbe3ef 3px, #dbe3ef 4px, transparent 4px)";
    handle.style.opacity = "0.7";
    handle.addEventListener("mouseenter", () => {
      handle.style.opacity = "1";
      handle.style.background = "linear-gradient(to right, transparent 3px, #94a3b8 3px, #94a3b8 4px, transparent 4px)";
    });
    handle.addEventListener("mouseleave", () => {
      handle.style.opacity = "0.7";
      handle.style.background = "linear-gradient(to right, transparent 3px, #dbe3ef 3px, #dbe3ef 4px, transparent 4px)";
    });
    leaf.cell.appendChild(handle);
  }

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const handle = target?.closest(".table-col-resize") as HTMLElement | null;
    if (!handle || !tableEl.contains(handle)) return;
    const colIndex = Number(handle.dataset.colIndex);
    if (!Number.isFinite(colIndex) || !cols[colIndex]) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = Number.parseFloat(cols[colIndex].style.width) || defaultWidthMap.get(colIndex) || 96;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(TABLE_COLUMN_MIN_WIDTH, Math.round(startWidth + moveEvent.clientX - startX));
      cols[colIndex].style.width = `${nextWidth}px`;
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      const finalWidth = Number.parseFloat(cols[colIndex].style.width);
      if (Number.isFinite(finalWidth)) {
        setTableColumnWidth(tableKey, colIndex, finalWidth);
        saveTableColumnWidthMemory();
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  tableEl.addEventListener("mousedown", onMouseDown);
  const cleanup = () => {
    tableEl.removeEventListener("mousedown", onMouseDown);
    tableEl.querySelectorAll(".table-col-resize").forEach((node) => node.remove());
    tableEl.querySelectorAll("th.table-resizable-th").forEach((th) => th.classList.remove("table-resizable-th"));
  };
  tableResizeCleanupMap.set(tableEl, cleanup);
}

function scheduleSetupResizableTable(tableEl: HTMLTableElement, tableKey: string): void {
  nextTick(() => {
    setupResizableTable(tableEl, tableKey);
  });
}

const vResizableTable: Directive<HTMLTableElement, string> = {
  mounted(el, binding) {
    scheduleSetupResizableTable(el, binding.value || "default-table");
  },
  updated(el, binding) {
    scheduleSetupResizableTable(el, binding.value || "default-table");
  },
  beforeUnmount(el) {
    const cleanup = tableResizeCleanupMap.get(el);
    if (cleanup) {
      cleanup();
      tableResizeCleanupMap.delete(el);
    }
  }
};

const apiDocGroups = [
  {
    title: "基础",
    endpoints: ["GET /api/v1/health"]
  },
  {
    title: "认证",
    endpoints: [
      "POST /api/v1/auth/register",
      "POST /api/v1/auth/login",
      "GET /api/v1/auth/me",
      "POST /api/v1/auth/logout",
      "GET /api/v1/auth/users (admin)",
      "PATCH /api/v1/auth/users/:userId/status (admin)",
      "GET /api/v1/auth/invite-codes (admin)",
      "POST /api/v1/auth/invite-codes/generate (admin)"
    ]
  },
  {
    title: "模板",
    endpoints: [
      "GET /api/v1/templates",
      "GET /api/v1/templates/:templateId",
      "POST /api/v1/templates/import-json (admin)",
      "POST /api/v1/templates/import-excel (admin)"
    ]
  },
  {
    title: "规则",
    endpoints: [
      "GET /api/v1/rule-sets/active",
      "GET /api/v1/rule-sets/meta",
      "POST /api/v1/rule-sets/import-json (admin)"
    ]
  },
  {
    title: "估算",
    endpoints: [
      "POST /api/v1/estimates/calculate",
      "POST /api/v1/estimates/calculate-and-export",
      "POST /api/v1/estimates/export/excel",
      "POST /api/v1/estimates/export/pdf"
    ]
  },
  {
    title: "会话",
    endpoints: ["POST /api/v1/sessions/start", "POST /api/v1/sessions/:sessionId/calculate"]
  },
  {
    title: "导出与下载",
    endpoints: ["GET /api/v1/exports/history", "GET /downloads/:fileName"]
  }
];

const form = ref({
  templateId: "",
  ruleSetId: "",
  userCount: 120,
  difficultyFactor: 0.2,
  orgCount: 3,
  orgSimilarityFactor: 0.6
});
const dashboardBasicInfo = ref<DashboardBasicInfo>({
  customerName: "",
  projectName: "",
  opportunityNo: "",
  customerIndustry: "",
  enterpriseRevenue: "",
  itStatus: "",
  expectedGoLive: "",
  enterpriseProfile: "",
  projectBackgroundNeeds: "",
  projectGoals: ""
});
const requirementRowSeed = ref(1);
function nextRequirementRowId(prefix: string): string {
  return `${prefix}-${requirementRowSeed.value++}`;
}
const requirementValuePropositionRows = ref<RequirementValuePropositionRow[]>([
  {
    rowId: nextRequirementRowId("vp"),
    summary: "",
    refinedContent: "",
    originalDemand: "",
    interviewOutline: ""
  }
]);
const requirementBusinessNeedRows = ref<RequirementBusinessNeedRow[]>([
  {
    rowId: nextRequirementRowId("bn"),
    businessDomain: "",
    category: "",
    businessNeed: "",
    proposer: "",
    title: "",
    preSalesIncluded: "",
    standardImplemented: "",
    solutionSuggestion: "",
    requiresCustomDev: ""
  }
]);
const requirementDevOverviewRows = ref<RequirementDevOverviewRow[]>([
  {
    rowId: nextRequirementRowId("do"),
    businessDomain: "",
    moduleName: "",
    moduleBrief: "",
    functionDesc: "",
    solutionSuggestion: "",
    codingDays: 0,
    estimateBasis: ""
  }
]);
const requirementProductModuleRows = ref<RequirementProductModuleRow[]>([
  {
    rowId: nextRequirementRowId("pm"),
    productDomain: "",
    moduleName: "",
    subModule: "",
    userCount: "",
    implementationOrgCount: "",
    pilotOrgCount: "",
    partyBLead: "",
    partyALead: ""
  }
]);
const requirementImplementationScopeRows = ref<RequirementImplementationScopeRow[]>([
  {
    rowId: nextRequirementRowId("is"),
    companyName: "",
    companyType: "",
    moduleScope: "",
    location: "",
    implementationMode: "",
    note: ""
  }
]);
const requirementMeetingNotes = ref("");
const requirementKeyPointRows = ref<RequirementKeyPointRow[]>([
  {
    rowId: nextRequirementRowId("kp"),
    analysisCategory: "需求分析",
    subItem: "",
    detail: "",
    note: ""
  }
]);
const requirementSectionExpanded = ref<Record<string, boolean>>({
  valueProposition: true,
  businessNeeds: true,
  devOverview: true,
  productModule: true,
  implementationScope: true,
  meetingNotes: true,
  keyPoints: true
});

function isRequirementSectionExpanded(sectionId: string): boolean {
  return requirementSectionExpanded.value[sectionId] !== false;
}

function toggleRequirementSection(sectionId: string): void {
  requirementSectionExpanded.value = {
    ...requirementSectionExpanded.value,
    [sectionId]: !isRequirementSectionExpanded(sectionId)
  };
}
const requirementBasicInfoExpanded = ref(true);
const basicInfoImportVisible = ref(false);
const basicInfoImporting = ref(false);
const enterpriseProfileGenerating = ref(false);
const enterpriseProfilePreviewVisible = ref(false);
const enterpriseProfileGeneratedText = ref("");
const enterpriseProfileGeneratedFields = ref({
  customerIndustry: "",
  enterpriseRevenue: "",
  itStatus: ""
});
type KimiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};
const kimiChatVisible = ref(false);
const kimiChatSending = ref(false);
const kimiChatInput = ref("");
const kimiChatMessages = ref<KimiChatMessage[]>([
  {
    id: "kimi-welcome",
    role: "assistant",
    content: "你好，我是 KIMI 助手。可以直接问我评估口径、字段填写、方案梳理等问题。"
  }
]);
const kimiChatBodyRef = ref<HTMLElement | null>(null);
const KIMI_FAB_SIZE_PX = 36;
const KIMI_FLOAT_MARGIN_PX = 12;
const kimiFloatPos = ref({ x: KIMI_FLOAT_MARGIN_PX, y: 420 });
const kimiFabDragging = ref(false);
const kimiFabSuppressClick = ref(false);
let kimiDragStartPointer = { x: 0, y: 0 };
let kimiDragStartPos = { x: 0, y: 0 };
let kimiDragMoved = false;
const kimiFloatStyle = computed(() => ({
  left: `${kimiFloatPos.value.x}px`,
  top: `${kimiFloatPos.value.y}px`
}));
const basicInfoImportFile = ref<File | null>(null);
const basicInfoModelName = ref("moonshot-v1-8k");
const basicInfoImportError = ref("");
const AUTH_TOKEN_STORAGE_KEY = "workload-auth-token-v1";
const authBootstrapping = ref(true);
const authSubmitting = ref(false);
const authToken = ref("");
const authUser = ref<FrontAuthUser | null>(null);
const authError = ref("");
const authRegisterMode = ref(false);
const authForm = ref({
  username: "",
  password: "",
  inviteCode: ""
});
const userMgmtLoading = ref(false);
const userMgmtSubmittingUserId = ref("");
const userMgmtError = ref("");
const userMgmtUsers = ref<FrontAuthUser[]>([]);
const inviteCodeLoading = ref(false);
const inviteCodeGenerating = ref(false);
const inviteCodeError = ref("");
const inviteCodes = ref<InviteCodeRecord[]>([]);
const inviteCodeKeyword = ref("");
const inviteCodeStatusFilter = ref<"all" | "active" | "used">("active");

const result = ref<CalculateResult | null>(null);
const exportInfo = ref<ExportResult | null>(null);
const filteredInviteCodes = computed(() => {
  const keyword = inviteCodeKeyword.value.trim().toLowerCase();
  const status = inviteCodeStatusFilter.value;
  const sorted = [...inviteCodes.value].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "active" ? -1 : 1;
    }
    return Number(new Date(b.createdAt)) - Number(new Date(a.createdAt));
  });
  return sorted.filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    if (!keyword) return true;
    const usedBy = (item.usedByUsername || "").toLowerCase();
    return item.code.toLowerCase().includes(keyword) || usedBy.includes(keyword);
  });
});

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function toggleDashboardAnalysis(): void {
  dashboardAnalysisExpanded.value = !dashboardAnalysisExpanded.value;
}

function openBasicInfoImportDialog(): void {
  basicInfoImportVisible.value = true;
  basicInfoImportError.value = "";
}

function expandRequirementBasicInfo(): void {
  requirementBasicInfoExpanded.value = true;
}

function collapseRequirementBasicInfo(): void {
  requirementBasicInfoExpanded.value = false;
}

function closeBasicInfoImportDialog(): void {
  if (basicInfoImporting.value) return;
  basicInfoImportVisible.value = false;
  basicInfoImportError.value = "";
}

function readAuthTokenFromStorage(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
}

function persistAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
}

function resetAuthState(message = ""): void {
  authToken.value = "";
  authUser.value = null;
  persistAuthToken("");
  if (message) {
    authError.value = message;
  }
}

function authHeaderWithToken(headers?: HeadersInit): Headers {
  const merged = new Headers(headers || {});
  if (authToken.value) {
    merged.set("Authorization", `Bearer ${authToken.value}`);
  }
  return merged;
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    headers: authHeaderWithToken(init.headers)
  });
  const targetUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const isAuthRoute = targetUrl.includes("/api/v1/auth/");
  if (response.status === 401 && !isAuthRoute) {
    resetAuthState("登录已过期，请重新登录");
  }
  return response;
}

type BackendVersionType = "assessment" | "resource" | "requirementImport" | "dev" | "global";
type BackendVersionStatus = "draft" | "reviewed" | "published" | "archived";
type BackendVersionRecord = {
  id: string;
  type: BackendVersionType;
  versionCode: string;
  templateId: string;
  status: BackendVersionStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
};

function currentVersionTemplateId(): string {
  return form.value.templateId || "default";
}

async function createVersionRecordOnServer(
  type: BackendVersionType,
  versionCode: string,
  payload: Record<string, unknown>,
  status: BackendVersionStatus = "draft"
): Promise<void> {
  if (!authUser.value || !versionCode) return;
  const response = await apiFetch("/api/v1/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type,
      versionCode,
      templateId: currentVersionTemplateId(),
      status,
      payload
    })
  });
  const result = (await response.json()) as ApiResponse<{ record: BackendVersionRecord }>;
  if (!response.ok || result.code !== 0) {
    throw new Error(result.message || "版本保存到后端失败");
  }
}

async function deleteVersionRecordOnServer(type: BackendVersionType, versionCode: string): Promise<void> {
  if (!authUser.value || !versionCode) return;
  const query = new URLSearchParams({ templateId: currentVersionTemplateId() });
  const response = await apiFetch(`/api/v1/versions/${type}/${encodeURIComponent(versionCode)}?${query.toString()}`, {
    method: "DELETE"
  });
  const result = (await response.json()) as ApiResponse<{ deleted: boolean }>;
  if (!response.ok && result.code === 40404) {
    return;
  }
  if (!response.ok || result.code !== 0) {
    throw new Error(result.message || "版本删除失败");
  }
}

async function bootstrapAuth(): Promise<void> {
  authBootstrapping.value = true;
  const token = readAuthTokenFromStorage();
  if (!token) {
    authBootstrapping.value = false;
    return;
  }
  authToken.value = token;
  try {
    const response = await apiFetch("/api/v1/auth/me");
    const payload = (await response.json()) as ApiResponse<{ user: FrontAuthUser }>;
    if (!response.ok || payload.code !== 0 || !payload.data?.user) {
      resetAuthState("");
      return;
    }
    authUser.value = payload.data.user;
    await loadInitialAssessmentData();
  } catch {
    resetAuthState("");
  } finally {
    authBootstrapping.value = false;
  }
}

async function onSubmitAuth(): Promise<void> {
  authError.value = "";
  const username = authForm.value.username.trim();
  const password = authForm.value.password;
  const inviteCode = authForm.value.inviteCode.trim();
  if (!username || !password) {
    authError.value = "请输入用户名和密码";
    return;
  }
  if (authRegisterMode.value && !inviteCode) {
    authError.value = "注册时请输入推荐码";
    return;
  }
  authSubmitting.value = true;
  try {
    const endpoint = authRegisterMode.value ? "/api/v1/auth/register" : "/api/v1/auth/login";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authRegisterMode.value ? { username, password, inviteCode } : { username, password })
    });
    const payload = (await response.json()) as ApiResponse<{ token: string; user: FrontAuthUser }>;
    if (!response.ok || payload.code !== 0 || !payload.data?.token || !payload.data?.user) {
      throw new Error(payload.message || (authRegisterMode.value ? "注册失败" : "登录失败"));
    }
    authToken.value = payload.data.token;
    authUser.value = payload.data.user;
    persistAuthToken(payload.data.token);
    authForm.value.password = "";
    authForm.value.inviteCode = "";
    authRegisterMode.value = false;
    await loadInitialAssessmentData();
  } catch (err) {
    authError.value = err instanceof Error ? err.message : "登录失败";
  } finally {
    authSubmitting.value = false;
  }
}

function onLogout(): void {
  modeDrafts.value = {};
  resourceDrafts.value = {};
  globalPlanDrafts.value = {};
  devAssessmentDrafts.value = {};
  currentResourceVersionCode.value = "";
  currentDevAssessmentVersionCode.value = "";
  currentRequirementImportVersionCode.value = "";
  selectedResourceVersionCode.value = "";
  selectedGlobalPlanVersionCode.value = "";
  selectedMyEvaluationVersionCode.value = "";
  plannedGlobalPlanVersionCode.value = "";
  planGuideProjectName.value = "";
  planGuideCreatedAt.value = null;
  createPlanGuideVisible.value = false;
  selectedGlobalAssessmentVersionCode.value = "";
  selectedGlobalResourceVersionCode.value = "";
  selectedGlobalRequirementImportVersionCode.value = "";
  userMgmtUsers.value = [];
  userMgmtError.value = "";
  inviteCodes.value = [];
  inviteCodeError.value = "";
  resetAuthState("已退出登录");
}

async function loadUserManagementUsers(): Promise<void> {
  if (!authUser.value || authUser.value.role !== "admin") {
    userMgmtUsers.value = [];
    userMgmtError.value = "仅管理员可查看用户列表";
    return;
  }
  userMgmtLoading.value = true;
  userMgmtError.value = "";
  try {
    const response = await apiFetch("/api/v1/auth/users");
    const payload = (await response.json()) as ApiResponse<{ users: FrontAuthUser[] }>;
    if (!response.ok || payload.code !== 0 || !Array.isArray(payload.data?.users)) {
      throw new Error(payload.message || "读取用户列表失败");
    }
    userMgmtUsers.value = payload.data.users;
  } catch (err) {
    userMgmtError.value = err instanceof Error ? err.message : "读取用户列表失败";
  } finally {
    userMgmtLoading.value = false;
  }
}

async function loadInviteCodes(): Promise<void> {
  if (!authUser.value || authUser.value.role !== "admin") {
    inviteCodes.value = [];
    inviteCodeError.value = "仅管理员可查看推荐码";
    return;
  }
  inviteCodeLoading.value = true;
  inviteCodeError.value = "";
  try {
    const response = await apiFetch("/api/v1/auth/invite-codes");
    const payload = (await response.json()) as ApiResponse<{ codes: InviteCodeRecord[] }>;
    if (!response.ok || payload.code !== 0 || !Array.isArray(payload.data?.codes)) {
      throw new Error(payload.message || "读取推荐码失败");
    }
    inviteCodes.value = payload.data.codes;
  } catch (err) {
    inviteCodeError.value = err instanceof Error ? err.message : "读取推荐码失败";
  } finally {
    inviteCodeLoading.value = false;
  }
}

async function onGenerateInviteCode(): Promise<void> {
  if (!authUser.value || authUser.value.role !== "admin") return;
  inviteCodeGenerating.value = true;
  inviteCodeError.value = "";
  try {
    const response = await apiFetch("/api/v1/auth/invite-codes/generate", {
      method: "POST"
    });
    const payload = (await response.json()) as ApiResponse<{ code: InviteCodeRecord }>;
    if (!response.ok || payload.code !== 0 || !payload.data?.code) {
      throw new Error(payload.message || "生成推荐码失败");
    }
    inviteCodes.value = [payload.data.code, ...inviteCodes.value];
    showTimedNotice(`推荐码已生成：${payload.data.code.code}`);
  } catch (err) {
    inviteCodeError.value = err instanceof Error ? err.message : "生成推荐码失败";
  } finally {
    inviteCodeGenerating.value = false;
  }
}

async function onCopyInviteCode(code: string): Promise<void> {
  if (!code) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    showTimedNotice("推荐码已复制");
  } catch {
    inviteCodeError.value = "复制失败，请手动复制";
  }
}

async function onToggleUserStatus(target: FrontAuthUser): Promise<void> {
  if (!authUser.value || authUser.value.role !== "admin") return;
  const nextStatus: UserMgmtStatus = target.status === "active" ? "disabled" : "active";
  userMgmtSubmittingUserId.value = target.id;
  userMgmtError.value = "";
  try {
    const response = await apiFetch(`/api/v1/auth/users/${target.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus })
    });
    const payload = (await response.json()) as ApiResponse<{ user: FrontAuthUser }>;
    if (!response.ok || payload.code !== 0 || !payload.data?.user) {
      throw new Error(payload.message || "更新用户状态失败");
    }
    userMgmtUsers.value = userMgmtUsers.value.map((user) => (user.id === payload.data.user.id ? payload.data.user : user));
    showTimedNotice(nextStatus === "active" ? "用户已启用" : "用户已禁用");
  } catch (err) {
    userMgmtError.value = err instanceof Error ? err.message : "更新用户状态失败";
  } finally {
    userMgmtSubmittingUserId.value = "";
  }
}

function onBasicInfoImportFileChange(event: Event): void {
  const target = event.target as HTMLInputElement | null;
  basicInfoImportFile.value = target?.files?.[0] || null;
}

function patchDashboardBasicInfo(
  patch: Partial<DashboardBasicInfo>
): void {
  dashboardBasicInfo.value = {
    ...dashboardBasicInfo.value,
    ...Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
    )
  };
}

function addRequirementValuePropositionRow(): void {
  requirementValuePropositionRows.value = [
    ...requirementValuePropositionRows.value,
    {
      rowId: nextRequirementRowId("vp"),
      summary: "",
      refinedContent: "",
      originalDemand: "",
      interviewOutline: ""
    }
  ];
}

function removeRequirementValuePropositionRow(): void {
  if (requirementValuePropositionRows.value.length <= 1) return;
  requirementValuePropositionRows.value = requirementValuePropositionRows.value.slice(0, -1);
}

function addRequirementBusinessNeedRow(): void {
  requirementBusinessNeedRows.value = [
    ...requirementBusinessNeedRows.value,
    {
      rowId: nextRequirementRowId("bn"),
      businessDomain: "",
      category: "",
      businessNeed: "",
      proposer: "",
      title: "",
      preSalesIncluded: "",
      standardImplemented: "",
      solutionSuggestion: "",
      requiresCustomDev: ""
    }
  ];
}

function removeRequirementBusinessNeedRow(): void {
  if (requirementBusinessNeedRows.value.length <= 1) return;
  requirementBusinessNeedRows.value = requirementBusinessNeedRows.value.slice(0, -1);
}

function addRequirementDevOverviewRow(): void {
  requirementDevOverviewRows.value = [
    ...requirementDevOverviewRows.value,
    {
      rowId: nextRequirementRowId("do"),
      businessDomain: "",
      moduleName: "",
      moduleBrief: "",
      functionDesc: "",
      solutionSuggestion: "",
      codingDays: 0,
      estimateBasis: ""
    }
  ];
}

function removeRequirementDevOverviewRow(): void {
  if (requirementDevOverviewRows.value.length <= 1) return;
  requirementDevOverviewRows.value = requirementDevOverviewRows.value.slice(0, -1);
}

function requirementDevAnalysisDays(row: RequirementDevOverviewRow): number {
  return round1(toNumber(row.codingDays) * 0.2);
}

function requirementDevTestingDays(row: RequirementDevOverviewRow): number {
  return round1(toNumber(row.codingDays) * 0.4);
}

function requirementDevTotalDays(row: RequirementDevOverviewRow): number {
  return round1(toNumber(row.codingDays) + requirementDevAnalysisDays(row) + requirementDevTestingDays(row));
}

const requirementDevOverviewSummary = computed(() => {
  const codingDays = round1(requirementDevOverviewRows.value.reduce((sum, row) => sum + toNumber(row.codingDays), 0));
  const analysisDays = round1(codingDays * 0.2);
  const testingDays = round1(codingDays * 0.4);
  const totalDays = round1(codingDays + analysisDays + testingDays);
  return { codingDays, analysisDays, testingDays, totalDays };
});

function addRequirementProductModuleRow(): void {
  requirementProductModuleRows.value = [
    ...requirementProductModuleRows.value,
    {
      rowId: nextRequirementRowId("pm"),
      productDomain: "",
      moduleName: "",
      subModule: "",
      userCount: "",
      implementationOrgCount: "",
      pilotOrgCount: "",
      partyBLead: "",
      partyALead: ""
    }
  ];
}

function removeRequirementProductModuleRow(): void {
  if (requirementProductModuleRows.value.length <= 1) return;
  requirementProductModuleRows.value = requirementProductModuleRows.value.slice(0, -1);
}

function addRequirementImplementationScopeRow(): void {
  requirementImplementationScopeRows.value = [
    ...requirementImplementationScopeRows.value,
    {
      rowId: nextRequirementRowId("is"),
      companyName: "",
      companyType: "",
      moduleScope: "",
      location: "",
      implementationMode: "",
      note: ""
    }
  ];
}

function removeRequirementImplementationScopeRow(): void {
  if (requirementImplementationScopeRows.value.length <= 1) return;
  requirementImplementationScopeRows.value = requirementImplementationScopeRows.value.slice(0, -1);
}

function addRequirementKeyPointRow(): void {
  requirementKeyPointRows.value = [
    ...requirementKeyPointRows.value,
    {
      rowId: nextRequirementRowId("kp"),
      analysisCategory: "",
      subItem: "",
      detail: "",
      note: ""
    }
  ];
}

function removeRequirementKeyPointRow(): void {
  if (requirementKeyPointRows.value.length <= 1) return;
  requirementKeyPointRows.value = requirementKeyPointRows.value.slice(0, -1);
}

function snapshotRequirementImportData(): RequirementImportData {
  return {
    valuePropositionRows: requirementValuePropositionRows.value.map((row) => ({ ...row })),
    businessNeedRows: requirementBusinessNeedRows.value.map((row) => ({ ...row })),
    devOverviewRows: requirementDevOverviewRows.value.map((row) => ({ ...row, codingDays: toNumber(row.codingDays) })),
    productModuleRows: requirementProductModuleRows.value.map((row) => ({ ...row })),
    implementationScopeRows: requirementImplementationScopeRows.value.map((row) => ({ ...row })),
    meetingNotes: requirementMeetingNotes.value,
    keyPointRows: requirementKeyPointRows.value.map((row) => ({ ...row }))
  };
}

function applyRequirementImportData(data?: RequirementImportData): void {
  if (!data) return;
  requirementValuePropositionRows.value =
    data.valuePropositionRows?.length
      ? data.valuePropositionRows.map((row) => ({ ...row, rowId: nextRequirementRowId("vp") }))
      : requirementValuePropositionRows.value;
  requirementBusinessNeedRows.value =
    data.businessNeedRows?.length
      ? data.businessNeedRows.map((row) => ({ ...row, rowId: nextRequirementRowId("bn") }))
      : requirementBusinessNeedRows.value;
  requirementDevOverviewRows.value =
    data.devOverviewRows?.length
      ? data.devOverviewRows.map((row) => ({
          ...row,
          rowId: nextRequirementRowId("do"),
          codingDays: toNumber(row.codingDays)
        }))
      : requirementDevOverviewRows.value;
  requirementProductModuleRows.value =
    data.productModuleRows?.length
      ? data.productModuleRows.map((row) => ({ ...row, rowId: nextRequirementRowId("pm") }))
      : requirementProductModuleRows.value;
  requirementImplementationScopeRows.value =
    data.implementationScopeRows?.length
      ? data.implementationScopeRows.map((row) => ({ ...row, rowId: nextRequirementRowId("is") }))
      : requirementImplementationScopeRows.value;
  requirementMeetingNotes.value = data.meetingNotes || "";
  requirementKeyPointRows.value =
    data.keyPointRows?.length
      ? data.keyPointRows.map((row) => ({ ...row, rowId: nextRequirementRowId("kp") }))
      : requirementKeyPointRows.value;
}

async function onImportBasicInfoByExcel(): Promise<void> {
  basicInfoImportError.value = "";
  if (!basicInfoImportFile.value) {
    basicInfoImportError.value = "请先选择 Excel 文件";
    return;
  }
  basicInfoImporting.value = true;
  try {
    const formData = new FormData();
    formData.append("file", basicInfoImportFile.value);

    const response = await apiFetch("/api/v1/ai/parse-basic-info", {
      method: "POST",
      body: formData
    });
    const payload = (await response.json()) as ApiResponse<{
      basicInfo: Partial<typeof dashboardBasicInfo.value>;
      requirementImportData?: RequirementImportData;
      model: string;
      mode?: "model" | "rule_fallback";
      fallbackReason?: string;
      details?: Array<{ field: string; reason: string }>;
    }>;
    if (!response.ok || payload.code !== 0 || !payload.data?.basicInfo) {
      const detailReason = Array.isArray((payload as unknown as { details?: Array<{ reason?: string }> }).details)
        ? (payload as unknown as { details?: Array<{ reason?: string }> }).details?.[0]?.reason || ""
        : "";
      throw new Error(detailReason ? `${payload.message || "解析失败"}：${detailReason}` : payload.message || "解析失败");
    }
    patchDashboardBasicInfo(payload.data.basicInfo);
    if (payload.data.requirementImportData) {
      applyRequirementImportData(payload.data.requirementImportData);
    }
    if (payload.data.model) {
      basicInfoModelName.value = payload.data.model;
    }
    basicInfoImportVisible.value = false;
    basicInfoImportFile.value = null;
    if (payload.data.mode === "rule_fallback") {
      const fallbackHint = payload.data.fallbackReason ? `（${payload.data.fallbackReason}）` : "";
      showTimedNotice(`Excel 已按规则回填${fallbackHint}`);
    } else {
      showTimedNotice("Excel 解析完成，已回填需求导入全部内容");
    }
  } catch (err) {
    basicInfoImportError.value = err instanceof Error ? err.message : "解析失败";
  } finally {
    basicInfoImporting.value = false;
  }
}

async function onGenerateEnterpriseProfileByKimi(): Promise<void> {
  const customerName = (dashboardBasicInfo.value.customerName || "").trim();
  if (!customerName) {
    showTimedNotice("请先填写客户名称");
    return;
  }
  enterpriseProfileGenerating.value = true;
  try {
    const response = await apiFetch("/api/v1/ai/company-profile-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName,
        customerIndustry: dashboardBasicInfo.value.customerIndustry || "",
        enterpriseRevenue: dashboardBasicInfo.value.enterpriseRevenue || "",
        itStatus: dashboardBasicInfo.value.itStatus || ""
      })
    });
    const payload = (await response.json()) as ApiResponse<{
      customerName: string;
      enterpriseProfile: string;
      customerIndustry: string;
      enterpriseRevenue: string;
      itStatus: string;
      model: string;
      mode?: "model" | "rule_fallback";
      fallbackReason?: string;
    }>;
    if (!response.ok || payload.code !== 0 || !payload.data?.enterpriseProfile) {
      throw new Error(payload.message || "企业简介生成失败");
    }
    enterpriseProfileGeneratedText.value = payload.data.enterpriseProfile;
    enterpriseProfileGeneratedFields.value = {
      customerIndustry: payload.data.customerIndustry || "",
      enterpriseRevenue: payload.data.enterpriseRevenue || "",
      itStatus: payload.data.itStatus || ""
    };
    enterpriseProfilePreviewVisible.value = true;
    if (payload.data.model) {
      basicInfoModelName.value = payload.data.model;
    }
    if (payload.data.mode === "rule_fallback") {
      const fallbackHint = payload.data.fallbackReason ? `（${payload.data.fallbackReason}）` : "";
      showTimedNotice(`企业简介已按规则生成${fallbackHint}，请确认是否插入`);
    } else {
      showTimedNotice("企业简介已生成，请确认是否插入");
    }
  } catch (err) {
    showTimedNotice(err instanceof Error ? err.message : "企业简介生成失败");
  } finally {
    enterpriseProfileGenerating.value = false;
  }
}

function closeEnterpriseProfilePreview(): void {
  enterpriseProfilePreviewVisible.value = false;
}

function applyGeneratedEnterpriseProfile(): void {
  const generatedIndustry = (enterpriseProfileGeneratedFields.value.customerIndustry || "").trim();
  const generatedRevenue = (enterpriseProfileGeneratedFields.value.enterpriseRevenue || "").trim();
  const generatedItStatus = (enterpriseProfileGeneratedFields.value.itStatus || "").trim();
  if (!generatedIndustry || !generatedRevenue || !generatedItStatus) {
    showTimedNotice("生成内容缺少客户行业/企业应收/信息化现状，暂不可插入");
    return;
  }
  dashboardBasicInfo.value = {
    ...dashboardBasicInfo.value,
    enterpriseProfile: enterpriseProfileGeneratedText.value,
    customerIndustry: generatedIndustry,
    enterpriseRevenue: generatedRevenue,
    itStatus: generatedItStatus
  };
  enterpriseProfilePreviewVisible.value = false;
  showTimedNotice("已插入企业简介并同步回填客户行业/企业应收/信息化现状");
}

function toggleKimiChatPanel(): void {
  if (kimiFabSuppressClick.value) {
    kimiFabSuppressClick.value = false;
    return;
  }
  kimiChatVisible.value = !kimiChatVisible.value;
  if (kimiChatVisible.value) {
    nextTick(() => {
      if (kimiChatBodyRef.value) {
        kimiChatBodyRef.value.scrollTop = kimiChatBodyRef.value.scrollHeight;
      }
    });
  }
}

function clampKimiFloatPos(x: number, y: number): { x: number; y: number } {
  if (typeof window === "undefined") return { x, y };
  const maxX = Math.max(KIMI_FLOAT_MARGIN_PX, window.innerWidth - KIMI_FAB_SIZE_PX - KIMI_FLOAT_MARGIN_PX);
  const maxY = Math.max(KIMI_FLOAT_MARGIN_PX, window.innerHeight - KIMI_FAB_SIZE_PX - KIMI_FLOAT_MARGIN_PX);
  return {
    x: Math.min(maxX, Math.max(KIMI_FLOAT_MARGIN_PX, Math.round(x))),
    y: Math.min(maxY, Math.max(KIMI_FLOAT_MARGIN_PX, Math.round(y)))
  };
}

function refreshKimiFloatPos(): void {
  if (typeof window === "undefined") return;
  // 首次放置在左下角，后续仅做边界约束
  if (kimiFloatPos.value.y === 420) {
    kimiFloatPos.value = clampKimiFloatPos(
      KIMI_FLOAT_MARGIN_PX,
      window.innerHeight - KIMI_FAB_SIZE_PX - KIMI_FLOAT_MARGIN_PX
    );
    return;
  }
  kimiFloatPos.value = clampKimiFloatPos(kimiFloatPos.value.x, kimiFloatPos.value.y);
}

function onKimiFabMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  kimiFabDragging.value = true;
  kimiFabSuppressClick.value = false;
  kimiDragMoved = false;
  kimiDragStartPointer = { x: event.clientX, y: event.clientY };
  kimiDragStartPos = { ...kimiFloatPos.value };

  const onMouseMove = (moveEvent: MouseEvent) => {
    const dx = moveEvent.clientX - kimiDragStartPointer.x;
    const dy = moveEvent.clientY - kimiDragStartPointer.y;
    if (!kimiDragMoved && Math.abs(dx) + Math.abs(dy) >= 4) {
      kimiDragMoved = true;
    }
    const next = clampKimiFloatPos(kimiDragStartPos.x + dx, kimiDragStartPos.y + dy);
    kimiFloatPos.value = next;
  };

  const onMouseUp = () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    kimiFabDragging.value = false;
    // 仅当发生了实际拖拽，才屏蔽紧随其后的那一次 click
    kimiFabSuppressClick.value = kimiDragMoved;
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

function asTableLongTextarea(target: EventTarget | null): HTMLTextAreaElement | null {
  if (!(target instanceof HTMLTextAreaElement)) return null;
  if (!target.classList.contains("resource-input--textarea")) return null;
  if (!target.closest("table")) return null;
  return target;
}

function resetTableLongTextarea(textarea: HTMLTextAreaElement): void {
  textarea.classList.remove("table-textarea-expanded");
  textarea.style.height = `${TABLE_LONG_TEXTAREA_COLLAPSED_HEIGHT_PX}px`;
  textarea.style.overflow = "hidden";
  const cell = textarea.closest("td");
  if (cell) cell.classList.remove("table-textarea-cell-expanded");
}

function expandTableLongTextarea(textarea: HTMLTextAreaElement): void {
  const cell = textarea.closest("td");
  if (cell) cell.classList.add("table-textarea-cell-expanded");
  textarea.classList.add("table-textarea-expanded");
  textarea.style.overflow = "hidden";
  textarea.style.height = "auto";
  const nextHeight = Math.max(TABLE_LONG_TEXTAREA_EXPANDED_MIN_HEIGHT_PX, textarea.scrollHeight + 2);
  textarea.style.height = `${nextHeight}px`;
}

function onTableLongTextareaFocusIn(event: FocusEvent): void {
  const textarea = asTableLongTextarea(event.target);
  if (!textarea) return;
  expandTableLongTextarea(textarea);
}

function onTableLongTextareaInput(event: Event): void {
  const textarea = asTableLongTextarea(event.target);
  if (!textarea) return;
  expandTableLongTextarea(textarea);
}

function onTableLongTextareaFocusOut(event: FocusEvent): void {
  const textarea = asTableLongTextarea(event.target);
  if (!textarea) return;
  resetTableLongTextarea(textarea);
}

function appendKimiChatMessage(role: "user" | "assistant", content: string): void {
  kimiChatMessages.value.push({
    id: `kimi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    content
  });
}

async function sendKimiChatMessage(): Promise<void> {
  const content = kimiChatInput.value.trim();
  if (!content || kimiChatSending.value) return;
  appendKimiChatMessage("user", content);
  kimiChatInput.value = "";
  kimiChatSending.value = true;
  try {
    const response = await apiFetch("/api/v1/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: kimiChatMessages.value.map((item) => ({
          role: item.role,
          content: item.content
        }))
      })
    });
    const payload = (await response.json()) as ApiResponse<{
      answer: string;
      model: string;
    }>;
    if (!response.ok || payload.code !== 0 || !payload.data?.answer) {
      throw new Error(payload.message || "KIMI 暂时不可用");
    }
    appendKimiChatMessage("assistant", payload.data.answer);
    if (payload.data.model) {
      basicInfoModelName.value = payload.data.model;
    }
  } catch (err) {
    appendKimiChatMessage("assistant", err instanceof Error ? `抱歉，${err.message}` : "抱歉，KIMI 暂时不可用。");
  } finally {
    kimiChatSending.value = false;
    nextTick(() => {
      if (kimiChatBodyRef.value) {
        kimiChatBodyRef.value.scrollTop = kimiChatBodyRef.value.scrollHeight;
      }
    });
  }
}

function onMainScroll(event: Event): void {
  if (currentPage.value !== "assessment") return;

  const target = event.target as HTMLElement | null;
  const scrollTop = Math.max(0, Number(target?.scrollTop || 0));
  const direction = scrollTop > lastAssessmentScrollTop.value ? "down" : scrollTop < lastAssessmentScrollTop.value ? "up" : "none";
  const mainTop = target?.getBoundingClientRect().top || 0;

  // 云产品卡片滚动联动：
  // 仅在向下滚动时，当下一个云产品顶部进入一定程度后，再收起上一个云产品。
  // 向上回滚不自动展开。
  if (direction === "down") {
    const clouds = visibleClouds.value;
    for (let index = 0; index < clouds.length - 1; index += 1) {
      const currentName = clouds[index]?.cloudName;
      const nextName = clouds[index + 1]?.cloudName;
      if (!currentName || !nextName) continue;
      if (!isCloudCardExpanded(currentName)) continue;
      const currentCard = cloudCardRefs.value[currentName];
      const nextCard = cloudCardRefs.value[nextName];
      if (!currentCard || !nextCard) continue;
      const currentRect = currentCard.getBoundingClientRect();
      const nextRect = nextCard.getBoundingClientRect();
      const currentBottomVisible = currentRect.bottom > mainTop + 2;
      const nextTopEnteredEnough = nextRect.top <= mainTop + NEXT_CLOUD_COLLAPSE_TRIGGER_OFFSET;
      if (currentBottomVisible && nextTopEnteredEnough) {
        cloudCardExpanded.value = { ...cloudCardExpanded.value, [currentName]: false };
      }
    }
  }

  if (assessmentToolbarExpanded.value) {
    // 用户手动展开后，优先保持展开且不参与滚动透明/自动收起逻辑，避免与下层内容叠影。
    if (assessmentManualExpandOverride.value) {
      assessmentStickyOpacity.value = 1;
      lastAssessmentScrollTop.value = scrollTop;
      return;
    }
    const ratio = Math.min(scrollTop / AUTO_COLLAPSE_SCROLL_THRESHOLD, 1);
    assessmentStickyOpacity.value = 1 - ratio * (1 - MIN_STICKY_OPACITY);
    if (scrollTop >= AUTO_COLLAPSE_SCROLL_THRESHOLD && !assessmentManualExpandOverride.value) {
      assessmentToolbarExpanded.value = false;
      assessmentAutoCollapsed.value = true;
      assessmentStickyOpacity.value = 1;
    }
  }
  lastAssessmentScrollTop.value = scrollTop;
}

function onManualExpandAssessmentToolbar(): void {
  assessmentToolbarExpanded.value = true;
  assessmentAutoCollapsed.value = false;
  assessmentManualExpandOverride.value = true;
  assessmentStickyOpacity.value = 1;
}

function onManualCollapseAssessmentToolbar(): void {
  assessmentToolbarExpanded.value = false;
  assessmentAutoCollapsed.value = false;
  assessmentManualExpandOverride.value = false;
  assessmentStickyOpacity.value = 1;
}

function setCloudCardRef(cloudName: string, el: Element | { $el?: Element | null } | null): void {
  const resolvedEl = el && typeof el === "object" && "$el" in el ? el.$el || null : el;
  cloudCardRefs.value[cloudName] = (resolvedEl as HTMLElement | null) || null;
}

function currentUserStorageScope(): string {
  return authUser.value?.id || "anonymous";
}

function currentDraftStorageKey(): string {
  const templateKey = form.value.templateId || "default";
  return `${MODE_DRAFT_STORAGE_KEY}:${currentUserStorageScope()}:${templateKey}`;
}

function currentResourceDraftStorageKey(): string {
  const templateKey = form.value.templateId || "default";
  return `${RESOURCE_DRAFT_STORAGE_KEY}:${currentUserStorageScope()}:${templateKey}`;
}

function currentGlobalPlanStorageKey(): string {
  const templateKey = form.value.templateId || "default";
  return `${GLOBAL_PLAN_STORAGE_KEY}:${currentUserStorageScope()}:${templateKey}`;
}

function currentDevAssessmentDraftStorageKey(): string {
  const templateKey = form.value.templateId || "default";
  return `${DEV_ASSESSMENT_DRAFT_STORAGE_KEY}:${currentUserStorageScope()}:${templateKey}`;
}

function currentRequirementImportDraftStorageKey(): string {
  const templateKey = form.value.templateId || "default";
  return `${REQUIREMENT_IMPORT_DRAFT_STORAGE_KEY}:${currentUserStorageScope()}:${templateKey}`;
}

function persistModeDrafts(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(currentDraftStorageKey(), JSON.stringify(modeDrafts.value));
  } catch {
    // 忽略本地存储失败，保留内存草稿
  }
}

function persistResourceDrafts(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(currentResourceDraftStorageKey(), JSON.stringify(resourceDrafts.value));
  } catch {
    // 忽略本地存储失败，保留内存草稿
  }
}

function persistGlobalPlanDrafts(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(currentGlobalPlanStorageKey(), JSON.stringify(globalPlanDrafts.value));
  } catch {
    // 忽略本地存储失败，保留内存草稿
  }
}

function persistDevAssessmentDrafts(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(currentDevAssessmentDraftStorageKey(), JSON.stringify(devAssessmentDrafts.value));
  } catch {
    // 忽略本地存储失败，保留内存草稿
  }
}

function persistRequirementImportDrafts(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(currentRequirementImportDraftStorageKey(), JSON.stringify(requirementImportDrafts.value));
  } catch {
    // 忽略本地存储失败，保留内存草稿
  }
}

function loadModeDraftsFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(currentDraftStorageKey());
    if (!raw) {
      modeDrafts.value = {};
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, ModeDraft>;
    modeDrafts.value = parsed || {};
  } catch {
    modeDrafts.value = {};
  }
}

function loadResourceDraftsFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(currentResourceDraftStorageKey());
    if (!raw) {
      resourceDrafts.value = {};
      currentResourceVersionCode.value = "";
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, ResourceDraft>;
    resourceDrafts.value = parsed || {};
    const latest = Object.values(resourceDrafts.value).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];
    currentResourceVersionCode.value = latest?.versionCode || "";
    selectedGlobalResourceVersionCode.value = currentResourceVersionCode.value;
  } catch {
    resourceDrafts.value = {};
    currentResourceVersionCode.value = "";
    selectedGlobalResourceVersionCode.value = "";
  }
}

function loadGlobalPlanDraftsFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(currentGlobalPlanStorageKey());
    if (!raw) {
      globalPlanDrafts.value = {};
      selectedGlobalPlanVersionCode.value = "";
      selectedGlobalRequirementImportVersionCode.value = "";
      selectedMyEvaluationVersionCode.value = "";
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, GlobalPlanDraft>;
    globalPlanDrafts.value = parsed || {};
    const latest = Object.values(globalPlanDrafts.value).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];
    selectedGlobalPlanVersionCode.value = latest?.versionCode || "";
    selectedGlobalRequirementImportVersionCode.value = latest?.requirementImportVersionCode || "";
    selectedMyEvaluationVersionCode.value = selectedGlobalPlanVersionCode.value;
  } catch {
    globalPlanDrafts.value = {};
    selectedGlobalPlanVersionCode.value = "";
    selectedGlobalRequirementImportVersionCode.value = "";
    selectedMyEvaluationVersionCode.value = "";
  }
}

function loadDevAssessmentDraftsFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(currentDevAssessmentDraftStorageKey());
    if (!raw) {
      devAssessmentDrafts.value = {};
      currentDevAssessmentVersionCode.value = "";
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, DevAssessmentDraft>;
    devAssessmentDrafts.value = parsed || {};
    const latest = Object.values(devAssessmentDrafts.value).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];
    currentDevAssessmentVersionCode.value = latest?.versionCode || "";
  } catch {
    devAssessmentDrafts.value = {};
    currentDevAssessmentVersionCode.value = "";
  }
}

function loadRequirementImportDraftsFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(currentRequirementImportDraftStorageKey());
    if (!raw) {
      requirementImportDrafts.value = {};
      currentRequirementImportVersionCode.value = "";
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, RequirementImportDraft>;
    requirementImportDrafts.value = parsed || {};
    const latest = Object.values(requirementImportDrafts.value).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];
    currentRequirementImportVersionCode.value = latest?.versionCode || "";
    selectedGlobalRequirementImportVersionCode.value = currentRequirementImportVersionCode.value;
  } catch {
    requirementImportDrafts.value = {};
    currentRequirementImportVersionCode.value = "";
    selectedGlobalRequirementImportVersionCode.value = "";
  }
}

function pickNewerTimestamp(a?: number, bIso?: string): number {
  const b = bIso ? Number(new Date(bIso)) : 0;
  return Math.max(Number(a || 0), Number.isFinite(b) ? b : 0);
}

async function listVersionRecordsFromServer(type: BackendVersionType): Promise<BackendVersionRecord[]> {
  const query = new URLSearchParams({
    type,
    templateId: currentVersionTemplateId()
  });
  const response = await apiFetch(`/api/v1/versions?${query.toString()}`);
  const result = (await response.json()) as ApiResponse<{ items: BackendVersionRecord[] }>;
  if (!response.ok || result.code !== 0) {
    throw new Error(result.message || "读取后端版本失败");
  }
  return Array.isArray(result.data?.items) ? result.data.items : [];
}

async function hydrateVersionDraftsFromServer(): Promise<void> {
  if (!authUser.value) return;
  try {
    const [resourceRecords, devRecords, requirementRecords, globalRecords] = await Promise.all([
      listVersionRecordsFromServer("resource"),
      listVersionRecordsFromServer("dev"),
      listVersionRecordsFromServer("requirementImport"),
      listVersionRecordsFromServer("global")
    ]);

    for (const record of resourceRecords) {
      const payload = record.payload as unknown as ResourceDraft;
      if (!payload || !record.versionCode) continue;
      const local = resourceDrafts.value[record.versionCode];
      if (local && Number(local.updatedAt || 0) >= Number(new Date(record.updatedAt))) continue;
      resourceDrafts.value[record.versionCode] = {
        ...payload,
        versionCode: record.versionCode,
        updatedAt: pickNewerTimestamp(payload.updatedAt, record.updatedAt)
      };
    }

    for (const record of devRecords) {
      const payload = record.payload as unknown as DevAssessmentDraft;
      if (!payload || !record.versionCode) continue;
      const local = devAssessmentDrafts.value[record.versionCode];
      if (local && Number(local.updatedAt || 0) >= Number(new Date(record.updatedAt))) continue;
      devAssessmentDrafts.value[record.versionCode] = {
        ...payload,
        versionCode: record.versionCode,
        updatedAt: pickNewerTimestamp(payload.updatedAt, record.updatedAt)
      };
    }

    for (const record of requirementRecords) {
      const payload = record.payload as unknown as RequirementImportDraft;
      if (!payload || !record.versionCode) continue;
      const local = requirementImportDrafts.value[record.versionCode];
      if (local && Number(local.updatedAt || 0) >= Number(new Date(record.updatedAt))) continue;
      requirementImportDrafts.value[record.versionCode] = {
        ...payload,
        versionCode: record.versionCode,
        updatedAt: pickNewerTimestamp(payload.updatedAt, record.updatedAt)
      };
    }

    for (const record of globalRecords) {
      const payload = record.payload as unknown as GlobalPlanDraft;
      if (!payload || !record.versionCode) continue;
      const local = globalPlanDrafts.value[record.versionCode];
      if (local && Number(local.updatedAt || 0) >= Number(new Date(record.updatedAt))) continue;
      globalPlanDrafts.value[record.versionCode] = {
        ...payload,
        versionCode: record.versionCode,
        createdAt: payload.createdAt || Number(new Date(record.createdAt)),
        updatedAt: pickNewerTimestamp(payload.updatedAt, record.updatedAt),
        reviewedAt: payload.reviewedAt || (record.reviewedAt ? Number(new Date(record.reviewedAt)) : undefined)
      };
    }

    persistResourceDrafts();
    persistDevAssessmentDrafts();
    persistRequirementImportDrafts();
    persistGlobalPlanDrafts();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "后端版本同步失败";
  }
}

const resourceDraftOptions = computed<ResourceDraftOption[]>(() =>
  Object.values(resourceDrafts.value)
    .map((draft) => ({
      versionCode: draft.versionCode,
      updatedAt: Number(draft.updatedAt || 0),
      selectedEstimateVersionCode: draft.selectedEstimateVersionCode || ""
    }))
    .filter((x) => x.versionCode)
    .sort((a, b) => b.updatedAt - a.updatedAt)
);

const globalPlanOptions = computed<GlobalPlanDraft[]>(() =>
  Object.values(globalPlanDrafts.value)
    .filter((draft) => draft.versionCode)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
);

const requirementImportDraftOptions = computed(() =>
  Object.values(requirementImportDrafts.value)
    .filter((draft) => draft.versionCode)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
);

type MyEvaluationRow = {
  rowNo: number;
  projectName: string;
  versionCode: string;
  assessmentVersionCode: string;
  resourceVersionCode: string;
  requirementImportVersionCode: string;
  devAssessmentVersionCode: string;
  wbsVersionCode: string;
  reviewVersionCode: string;
  createdAtText: string;
  updatedAtText: string;
  reviewedAtText: string;
};

const myEvaluationRows = computed<MyEvaluationRow[]>(() =>
  globalPlanOptions.value.map((draft, idx) => ({
    rowNo: idx + 1,
    projectName: draft.basicInfo?.projectName || "未命名项目",
    versionCode: draft.versionCode,
    assessmentVersionCode: draft.assessmentVersionCode || "—",
    resourceVersionCode: draft.resourceVersionCode || "—",
    requirementImportVersionCode: draft.requirementImportVersionCode || "—",
    devAssessmentVersionCode: draft.devAssessmentVersionCode || "—",
    wbsVersionCode: draft.wbsVersionCode || "待关联",
    reviewVersionCode: draft.reviewVersionCode || "待关联",
    createdAtText: formatDateTime(draft.createdAt || draft.updatedAt) || "—",
    updatedAtText: formatDateTime(draft.updatedAt) || "—",
    reviewedAtText: formatDateTime(draft.reviewedAt) || "—"
  }))
);

const activeGlobalPlanVersionCode = computed(() => {
  return (
    plannedGlobalPlanVersionCode.value ||
    selectedGlobalPlanVersionCode.value ||
    selectedMyEvaluationVersionCode.value ||
    ""
  );
});
const planGuideCreatedAtText = computed(() => {
  return formatDateTime(planGuideCreatedAt.value || Date.now());
});
const previewPlanDraft = computed<GlobalPlanDraft | null>(() => {
  const code = planPreviewVersionCode.value;
  if (!code) return null;
  return globalPlanDrafts.value[code] || null;
});
const previewRelationNodes = computed(() => {
  const plan = previewPlanDraft.value;
  if (!plan) return [] as Array<{ key: string; label: string; value: string }>;
  return [
    { key: "assessment", label: "评估版本号", value: plan.assessmentVersionCode || "" },
    { key: "resource", label: "资源人天版本号", value: plan.resourceVersionCode || "" },
    { key: "requirement", label: "需求导入版本号", value: plan.requirementImportVersionCode || "" },
    { key: "dev", label: "开发版本号", value: plan.devAssessmentVersionCode || "" }
  ].filter((x) => x.value);
});
const previewRequirementDraft = computed<RequirementImportDraft | null>(() => {
  const code = previewPlanDraft.value?.requirementImportVersionCode || "";
  if (!code) return null;
  return requirementImportDrafts.value[code] || null;
});
const previewRequirementTotalRows = computed(() => {
  const data = previewRequirementDraft.value?.requirementImportData;
  if (!data) return 0;
  return (
    (data.valuePropositionRows?.length || 0) +
    (data.businessNeedRows?.length || 0) +
    (data.devOverviewRows?.length || 0) +
    (data.productModuleRows?.length || 0) +
    (data.implementationScopeRows?.length || 0) +
    (data.keyPointRows?.length || 0)
  );
});
const previewAssessmentResolved = computed(() => {
  const code = previewPlanDraft.value?.assessmentVersionCode || "";
  if (!code) return null;
  return findDraftByVersionCode(code);
});
const previewAssessmentSelectedCount = computed(() => {
  const draft = previewAssessmentResolved.value?.draft;
  if (!draft) return 0;
  return Object.values(draft.itemSelection || {}).filter(Boolean).length;
});
const previewResourceDraft = computed<ResourceDraft | null>(() => {
  const code = previewPlanDraft.value?.resourceVersionCode || "";
  if (!code) return null;
  return resourceDrafts.value[code] || null;
});
const previewResourcePlannedDays = computed(() => {
  const rows = previewResourceDraft.value?.rows || [];
  return round1(rows.reduce((sum, row) => sum + toNumber(row.plannedDays), 0));
});
const previewDevDraft = computed<DevAssessmentDraft | null>(() => {
  const code = previewPlanDraft.value?.devAssessmentVersionCode || "";
  if (!code) return null;
  return devAssessmentDrafts.value[code] || null;
});
const previewDevSummary = computed(() => {
  const rows = previewDevDraft.value?.rows || [];
  const codingDays = round1(rows.reduce((sum, row) => sum + toNumber(row.codingDays), 0));
  const planningDays = round1(codingDays * 0.2);
  const testingDays = round1(codingDays * 0.4);
  const totalDays = round1(codingDays + planningDays + testingDays);
  return { codingDays, planningDays, testingDays, totalDays };
});

function getCloudNamesBySheet(sheet: string): string[] {
  if (!templateDetail.value || !sheet) return [];
  const names = new Set(
    templateDetail.value.items
      .filter((item) => !isSummaryCloudProduct(item.cloudProduct))
      .filter((item) => (item.sheetName || "未分工作表") === sheet)
      .map((item) => item.cloudProduct || "未分类云产品")
  );
  return Array.from(names);
}

function saveCurrentModeDraft(): void {
  const key = selectedSheet.value || "未分工作表";
  const existingVersion = modeDrafts.value[key]?.versionCode;
  modeDrafts.value[key] = {
    selectedCloudNames: [...selectedCloudNames.value],
    itemSelection: { ...itemSelection.value },
    customModeEnabled: customModeEnabled.value,
    itemCustomDays: { ...itemCustomDays.value },
    versionCode: existingVersion,
    updatedAt: Date.now()
  };
  persistModeDrafts();
}

function syncCurrentGlobalPlanDraft(patch: Partial<GlobalPlanDraft>): void {
  const targetVersionCode =
    selectedGlobalPlanVersionCode.value || selectedMyEvaluationVersionCode.value || plannedGlobalPlanVersionCode.value;
  if (!targetVersionCode) return;
  const current = globalPlanDrafts.value[targetVersionCode];
  if (!current) return;
  globalPlanDrafts.value[targetVersionCode] = {
    ...current,
    ...patch,
    versionCode: targetVersionCode,
    createdAt: current.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  selectedGlobalPlanVersionCode.value = targetVersionCode;
  selectedMyEvaluationVersionCode.value = targetVersionCode;
  persistGlobalPlanDrafts();
}

function generateNextVersionCode(prefix: "PG" | "RS" | "GL" | "DV" | "RI", existingCodes: string[]): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePrefix = `${yyyy}${mm}${dd}`;
  const codePrefix = `${prefix}-`;
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let maxOrder = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(codePrefix)) continue;
    const body = code.slice(codePrefix.length);
    if (!body.startsWith(datePrefix)) continue;
    const seqPart = body.slice(8, 11);
    const letterPart = body.slice(11, 12);
    if (!/^\d{3}$/.test(seqPart)) continue;
    const letterIndex = letters.indexOf(letterPart);
    if (letterIndex < 0) continue;
    const seq = Number(seqPart);
    if (seq <= 0) continue;
    const order = (seq - 1) * letters.length + letterIndex + 1;
    if (order > maxOrder) maxOrder = order;
  }
  const nextOrder = maxOrder + 1;
  const seqNum = Math.floor((nextOrder - 1) / letters.length) + 1;
  const safeSeq = Math.min(seqNum, 999);
  const letterIndex = (nextOrder - 1) % letters.length;
  return `${codePrefix}${datePrefix}${String(safeSeq).padStart(3, "0")}${letters[letterIndex]}`;
}

function onManualSaveDraft(): void {
  const key = selectedSheet.value || "未分工作表";
  const existingVersionCode = modeDrafts.value[key]?.versionCode || "";
  const versionCode =
    existingVersionCode ||
    generateNextVersionCode(
      "PG",
      Object.values(modeDrafts.value)
        .map((draft) => draft.versionCode || "")
        .filter(Boolean)
    );
  const isNewVersion = !existingVersionCode;
  saveCurrentModeDraft();
  modeDrafts.value[key] = {
    ...modeDrafts.value[key],
    versionCode,
    updatedAt: Date.now()
  };
  persistModeDrafts();
  selectedGlobalAssessmentVersionCode.value = versionCode;
  if (isNewVersion) {
    void createVersionRecordOnServer("assessment", versionCode, {
      ...modeDrafts.value[key],
      sheetKey: key
    }).catch((err) => {
      error.value = err instanceof Error ? err.message : "评估版本后端持久化失败";
    });
  }
  syncCurrentGlobalPlanDraft({
    assessmentVersionCode: versionCode
  });
  showTimedNotice("已临时保存");
}

function cloneResourceRows(rows: ResourceCostRow[]): ResourceCostRow[] {
  return rows.map((row) => ({
    ...row,
    monthDays: [...row.monthDays]
  }));
}

function applyResourceDraft(draft: ResourceDraft): void {
  const monthCount = Math.max(MIN_RESOURCE_MONTH_COUNT, Number(draft.monthCount || 0) || MIN_RESOURCE_MONTH_COUNT);
  resourceMonthCount.value = monthCount;
  resourceIncludeTravel.value = Boolean(draft.includeTravel);
  if (draft.selectedEstimateVersionCode) {
    selectedResourceVersionCode.value = draft.selectedEstimateVersionCode;
  }

  const targetMonthLength = monthCount;
  const sourceRows = Array.isArray(draft.rows) && draft.rows.length
    ? draft.rows
    : [createEmptyResourceRow(), createEmptyResourceRow(), createEmptyResourceRow()];
  const rowIdMap = new Map<string, string>();
  const nextRows = sourceRows.map((row) => {
    const newRowId = `resource-row-${resourceRowIdSeed.value++}`;
    rowIdMap.set(row.rowId, newRowId);
    const nextMonthDays = Array.isArray(row.monthDays) ? row.monthDays.slice(0, targetMonthLength).map((x) => toNumber(x)) : [];
    while (nextMonthDays.length < targetMonthLength) nextMonthDays.push(0);
    return {
      ...row,
      rowId: newRowId,
      monthDays: nextMonthDays
    };
  });
  resourceCostRows.value = nextRows;

  const nextSelections: Record<string, string[]> = {};
  for (const [oldRowId, keys] of Object.entries(draft.rowSkuSelections || {})) {
    const mappedRowId = rowIdMap.get(oldRowId);
    if (!mappedRowId) continue;
    nextSelections[mappedRowId] = Array.from(new Set((keys || []).filter(Boolean)));
  }
  resourceRowSkuSelections.value = nextSelections;
  for (const row of resourceCostRows.value) {
    row.moduleTask = moduleTaskDisplayValue(row);
  }
  selectedResourceRowIds.value = [];
  resourceRoleHover.value = "";
  resourceModulePickerRowId.value = "";
}

function onSaveResourceDraft(): void {
  const existingVersionCode = currentResourceVersionCode.value;
  const versionCode =
    existingVersionCode ||
    generateNextVersionCode(
      "RS",
      Object.values(resourceDrafts.value)
        .map((draft) => draft.versionCode || "")
        .filter(Boolean)
    );
  const isNewVersion = !existingVersionCode || !resourceDrafts.value[existingVersionCode];
  resourceDrafts.value[versionCode] = {
    versionCode,
    updatedAt: Date.now(),
    selectedEstimateVersionCode: selectedResourceVersionCode.value,
    includeTravel: resourceIncludeTravel.value,
    monthCount: resourceMonthCount.value,
    rows: cloneResourceRows(resourceCostRows.value),
    rowSkuSelections: JSON.parse(JSON.stringify(resourceRowSkuSelections.value)) as Record<string, string[]>
  };
  currentResourceVersionCode.value = versionCode;
  selectedGlobalResourceVersionCode.value = versionCode;
  persistResourceDrafts();
  if (isNewVersion) {
    void createVersionRecordOnServer("resource", versionCode, resourceDrafts.value[versionCode] as unknown as Record<string, unknown>).catch(
      (err) => {
        error.value = err instanceof Error ? err.message : "资源版本后端持久化失败";
      }
    );
  }
  syncCurrentGlobalPlanDraft({
    assessmentVersionCode: selectedResourceVersionCode.value || "",
    resourceVersionCode: versionCode
  });
  showTimedNotice("资源人天及成本已保存");
}

function onResourceDraftChange(): void {
  const code = currentResourceVersionCode.value;
  if (!code) return;
  const draft = resourceDrafts.value[code];
  if (!draft) return;
  applyResourceDraft(draft);
  selectedGlobalResourceVersionCode.value = code;
}

function applyRequirementImportDraft(draft: RequirementImportDraft): void {
  patchDashboardBasicInfo(draft.basicInfo);
  applyRequirementImportData(draft.requirementImportData);
}

function onSaveRequirementImportDraft(): void {
  const globalVersionCode = activeGlobalPlanVersionCode.value;
  const globalDraft = globalVersionCode ? globalPlanDrafts.value[globalVersionCode] : undefined;
  const linkedVersionCode = globalDraft?.requirementImportVersionCode || "";
  const existingVersionCode = currentRequirementImportVersionCode.value;
  const preferredVersionCode = linkedVersionCode || existingVersionCode;
  const versionCode =
    preferredVersionCode ||
    generateNextVersionCode(
      "RI",
      Object.values(requirementImportDrafts.value)
        .map((draft) => draft.versionCode || "")
        .filter(Boolean)
    );
  const isNewVersion = !requirementImportDrafts.value[versionCode];
  requirementImportDrafts.value[versionCode] = {
    versionCode,
    updatedAt: Date.now(),
    basicInfo: { ...dashboardBasicInfo.value },
    requirementImportData: snapshotRequirementImportData()
  };
  currentRequirementImportVersionCode.value = versionCode;
  if (globalDraft) {
    selectedGlobalRequirementImportVersionCode.value = globalDraft.requirementImportVersionCode || versionCode;
  }
  persistRequirementImportDrafts();
  if (isNewVersion) {
    void createVersionRecordOnServer(
      "requirementImport",
      versionCode,
      requirementImportDrafts.value[versionCode] as unknown as Record<string, unknown>
    ).catch((err) => {
      error.value = err instanceof Error ? err.message : "需求导入版本后端持久化失败";
    });
  }
  if (globalDraft) {
    const shouldLinkVersion = !globalDraft.requirementImportVersionCode;
    syncCurrentGlobalPlanDraft({
      requirementImportVersionCode: shouldLinkVersion ? versionCode : globalDraft.requirementImportVersionCode || versionCode,
      basicInfo: { ...dashboardBasicInfo.value },
      requirementImportData: snapshotRequirementImportData()
    });
    selectedGlobalRequirementImportVersionCode.value = shouldLinkVersion
      ? versionCode
      : globalDraft.requirementImportVersionCode || versionCode;
  }
  showTimedNotice("需求导入已保存");
}

function onRequirementImportDraftChange(): void {
  const code = currentRequirementImportVersionCode.value;
  if (!code) return;
  const draft = requirementImportDrafts.value[code];
  if (!draft) return;
  applyRequirementImportDraft(draft);
  selectedGlobalRequirementImportVersionCode.value = code;
}

function nextGlobalPlanVersionCodePreview(): string {
  return generateNextVersionCode(
    "GL",
    Object.values(globalPlanDrafts.value)
      .map((draft) => draft.versionCode || "")
      .filter(Boolean)
  );
}

function openCreatePlanGuide(): void {
  plannedGlobalPlanVersionCode.value = nextGlobalPlanVersionCodePreview();
  planGuideProjectName.value = dashboardBasicInfo.value.projectName || "";
  planGuideCreatedAt.value = Date.now();
  createPlanGuideVisible.value = true;
}

function closeCreatePlanGuide(): void {
  createPlanGuideVisible.value = false;
}

function savePlannedGlobalPlanToMyEvaluations(silent = false): boolean {
  const versionCode = plannedGlobalPlanVersionCode.value || nextGlobalPlanVersionCodePreview();
  const projectName = planGuideProjectName.value.trim();
  if (!projectName) {
    if (!silent) showTimedNotice("请先录入项目名称");
    return false;
  }
  const existedDraft = globalPlanDrafts.value[versionCode];
  const now = Date.now();
  const createdAt = existedDraft?.createdAt || planGuideCreatedAt.value || now;
  const baseBasicInfo = existedDraft?.basicInfo || dashboardBasicInfo.value;
  const basicInfo: DashboardBasicInfo = {
    ...baseBasicInfo,
    projectName
  };
  globalPlanDrafts.value[versionCode] = {
    versionCode,
    createdAt,
    updatedAt: now,
    reviewedAt: existedDraft?.reviewedAt,
    assessmentVersionCode: existedDraft?.assessmentVersionCode || "",
    resourceVersionCode: existedDraft?.resourceVersionCode || "",
    requirementImportVersionCode: existedDraft?.requirementImportVersionCode || "",
    devAssessmentVersionCode: existedDraft?.devAssessmentVersionCode || "",
    wbsVersionCode: existedDraft?.wbsVersionCode || "",
    reviewVersionCode: existedDraft?.reviewVersionCode || "",
    basicInfo,
    requirementImportData: existedDraft?.requirementImportData || snapshotRequirementImportData()
  };
  dashboardBasicInfo.value = {
    ...dashboardBasicInfo.value,
    projectName
  };
  plannedGlobalPlanVersionCode.value = versionCode;
  selectedGlobalPlanVersionCode.value = versionCode;
  selectedMyEvaluationVersionCode.value = versionCode;
  persistGlobalPlanDrafts();
  if (!silent) {
    showTimedNotice(existedDraft ? "总方案已更新到我的评估" : "总方案已保存到我的评估");
  }
  return true;
}

function onSavePlannedGlobalPlan(): void {
  savePlannedGlobalPlanToMyEvaluations(false);
}

function goToPlanStep(page: PageKey): void {
  const saved = savePlannedGlobalPlanToMyEvaluations(true);
  if (!saved) {
    showTimedNotice("请先录入项目名称再开始评估");
    return;
  }
  createPlanGuideVisible.value = false;
  currentPage.value = page;
}

function onSaveGlobalPlanDraft(): void {
  const assessmentVersionCode =
    selectedGlobalAssessmentVersionCode.value || selectedResourceVersionCode.value || currentModeVersionCode.value || "";
  const resourceVersionCode = selectedGlobalResourceVersionCode.value || currentResourceVersionCode.value || "";
  const requirementImportVersionCode =
    selectedGlobalRequirementImportVersionCode.value || currentRequirementImportVersionCode.value || "";
  if (!assessmentVersionCode || !resourceVersionCode) {
    showTimedNotice("请先选择评估版本号和资源人天版本号");
    return;
  }
  const reservedCode = plannedGlobalPlanVersionCode.value;
  const reservedDraft = reservedCode ? globalPlanDrafts.value[reservedCode] : undefined;
  const canReuseReservedCode = Boolean(
    reservedCode && (!reservedDraft || (!reservedDraft.assessmentVersionCode && !reservedDraft.resourceVersionCode))
  );
  const versionCode =
    canReuseReservedCode && reservedCode ? reservedCode : nextGlobalPlanVersionCodePreview();
  const existingDraft = globalPlanDrafts.value[versionCode];
  globalPlanDrafts.value[versionCode] = {
    versionCode,
    createdAt: existingDraft?.createdAt || Date.now(),
    updatedAt: Date.now(),
    assessmentVersionCode,
    resourceVersionCode,
    requirementImportVersionCode,
    devAssessmentVersionCode: currentDevAssessmentVersionCode.value || "",
    wbsVersionCode: "",
    reviewVersionCode: "",
    basicInfo: {
      ...(existingDraft?.basicInfo || dashboardBasicInfo.value),
      projectName: planGuideProjectName.value.trim() || dashboardBasicInfo.value.projectName
    },
    requirementImportData: snapshotRequirementImportData(),
    reviewedAt: existingDraft?.reviewedAt
  };
  selectedGlobalPlanVersionCode.value = versionCode;
  selectedMyEvaluationVersionCode.value = versionCode;
  plannedGlobalPlanVersionCode.value = "";
  persistGlobalPlanDrafts();
  void createVersionRecordOnServer("global", versionCode, globalPlanDrafts.value[versionCode] as unknown as Record<string, unknown>).catch(
    (err) => {
      error.value = err instanceof Error ? err.message : "总方案版本后端持久化失败";
    }
  );
  showTimedNotice("评估总方案已保存");
}

function onSaveRequirementBasicInfoToGlobalPlan(): void {
  // 总方案采用不可变版本策略：每次保存都创建新版本，避免覆盖历史版本。
  onSaveGlobalPlanDraft();
}

async function onDeleteGlobalPlanDraft(): Promise<void> {
  const code = selectedGlobalPlanVersionCode.value;
  if (!code || !globalPlanDrafts.value[code]) return;
  const ok = window.confirm(`确定删除总方案版本「${code}」吗？`);
  if (!ok) return;
  try {
    await deleteVersionRecordOnServer("global", code);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "删除总方案版本失败";
    return;
  }
  delete globalPlanDrafts.value[code];
  const latest = globalPlanOptions.value[0];
  selectedGlobalPlanVersionCode.value = latest?.versionCode || "";
  selectedGlobalRequirementImportVersionCode.value = latest?.requirementImportVersionCode || "";
  selectedMyEvaluationVersionCode.value = selectedGlobalPlanVersionCode.value;
  persistGlobalPlanDrafts();
  showTimedNotice("评估总方案已删除");
}

function onSwitchGlobalPlanDraft(silent?: boolean): void {
  const code = selectedGlobalPlanVersionCode.value;
  const draft = globalPlanDrafts.value[code];
  if (!draft) return;
  selectedGlobalAssessmentVersionCode.value = draft.assessmentVersionCode || "";
  selectedGlobalResourceVersionCode.value = draft.resourceVersionCode || "";
  if (draft.assessmentVersionCode) {
    selectedResourceVersionCode.value = draft.assessmentVersionCode;
    onResourceVersionChange();
  }
  if (draft.resourceVersionCode) {
    currentResourceVersionCode.value = draft.resourceVersionCode;
    onResourceDraftChange();
  }
  selectedGlobalRequirementImportVersionCode.value = draft.requirementImportVersionCode || "";
  if (draft.requirementImportVersionCode) {
    currentRequirementImportVersionCode.value = draft.requirementImportVersionCode;
    onRequirementImportDraftChange();
  }
  if (draft.basicInfo) {
    patchDashboardBasicInfo(draft.basicInfo);
  }
  if (draft.requirementImportData) {
    applyRequirementImportData(draft.requirementImportData);
  }
  selectedMyEvaluationVersionCode.value = code;
  if (!silent) {
    showTimedNotice("已切换评估总方案");
  }
}

function applyAssessmentVersionDraftIfPossible(versionCode: string): void {
  if (!versionCode) return;
  const resolved = findDraftByVersionCode(versionCode);
  if (!resolved) return;
  selectedSheet.value = resolved.sheetKey;
  applyModeDraftForSheet(resolved.sheetKey);
  selectedGlobalAssessmentVersionCode.value = versionCode;
}

type RelationWorkbenchKind = "global" | "assessment" | "resource" | "requirement" | "dev";

function openRelationVersionWorkbench(kind: RelationWorkbenchKind | string): void {
  const plan = previewPlanDraft.value;
  if (!plan?.versionCode) return;

  selectedGlobalPlanVersionCode.value = plan.versionCode;
  selectedMyEvaluationVersionCode.value = plan.versionCode;
  onSwitchGlobalPlanDraft(true);
  closePlanPreview();

  if (kind === "global") {
    currentPage.value = "dashboard";
    showTimedNotice("已打开总览");
    return;
  }
  if (kind === "assessment") {
    const pg = plan.assessmentVersionCode || "";
    if (!pg) {
      currentPage.value = "assessment";
      showTimedNotice("当前方案未关联实施评估版本");
      return;
    }
    applyAssessmentVersionDraftIfPossible(pg);
    currentPage.value = "assessment";
    showTimedNotice("已打开实施评估");
    return;
  }
  if (kind === "resource") {
    const rs = plan.resourceVersionCode || "";
    if (!rs) {
      currentPage.value = "resourceCost";
      showTimedNotice("当前方案未关联资源人天版本");
      return;
    }
    currentResourceVersionCode.value = rs;
    onResourceDraftChange();
    currentPage.value = "resourceCost";
    showTimedNotice("已打开资源人天及成本");
    return;
  }
  if (kind === "requirement") {
    const ri = plan.requirementImportVersionCode || "";
    if (!ri) {
      currentPage.value = "requirementImport";
      showTimedNotice("当前方案未关联需求导入版本");
      return;
    }
    currentRequirementImportVersionCode.value = ri;
    onRequirementImportDraftChange();
    currentPage.value = "requirementImport";
    showTimedNotice("已打开需求导入");
    return;
  }
  if (kind === "dev") {
    const dv = plan.devAssessmentVersionCode || "";
    if (!dv) {
      currentPage.value = "devAssessment";
      showTimedNotice("当前方案未关联开发评估版本");
      return;
    }
    currentDevAssessmentVersionCode.value = dv;
    onDevAssessmentDraftChange();
    currentPage.value = "devAssessment";
    showTimedNotice("已打开开发评估");
    return;
  }
}

function onPreviewMyEvaluationPlan(): void {
  const code = selectedMyEvaluationVersionCode.value;
  if (!code) return;
  selectedMyEvaluationVersionCode.value = code;
  planPreviewVersionCode.value = code;
  previewSectionExpanded.value = { requirement: false, assessment: false, resource: false, dev: false };
  planPreviewVisible.value = true;
}

function onPreviewMyEvaluationPlanByCode(code: string): void {
  if (!code) return;
  selectedMyEvaluationVersionCode.value = code;
  planPreviewVersionCode.value = code;
  previewSectionExpanded.value = { requirement: false, assessment: false, resource: false, dev: false };
  planPreviewVisible.value = true;
}

function closePlanPreview(): void {
  planPreviewVisible.value = false;
  planPreviewVersionCode.value = "";
}

async function onDeleteMyEvaluationPlan(): Promise<void> {
  const code = selectedMyEvaluationVersionCode.value;
  if (!code || !globalPlanDrafts.value[code]) return;
  const ok = window.confirm(`确定删除总方案版本「${code}」吗？`);
  if (!ok) return;
  try {
    await deleteVersionRecordOnServer("global", code);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "删除总方案版本失败";
    return;
  }
  delete globalPlanDrafts.value[code];
  const latest = globalPlanOptions.value[0];
  const nextCode = latest?.versionCode || "";
  selectedGlobalPlanVersionCode.value = nextCode;
  selectedGlobalRequirementImportVersionCode.value = latest?.requirementImportVersionCode || "";
  selectedMyEvaluationVersionCode.value = nextCode;
  persistGlobalPlanDrafts();
  showTimedNotice("评估总方案已删除");
}

function showTimedNotice(message: string): void {
  saveNotice.value = message;
  if (saveNoticeTimer) {
    clearTimeout(saveNoticeTimer);
  }
  saveNoticeTimer = setTimeout(() => {
    saveNotice.value = "";
    saveNoticeTimer = null;
  }, 2200);
}

function applyModeDraftForSheet(sheet: string): void {
  const key = sheet || "未分工作表";
  const draft = modeDrafts.value[key];
  if (!draft) {
    selectedCloudNames.value = [];
    customModeEnabled.value = false;
    itemCustomDays.value = {};
    return;
  }
  const validCloudSet = new Set(getCloudNamesBySheet(sheet));
  selectedCloudNames.value = draft.selectedCloudNames.filter((name) => validCloudSet.has(name));
  customModeEnabled.value = Boolean(draft.customModeEnabled);
  itemCustomDays.value = { ...draft.itemCustomDays };
  itemSelection.value = { ...itemSelection.value, ...draft.itemSelection };
}

function formatDraftTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString();
}

const currentModeSavedAt = computed(() => {
  const key = selectedSheet.value || "未分工作表";
  return modeDrafts.value[key]?.updatedAt;
});

const currentModeVersionCode = computed(() => {
  const key = selectedSheet.value || "未分工作表";
  return modeDrafts.value[key]?.versionCode || "";
});

function switchSheetDirect(nextSheet: string): void {
  selectedSheet.value = nextSheet;
  applyModeDraftForSheet(nextSheet);
}

function onSwitchSheet(nextSheet: string): void {
  if (!nextSheet || nextSheet === selectedSheet.value) return;
  const hasAnyCloudSelected = selectedCloudNames.value.length > 0;
  if (!hasAnyCloudSelected) {
    switchSheetDirect(nextSheet);
    return;
  }
  const saveFirst = window.confirm("当前评估模式已选择云产品。是否先保存当前方案再切换？");
  if (saveFirst) {
    saveCurrentModeDraft();
    switchSheetDirect(nextSheet);
    return;
  }
  const continueSwitch = window.confirm("你选择了不保存。是否继续切换评估模式？");
  if (continueSwitch) {
    switchSheetDirect(nextSheet);
  }
}

function onModeVersionChange(event: Event): void {
  const target = event.target as HTMLSelectElement | null;
  const versionCode = target?.value || "";
  if (!versionCode) return;
  const resolved = findDraftByVersionCode(versionCode);
  if (!resolved) return;
  selectedSheet.value = resolved.sheetKey;
  applyModeDraftForSheet(resolved.sheetKey);
  selectedGlobalAssessmentVersionCode.value = versionCode;
}

function isSummaryCloudProduct(value?: string): boolean {
  const text = (value || "").replace(/\s+/g, "");
  return text.includes("产品实施工作量小计(人天)") || text.includes("产品实施工作量小计（人天）");
}

const sheets = computed(() => {
  if (!templateDetail.value) return [];
  if (templateDetail.value.sheets?.length) {
    return templateDetail.value.sheets.map((x) => x.sheetName);
  }
  return Array.from(new Set(templateDetail.value.items.map((item) => item.sheetName || "未分工作表")));
});

const filteredItems = computed(() => {
  if (!templateDetail.value) return [];
  const validItems = templateDetail.value.items.filter((item) => !isSummaryCloudProduct(item.cloudProduct));
  const sheet = selectedSheet.value;
  if (!sheet) return validItems;
  return validItems.filter((item) => (item.sheetName || "未分工作表") === sheet);
});

const isModuleQuoteSheet = computed(() => (selectedSheet.value || "").includes("模块报价"));

watch(isModuleQuoteSheet, (isModuleSheet) => {
  if (isModuleSheet) return;
  // 非「模块报价」工作表不展示预置选择模式，并清空已选预置项。
  selectedPresetMode.value = "";
});

const isTableLayoutSheet = computed(() => {
  const sheet = selectedSheet.value || "";
  return sheet.includes("模块报价") || sheet.includes("套件");
});

const hierarchy = computed(() => {
  const cloudMap = new Map<string, Map<string, Map<string, TemplateItem[]>>>();
  for (const item of filteredItems.value) {
    const cloud = item.cloudProduct || "未分类云产品";
    const sku = item.skuName || "未分类SKU";
    const group = isTableLayoutSheet.value ? "__NO_APP_GROUP__" : (item.appGroup || "未分类应用分组");
    if (!cloudMap.has(cloud)) cloudMap.set(cloud, new Map());
    const skuMap = cloudMap.get(cloud)!;
    if (!skuMap.has(sku)) skuMap.set(sku, new Map());
    const groupMap = skuMap.get(sku)!;
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push(item);
  }
  return Array.from(cloudMap.entries()).map(([cloudName, skuMap]) => ({
    cloudName,
    skuList: Array.from(skuMap.entries()).map(([skuName, groupMap]) => ({
      skuName,
      groups: Array.from(groupMap.entries()).map(([groupName, groupItems]) => ({
        groupName: groupName === "__NO_APP_GROUP__" ? "" : groupName,
        groupItems
      }))
    }))
  }));
});

const selectedCloudNameSet = computed(() => new Set(selectedCloudNames.value));

const visibleClouds = computed(() => {
  const set = selectedCloudNameSet.value;
  return hierarchy.value.filter((c) => set.has(c.cloudName));
});

const visibleItems = computed(() => {
  const set = selectedCloudNameSet.value;
  if (set.size === 0) {
    return [] as TemplateItem[];
  }
  return filteredItems.value.filter((item) => set.has(item.cloudProduct || "未分类云产品"));
});

watch(hierarchy, (nodes) => {
  const names = new Set(nodes.map((c) => c.cloudName));
  selectedCloudNames.value = selectedCloudNames.value.filter((n) => names.has(n));
});

function toggleCloudTag(cloudName: string): void {
  const set = new Set(selectedCloudNames.value);
  if (set.has(cloudName)) {
    set.delete(cloudName);
  } else {
    set.add(cloudName);
    // 新选中云产品时，默认将该云下条目全部置为未选中
    const targetCloud = hierarchy.value.find((cloud) => cloud.cloudName === cloudName);
    if (targetCloud) {
      for (const sku of targetCloud.skuList) {
        for (const group of sku.groups) {
          for (const item of group.groupItems) {
            itemSelection.value[item.templateItemId] = false;
          }
        }
      }
    }
  }
  selectedCloudNames.value = Array.from(set);
}

function toggleCloudTagsCollapsed(): void {
  cloudTagsCollapsed.value = !cloudTagsCollapsed.value;
}

function isBlankAreaInteraction(event: MouseEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const interactive = target.closest(
    "button, input, select, textarea, a, label, [role='button'], [data-no-collapse], .tree-item, .module-picker, .resource-cost-table"
  );
  if (interactive) return false;
  return true;
}

function hideCollapsibleHint(key: string): void {
  collapsibleHintVisible.value[key] = false;
  const hideTimer = collapsibleHideTimers.get(key);
  if (hideTimer) {
    clearTimeout(hideTimer);
    collapsibleHideTimers.delete(key);
  }
}

function updateCollapsibleHintPointer(key: string, event: MouseEvent): void {
  collapsibleHintPointer.value[key] = {
    x: event.clientX + 14,
    y: event.clientY + 14
  };
}

function scheduleCollapsibleHint(key: string, event: MouseEvent): void {
  if (!isBlankAreaInteraction(event)) return;
  updateCollapsibleHintPointer(key, event);
  const hoverTimer = collapsibleHoverTimers.get(key);
  if (hoverTimer) clearTimeout(hoverTimer);
  const hideTimer = collapsibleHideTimers.get(key);
  if (hideTimer) clearTimeout(hideTimer);
  const timer = setTimeout(() => {
    collapsibleHintVisible.value[key] = true;
    const autoHideTimer = setTimeout(() => {
      collapsibleHintVisible.value[key] = false;
      collapsibleHideTimers.delete(key);
    }, 5000);
    collapsibleHideTimers.set(key, autoHideTimer);
    collapsibleHoverTimers.delete(key);
  }, COLLAPSIBLE_HINT_HOVER_DELAY_MS);
  collapsibleHoverTimers.set(key, timer);
}

function onCollapsibleMouseMove(key: string, event: MouseEvent): void {
  const hoverTimer = collapsibleHoverTimers.get(key);
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    collapsibleHoverTimers.delete(key);
  }
  if (!isBlankAreaInteraction(event)) {
    hideCollapsibleHint(key);
    return;
  }
  if (collapsibleHintVisible.value[key]) {
    hideCollapsibleHint(key);
  }
  updateCollapsibleHintPointer(key, event);
}

function clearCollapsibleHover(key: string): void {
  const hoverTimer = collapsibleHoverTimers.get(key);
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    collapsibleHoverTimers.delete(key);
  }
}

function collapsibleHintStyle(key: string): { left: string; top: string } {
  const point = collapsibleHintPointer.value[key];
  if (!point) return { left: "12px", top: "12px" };
  return {
    left: `${point.x}px`,
    top: `${point.y}px`
  };
}

function toggleCollapsibleByKey(key: string): void {
  if (key === "dashboardAnalysis") {
    toggleDashboardAnalysis();
    return;
  }
  if (key === "requirementBasicInfo") {
    if (requirementBasicInfoExpanded.value) {
      collapseRequirementBasicInfo();
    } else {
      expandRequirementBasicInfo();
    }
    return;
  }
  if (key === "assessmentToolbar") {
    if (assessmentToolbarExpanded.value) {
      onManualCollapseAssessmentToolbar();
    } else {
      onManualExpandAssessmentToolbar();
    }
    return;
  }
  if (key === "cloudTags") {
    toggleCloudTagsCollapsed();
    return;
  }
  if (key === "moduleAssessmentPanel") {
    moduleAssessmentPanelExpanded.value = !moduleAssessmentPanelExpanded.value;
    return;
  }
  if (key === "multiOrgPanel") {
    multiOrgPanelExpanded.value = !multiOrgPanelExpanded.value;
    return;
  }
  if (key.startsWith("requirement:")) {
    const sectionId = key.slice("requirement:".length);
    if (sectionId) {
      toggleRequirementSection(sectionId);
    }
    return;
  }
  if (key.startsWith("cloudCard:")) {
    const cloudName = key.slice("cloudCard:".length);
    if (cloudName) {
      toggleCloudCardExpand(cloudName);
    }
    return;
  }
  if (key.startsWith("preview:")) {
    const sectionId = key.slice("preview:".length) as "requirement" | "assessment" | "resource" | "dev";
    previewSectionExpanded.value = {
      ...previewSectionExpanded.value,
      [sectionId]: !previewSectionExpanded.value[sectionId]
    };
  }
}

function onCollapsibleBlankDblClick(key: string, event: MouseEvent): void {
  if (key === "moduleAssessmentPanel") {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".cloud-tags-bar, .tree-card")) return;
  }
  if (!isBlankAreaInteraction(event)) return;
  event.preventDefault();
  if (typeof window !== "undefined") {
    window.getSelection?.()?.removeAllRanges();
  }
  const currentTarget = event.currentTarget;
  if (currentTarget instanceof HTMLElement) {
    currentTarget.classList.remove("collapsible-dblclick-anim");
    // 强制重排，确保连续双击也能重复触发动画
    void currentTarget.offsetWidth;
    currentTarget.classList.add("collapsible-dblclick-anim");
    window.setTimeout(() => {
      currentTarget.classList.remove("collapsible-dblclick-anim");
    }, 320);
  }
  clearCollapsibleHover(key);
  hideCollapsibleHint(key);
  toggleCollapsibleByKey(key);
  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => {
      window.getSelection?.()?.removeAllRanges();
    });
  }
}

function applyPresetMode(mode: PresetMode): void {
  if (!templateDetail.value) return;
  const configuredIds = presetModeConfigs[mode]?.templateItemIds || [];
  if (!configuredIds.length) {
    showTimedNotice(`“${mode}”暂未配置`);
    return;
  }

  const allItems = templateDetail.value.items;
  const existingIds = new Set(allItems.map((item) => item.templateItemId));
  const includedIdSet = new Set(configuredIds.filter((id) => existingIds.has(id)));
  if (includedIdSet.size === 0) {
    showTimedNotice(`“${mode}”未匹配到可用条目`);
    return;
  }

  // 若当前工作表不包含该预置模式的条目，则自动切到该模式的首个工作表，便于用户立刻看到命中结果。
  const matchedItems = allItems.filter((item) => includedIdSet.has(item.templateItemId));
  const matchedSheets = new Set(matchedItems.map((item) => item.sheetName || "未分工作表"));
  if (selectedSheet.value && !matchedSheets.has(selectedSheet.value)) {
    selectedSheet.value = matchedItems[0]?.sheetName || "未分工作表";
  }

  const nextSelection: Record<string, boolean> = {};
  for (const item of allItems) {
    nextSelection[item.templateItemId] = includedIdSet.has(item.templateItemId);
  }
  itemSelection.value = nextSelection;

  const nextClouds = new Set(
    matchedItems
      .filter((item) => !isSummaryCloudProduct(item.cloudProduct))
      .map((item) => item.cloudProduct || "未分类云产品")
  );
  selectedCloudNames.value = Array.from(nextClouds);
  cloudTagsCollapsed.value = false;
  showTimedNotice(`已应用“${mode}”`);
}

function selectPresetMode(mode: PresetMode): void {
  selectedPresetMode.value = mode;
  applyPresetMode(mode);
}

/** 云产品大卡片是否展开（默认展开；false 为收起） */
const cloudCardExpanded = ref<Record<string, boolean>>({});

function isCloudCardExpanded(cloudName: string): boolean {
  return cloudCardExpanded.value[cloudName] !== false;
}

function toggleCloudCardExpand(cloudName: string): void {
  const expanded = isCloudCardExpanded(cloudName);
  cloudCardExpanded.value = { ...cloudCardExpanded.value, [cloudName]: !expanded };
}

function toggleItemSelection(templateItemId: string): void {
  itemSelection.value[templateItemId] = !itemSelection.value[templateItemId];
}

function toggleCustomMode(): void {
  if (customModeEnabled.value) {
    customModeEnabled.value = false;
    itemCustomDays.value = {};
    return;
  }
  customModeEnabled.value = true;
}

function getEffectiveStandardDays(item: TemplateItem): number {
  if (!customModeEnabled.value) return item.standardDays;
  const custom = itemCustomDays.value[item.templateItemId];
  if (typeof custom === "number" && Number.isFinite(custom) && custom >= 0) {
    return round1(custom);
  }
  return item.standardDays;
}

function adjustCustomDays(item: TemplateItem, delta: number): void {
  const current = getEffectiveStandardDays(item);
  const next = Math.max(0, round1(current + delta));
  itemCustomDays.value[item.templateItemId] = next;
}

type HierarchyCloud = (typeof hierarchy.value)[number];
type HierarchySku = HierarchyCloud["skuList"][number];

function flattenSkuItems(sku: HierarchySku): TemplateItem[] {
  return sku.groups.flatMap((group) => group.groupItems);
}

function clearCloudSelections(cloud: HierarchyCloud): void {
  let changed = false;
  for (const sku of cloud.skuList) {
    for (const group of sku.groups) {
      for (const item of group.groupItems) {
        if (itemSelection.value[item.templateItemId]) {
          itemSelection.value[item.templateItemId] = false;
          changed = true;
        }
      }
    }
  }
  showTimedNotice(changed ? `已清除“${cloud.cloudName}”下的勾选` : `“${cloud.cloudName}”当前无已勾选项`);
}

function setCloudSelections(cloud: HierarchyCloud, checked: boolean): void {
  let changed = false;
  for (const sku of cloud.skuList) {
    for (const group of sku.groups) {
      for (const item of group.groupItems) {
        if (Boolean(itemSelection.value[item.templateItemId]) !== checked) {
          itemSelection.value[item.templateItemId] = checked;
          changed = true;
        }
      }
    }
  }
  if (!changed) {
    showTimedNotice(`“${cloud.cloudName}”当前已${checked ? "全选" : "全不选"}`);
    return;
  }
  showTimedNotice(`已${checked ? "全选" : "全不选"}“${cloud.cloudName}”下的条目`);
}

function cloudBasics(cloud: HierarchyCloud): { skuCount: number; groupCount: number; itemTotal: number } {
  let groupCount = 0;
  let itemTotal = 0;
  for (const sku of cloud.skuList) {
    groupCount += sku.groups.length;
    for (const g of sku.groups) {
      itemTotal += g.groupItems.length;
    }
  }
  return { skuCount: cloud.skuList.length, groupCount, itemTotal };
}

/** 已勾选：交付模块去重数量、标准人天合计（当前云产品内） */
function cloudPickStats(cloud: HierarchyCloud): { selectedModuleCount: number; checkedPersonDays: number } {
  const modules = new Set<string>();
  let checkedPersonDays = 0;
  for (const sku of cloud.skuList) {
    for (const group of sku.groups) {
      for (const item of group.groupItems) {
        if (itemSelection.value[item.templateItemId]) {
          checkedPersonDays += getEffectiveStandardDays(item);
          modules.add(item.deliveryModule || item.itemName);
        }
      }
    }
  }
  return { selectedModuleCount: modules.size, checkedPersonDays };
}

function selectedSkuNamesInCloud(cloud: HierarchyCloud): string[] {
  const names = new Set<string>();
  for (const sku of cloud.skuList) {
    const hasSelected = sku.groups.some((group) =>
      group.groupItems.some((item) => Boolean(itemSelection.value[item.templateItemId]))
    );
    if (hasSelected) {
      names.add(sku.skuName);
    }
  }
  return Array.from(names);
}

function selectedSkuSummaryText(cloud: HierarchyCloud): string {
  const names = selectedSkuNamesInCloud(cloud);
  return names.length ? names.join("、") : "未选择";
}

function formatStandardDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function round1(input: number): number {
  return Math.round(input * 10) / 10;
}

function safePercent(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return round1((value / total) * 100);
}

function estimateTotalDaysByBase(base: number): number {
  const safeBase = round1(base);
  const tiers = activeRuleSet.value?.baseRule?.userCountTiers || [];
  const tier = tiers.find((x) => form.value.userCount >= x.min && form.value.userCount <= x.max) || {
    min: 0,
    max: 0,
    factor: 0
  };
  const userRaw = safeBase * tier.factor;
  const userIncrement =
    activeRuleSet.value?.baseRule?.userIncrementRounding === "ceil_int" ? Math.ceil(userRaw) : round1(userRaw);
  const difficultyIncrement = round1(safeBase * Number(form.value.difficultyFactor || 0));
  const orgRule = activeRuleSet.value?.orgIncrementRule;
  const orgFactor = Number(orgRule?.factor ?? 0.1);
  const orgEnabled = orgRule?.enabled !== false;
  const orgIncrement = orgEnabled
    ? round1(
        safeBase *
          Math.max(0, Number(form.value.orgCount || 0) - 1) *
          (1 - Number(form.value.orgSimilarityFactor || 0)) *
          orgFactor
      )
    : 0;
  return round1(safeBase + userIncrement + difficultyIncrement + orgIncrement);
}

function estimateBreakdownByBase(base: number): {
  total: number;
  rows: Array<{ label: string; value: number; color: string; percent: number }>;
} {
  const safeBase = round1(base);
  const tiers = activeRuleSet.value?.baseRule?.userCountTiers || [];
  const tier = tiers.find((x) => form.value.userCount >= x.min && form.value.userCount <= x.max) || {
    min: 0,
    max: 0,
    factor: 0
  };
  const userRaw = safeBase * tier.factor;
  const userIncrement =
    activeRuleSet.value?.baseRule?.userIncrementRounding === "ceil_int" ? Math.ceil(userRaw) : round1(userRaw);
  const difficultyIncrement = round1(safeBase * Number(form.value.difficultyFactor || 0));
  const orgRule = activeRuleSet.value?.orgIncrementRule;
  const orgFactor = Number(orgRule?.factor ?? 0.1);
  const orgEnabled = orgRule?.enabled !== false;
  const orgIncrement = orgEnabled
    ? round1(
        safeBase *
          Math.max(0, Number(form.value.orgCount || 0) - 1) *
          (1 - Number(form.value.orgSimilarityFactor || 0)) *
          orgFactor
      )
    : 0;
  const total = round1(safeBase + userIncrement + difficultyIncrement + orgIncrement);
  const rows = [
    { label: "模块基础人天", value: safeBase, color: "#7c3aed" },
    { label: "难度系数增量", value: difficultyIncrement, color: "#2563eb" },
    { label: "多组织相似度增量", value: orgIncrement, color: "#10b981" },
    { label: "用户数增量", value: userIncrement, color: "#f59e0b" }
  ];
  return {
    total,
    rows: rows.map((row) => ({ ...row, percent: safePercent(row.value, total) }))
  };
}

const selectedCount = computed(
  () => visibleItems.value.filter((item) => itemSelection.value[item.templateItemId]).length
);
const baseDays = computed(() =>
  visibleItems.value.reduce(
    (sum, item) => sum + (itemSelection.value[item.templateItemId] ? getEffectiveStandardDays(item) : 0),
    0
  )
);

const multiOrgCloudDayMap = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {};
  for (const slice of cloudWorkloadSlices.value) {
    map[slice.label] = slice.value;
  }
  return map;
});

const multiOrgScopeDefs: MultiOrgScopeDef[] = [
  { key: "finance", label: "财务云", cloudName: "财务云" },
  { key: "scm", label: "供应链云", cloudName: "供应链云" },
  { key: "mfg", label: "制造云", cloudName: "制造云" },
  { key: "plm", label: "PLM云", cloudName: "PLM云" },
  { key: "mes", label: "MES云", cloudName: "MES云" },
  { key: "omni", label: "全渠道云", cloudName: "全渠道云" }
];

const multiOrgVisibleScopeDefs = computed(() => {
  const availableCloudNameSet = new Set(hierarchy.value.map((cloud) => cloud.cloudName));
  return multiOrgScopeDefs.filter((scopeDef) => availableCloudNameSet.has(scopeDef.cloudName));
});

const moduleAssessmentCollapsedSheetText = computed(() => selectedSheet.value || "—");
const moduleAssessmentCollapsedPresetText = computed(() =>
  isModuleQuoteSheet.value ? selectedPresetMode.value || "—" : "—"
);
const moduleAssessmentCollapsedCloudText = computed(() =>
  selectedCloudNames.value.length > 0 ? selectedCloudNames.value.join("、") : "未选云产品"
);
const moduleAssessmentCollapsedDaysText = computed(() => `共：${formatStandardDays(baseDays.value)} 人天`);
/** 模块评估面板折叠时 tooltip 全量文本 */
const moduleAssessmentCollapsedSummary = computed(
  () =>
    `${moduleAssessmentCollapsedSheetText.value}|${moduleAssessmentCollapsedPresetText.value}|${moduleAssessmentCollapsedCloudText.value}|${moduleAssessmentCollapsedDaysText.value}`
);

const multiOrgTotalDays = computed(() =>
  Math.floor(
    multiOrgRows.value.reduce((sum, row) => sum + calcMultiOrgEstimatedDays(row), 0)
  )
);

const multiOrgCollapsedSummary = computed(() => {
  const orgCount = multiOrgRows.value.length;
  const total = multiOrgTotalDays.value;
  const strategySet = new Set(
    multiOrgRows.value.map((row) => row.deliveryStrategy).filter((value) => value && value.trim() !== "")
  );
  const strategies = strategySet.size ? Array.from(strategySet).join("、") : "未设置交付策略";
  return `组织数：${orgCount} | 策略：${strategies} | 合计：${formatStandardDays(total)} 人天`;
});

const cloudWorkloadSlices = computed(() => {
  const set = selectedCloudNameSet.value;
  if (set.size === 0) return [] as Array<{ label: string; value: number; color: string; percent: number }>;

  const colorPalette = ["#7c3aed", "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#14b8a6", "#8b5cf6", "#84cc16"];
  const sums = new Map<string, number>();
  for (const item of visibleItems.value) {
    if (!itemSelection.value[item.templateItemId]) continue;
    const cloud = item.cloudProduct || "未分类云产品";
    sums.set(cloud, round1((sums.get(cloud) || 0) + getEffectiveStandardDays(item)));
  }

  const rows = Array.from(sums.entries())
    .map(([label, value]) => ({ label, value }))
    .filter((x) => x.value > 0);
  const total = rows.reduce((sum, cur) => sum + cur.value, 0);
  return rows.map((row, idx) => ({
    ...row,
    color: colorPalette[idx % colorPalette.length],
    percent: safePercent(row.value, total)
  }));
});

const realtimeBreakdown = computed(() => estimateBreakdownByBase(baseDays.value));

function pieStyle(slices: Array<{ value: number; color: string }>): string {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return "conic-gradient(#e5e7eb 0 100%)";

  let start = 0;
  const segments = slices.map((slice) => {
    const span = (slice.value / total) * 360;
    const end = start + span;
    const seg = `${slice.color} ${start}deg ${end}deg`;
    start = end;
    return seg;
  });
  return `conic-gradient(${segments.join(", ")})`;
}

const cloudWorkloadPieStyle = computed(() => pieStyle(cloudWorkloadSlices.value));
const breakdownPieStyle = computed(() => pieStyle(realtimeBreakdown.value.rows));
const devTypeOptions = ["功能开发", "报表开发", "集成开发"] as const;
const devAssessmentRowSeed = ref(1);
const selectedDevAssessmentRowIds = ref<string[]>([]);
const devAssessmentRows = ref<DevAssessmentRow[]>([
  {
    rowId: `dev-row-${devAssessmentRowSeed.value++}`,
    businessDomain: "滚动生产计划",
    moduleName: "多选工单批量修改工单BOM",
    moduleBrief: "",
    functionDesc:
      "用户在生产线计划平台选中工单执行【批量指定BOM】操作，校验状态与BOM一致后弹窗维护并回写BOM，最终反馈批改结果。",
    devType: "功能开发",
    estimateBasis: "",
    codingDays: 3
  },
  {
    rowId: `dev-row-${devAssessmentRowSeed.value++}`,
    businessDomain: "重复生产管理",
    moduleName: "调拨下推重复生产领料单（包辅材）",
    moduleBrief: "",
    functionDesc:
      "根据调拨申请单物料及BOM子项扩展标识，计算包辅材用量并自动回填重复生产领料单单据体字段。",
    devType: "功能开发",
    estimateBasis: "",
    codingDays: 4
  },
  {
    rowId: `dev-row-${devAssessmentRowSeed.value++}`,
    businessDomain: "滚动销售管理",
    moduleName: "发货/出库反写销售订单",
    moduleBrief: "",
    functionDesc:
      "扩展销售订单分录关联字段，发货通知与销售出库审核/反审核时双向反写销售订单数量。",
    devType: "功能开发",
    estimateBasis: "",
    codingDays: 2
  }
]);
const devAssessmentEvaluator = ref("林宏果");
const devAssessmentDate = ref(new Date().toISOString().slice(0, 10));
const devAssessmentModulePickerRowId = ref("");
const devAssessmentRowSkuSelections = ref<Record<string, string[]>>({});
const hasSelectedDevAssessmentRows = computed(() => selectedDevAssessmentRowIds.value.length > 0);
type DevModuleCloudGroup = {
  cloudName: string;
  skuNames: string[];
};

const devAssessmentSkuGroups = computed<DevModuleCloudGroup[]>(() => {
  if (!templateDetail.value) return [];
  const grouped = new Map<string, Set<string>>();
  const resolved = findDraftByVersionCode(selectedDevAssessmentEstimateVersionCode.value);

  if (resolved) {
    const { draft, sheetKey } = resolved;
    const cloudSet = new Set(draft.selectedCloudNames || []);
    for (const item of templateDetail.value.items) {
      if ((item.sheetName || "未分工作表") !== sheetKey) continue;
      if (!draft.itemSelection[item.templateItemId]) continue;
      const cloud = item.cloudProduct || "未分类云产品";
      if (!cloudSet.has(cloud)) continue;
      const sku = (item.skuName || item.deliveryModule || item.itemName || "").trim();
      if (!sku) continue;
      if (!grouped.has(cloud)) grouped.set(cloud, new Set());
      grouped.get(cloud)!.add(sku);
    }
  } else {
    for (const item of templateDetail.value.items) {
      const sheet = item.sheetName || "未分工作表";
      if (sheet !== "模块报价") continue;
      const cloud = item.cloudProduct || "未分类云产品";
      const sku = (item.skuName || item.deliveryModule || item.itemName || "").trim();
      if (!sku) continue;
      if (!grouped.has(cloud)) grouped.set(cloud, new Set());
      grouped.get(cloud)!.add(sku);
    }
  }

  return Array.from(grouped.entries())
    .map(([cloudName, skuSet]) => ({
      cloudName,
      skuNames: Array.from(skuSet).sort((a, b) => a.localeCompare(b, "zh-CN"))
    }))
    .sort((a, b) => a.cloudName.localeCompare(b.cloudName, "zh-CN"));
});

function devAssessmentBusinessDomainDisplayValue(row: DevAssessmentRow): string {
  const selectedKeys = devAssessmentRowSkuSelections.value[row.rowId] || [];
  if (!selectedKeys.length) return row.businessDomain || "";
  return selectedKeys
    .map((key) => parseSkuOptionKey(key).skuName)
    .filter(Boolean)
    .join("、");
}

function devAssessmentSelectedSkuNames(row: DevAssessmentRow): string[] {
  const selectedKeys = devAssessmentRowSkuSelections.value[row.rowId] || [];
  return selectedKeys
    .map((key) => parseSkuOptionKey(key).skuName)
    .filter(Boolean);
}

function devAssessmentSelectedSkuPreviewNames(row: DevAssessmentRow, limit = 2): string[] {
  return devAssessmentSelectedSkuNames(row).slice(0, limit);
}

function devAssessmentSelectedSkuOverflowCount(row: DevAssessmentRow, limit = 2): number {
  const total = devAssessmentSelectedSkuNames(row).length;
  return Math.max(0, total - limit);
}
const devAssessmentSummary = computed(() => {
  const codingDays = round1(devAssessmentRows.value.reduce((sum, row) => sum + toNumber(row.codingDays), 0));
  const planningDays = round1(codingDays * 0.2);
  const testingDays = round1(codingDays * 0.4);
  const totalDays = round1(codingDays + planningDays + testingDays);
  return { codingDays, planningDays, testingDays, totalDays };
});

const devAssessmentDraftOptions = computed(() =>
  Object.values(devAssessmentDrafts.value)
    .map((draft) => ({
      versionCode: draft.versionCode,
      updatedAt: Number(draft.updatedAt || 0)
    }))
    .filter((x) => x.versionCode)
    .sort((a, b) => b.updatedAt - a.updatedAt)
);

function createEmptyDevAssessmentRow(): DevAssessmentRow {
  return {
    rowId: `dev-row-${devAssessmentRowSeed.value++}`,
    businessDomain: "",
    moduleName: "",
    moduleBrief: "",
    functionDesc: "",
    devType: "功能开发",
    estimateBasis: "",
    codingDays: 0
  };
}

function devAssessmentPlanningDays(row: DevAssessmentRow): number {
  return round1(toNumber(row.codingDays) * 0.2);
}

function devAssessmentTestingDays(row: DevAssessmentRow): number {
  return round1(toNumber(row.codingDays) * 0.4);
}

function devAssessmentTotalDays(row: DevAssessmentRow): number {
  return round1(toNumber(row.codingDays) + devAssessmentPlanningDays(row) + devAssessmentTestingDays(row));
}

function toggleDevAssessmentRowSelection(rowId: string): void {
  const selected = new Set(selectedDevAssessmentRowIds.value);
  if (selected.has(rowId)) {
    selected.delete(rowId);
  } else {
    selected.add(rowId);
  }
  selectedDevAssessmentRowIds.value = Array.from(selected);
}

function onDevAssessmentRowClick(rowId: string, event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, select, textarea, button, a, label")) return;
  toggleDevAssessmentRowSelection(rowId);
}

function toggleDevAssessmentModulePicker(rowId: string): void {
  devAssessmentModulePickerRowId.value = devAssessmentModulePickerRowId.value === rowId ? "" : rowId;
}

function isDevSkuChecked(rowId: string, cloudName: string, skuName: string): boolean {
  const key = skuOptionKey(cloudName, skuName);
  return (devAssessmentRowSkuSelections.value[rowId] || []).includes(key);
}

function setDevRowSkuSelections(row: DevAssessmentRow, nextKeys: string[]): void {
  devAssessmentRowSkuSelections.value[row.rowId] = Array.from(new Set(nextKeys));
  row.businessDomain = devAssessmentBusinessDomainDisplayValue(row);
}

function toggleDevRowSku(row: DevAssessmentRow, cloudName: string, skuName: string): void {
  const key = skuOptionKey(cloudName, skuName);
  const current = devAssessmentRowSkuSelections.value[row.rowId] || [];
  if (current.includes(key)) {
    setDevRowSkuSelections(
      row,
      current.filter((x) => x !== key)
    );
    return;
  }
  setDevRowSkuSelections(row, [...current, key]);
}

function selectAllDevRowSkuInCloud(row: DevAssessmentRow, cloud: DevModuleCloudGroup): void {
  const current = new Set(devAssessmentRowSkuSelections.value[row.rowId] || []);
  for (const sku of cloud.skuNames) {
    current.add(skuOptionKey(cloud.cloudName, sku));
  }
  setDevRowSkuSelections(row, Array.from(current));
}

function clearAllDevRowSkuInCloud(row: DevAssessmentRow, cloud: DevModuleCloudGroup): void {
  const removeSet = new Set(cloud.skuNames.map((sku) => skuOptionKey(cloud.cloudName, sku)));
  const current = devAssessmentRowSkuSelections.value[row.rowId] || [];
  setDevRowSkuSelections(
    row,
    current.filter((key) => !removeSet.has(key))
  );
}

function addDevAssessmentRow(): void {
  devAssessmentRows.value = [...devAssessmentRows.value, createEmptyDevAssessmentRow()];
}

function deleteSelectedDevAssessmentRows(): void {
  if (!selectedDevAssessmentRowIds.value.length) return;
  const selected = new Set(selectedDevAssessmentRowIds.value);
  devAssessmentRows.value = devAssessmentRows.value.filter((row) => !selected.has(row.rowId));
  selectedDevAssessmentRowIds.value = [];
  for (const rowId of selected) {
    delete devAssessmentRowSkuSelections.value[rowId];
  }
  if (devAssessmentModulePickerRowId.value && selected.has(devAssessmentModulePickerRowId.value)) {
    devAssessmentModulePickerRowId.value = "";
  }
}

function cloneDevAssessmentRows(rows: DevAssessmentRow[]): DevAssessmentRow[] {
  return rows.map((row) => ({ ...row }));
}

function applyDevAssessmentDraft(draft: DevAssessmentDraft): void {
  const sourceRows = Array.isArray(draft.rows) && draft.rows.length ? draft.rows : [createEmptyDevAssessmentRow()];
  const rowIdMap = new Map<string, string>();
  devAssessmentRows.value = sourceRows.map((row) => {
    const nextRowId = `dev-row-${devAssessmentRowSeed.value++}`;
    rowIdMap.set(row.rowId, nextRowId);
    return {
      ...row,
      rowId: nextRowId,
      codingDays: toNumber(row.codingDays),
      businessDomain: row.businessDomain || ""
    };
  });
  devAssessmentEvaluator.value = draft.evaluator || "";
  devAssessmentDate.value = draft.evaluateDate || new Date().toISOString().slice(0, 10);
  selectedDevAssessmentEstimateVersionCode.value = draft.selectedEstimateVersionCode || "";
  const nextSelections: Record<string, string[]> = {};
  for (const [oldRowId, keys] of Object.entries(draft.rowSkuSelections || {})) {
    const mapped = rowIdMap.get(oldRowId);
    if (!mapped) continue;
    nextSelections[mapped] = Array.from(new Set((keys || []).filter(Boolean)));
  }
  devAssessmentRowSkuSelections.value = nextSelections;
  for (const row of devAssessmentRows.value) {
    row.businessDomain = devAssessmentBusinessDomainDisplayValue(row);
  }
  selectedDevAssessmentRowIds.value = [];
  devAssessmentModulePickerRowId.value = "";
}

function saveDevAssessmentDraft(): void {
  const existingVersionCode = currentDevAssessmentVersionCode.value;
  const versionCode =
    existingVersionCode ||
    generateNextVersionCode(
      "DV",
      Object.values(devAssessmentDrafts.value)
        .map((draft) => draft.versionCode || "")
        .filter(Boolean)
    );
  const isNewVersion = !existingVersionCode || !devAssessmentDrafts.value[existingVersionCode];
  devAssessmentDate.value = new Date().toISOString().slice(0, 10);
  devAssessmentDrafts.value[versionCode] = {
    versionCode,
    updatedAt: Date.now(),
    selectedEstimateVersionCode: selectedDevAssessmentEstimateVersionCode.value,
    evaluator: devAssessmentEvaluator.value,
    evaluateDate: devAssessmentDate.value,
    rows: cloneDevAssessmentRows(devAssessmentRows.value),
    rowSkuSelections: JSON.parse(JSON.stringify(devAssessmentRowSkuSelections.value)) as Record<string, string[]>
  };
  currentDevAssessmentVersionCode.value = versionCode;
  persistDevAssessmentDrafts();
  if (isNewVersion) {
    void createVersionRecordOnServer("dev", versionCode, devAssessmentDrafts.value[versionCode] as unknown as Record<string, unknown>).catch(
      (err) => {
        error.value = err instanceof Error ? err.message : "开发评估版本后端持久化失败";
      }
    );
  }
  syncCurrentGlobalPlanDraft({
    devAssessmentVersionCode: versionCode
  });
  showTimedNotice("开发评估已保存");
}

function onDevAssessmentDraftChange(): void {
  const code = currentDevAssessmentVersionCode.value;
  if (!code) return;
  const draft = devAssessmentDrafts.value[code];
  if (!draft) return;
  applyDevAssessmentDraft(draft);
}

const resourceMonthCount = ref(3);
const MIN_RESOURCE_MONTH_COUNT = 1;
const resourceIncludeTravel = ref(false);

function buildResourceMonthLabel(baseDate: Date, offset: number): string {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + offset + 1;
  const normalizedYear = year + Math.floor((month - 1) / 12);
  const normalizedMonth = ((month - 1) % 12 + 12) % 12 + 1;
  return `${normalizedYear}年${normalizedMonth}月人天投入`;
}

const resourceMonthColumns = computed(() => {
  const now = new Date();
  return Array.from({ length: resourceMonthCount.value }, (_, idx) => buildResourceMonthLabel(now, idx));
});
const resourceRoleOptions = ["项目经理", "实施顾问", "开发顾问", "咨询顾问"] as const;
const resourcePersonTypeOptions = ["伙伴", "员工"] as const;
const resourceConsultantLevelOptions = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1"] as const;
const resourceRowIdSeed = ref(1);
const selectedResourceRowIds = ref<string[]>([]);
const selectedResourceVersionCode = ref("");
const resourceModulePickerRowId = ref("");
const resourceRowSkuSelections = ref<Record<string, string[]>>({});

function toNumber(value: number | string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function createEmptyResourceRow(): ResourceCostRow {
  const rowId = `resource-row-${resourceRowIdSeed.value++}`;
  return {
    rowId,
    role: "实施顾问",
    personType: "员工",
    orgName: "",
    name: "",
    consultantLevel: "2-1",
    product: "金蝶AI星空",
    moduleTask: "",
    unitCost: 0,
    plannedDays: 0,
    plannedCost: 0,
    trafficCount: 0,
    trafficUnitCost: 0,
    stayDays: 0,
    stayUnitCost: 0,
    allowanceDays: 0,
    allowanceUnitCost: 0,
    travelCostTotal: 0,
    monthDays: resourceMonthColumns.value.map(() => 0)
  };
}

const resourceCostRows = ref<ResourceCostRow[]>([createEmptyResourceRow(), createEmptyResourceRow(), createEmptyResourceRow()]);
const hasSelectedResourceRows = computed(() => selectedResourceRowIds.value.length > 0);

function toggleResourceRowSelection(rowId: string): void {
  const set = new Set(selectedResourceRowIds.value);
  if (set.has(rowId)) {
    set.delete(rowId);
  } else {
    set.add(rowId);
  }
  selectedResourceRowIds.value = Array.from(set);
}

function onResourceRowClick(rowId: string, event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, select, textarea, button, a, label")) return;
  toggleResourceRowSelection(rowId);
}

function addResourceRow(): void {
  resourceCostRows.value = [...resourceCostRows.value, createEmptyResourceRow()];
}

function deleteSelectedResourceRows(): void {
  if (!selectedResourceRowIds.value.length) return;
  const selected = new Set(selectedResourceRowIds.value);
  resourceCostRows.value = resourceCostRows.value.filter((row) => !selected.has(row.rowId));
  selectedResourceRowIds.value = [];
  for (const rowId of selected) {
    delete resourceRowSkuSelections.value[rowId];
  }
  if (resourceModulePickerRowId.value && selected.has(resourceModulePickerRowId.value)) {
    resourceModulePickerRowId.value = "";
  }
}

function addResourceMonth(): void {
  resourceMonthCount.value += 1;
}

function removeResourceMonth(): void {
  resourceMonthCount.value = Math.max(MIN_RESOURCE_MONTH_COUNT, resourceMonthCount.value - 1);
}

function clearResourceTravelData(): void {
  resourceCostRows.value = resourceCostRows.value.map((row) => ({
    ...row,
    trafficCount: 0,
    trafficUnitCost: 0,
    stayDays: 0,
    stayUnitCost: 0,
    allowanceDays: 0,
    allowanceUnitCost: 0,
    travelCostTotal: 0
  }));
}

function toggleResourceIncludeTravel(): void {
  if (resourceIncludeTravel.value) {
    clearResourceTravelData();
    resourceIncludeTravel.value = false;
    return;
  }
  resourceIncludeTravel.value = true;
}

type ResourceVersionOption = {
  sheetKey: string;
  versionCode: string;
  updatedAt: number;
};

const resourceVersionOptions = computed<ResourceVersionOption[]>(() => {
  return Object.entries(modeDrafts.value)
    .map(([sheetKey, draft]) => ({
      sheetKey,
      versionCode: draft.versionCode || "",
      updatedAt: Number(draft.updatedAt || 0)
    }))
    .filter((x) => x.versionCode)
    .sort((a, b) => b.updatedAt - a.updatedAt);
});

type ResourceModuleCloudGroup = {
  cloudName: string;
  skuNames: string[];
};

function skuOptionKey(cloudName: string, skuName: string): string {
  return `${cloudName}||${skuName}`;
}

function parseSkuOptionKey(key: string): { cloudName: string; skuName: string } {
  const [cloudName, skuName] = key.split("||");
  return { cloudName: cloudName || "", skuName: skuName || "" };
}

function findDraftByVersionCode(versionCode: string): { sheetKey: string; draft: ModeDraft } | null {
  if (!versionCode) return null;
  const option = resourceVersionOptions.value.find((x) => x.versionCode === versionCode);
  if (!option) return null;
  const draft = modeDrafts.value[option.sheetKey];
  if (!draft) return null;
  return { sheetKey: option.sheetKey, draft };
}

const resourceVersionSkuGroups = computed<ResourceModuleCloudGroup[]>(() => {
  if (!templateDetail.value) return [];
  const resolved = findDraftByVersionCode(selectedResourceVersionCode.value);
  if (!resolved) return [];
  const { draft, sheetKey } = resolved;
  const cloudSet = new Set(draft.selectedCloudNames || []);
  const grouped = new Map<string, Set<string>>();
  for (const item of templateDetail.value.items) {
    if ((item.sheetName || "未分工作表") !== sheetKey) continue;
    if (!draft.itemSelection[item.templateItemId]) continue;
    const cloud = item.cloudProduct || "未分类云产品";
    if (!cloudSet.has(cloud)) continue;
    const sku = item.skuName || item.deliveryModule || item.itemName;
    if (!grouped.has(cloud)) grouped.set(cloud, new Set());
    grouped.get(cloud)!.add(sku);
  }
  return Array.from(grouped.entries())
    .map(([cloudName, skuSet]) => ({ cloudName, skuNames: Array.from(skuSet) }))
    .sort((a, b) => a.cloudName.localeCompare(b.cloudName, "zh-CN"));
});

function formatDateTime(ts?: number | string): string {
  if (!ts) return "";
  const timeValue = typeof ts === "string" ? Date.parse(ts) : ts;
  if (!Number.isFinite(timeValue)) return "";
  return new Date(timeValue).toLocaleString();
}

function getDraftItemDays(item: TemplateItem, draft: ModeDraft): number {
  if (!draft.customModeEnabled) return item.standardDays;
  const custom = draft.itemCustomDays[item.templateItemId];
  if (typeof custom === "number" && Number.isFinite(custom) && custom >= 0) {
    return round1(custom);
  }
  return item.standardDays;
}

function createResourceRoleRow(role: string, consultantLevel: string, unitCost: number, plannedDays: number): ResourceCostRow {
  return {
    rowId: `resource-row-${resourceRowIdSeed.value++}`,
    role,
    personType: "员工",
    orgName: "",
    name: "",
    consultantLevel,
    product: "金蝶AI星空",
    moduleTask: "",
    unitCost,
    plannedDays,
    plannedCost: Math.round(plannedDays * unitCost),
    trafficCount: 0,
    trafficUnitCost: 0,
    stayDays: 0,
    stayUnitCost: 0,
    allowanceDays: 0,
    allowanceUnitCost: 0,
    travelCostTotal: 0,
    monthDays: resourceMonthColumns.value.map((_, idx) => (idx === 0 ? plannedDays : 0))
  };
}

function onResourceVersionChange(): void {
  const code = selectedResourceVersionCode.value;
  if (!code || !templateDetail.value) return;
  selectedGlobalAssessmentVersionCode.value = code;
  const target = resourceVersionOptions.value.find((x) => x.versionCode === code);
  if (!target) return;
  const draft = modeDrafts.value[target.sheetKey];
  if (!draft) return;

  const cloudSet = new Set(draft.selectedCloudNames || []);
  let totalDays = 0;
  for (const item of templateDetail.value.items) {
    if (isSummaryCloudProduct(item.cloudProduct)) continue;
    if ((item.sheetName || "未分工作表") !== target.sheetKey) continue;
    const cloud = item.cloudProduct || "未分类云产品";
    if (!cloudSet.has(cloud)) continue;
    if (!draft.itemSelection[item.templateItemId]) continue;
    totalDays += getDraftItemDays(item, draft);
  }

  const versionTotalDays = round1(totalDays);
  const managerDays = round1(versionTotalDays * 0.3);
  const consultantDaysA = round1(versionTotalDays * 0.35);
  const consultantDaysB = round1(versionTotalDays * 0.35);
  resourceCostRows.value = [
    createResourceRoleRow("项目经理", "3-1", 1680, managerDays),
    createResourceRoleRow("实施顾问", "2-1", 1440, consultantDaysA),
    createResourceRoleRow("实施顾问", "2-1", 1440, consultantDaysB)
  ];
  resourceRowSkuSelections.value = {};
  selectedResourceRowIds.value = [];
  resourceRoleHover.value = "";
  resourceModulePickerRowId.value = "";
}

function moduleTaskDisplayValue(row: ResourceCostRow): string {
  const selectedKeys = resourceRowSkuSelections.value[row.rowId] || [];
  if (!selectedKeys.length) return row.moduleTask || "";
  return selectedKeys
    .map((key) => {
      const parsed = parseSkuOptionKey(key);
      return parsed.skuName;
    })
    .join("、");
}

function toggleResourceModulePicker(rowId: string): void {
  resourceModulePickerRowId.value = resourceModulePickerRowId.value === rowId ? "" : rowId;
}

function isSkuChecked(rowId: string, cloudName: string, skuName: string): boolean {
  const key = skuOptionKey(cloudName, skuName);
  return (resourceRowSkuSelections.value[rowId] || []).includes(key);
}

function selectedSkuKeysExceptRow(rowId: string): Set<string> {
  const used = new Set<string>();
  for (const [rid, keys] of Object.entries(resourceRowSkuSelections.value)) {
    if (rid === rowId) continue;
    for (const key of keys || []) used.add(key);
  }
  return used;
}

function isSkuOccupiedByOtherRows(rowId: string, cloudName: string, skuName: string): boolean {
  const key = skuOptionKey(cloudName, skuName);
  return selectedSkuKeysExceptRow(rowId).has(key);
}

function resourceVersionSkuGroupsForRow(rowId: string): ResourceModuleCloudGroup[] {
  const occupied = selectedSkuKeysExceptRow(rowId);
  return resourceVersionSkuGroups.value
    .map((cloud) => ({
      cloudName: cloud.cloudName,
      skuNames: cloud.skuNames.filter((skuName) => !occupied.has(skuOptionKey(cloud.cloudName, skuName)))
    }))
    .filter((cloud) => cloud.skuNames.length > 0);
}

function setRowSkuSelections(row: ResourceCostRow, nextKeys: string[]): void {
  resourceRowSkuSelections.value[row.rowId] = Array.from(new Set(nextKeys));
  row.moduleTask = moduleTaskDisplayValue(row);
}

function onToggleSku(row: ResourceCostRow, cloudName: string, skuName: string): void {
  if (!isSkuChecked(row.rowId, cloudName, skuName) && isSkuOccupiedByOtherRows(row.rowId, cloudName, skuName)) return;
  const key = skuOptionKey(cloudName, skuName);
  const current = resourceRowSkuSelections.value[row.rowId] || [];
  const set = new Set(current);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  setRowSkuSelections(row, Array.from(set));
}

function isCloudAllChecked(rowId: string, cloud: ResourceModuleCloudGroup): boolean {
  if (!cloud.skuNames.length) return false;
  return cloud.skuNames.every((sku) => isSkuChecked(rowId, cloud.cloudName, sku));
}

function onSelectCloudAll(row: ResourceCostRow, cloud: ResourceModuleCloudGroup): void {
  const current = new Set(resourceRowSkuSelections.value[row.rowId] || []);
  for (const skuName of cloud.skuNames) {
    if (isSkuOccupiedByOtherRows(row.rowId, cloud.cloudName, skuName)) continue;
    const key = skuOptionKey(cloud.cloudName, skuName);
    current.add(key);
  }
  setRowSkuSelections(row, Array.from(current));
}

function onClearCloudSelection(row: ResourceCostRow, cloud: ResourceModuleCloudGroup): void {
  const current = new Set(resourceRowSkuSelections.value[row.rowId] || []);
  for (const skuName of cloud.skuNames) {
    const key = skuOptionKey(cloud.cloudName, skuName);
    current.delete(key);
  }
  setRowSkuSelections(row, Array.from(current));
}

function cloudSelectedCount(rowId: string, cloud: ResourceModuleCloudGroup): number {
  return cloud.skuNames.filter((sku) => isSkuChecked(rowId, cloud.cloudName, sku)).length;
}

function resourceRowPlannedCost(row: ResourceCostRow): number {
  return Math.round(toNumber(row.unitCost) * toNumber(row.plannedDays));
}

function resourceRowTravelCost(row: ResourceCostRow): number {
  const traffic = toNumber(row.trafficCount) * toNumber(row.trafficUnitCost);
  const stay = toNumber(row.stayDays) * toNumber(row.stayUnitCost);
  const allowance = toNumber(row.allowanceDays) * toNumber(row.allowanceUnitCost);
  return Math.round(traffic + stay + allowance);
}

function effectiveResourceRowTravelCost(row: ResourceCostRow): number {
  return resourceIncludeTravel.value ? resourceRowTravelCost(row) : 0;
}

const resourceCostSummary = computed(() => {
  const totalPlannedDays = round1(resourceCostRows.value.reduce((sum, row) => sum + toNumber(row.plannedDays), 0));
  const totalPlannedCost = Math.round(resourceCostRows.value.reduce((sum, row) => sum + resourceRowPlannedCost(row), 0));
  const totalTravelCost = Math.round(resourceCostRows.value.reduce((sum, row) => sum + effectiveResourceRowTravelCost(row), 0));
  const monthTotals = resourceMonthColumns.value.map((_, idx) =>
    round1(resourceCostRows.value.reduce((sum, row) => sum + toNumber(row.monthDays[idx] || 0), 0))
  );
  return { totalPlannedDays, totalPlannedCost, totalTravelCost, monthTotals };
});

const resourceTravelInputColumnCount = computed(() => (resourceIncludeTravel.value ? 6 : 0));
const resourceLeafColumnCount = computed(() => 10 + resourceTravelInputColumnCount.value + 1 + resourceMonthColumns.value.length);

watch(resourceMonthColumns, (columns) => {
  const targetLength = columns.length;
  resourceCostRows.value = resourceCostRows.value.map((row) => {
    const nextDays = row.monthDays.slice(0, targetLength);
    while (nextDays.length < targetLength) nextDays.push(0);
    return { ...row, monthDays: nextDays };
  });
});

const resourceRoleHover = ref("");
const resourceChartPalette = ["#7c3aed", "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#14b8a6", "#8b5cf6", "#06b6d4"];
const innerRingPalette = ["#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#2dd4bf", "#c4b5fd", "#67e8f9"];

function toChartSlices(entries: Array<{ label: string; value: number }>, palette: string[]): ChartSlice[] {
  const rows = entries.filter((entry) => entry.value > 0);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total <= 0) return [];
  return rows.map((row, idx) => ({
    label: row.label,
    value: row.value,
    color: palette[idx % palette.length],
    percent: safePercent(row.value, total)
  }));
}

function isOutsourcedOrg(orgName: string): boolean {
  return /外包|供应商|合作伙伴|第三方/.test(orgName || "");
}

function rowTotalCost(row: ResourceCostRow): number {
  return Math.round(resourceRowPlannedCost(row) + effectiveResourceRowTravelCost(row));
}

const resourceUniverse = computed(() => {
  const detail = templateDetail.value;
  const resolved = findDraftByVersionCode(selectedResourceVersionCode.value);
  if (!detail || !resolved) {
    return {
      totalDays: 0,
      totalModules: 0
    };
  }
  const { draft, sheetKey } = resolved;
  const cloudSet = new Set(draft.selectedCloudNames || []);
  const moduleSet = new Set<string>();
  let baseDays = 0;
  for (const item of detail.items) {
    if (isSummaryCloudProduct(item.cloudProduct)) continue;
    if ((item.sheetName || "未分工作表") !== sheetKey) continue;
    const cloud = item.cloudProduct || "未分类云产品";
    if (!cloudSet.has(cloud)) continue;
    if (!draft.itemSelection[item.templateItemId]) continue;
    baseDays += getDraftItemDays(item, draft);
    const sku = item.skuName || item.deliveryModule || item.itemName || "未命名模块";
    moduleSet.add(skuOptionKey(cloud, sku));
  }
  return {
    totalDays: estimateTotalDaysByBase(baseDays),
    totalModules: moduleSet.size
  };
});

const resourceAssignedDays = computed(() => round1(resourceCostRows.value.reduce((sum, row) => sum + toNumber(row.plannedDays), 0)));

const resourceAssignedModules = computed(() => {
  const set = new Set<string>();
  for (const keys of Object.values(resourceRowSkuSelections.value)) {
    for (const key of keys || []) {
      set.add(key);
    }
  }
  return set.size;
});

const resourceAllocationDaysSlices = computed(() =>
  toChartSlices(
    [
      { label: "已分配人天", value: resourceAssignedDays.value },
      { label: "未分配人天", value: Math.max(0, round1(resourceUniverse.value.totalDays - resourceAssignedDays.value)) }
    ],
    ["#7c3aed", "#d1d5db"]
  )
);

const resourceAllocationModuleSlices = computed(() =>
  toChartSlices(
    [
      { label: "已分配模块", value: resourceAssignedModules.value },
      { label: "未分配模块", value: Math.max(0, resourceUniverse.value.totalModules - resourceAssignedModules.value) }
    ],
    ["#2563eb", "#d1d5db"]
  )
);

const resourceCostTypeSlices = computed(() => {
  const internalLabor = resourceCostRows.value
    .filter((row) => !isOutsourcedOrg(row.orgName))
    .reduce((sum, row) => sum + resourceRowPlannedCost(row), 0);
  const outsourcing = resourceCostRows.value
    .filter((row) => isOutsourcedOrg(row.orgName))
    .reduce((sum, row) => sum + resourceRowPlannedCost(row), 0);
  const travel = resourceCostRows.value.reduce((sum, row) => sum + effectiveResourceRowTravelCost(row), 0);
  return toChartSlices(
    [
      { label: "人天成本", value: internalLabor },
      { label: "差旅成本", value: travel },
      { label: "外包成本", value: outsourcing }
    ],
    ["#7c3aed", "#f59e0b", "#ef4444"]
  );
});

const resourceRoleOuterSlices = computed(() => {
  const sums = new Map<string, number>();
  for (const row of resourceCostRows.value) {
    const role = row.role || "未设置角色";
    sums.set(role, (sums.get(role) || 0) + rowTotalCost(row));
  }
  return toChartSlices(
    Array.from(sums.entries()).map(([label, value]) => ({ label, value })),
    resourceChartPalette
  );
});

const resourceLevelInnerSlices = computed(() => {
  const roleFilter = resourceRoleHover.value;
  const rows = roleFilter ? resourceCostRows.value.filter((row) => (row.role || "未设置角色") === roleFilter) : resourceCostRows.value;
  const sums = new Map<string, number>();
  for (const row of rows) {
    const level = row.consultantLevel || "未设置级别";
    sums.set(level, (sums.get(level) || 0) + rowTotalCost(row));
  }
  return toChartSlices(
    Array.from(sums.entries()).map(([label, value]) => ({ label, value })),
    innerRingPalette
  );
});

const resourceCompositeCenterLabel = computed(() => (resourceRoleHover.value ? resourceRoleHover.value : "项目角色"));
const resourceCompositeCenterValue = computed(() => {
  const rows = resourceRoleHover.value
    ? resourceCostRows.value.filter((row) => (row.role || "未设置角色") === resourceRoleHover.value)
    : resourceCostRows.value;
  return Math.round(rows.reduce((sum, row) => sum + rowTotalCost(row), 0));
});

function buildRingSegments(slices: ChartSlice[], radius: number): RingSegment[] {
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return slices.map((slice) => {
    const segmentLength = (slice.percent / 100) * circumference;
    const segment: RingSegment = {
      ...slice,
      dasharray: `${segmentLength} ${Math.max(circumference - segmentLength, 0)}`,
      dashoffset: -offset
    };
    offset += segmentLength;
    return segment;
  });
}

const resourceRoleOuterSegments = computed(() => buildRingSegments(resourceRoleOuterSlices.value, 54));
const resourceLevelInnerSegments = computed(() => buildRingSegments(resourceLevelInnerSlices.value, 34));

const selectedDashboardPlan = computed<GlobalPlanDraft | null>(() => {
  const code = selectedMyEvaluationVersionCode.value;
  if (!code) return null;
  return globalPlanDrafts.value[code] || null;
});
const dashboardHasSelectedPlan = computed(() => Boolean(selectedDashboardPlan.value));

const dashboardAssessmentVersionCode = computed(() => {
  const plan = selectedDashboardPlan.value;
  return plan?.assessmentVersionCode || "";
});
const dashboardResourceVersionCode = computed(() => {
  const plan = selectedDashboardPlan.value;
  return plan?.resourceVersionCode || "";
});

const dashboardOverviewData = computed(() => {
  const detail = templateDetail.value;
  const assessmentCode = dashboardAssessmentVersionCode.value;
  if (!detail || !assessmentCode) {
    return {
      moduleSlices: [] as ChartSlice[],
      daySlices: [] as ChartSlice[],
      complexitySlices: [] as Array<{ label: string; value: number; color: string; percent: number }>,
      totalModules: 0,
      assignedModules: 0,
      totalDays: 0,
      assignedDays: 0,
      complexityTotal: 0
    };
  }
  const resolved = findDraftByVersionCode(assessmentCode);
  if (!resolved) {
    return {
      moduleSlices: [] as ChartSlice[],
      daySlices: [] as ChartSlice[],
      complexitySlices: [] as Array<{ label: string; value: number; color: string; percent: number }>,
      totalModules: 0,
      assignedModules: 0,
      totalDays: 0,
      assignedDays: 0,
      complexityTotal: 0
    };
  }

  const { draft, sheetKey } = resolved;
  const cloudSet = new Set(draft.selectedCloudNames || []);
  const moduleKeys = new Set<string>();
  const cloudModules = new Map<string, Set<string>>();
  let base = 0;
  for (const item of detail.items) {
    if (isSummaryCloudProduct(item.cloudProduct)) continue;
    if ((item.sheetName || "未分工作表") !== sheetKey) continue;
    if (!draft.itemSelection[item.templateItemId]) continue;
    const cloud = item.cloudProduct || "未分类云产品";
    if (!cloudSet.has(cloud)) continue;
    const sku = item.skuName || item.deliveryModule || item.itemName || "未命名模块";
    const key = skuOptionKey(cloud, sku);
    moduleKeys.add(key);
    if (!cloudModules.has(cloud)) cloudModules.set(cloud, new Set());
    cloudModules.get(cloud)!.add(sku);
    base += getDraftItemDays(item, draft);
  }
  const totalModules = moduleKeys.size;
  const totalDays = estimateTotalDaysByBase(base);

  const resourceCode = dashboardResourceVersionCode.value;
  const resourceDraft = resourceCode ? resourceDrafts.value[resourceCode] : undefined;
  const assignedDays = round1(
    (resourceDraft?.rows || resourceCostRows.value).reduce((sum, row) => sum + toNumber(row.plannedDays), 0)
  );
  const assignedModuleSet = new Set<string>();
  const selections = resourceDraft?.rowSkuSelections || resourceRowSkuSelections.value;
  for (const keys of Object.values(selections)) {
    for (const key of keys || []) {
      if (moduleKeys.has(key)) assignedModuleSet.add(key);
    }
  }
  const assignedModules = assignedModuleSet.size;

  const moduleSlices = toChartSlices(
    Array.from(cloudModules.entries()).map(([label, modules]) => ({ label, value: modules.size })),
    ["#7c3aed", "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#14b8a6", "#8b5cf6", "#06b6d4"]
  );
  const daySlices = toChartSlices(
    [
      { label: "已分配人天", value: assignedDays },
      { label: "未分配人天", value: Math.max(0, round1(totalDays - assignedDays)) }
    ],
    ["#2563eb", "#d1d5db"]
  );
  const complexity = estimateBreakdownByBase(base);
  return {
    moduleSlices,
    daySlices,
    complexitySlices: complexity.rows,
    totalModules,
    assignedModules,
    totalDays,
    assignedDays,
    complexityTotal: complexity.total
  };
});

const wbsProgressSlices = computed(() =>
  toChartSlices(
    [
      { label: "已完成工作包", value: 24 },
      { label: "进行中工作包", value: 11 },
      { label: "未开始工作包", value: 7 }
    ],
    ["#10b981", "#2563eb", "#f59e0b"]
  )
);
const wbsEffortSlices = computed(() =>
  toChartSlices(
    [
      { label: "设计阶段", value: 28 },
      { label: "构建阶段", value: 42 },
      { label: "测试上线", value: 30 }
    ],
    ["#7c3aed", "#06b6d4", "#14b8a6"]
  )
);
const reviewIssueSlices = computed(() =>
  toChartSlices(
    [
      { label: "高风险项", value: 6 },
      { label: "中风险项", value: 14 },
      { label: "低风险项", value: 19 }
    ],
    ["#ef4444", "#f59e0b", "#22c55e"]
  )
);
const reviewStatusSlices = computed(() =>
  toChartSlices(
    [
      { label: "已通过", value: 18 },
      { label: "待修订", value: 9 },
      { label: "待评审", value: 5 }
    ],
    ["#10b981", "#3b82f6", "#94a3b8"]
  )
);

function onGlobalAssessmentVersionChange(): void {
  if (!selectedGlobalAssessmentVersionCode.value) return;
  selectedResourceVersionCode.value = selectedGlobalAssessmentVersionCode.value;
  onResourceVersionChange();
}

function onGlobalResourceVersionChange(): void {
  if (!selectedGlobalResourceVersionCode.value) return;
  currentResourceVersionCode.value = selectedGlobalResourceVersionCode.value;
  onResourceDraftChange();
}

function onGlobalRequirementImportVersionChange(): void {
  if (!selectedGlobalRequirementImportVersionCode.value) return;
  currentRequirementImportVersionCode.value = selectedGlobalRequirementImportVersionCode.value;
  onRequirementImportDraftChange();
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

const apiBaseUrl = (() => {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "";
})();

function resolveDownloadUrl(url: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) {
    return apiBaseUrl ? `${apiBaseUrl}${url}` : url;
  }
  return apiBaseUrl ? `${apiBaseUrl}/${url}` : `/${url}`;
}

async function downloadWithAuth(downloadUrl: string, fallbackFileName = "estimate"): Promise<void> {
  const resolved = resolveDownloadUrl(downloadUrl);
  const response = await apiFetch(resolved);
  if (!response.ok) {
    throw new Error("下载失败");
  }
  const blob = await response.blob();
  const fileNameFromHeader = (() => {
    const disposition = response.headers.get("Content-Disposition") || "";
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
    const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
    return plainMatch?.[1] || "";
  })();
  const fileName = fileNameFromHeader || fallbackFileName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

const currentTemplateDisplay = computed(() => {
  const id = form.value.templateId;
  const opt = templateOptions.value.find((t) => t.templateId === id);
  if (opt) return `${opt.templateName} (${opt.templateVersion})`;
  const d = templateDetail.value;
  if (d) return `${d.templateName} (${d.templateVersion})`;
  return id || "—";
});

const payload = computed(() => ({
  templateId: form.value.templateId,
  ruleSetId: form.value.ruleSetId,
  userCount: Number(form.value.userCount),
  difficultyFactor: Number(form.value.difficultyFactor),
  orgCount: Number(form.value.orgCount),
  orgSimilarityFactor: Number(form.value.orgSimilarityFactor),
  selectedSheet: selectedSheet.value,
  exportProjectName: (dashboardBasicInfo.value.projectName || "").trim(),
  exportAssessmentVersionCode:
    selectedGlobalAssessmentVersionCode.value || currentModeVersionCode.value || selectedResourceVersionCode.value || "",
  items: (templateDetail.value?.items || []).map((item) => ({
    templateItemId: item.templateItemId,
    included:
      selectedCloudNameSet.value.size > 0 &&
      selectedCloudNameSet.value.has(item.cloudProduct || "未分类云产品") &&
      Boolean(itemSelection.value[item.templateItemId]),
    customStandardDays:
      customModeEnabled.value &&
      typeof itemCustomDays.value[item.templateItemId] === "number" &&
      Number.isFinite(itemCustomDays.value[item.templateItemId]) &&
      itemCustomDays.value[item.templateItemId]! >= 0
        ? round1(itemCustomDays.value[item.templateItemId]!)
        : undefined
  }))
}));

async function loadTemplateDetail(templateId: string): Promise<void> {
  const response = await apiFetch(`/api/v1/templates/${templateId}`);
  const data = (await response.json()) as ApiResponse<TemplateDetail>;
  if (!response.ok || data.code !== 0) {
    throw new Error(data.message || "读取模板详情失败");
  }
  templateDetail.value = data.data;
  const next: Record<string, boolean> = {};
  for (const item of data.data.items) {
    next[item.templateItemId] = true;
  }
  itemSelection.value = next;
  customModeEnabled.value = false;
  itemCustomDays.value = {};
  selectedSheet.value = data.data.sheets?.[0]?.sheetName || data.data.items[0]?.sheetName || "";
  selectedCloudNames.value = [];
  loadModeDraftsFromStorage();
  loadMultiOrgDraftsFromStorage();
  loadResourceDraftsFromStorage();
  loadGlobalPlanDraftsFromStorage();
  loadDevAssessmentDraftsFromStorage();
  loadRequirementImportDraftsFromStorage();
  await hydrateVersionDraftsFromServer();
  applyModeDraftForSheet(selectedSheet.value);
  applyMultiOrgDraftForSheet(selectedSheet.value);
}

async function loadInitialAssessmentData(): Promise<void> {
  if (!authUser.value) return;
  initLoading.value = true;
  error.value = "";
  try {
    const [templatesRes, rulesRes] = await Promise.all([apiFetch("/api/v1/templates"), apiFetch("/api/v1/rule-sets/active")]);
    const templatesData = (await templatesRes.json()) as ApiResponse<{ list: TemplateOption[] }>;
    const rulesData = (await rulesRes.json()) as ApiResponse<RuleSetActive>;
    if (!templatesRes.ok || templatesData.code !== 0) {
      throw new Error(templatesData.message || "模板加载失败");
    }
    if (!rulesRes.ok || rulesData.code !== 0) {
      throw new Error(rulesData.message || "规则加载失败");
    }
    templateOptions.value = templatesData.data.list || [];
    form.value.ruleSetId = rulesData.data.ruleSetId;
    activeRuleSet.value = rulesData.data;
    difficultyOptions.value = rulesData.data.baseRule?.difficultyFactorList || [0, 0.1, 0.2, 0.3];
    if (!difficultyOptions.value.includes(form.value.difficultyFactor)) {
      form.value.difficultyFactor = difficultyOptions.value[0] ?? 0;
    }
    if (templateOptions.value.length > 0) {
      form.value.templateId = templateOptions.value[0].templateId;
      await loadTemplateDetail(form.value.templateId);
    }
    await loadExportHistory(true);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "初始化失败";
  } finally {
    initLoading.value = false;
  }
}

async function onTemplateChange(): Promise<void> {
  result.value = null;
  exportInfo.value = null;
  if (!form.value.templateId) return;
  await loadTemplateDetail(form.value.templateId);
}

function selectAllInSheet(checked: boolean): void {
  for (const item of filteredItems.value) {
    itemSelection.value[item.templateItemId] = checked;
  }
}

function onCloudTagsSheetBulkClick(): void {
  if (cloudTagsSheetBulkShowsDeselect.value) {
    selectAllInSheet(false);
    cloudTagsSheetBulkShowsDeselect.value = false;
  } else {
    selectAllInSheet(true);
    cloudTagsSheetBulkShowsDeselect.value = true;
  }
}

const multiOrgStrategyFactorMap: Record<string, number> = {
  主站实施: 0,
  逐个推广: 1,
  集中推广: 0.8,
  远程支持: 0.6
};

function defaultMultiOrgScopeFlags(): MultiOrgScopeFlags {
  const selected = new Set(selectedCloudNames.value);
  return {
    finance: selected.has("财务云"),
    scm: selected.has("供应链云"),
    mfg: selected.has("制造云"),
    plm: selected.has("PLM云"),
    mes: selected.has("MES云"),
    omni: selected.has("全渠道云")
  };
}

function createMultiOrgRow(): MultiOrgRow {
  return {
    rowId: `multi-org-${Date.now()}-${multiOrgRowSeed.value++}`,
    orgName: "",
    orgType: multiOrgOrgTypeOptions[0],
    location: "",
    deliveryStrategy: multiOrgDeliveryStrategyOptions[1],
    userCount: null,
    scope: defaultMultiOrgScopeFlags(),
    otherBusinessDays: 0,
    difficultyFactor: multiOrgStrategyFactorMap[multiOrgDeliveryStrategyOptions[1]] ?? 1
  };
}

function calcMultiOrgStandardDays(row: MultiOrgRow): number {
  let sum = Number(row.otherBusinessDays || 0);
  for (const scopeDef of multiOrgVisibleScopeDefs.value) {
    if (row.scope[scopeDef.key]) {
      sum += Number(multiOrgCloudDayMap.value[scopeDef.cloudName] || 0);
    }
  }
  return round1(Math.max(0, sum));
}

function calcMultiOrgEstimatedDays(row: MultiOrgRow): number {
  const standardDays = calcMultiOrgStandardDays(row);
  const factor = Number.isFinite(row.difficultyFactor) ? Number(row.difficultyFactor) : 0;
  return round1(Math.max(0, standardDays * Math.max(0, factor)));
}

function addMultiOrgRow(): void {
  multiOrgRows.value.push(createMultiOrgRow());
}

function removeMultiOrgRow(rowId: string): void {
  multiOrgRows.value = multiOrgRows.value.filter((row) => row.rowId !== rowId);
}

function onMultiOrgDeliveryStrategyChange(row: MultiOrgRow): void {
  const factor = multiOrgStrategyFactorMap[row.deliveryStrategy];
  if (typeof factor === "number") {
    row.difficultyFactor = factor;
  }
}

function currentMultiOrgSheetKey(): string {
  return selectedSheet.value || "未分工作表";
}

function saveMultiOrgDraftsToStorage(): void {
  localStorage.setItem(MULTI_ORG_DRAFT_STORAGE_KEY, JSON.stringify(multiOrgDrafts.value));
}

function loadMultiOrgDraftsFromStorage(): void {
  const raw = localStorage.getItem(MULTI_ORG_DRAFT_STORAGE_KEY);
  if (!raw) {
    multiOrgDrafts.value = {};
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, MultiOrgDraft>;
    multiOrgDrafts.value = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    multiOrgDrafts.value = {};
  }
}

function saveMultiOrgDraftForSheet(showNotice = false): void {
  const key = currentMultiOrgSheetKey();
  multiOrgDrafts.value[key] = {
    updatedAt: Date.now(),
    rows: multiOrgRows.value.map((row) => ({
      ...row,
      scope: { ...row.scope }
    }))
  };
  saveMultiOrgDraftsToStorage();
  if (showNotice) {
    showTimedNotice("多组织推广估算已保存");
  }
}

function applyMultiOrgDraftForSheet(sheetKey: string): void {
  const key = sheetKey || "未分工作表";
  const draft = multiOrgDrafts.value[key];
  if (!draft?.rows?.length) {
    multiOrgRows.value = [createMultiOrgRow()];
    return;
  }
  multiOrgRows.value = draft.rows.map((row) => ({
    ...row,
    scope: { ...row.scope }
  }));
}

watch(
  multiOrgRows,
  () => {
    if (currentPage.value !== "assessment") return;
    saveMultiOrgDraftForSheet(false);
  },
  { deep: true }
);

async function buildIdempotencyKey(input: unknown): Promise<string> {
  const raw = JSON.stringify(input);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `export-${hash.slice(0, 24)}`;
}

async function calculateAndExport(type: "excel" | "pdf"): Promise<void> {
  exporting.value = true;
  error.value = "";
  try {
    const requestBody = { ...payload.value, exportType: type };
    const idempotencyKey = await buildIdempotencyKey(requestBody);
    const response = await apiFetch("/api/v1/estimates/calculate-and-export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(requestBody)
    });
    const data = (await response.json()) as ApiResponse<ExportResult>;
    if (!response.ok || data.code !== 0) {
      throw new Error(data.message || "导出失败");
    }
    exportInfo.value = data.data;
    await loadExportHistory(true);
    const fallbackFileName = data.data.downloadUrl.split("/").pop() || "estimate";
    await downloadWithAuth(data.data.downloadUrl, fallbackFileName);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "导出失败";
  } finally {
    exporting.value = false;
  }
}

async function loadExportHistory(reset: boolean): Promise<void> {
  const page = reset ? 1 : historyPage.value;
  const response = await apiFetch(`/api/v1/exports/history?page=${page}&pageSize=8`);
  const data = (await response.json()) as ApiResponse<{ total: number; items: ExportHistoryItem[] }>;
  if (!response.ok || data.code !== 0) {
    return;
  }
  historyTotal.value = data.data.total;
  if (reset) {
    exportHistory.value = data.data.items;
    historyPage.value = 2;
  } else {
    exportHistory.value = [...exportHistory.value, ...data.data.items];
    historyPage.value += 1;
  }
}

async function onDownloadExportItem(item: { downloadUrl: string; fileName: string }): Promise<void> {
  try {
    await downloadWithAuth(item.downloadUrl, item.fileName || "estimate");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "下载失败";
  }
}

const hasMoreHistory = computed(() => exportHistory.value.length < historyTotal.value);

onMounted(() => {
  void bootstrapAuth();
  refreshKimiFloatPos();
  window.addEventListener("resize", refreshKimiFloatPos);
  document.addEventListener("focusin", onTableLongTextareaFocusIn, true);
  document.addEventListener("input", onTableLongTextareaInput, true);
  document.addEventListener("focusout", onTableLongTextareaFocusOut, true);
});

onBeforeUnmount(() => {
  if (saveNoticeTimer) {
    clearTimeout(saveNoticeTimer);
  }
  for (const timer of collapsibleHoverTimers.values()) {
    clearTimeout(timer);
  }
  for (const timer of collapsibleHideTimers.values()) {
    clearTimeout(timer);
  }
  collapsibleHoverTimers.clear();
  collapsibleHideTimers.clear();
  window.removeEventListener("resize", refreshKimiFloatPos);
  document.removeEventListener("focusin", onTableLongTextareaFocusIn, true);
  document.removeEventListener("input", onTableLongTextareaInput, true);
  document.removeEventListener("focusout", onTableLongTextareaFocusOut, true);
});

watch(assessmentToolbarExpanded, (expanded) => {
  if (expanded) {
    assessmentStickyOpacity.value = 1;
  }
});

watch(visibleClouds, (clouds) => {
  const keep = new Set(clouds.map((c) => c.cloudName));
  const next: Record<string, HTMLElement | null> = {};
  for (const name of Object.keys(cloudCardRefs.value)) {
    if (keep.has(name)) next[name] = cloudCardRefs.value[name];
  }
  cloudCardRefs.value = next;
});

watch([currentPage, authUser], ([page, user]) => {
  if (createPlanGuideVisible.value && ["requirementImport", "assessment", "devAssessment", "resourceCost"].includes(page)) {
    const saved = savePlannedGlobalPlanToMyEvaluations(true);
    if (saved) {
      createPlanGuideVisible.value = false;
      showTimedNotice("已自动保存总方案到我的评估");
    }
  }
  if (page === "userManagement" && user?.role === "admin") {
    void loadUserManagementUsers();
    void loadInviteCodes();
  }
  if (page === "devAssessment") {
    if (!Object.keys(devAssessmentDrafts.value).length) {
      loadDevAssessmentDraftsFromStorage();
    }
    if (currentDevAssessmentVersionCode.value) {
      onDevAssessmentDraftChange();
    }
  }
});

watch(selectedGlobalPlanVersionCode, (code) => {
  if (!code) return;
  selectedMyEvaluationVersionCode.value = code;
});

watch(planGuideProjectName, (name) => {
  if (!createPlanGuideVisible.value) return;
  const normalizedName = (name || "").trim();
  if ((dashboardBasicInfo.value.projectName || "") === normalizedName) return;
  dashboardBasicInfo.value = {
    ...dashboardBasicInfo.value,
    projectName: normalizedName
  };
});

watch(
  () => dashboardBasicInfo.value.projectName,
  (name) => {
    if (!createPlanGuideVisible.value) return;
    const normalizedName = (name || "").trim();
    if ((planGuideProjectName.value || "") === normalizedName) return;
    planGuideProjectName.value = normalizedName;
  }
);
</script>

<template>
  <div v-if="authBootstrapping" class="auth-gate">
    <div class="auth-card auth-card--loading">
      <h2 class="auth-title">正在校验登录状态</h2>
      <p class="auth-subtitle">请稍候...</p>
    </div>
  </div>

  <div v-else-if="!authUser" class="auth-gate">
    <form class="auth-card" @submit.prevent="onSubmitAuth">
      <h2 class="auth-title">{{ authRegisterMode ? "创建账号" : "账号登录" }}</h2>
      <p class="auth-subtitle">登录后可访问评估系统页面与 API 能力</p>
      <label class="auth-field">
        用户名
        <input v-model.trim="authForm.username" type="text" placeholder="请输入用户名" autocomplete="username" />
      </label>
      <label class="auth-field">
        密码
        <input v-model="authForm.password" type="password" placeholder="请输入密码（至少8位）" autocomplete="current-password" />
      </label>
      <label v-if="authRegisterMode" class="auth-field">
        推荐码
        <input v-model.trim="authForm.inviteCode" type="text" placeholder="请输入推荐码" autocomplete="off" />
      </label>
      <p v-if="authError" class="auth-error">{{ authError }}</p>
      <button type="submit" class="auth-submit" :disabled="authSubmitting">
        {{ authSubmitting ? "提交中..." : authRegisterMode ? "注册并登录" : "登录" }}
      </button>
      <button type="button" class="auth-switch" :disabled="authSubmitting" @click="authRegisterMode = !authRegisterMode">
        {{ authRegisterMode ? "已有账号，去登录" : "没有账号，去注册" }}
      </button>
    </form>
  </div>

  <div v-else class="dashboard-shell app">
    <aside class="sidebar" :class="{ 'is-collapsed': sidebarCollapsed }">
      <div class="sidebar-inner">
        <div class="brand">
          <div class="brand-icon">W</div>
          <span class="brand-text" :title="sidebarCollapsed ? 'WorkEvaluationsys' : ''">WorkEvaluationsys</span>
        </div>

        <nav class="nav">
          <a href="#" class="nav-item" :class="{ active: currentPage === 'dashboard' }" @click.prevent="currentPage = 'dashboard'">
            <span class="nav-icon">🏠</span>
            <span class="nav-text">主页</span>
          </a>
          <a href="#" class="nav-item" :class="{ active: currentPage === 'requirementImport' }" @click.prevent="currentPage = 'requirementImport'">
            <span class="nav-icon">📥</span>
            <span class="nav-text">需求导入</span>
          </a>
          <a href="#" class="nav-item" :class="{ active: currentPage === 'assessment' }" @click.prevent="currentPage = 'assessment'">
            <span class="nav-icon">👥</span>
            <span class="nav-text">实施评估</span>
          </a>
          <a href="#" class="nav-item" :class="{ active: currentPage === 'devAssessment' }" @click.prevent="currentPage = 'devAssessment'">
            <span class="nav-icon">🛠️</span>
            <span class="nav-text">开发评估</span>
          </a>
          <a href="#" class="nav-item" :class="{ active: currentPage === 'resourceCost' }" @click.prevent="currentPage = 'resourceCost'">
            <span class="nav-icon">📊</span>
            <span class="nav-text">资源人天及成本</span>
          </a>
          <a href="#" class="nav-item" :class="{ active: currentPage === 'wbs' }" @click.prevent="currentPage = 'wbs'">
            <span class="nav-icon">🧱</span>
            <span class="nav-text">WBS</span>
          </a>
          <a href="#" class="nav-item" :class="{ active: currentPage === 'review' }" @click.prevent="currentPage = 'review'">
            <span class="nav-icon">📝</span>
            <span class="nav-text">评审</span>
          </a>
          <a href="#" class="nav-item" :class="{ active: currentPage === 'userManagement' }" @click.prevent="currentPage = 'userManagement'">
            <span class="nav-icon">👤</span>
            <span class="nav-text">用户管理</span>
          </a>
          <a href="#" class="nav-item" :class="{ active: currentPage === 'apiKeys' }" @click.prevent="currentPage = 'apiKeys'">
            <span class="nav-icon">🔑</span>
            <span class="nav-text">API</span>
          </a>
          <a href="#" class="nav-item">
            <span class="nav-icon">📄</span>
            <span class="nav-text">Logs</span>
          </a>
          <a href="#" class="nav-item">
            <span class="nav-icon">⚙️</span>
            <span class="nav-text">Settings</span>
          </a>
        </nav>
      </div>

      <div class="sidebar-footer-tools">
        <button
          type="button"
          class="sidebar-toggle-btn"
          :aria-label="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          :title="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          @click="toggleSidebar"
        >
          <span class="sidebar-toggle-icon" aria-hidden="true">❮</span>
        </button>
      </div>

      <div class="profile">
        <img
          class="avatar"
          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=facearea&facepad=2&w=120&h=120&q=80"
          alt="profile"
        />
        <div class="profile-meta">
          <p class="profile-name">{{ authUser.username }}</p>
          <p class="profile-role">{{ authUser.role === "admin" ? "管理员" : "普通用户" }}</p>
        </div>
        <button type="button" class="mini-btn profile-logout-btn" @click="onLogout">退出</button>
      </div>
    </aside>

    <div class="content-wrap content">
      <header class="topbar">
        <div class="topbar-left">
          <h1 class="page-title title">
            {{
              currentPage === "dashboard"
                ? "总览"
                : currentPage === "requirementImport"
                  ? "需求导入"
                : currentPage === "assessment"
                  ? "评估工作台"
                  : currentPage === "devAssessment"
                    ? "开发评估"
                  : currentPage === "resourceCost"
                    ? "资源人天及成本"
                    : currentPage === "wbs"
                      ? "WBS"
                      : currentPage === "review"
                        ? "评审"
                        : currentPage === "userManagement"
                          ? "用户管理"
                        : "API 文档"
            }}
          </h1>
          <p class="subtitle">{{ pageSubtitle }}</p>
        </div>
        <span class="badge">{{ authUser.role === "admin" ? "管理员" : "普通用户" }} · {{ authUser.username }}</span>
      </header>

      <main
        class="main"
        :class="{
          'main--assessment': currentPage === 'assessment',
          'main--dashboard': currentPage === 'dashboard',
          'main--resource-cost': currentPage === 'resourceCost'
        }"
        @scroll.passive="onMainScroll"
      >
        <template v-if="currentPage === 'dashboard'">
          <section class="section">
          <div class="dashboard-my-evaluations-panel">
            <div class="dashboard-my-evaluations-head">
              <h3 class="dashboard-my-evaluations-title">评估方案列表</h3>
              <div class="dashboard-my-evaluations-actions">
                <button type="button" class="mini-btn mini-btn--primary" @click="openCreatePlanGuide">新建方案</button>
                <button
                  type="button"
                  class="mini-btn mini-btn--primary"
                  :disabled="!selectedMyEvaluationVersionCode"
                  @click="onPreviewMyEvaluationPlan"
                >
                  预览方案
                </button>
                <button
                  type="button"
                  class="mini-btn"
                  :disabled="!selectedMyEvaluationVersionCode"
                  @click="onDeleteMyEvaluationPlan"
                >
                  删除方案
                </button>
              </div>
            </div>
            <div class="resource-cost-table-wrap dashboard-my-evaluations-table-wrap">
              <table v-resizable-table="'dashboard-my-evaluations'" class="resource-cost-table dashboard-my-evaluations-table">
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>项目名称</th>
                    <th>总方案版本号</th>
                    <th>评估版本号</th>
                    <th>资源人天版本号</th>
                    <th>需求导入版本号</th>
                    <th>开发版本号</th>
                    <th>WBS版本号</th>
                    <th>评审版本号</th>
                    <th>创建时间</th>
                    <th>修改时间</th>
                    <th>审核时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in myEvaluationRows"
                    :key="`my-evaluation-${row.versionCode}`"
                    class="resource-row"
                    :class="{ 'is-selected': selectedMyEvaluationVersionCode === row.versionCode }"
                    @click="selectedMyEvaluationVersionCode = row.versionCode"
                    @dblclick="onPreviewMyEvaluationPlanByCode(row.versionCode)"
                  >
                    <td>{{ row.rowNo }}</td>
                    <td>{{ row.projectName }}</td>
                    <td>{{ row.versionCode }}</td>
                    <td>{{ row.assessmentVersionCode }}</td>
                    <td>{{ row.resourceVersionCode }}</td>
                    <td>{{ row.requirementImportVersionCode }}</td>
                    <td>{{ row.devAssessmentVersionCode }}</td>
                    <td>{{ row.wbsVersionCode }}</td>
                    <td>{{ row.reviewVersionCode }}</td>
                    <td>{{ row.createdAtText }}</td>
                    <td>{{ row.updatedAtText }}</td>
                    <td>{{ row.reviewedAtText }}</td>
                  </tr>
                  <tr v-if="myEvaluationRows.length === 0">
                    <td colspan="12" class="resource-empty">暂无已保存评估方案</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="planPreviewVisible" class="plan-preview-mask" @click.self="closePlanPreview">
            <div class="plan-preview-dialog">
              <div class="plan-preview-head">
                <h4>评估方案预览</h4>
                <div class="plan-preview-head-meta">
                  <span class="plan-preview-head-meta-item">
                    <span>项目名称</span>
                    <strong>{{ previewPlanDraft?.basicInfo?.projectName || "未命名项目" }}</strong>
                  </span>
                  <span class="plan-preview-head-meta-item">
                    <span>总方案版本号</span>
                    <strong>{{ previewPlanDraft?.versionCode || "—" }}</strong>
                  </span>
                </div>
                <button type="button" class="mini-btn" @click="closePlanPreview">关闭</button>
              </div>
              <div class="plan-preview-body">
                <section class="plan-preview-panel">
                  <h5 class="plan-preview-title">关联关系</h5>
                  <div class="plan-relation-map">
                    <div class="plan-relation-root">
                      <span class="plan-relation-label">总方案</span>
                      <button
                        v-if="previewPlanDraft?.versionCode"
                        type="button"
                        class="plan-relation-version-link"
                        @click="openRelationVersionWorkbench('global')"
                      >
                        {{ previewPlanDraft.versionCode }}
                      </button>
                      <span v-else class="plan-relation-version-fallback">—</span>
                    </div>
                    <div v-if="previewRelationNodes.length > 0" class="plan-relation-branches">
                      <div v-for="node in previewRelationNodes" :key="node.key" class="plan-relation-node">
                        <span class="plan-relation-arrow" aria-hidden="true">→</span>
                        <span class="plan-relation-label">{{ node.label }}</span>
                        <button
                          type="button"
                          class="plan-relation-version-link"
                          @click="openRelationVersionWorkbench(node.key)"
                        >
                          {{ node.value }}
                        </button>
                      </div>
                    </div>
                    <p v-else class="plan-relation-empty">当前方案尚未建立子版本关联</p>
                  </div>
                </section>

                <section class="plan-preview-panel">
                  <h5 class="plan-preview-title">基本分析</h5>
                  <div class="kpi-grid">
                    <article class="kpi-card dashboard-chart-card">
                      <div class="dashboard-chart-head">
                        <p class="kpi-label">模块构成</p>
                        <p class="dashboard-chart-sub">
                          {{ dashboardOverviewData.assignedModules }} / {{ dashboardOverviewData.totalModules }} 模块已分配
                        </p>
                      </div>
                      <div class="dashboard-chart-body">
                        <div class="resource-donut dashboard-donut" :style="{ background: pieStyle(dashboardOverviewData.moduleSlices) }"></div>
                        <ul class="chart-legend">
                          <li v-for="slice in dashboardOverviewData.moduleSlices" :key="slice.label" class="chart-legend-item">
                            <span class="chart-dot" :style="{ background: slice.color }"></span>
                            <span class="chart-label">{{ slice.label }}</span>
                            <span class="chart-value">{{ slice.value }} 模块（{{ slice.percent }}%）</span>
                          </li>
                          <li v-if="dashboardOverviewData.moduleSlices.length === 0" class="chart-empty">
                            {{ dashboardHasSelectedPlan ? "暂无模块数据" : "请先在“评估方案列表”中选择方案" }}
                          </li>
                        </ul>
                      </div>
                    </article>
                    <article class="kpi-card dashboard-chart-card">
                      <div class="dashboard-chart-head">
                        <p class="kpi-label">人天情况</p>
                        <p class="dashboard-chart-sub">
                          {{ formatStandardDays(dashboardOverviewData.assignedDays) }} / {{ formatStandardDays(dashboardOverviewData.totalDays) }}
                          人天已分配
                        </p>
                      </div>
                      <div class="dashboard-chart-body">
                        <div class="resource-donut dashboard-donut" :style="{ background: pieStyle(dashboardOverviewData.daySlices) }"></div>
                        <ul class="chart-legend">
                          <li v-for="slice in dashboardOverviewData.daySlices" :key="slice.label" class="chart-legend-item">
                            <span class="chart-dot" :style="{ background: slice.color }"></span>
                            <span class="chart-label">{{ slice.label }}</span>
                            <span class="chart-value">{{ formatStandardDays(slice.value) }} 人天（{{ slice.percent }}%）</span>
                          </li>
                          <li v-if="dashboardOverviewData.daySlices.length === 0" class="chart-empty">
                            {{ dashboardHasSelectedPlan ? "暂无人天数据" : "请先在“评估方案列表”中选择方案" }}
                          </li>
                        </ul>
                      </div>
                    </article>
                    <article class="kpi-card dashboard-chart-card">
                      <div class="dashboard-chart-head">
                        <p class="kpi-label">复杂度</p>
                        <p class="dashboard-chart-sub">
                          总人天：{{ formatStandardDays(dashboardOverviewData.complexityTotal) }}
                        </p>
                      </div>
                      <div class="dashboard-chart-body">
                        <div class="resource-donut dashboard-donut" :style="{ background: pieStyle(dashboardOverviewData.complexitySlices) }"></div>
                        <ul class="chart-legend">
                          <li v-for="slice in dashboardOverviewData.complexitySlices" :key="slice.label" class="chart-legend-item">
                            <span class="chart-dot" :style="{ background: slice.color }"></span>
                            <span class="chart-label">{{ slice.label }}</span>
                            <span class="chart-value">{{ formatStandardDays(slice.value) }} 人天（{{ slice.percent }}%）</span>
                          </li>
                          <li v-if="dashboardOverviewData.complexitySlices.length === 0" class="chart-empty">
                            {{ dashboardHasSelectedPlan ? "暂无复杂度数据" : "请先在“评估方案列表”中选择方案" }}
                          </li>
                        </ul>
                      </div>
                    </article>
                  </div>
                </section>

                <section class="plan-preview-panel">
                  <h5 class="plan-preview-title">关联评估摘要（双击空白处可展开/折叠）</h5>
                  <div class="plan-preview-blocks">
                    <article
                      class="plan-preview-block collapsible-hover-target"
                      :class="{ 'is-collapsed': !previewSectionExpanded.requirement }"
                      @mouseenter="scheduleCollapsibleHint('preview:requirement', $event)"
                      @mousemove="onCollapsibleMouseMove('preview:requirement', $event)"
                      @mouseleave="clearCollapsibleHover('preview:requirement')"
                      @dblclick="onCollapsibleBlankDblClick('preview:requirement', $event)"
                    >
                      <div class="plan-preview-block-head" :class="{ 'is-collapsed-row': !previewSectionExpanded.requirement }">
                        <strong>需求导入</strong>
                        <div v-if="!previewSectionExpanded.requirement" class="plan-preview-block-summary plan-preview-block-summary--inline">
                          <span>版本：<em class="plan-preview-key">{{ previewPlanDraft?.requirementImportVersionCode || "未关联" }}</em></span>
                          <span>项目：<em class="plan-preview-key">{{ previewPlanDraft?.basicInfo?.projectName || "—" }}</em></span>
                          <span>条目：<em class="plan-preview-key">{{ previewRequirementTotalRows }}</em></span>
                        </div>
                      </div>
                      <div v-if="previewSectionExpanded.requirement" class="plan-preview-block-summary">
                        <span>版本：{{ previewPlanDraft?.requirementImportVersionCode || "未关联" }}</span>
                        <span>项目：{{ previewPlanDraft?.basicInfo?.projectName || "—" }}</span>
                        <span>条目：{{ previewRequirementTotalRows }}</span>
                      </div>
                      <div v-if="previewSectionExpanded.requirement" class="plan-preview-block-detail">
                        <p>行业：{{ previewPlanDraft?.basicInfo?.industry || "—" }}</p>
                        <p>营收：{{ previewPlanDraft?.basicInfo?.revenue || "—" }}</p>
                        <p>客户主诉：{{ previewPlanDraft?.basicInfo?.customerPain || "—" }}</p>
                      </div>
                      <div
                        v-if="collapsibleHintVisible['preview:requirement']"
                        class="collapsible-hover-hint"
                        :style="collapsibleHintStyle('preview:requirement')"
                      >
                        双击空白处可{{ previewSectionExpanded.requirement ? "折叠" : "展开" }}
                      </div>
                    </article>

                    <article
                      class="plan-preview-block collapsible-hover-target"
                      :class="{ 'is-collapsed': !previewSectionExpanded.assessment }"
                      @mouseenter="scheduleCollapsibleHint('preview:assessment', $event)"
                      @mousemove="onCollapsibleMouseMove('preview:assessment', $event)"
                      @mouseleave="clearCollapsibleHover('preview:assessment')"
                      @dblclick="onCollapsibleBlankDblClick('preview:assessment', $event)"
                    >
                      <div class="plan-preview-block-head" :class="{ 'is-collapsed-row': !previewSectionExpanded.assessment }">
                        <strong>实施评估</strong>
                        <div v-if="!previewSectionExpanded.assessment" class="plan-preview-block-summary plan-preview-block-summary--inline">
                          <span>版本：<em class="plan-preview-key">{{ previewPlanDraft?.assessmentVersionCode || "未关联" }}</em></span>
                          <span>工作表：<em class="plan-preview-key">{{ previewAssessmentResolved?.sheetKey || "—" }}</em></span>
                          <span>已选SKU：<em class="plan-preview-key">{{ previewAssessmentSelectedCount }}</em></span>
                        </div>
                      </div>
                      <div v-if="previewSectionExpanded.assessment" class="plan-preview-block-summary">
                        <span>版本：{{ previewPlanDraft?.assessmentVersionCode || "未关联" }}</span>
                        <span>工作表：{{ previewAssessmentResolved?.sheetKey || "—" }}</span>
                        <span>已选SKU：{{ previewAssessmentSelectedCount }}</span>
                      </div>
                      <div v-if="previewSectionExpanded.assessment" class="plan-preview-block-detail">
                        <p>总人天：{{ formatStandardDays(dashboardOverviewData.totalDays) }}</p>
                        <p>已分配模块：{{ dashboardOverviewData.assignedModules }}</p>
                        <p>高复杂占比：{{ dashboardOverviewData.highComplexityRatio }}%</p>
                      </div>
                      <div
                        v-if="collapsibleHintVisible['preview:assessment']"
                        class="collapsible-hover-hint"
                        :style="collapsibleHintStyle('preview:assessment')"
                      >
                        双击空白处可{{ previewSectionExpanded.assessment ? "折叠" : "展开" }}
                      </div>
                    </article>

                    <article
                      class="plan-preview-block collapsible-hover-target"
                      :class="{ 'is-collapsed': !previewSectionExpanded.resource }"
                      @mouseenter="scheduleCollapsibleHint('preview:resource', $event)"
                      @mousemove="onCollapsibleMouseMove('preview:resource', $event)"
                      @mouseleave="clearCollapsibleHover('preview:resource')"
                      @dblclick="onCollapsibleBlankDblClick('preview:resource', $event)"
                    >
                      <div class="plan-preview-block-head" :class="{ 'is-collapsed-row': !previewSectionExpanded.resource }">
                        <strong>资源人天及成本</strong>
                        <div v-if="!previewSectionExpanded.resource" class="plan-preview-block-summary plan-preview-block-summary--inline">
                          <span>版本：<em class="plan-preview-key">{{ previewPlanDraft?.resourceVersionCode || "未关联" }}</em></span>
                          <span>行数：<em class="plan-preview-key">{{ previewResourceDraft?.rows?.length || 0 }}</em></span>
                          <span>投入：<em class="plan-preview-key">{{ formatStandardDays(previewResourcePlannedDays) }} 人天</em></span>
                        </div>
                      </div>
                      <div v-if="previewSectionExpanded.resource" class="plan-preview-block-summary">
                        <span>版本：{{ previewPlanDraft?.resourceVersionCode || "未关联" }}</span>
                        <span>行数：{{ previewResourceDraft?.rows?.length || 0 }}</span>
                        <span>投入：{{ formatStandardDays(previewResourcePlannedDays) }} 人天</span>
                      </div>
                      <div v-if="previewSectionExpanded.resource" class="plan-preview-block-detail">
                        <p>已分配人天：{{ formatStandardDays(dashboardOverviewData.assignedDays) }}</p>
                        <p>未分配人天：{{ formatStandardDays(Math.max(0, dashboardOverviewData.totalDays - dashboardOverviewData.assignedDays)) }}</p>
                        <p>差旅开关：{{ previewResourceDraft?.includeTravel ? "开启" : "关闭" }}</p>
                      </div>
                      <div
                        v-if="collapsibleHintVisible['preview:resource']"
                        class="collapsible-hover-hint"
                        :style="collapsibleHintStyle('preview:resource')"
                      >
                        双击空白处可{{ previewSectionExpanded.resource ? "折叠" : "展开" }}
                      </div>
                    </article>

                    <article
                      class="plan-preview-block collapsible-hover-target"
                      :class="{ 'is-collapsed': !previewSectionExpanded.dev }"
                      @mouseenter="scheduleCollapsibleHint('preview:dev', $event)"
                      @mousemove="onCollapsibleMouseMove('preview:dev', $event)"
                      @mouseleave="clearCollapsibleHover('preview:dev')"
                      @dblclick="onCollapsibleBlankDblClick('preview:dev', $event)"
                    >
                      <div class="plan-preview-block-head" :class="{ 'is-collapsed-row': !previewSectionExpanded.dev }">
                        <strong>开发评估</strong>
                        <div v-if="!previewSectionExpanded.dev" class="plan-preview-block-summary plan-preview-block-summary--inline">
                          <span>版本：<em class="plan-preview-key">{{ previewPlanDraft?.devAssessmentVersionCode || "未关联" }}</em></span>
                          <span>行数：<em class="plan-preview-key">{{ previewDevDraft?.rows?.length || 0 }}</em></span>
                          <span>总人天：<em class="plan-preview-key">{{ formatStandardDays(previewDevSummary.totalDays) }}</em></span>
                        </div>
                      </div>
                      <div v-if="previewSectionExpanded.dev" class="plan-preview-block-summary">
                        <span>版本：{{ previewPlanDraft?.devAssessmentVersionCode || "未关联" }}</span>
                        <span>行数：{{ previewDevDraft?.rows?.length || 0 }}</span>
                        <span>总人天：{{ formatStandardDays(previewDevSummary.totalDays) }}</span>
                      </div>
                      <div v-if="previewSectionExpanded.dev" class="plan-preview-block-detail">
                        <p>编码人天：{{ formatStandardDays(previewDevSummary.codingDays) }}</p>
                        <p>需求规划：{{ formatStandardDays(previewDevSummary.planningDays) }}</p>
                        <p>功能测试：{{ formatStandardDays(previewDevSummary.testingDays) }}</p>
                      </div>
                      <div
                        v-if="collapsibleHintVisible['preview:dev']"
                        class="collapsible-hover-hint"
                        :style="collapsibleHintStyle('preview:dev')"
                      >
                        双击空白处可{{ previewSectionExpanded.dev ? "折叠" : "展开" }}
                      </div>
                    </article>
                  </div>
                </section>
              </div>
            </div>
          </div>

          <div v-if="createPlanGuideVisible" class="plan-guide-mask" @click.self="closeCreatePlanGuide">
            <div class="plan-guide-dialog">
              <div class="plan-guide-head">
                <h4>新建方案向导</h4>
                <button type="button" class="mini-btn" @click="closeCreatePlanGuide">关闭</button>
              </div>
              <div class="plan-guide-body">
                <p class="plan-guide-version">
                  已生成总方案版本号：<strong>{{ plannedGlobalPlanVersionCode }}</strong>
                </p>
                <div class="plan-guide-form">
                  <label class="plan-guide-field">
                    <span class="plan-guide-field-title">项目名称<span class="plan-guide-required">*</span></span>
                    <input v-model.trim="planGuideProjectName" type="text" placeholder="请输入项目名称" />
                  </label>
                  <label class="plan-guide-field">
                    <span class="plan-guide-field-title">创建时间</span>
                    <input :value="planGuideCreatedAtText" type="text" readonly />
                  </label>
                </div>
                <p class="plan-guide-tip">请按以下流程完成评估（点击关键字可直接跳转）：</p>
                <div class="plan-guide-steps">
                  <button type="button" class="plan-guide-link" @click="goToPlanStep('requirementImport')">需求导入</button>
                  <span class="plan-guide-arrow" aria-hidden="true">→</span>
                  <button type="button" class="plan-guide-link" @click="goToPlanStep('assessment')">实施评估</button>
                  <span class="plan-guide-arrow" aria-hidden="true">→</span>
                  <button type="button" class="plan-guide-link" @click="goToPlanStep('devAssessment')">开发评估</button>
                  <span class="plan-guide-arrow" aria-hidden="true">→</span>
                  <button type="button" class="plan-guide-link" @click="goToPlanStep('resourceCost')">资源人天及成本</button>
                </div>
                <p class="plan-guide-tip">完成后回到【总览】并执行保存方案，将使用该版本号归档。</p>
              </div>
              <div class="plan-guide-foot">
                <button type="button" class="mini-btn" @click="closeCreatePlanGuide">稍后处理</button>
                <button type="button" class="mini-btn" @click="onSavePlannedGlobalPlan">保存方案</button>
                <button type="button" class="mini-btn mini-btn--primary" @click="goToPlanStep('requirementImport')">立即开始</button>
              </div>
            </div>
          </div>

        </section>
        </template>

        <template v-else-if="currentPage === 'requirementImport'">
          <section class="section">
            <div class="requirement-version-toolbar">
              <div class="global-plan-field global-plan-field--wide">
                <label for="requirement-global-plan-version">总方案版本号</label>
                <input
                  id="requirement-global-plan-version"
                  class="resource-version-value"
                  :value="activeGlobalPlanVersionCode"
                  type="text"
                  readonly
                  placeholder="请先新建方案或选择总方案"
                />
              </div>
              <div class="global-plan-field">
                <label for="requirement-import-version">需求导入版本号</label>
                <select
                  id="requirement-import-version"
                  class="resource-version-value"
                  v-model="currentRequirementImportVersionCode"
                  @change="onRequirementImportDraftChange"
                >
                  <option value="">请选择需求导入版本</option>
                  <option v-for="option in requirementImportDraftOptions" :key="option.versionCode" :value="option.versionCode">
                    {{ option.versionCode }}（{{ formatDateTime(option.updatedAt) }}）
                  </option>
                </select>
              </div>
              <div class="requirement-version-toolbar-actions">
                <button type="button" class="mini-btn mini-btn--primary" @click="onSaveRequirementImportDraft">保存</button>
                <span v-if="saveNotice" class="mode-save-notice">{{ saveNotice }}</span>
              </div>
            </div>
            <div
              v-if="!requirementBasicInfoExpanded"
              class="requirement-basic-collapsed collapsible-hover-target"
              @mouseenter="scheduleCollapsibleHint('requirementBasicInfo', $event)"
              @mousemove="onCollapsibleMouseMove('requirementBasicInfo', $event)"
              @mouseleave="clearCollapsibleHover('requirementBasicInfo')"
              @dblclick="onCollapsibleBlankDblClick('requirementBasicInfo', $event)"
            >
              <div class="requirement-basic-collapsed-summary">
                <strong class="requirement-basic-collapsed-kicker">基本情况</strong>
                <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                <span>项目名称 <span class="assessment-sticky-collapsed-stat">{{ dashboardBasicInfo.projectName || "未填写" }}</span></span>
                <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                <span>行业 <span class="assessment-sticky-collapsed-stat">{{ dashboardBasicInfo.customerIndustry || "未填写" }}</span></span>
                <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                <span>营收 <span class="assessment-sticky-collapsed-stat">{{ dashboardBasicInfo.enterpriseRevenue || "未填写" }}</span></span>
              </div>
              <div class="requirement-basic-collapsed-actions">
                <span v-if="saveNotice" class="mode-save-notice">{{ saveNotice }}</span>
              </div>
              <div
                v-if="collapsibleHintVisible.requirementBasicInfo"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('requirementBasicInfo')"
              >
                双击空白处可展开
              </div>
            </div>

            <div
              v-else
              class="dashboard-basic-info-panel collapsible-hover-target"
              @mouseenter="scheduleCollapsibleHint('requirementBasicInfo', $event)"
              @mousemove="onCollapsibleMouseMove('requirementBasicInfo', $event)"
              @mouseleave="clearCollapsibleHover('requirementBasicInfo')"
              @dblclick="onCollapsibleBlankDblClick('requirementBasicInfo', $event)"
            >
              <div class="dashboard-basic-info-head">
                <h3 class="dashboard-basic-info-title">基本情况</h3>
                <div class="dashboard-basic-info-actions">
                  <span class="dashboard-basic-info-tip">用于维护本次项目评估的背景信息</span>
                  <span v-if="saveNotice" class="mode-save-notice">{{ saveNotice }}</span>
                  <button
                    type="button"
                    class="mini-btn dashboard-basic-ai-btn"
                    :disabled="enterpriseProfileGenerating"
                    @click="onGenerateEnterpriseProfileByKimi"
                  >
                    {{ enterpriseProfileGenerating ? "生成中..." : "KIMI生成" }}
                  </button>
                  <button type="button" class="mini-btn" @click="openBasicInfoImportDialog">导入Excel解析</button>
                </div>
              </div>
              <div class="dashboard-basic-info-grid">
                <label class="dashboard-basic-field">
                  客户名称
                  <input v-model.trim="dashboardBasicInfo.customerName" type="text" placeholder="请输入客户名称" />
                </label>
                <label class="dashboard-basic-field">
                  项目名称
                  <input v-model.trim="dashboardBasicInfo.projectName" type="text" placeholder="请输入项目名称" />
                </label>
                <label class="dashboard-basic-field">
                  商机号
                  <input v-model.trim="dashboardBasicInfo.opportunityNo" type="text" placeholder="请输入商机号" />
                </label>
                <label class="dashboard-basic-field">
                  客户行业
                  <input v-model.trim="dashboardBasicInfo.customerIndustry" type="text" placeholder="请输入客户行业" />
                </label>
                <label class="dashboard-basic-field">
                  企业营收
                  <input v-model.trim="dashboardBasicInfo.enterpriseRevenue" type="text" placeholder="例如：50亿/年" />
                </label>
                <label class="dashboard-basic-field">
                  信息化现状
                  <input v-model.trim="dashboardBasicInfo.itStatus" type="text" placeholder="请输入信息化现状" />
                </label>
                <label class="dashboard-basic-field">
                  预期上线时间
                  <input v-model="dashboardBasicInfo.expectedGoLive" type="month" />
                </label>

                <label class="dashboard-basic-field dashboard-basic-field--full">
                  企业简介
                  <textarea
                    v-model.trim="dashboardBasicInfo.enterpriseProfile"
                    rows="2"
                    placeholder="请输入企业简介"
                  ></textarea>
                </label>
                <label class="dashboard-basic-field dashboard-basic-field--full">
                  项目背景和需求
                  <textarea
                    v-model.trim="dashboardBasicInfo.projectBackgroundNeeds"
                    rows="3"
                    placeholder="请输入项目背景和需求"
                  ></textarea>
                </label>
                <label class="dashboard-basic-field dashboard-basic-field--full">
                  项目目标
                  <textarea
                    v-model.trim="dashboardBasicInfo.projectGoals"
                    rows="2"
                    placeholder="请输入项目目标"
                  ></textarea>
                </label>
              </div>
              <div
                v-if="collapsibleHintVisible.requirementBasicInfo"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('requirementBasicInfo')"
              >
                双击空白处可折叠
              </div>
            </div>

            <article
              class="panel requirement-extended-panel collapsible-hover-target"
              @mouseenter="scheduleCollapsibleHint('requirement:valueProposition', $event)"
              @mousemove="onCollapsibleMouseMove('requirement:valueProposition', $event)"
              @mouseleave="clearCollapsibleHover('requirement:valueProposition')"
              @dblclick="onCollapsibleBlankDblClick('requirement:valueProposition', $event)"
            >
              <div class="section-head">
                <h3 class="section-title">价值主张</h3>
                <div class="resource-toolbar-actions">
                  <button type="button" class="mini-btn" @click="addRequirementValuePropositionRow">新增行</button>
                  <button type="button" class="mini-btn" :disabled="requirementValuePropositionRows.length <= 1" @click="removeRequirementValuePropositionRow">
                    删除末行
                  </button>
                </div>
              </div>
              <div v-if="isRequirementSectionExpanded('valueProposition')" class="resource-cost-table-wrap">
                <table v-resizable-table="'requirement-value-proposition'" class="resource-cost-table requirement-table">
                  <thead>
                    <tr>
                      <th>简要内容</th>
                      <th>具体内容（提炼）</th>
                      <th>访谈原始诉求</th>
                      <th>访谈提纲</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in requirementValuePropositionRows" :key="row.rowId">
                      <td><input v-model.trim="row.summary" class="resource-input" type="text" placeholder="如：满足数字化建设" /></td>
                      <td><textarea v-model.trim="row.refinedContent" class="resource-input resource-input--textarea" rows="2" placeholder="请输入提炼内容"></textarea></td>
                      <td><textarea v-model.trim="row.originalDemand" class="resource-input resource-input--textarea" rows="2" placeholder="请输入原始诉求"></textarea></td>
                      <td><textarea v-model.trim="row.interviewOutline" class="resource-input resource-input--textarea" rows="2" placeholder="请输入访谈提纲"></textarea></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="meta requirement-collapsed-tip">已折叠，可点击“展开”查看详情。</p>
              <div
                v-if="collapsibleHintVisible['requirement:valueProposition']"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('requirement:valueProposition')"
              >
                双击空白处可{{ isRequirementSectionExpanded("valueProposition") ? "折叠" : "展开" }}
              </div>
            </article>

            <article
              class="panel requirement-extended-panel collapsible-hover-target"
              @mouseenter="scheduleCollapsibleHint('requirement:businessNeeds', $event)"
              @mousemove="onCollapsibleMouseMove('requirement:businessNeeds', $event)"
              @mouseleave="clearCollapsibleHover('requirement:businessNeeds')"
              @dblclick="onCollapsibleBlankDblClick('requirement:businessNeeds', $event)"
            >
              <div class="section-head">
                <h3 class="section-title">业务需求及问题一览表</h3>
                <div class="resource-toolbar-actions">
                  <button type="button" class="mini-btn" @click="addRequirementBusinessNeedRow">新增行</button>
                  <button type="button" class="mini-btn" :disabled="requirementBusinessNeedRows.length <= 1" @click="removeRequirementBusinessNeedRow">
                    删除末行
                  </button>
                </div>
              </div>
              <div v-if="isRequirementSectionExpanded('businessNeeds')" class="resource-cost-table-wrap">
                <table v-resizable-table="'requirement-business-needs'" class="resource-cost-table requirement-table">
                  <thead>
                    <tr>
                      <th>业务领域</th>
                      <th>分类</th>
                      <th>业务需求及问题</th>
                      <th>提出人</th>
                      <th>职务</th>
                      <th>售前方案包含</th>
                      <th>标准产品是否实现</th>
                      <th>建议解决方案</th>
                      <th>是否需二次开发</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in requirementBusinessNeedRows" :key="row.rowId">
                      <td><input v-model.trim="row.businessDomain" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.category" class="resource-input" type="text" /></td>
                      <td><textarea v-model.trim="row.businessNeed" class="resource-input resource-input--textarea" rows="2"></textarea></td>
                      <td><input v-model.trim="row.proposer" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.title" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.preSalesIncluded" class="resource-input" type="text" placeholder="已包含/未包含" /></td>
                      <td><input v-model.trim="row.standardImplemented" class="resource-input" type="text" placeholder="已实现/未实现" /></td>
                      <td><textarea v-model.trim="row.solutionSuggestion" class="resource-input resource-input--textarea" rows="2"></textarea></td>
                      <td><input v-model.trim="row.requiresCustomDev" class="resource-input" type="text" placeholder="是/否" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="meta requirement-collapsed-tip">已折叠，可点击“展开”查看详情。</p>
              <div
                v-if="collapsibleHintVisible['requirement:businessNeeds']"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('requirement:businessNeeds')"
              >
                双击空白处可{{ isRequirementSectionExpanded("businessNeeds") ? "折叠" : "展开" }}
              </div>
            </article>

            <article
              class="panel requirement-extended-panel collapsible-hover-target"
              @mouseenter="scheduleCollapsibleHint('requirement:devOverview', $event)"
              @mousemove="onCollapsibleMouseMove('requirement:devOverview', $event)"
              @mouseleave="clearCollapsibleHover('requirement:devOverview')"
              @dblclick="onCollapsibleBlankDblClick('requirement:devOverview', $event)"
            >
              <div class="section-head">
                <h3 class="section-title">开发需求概要</h3>
                <div class="resource-toolbar-actions">
                  <button type="button" class="mini-btn" @click="addRequirementDevOverviewRow">新增行</button>
                  <button type="button" class="mini-btn" :disabled="requirementDevOverviewRows.length <= 1" @click="removeRequirementDevOverviewRow">
                    删除末行
                  </button>
                </div>
              </div>
              <div v-if="isRequirementSectionExpanded('devOverview')" class="resource-cost-table-wrap">
                <table v-resizable-table="'requirement-dev-overview'" class="resource-cost-table requirement-table">
                  <thead>
                    <tr>
                      <th>业务领域</th>
                      <th>模块名称</th>
                      <th>模块简述</th>
                      <th>功能说明</th>
                      <th>建议解决方案</th>
                      <th>基准编码人天</th>
                      <th>需求分析（20%）</th>
                      <th>系统测试（40%）</th>
                      <th>开发估算合计</th>
                      <th>估算依据</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in requirementDevOverviewRows" :key="row.rowId">
                      <td><input v-model.trim="row.businessDomain" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.moduleName" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.moduleBrief" class="resource-input" type="text" /></td>
                      <td><textarea v-model.trim="row.functionDesc" class="resource-input resource-input--textarea" rows="2"></textarea></td>
                      <td><input v-model.trim="row.solutionSuggestion" class="resource-input" type="text" /></td>
                      <td><input v-model.number="row.codingDays" class="resource-input resource-input--number" type="number" min="0" step="0.1" /></td>
                      <td class="is-number">{{ formatStandardDays(requirementDevAnalysisDays(row)) }}</td>
                      <td class="is-number">{{ formatStandardDays(requirementDevTestingDays(row)) }}</td>
                      <td class="is-number">{{ formatStandardDays(requirementDevTotalDays(row)) }}</td>
                      <td><textarea v-model.trim="row.estimateBasis" class="resource-input resource-input--textarea" rows="2"></textarea></td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colspan="5">合计</td>
                      <td class="is-number">{{ formatStandardDays(requirementDevOverviewSummary.codingDays) }}</td>
                      <td class="is-number">{{ formatStandardDays(requirementDevOverviewSummary.analysisDays) }}</td>
                      <td class="is-number">{{ formatStandardDays(requirementDevOverviewSummary.testingDays) }}</td>
                      <td class="is-number">{{ formatStandardDays(requirementDevOverviewSummary.totalDays) }}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p v-else class="meta requirement-collapsed-tip">已折叠，可点击“展开”查看详情。</p>
              <div
                v-if="collapsibleHintVisible['requirement:devOverview']"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('requirement:devOverview')"
              >
                双击空白处可{{ isRequirementSectionExpanded("devOverview") ? "折叠" : "展开" }}
              </div>
            </article>

            <article
              class="panel requirement-extended-panel collapsible-hover-target"
              @mouseenter="scheduleCollapsibleHint('requirement:productModule', $event)"
              @mousemove="onCollapsibleMouseMove('requirement:productModule', $event)"
              @mouseleave="clearCollapsibleHover('requirement:productModule')"
              @dblclick="onCollapsibleBlankDblClick('requirement:productModule', $event)"
            >
              <div class="section-head">
                <h3 class="section-title">产品及模块信息</h3>
                <div class="resource-toolbar-actions">
                  <button type="button" class="mini-btn" @click="addRequirementProductModuleRow">新增行</button>
                  <button type="button" class="mini-btn" :disabled="requirementProductModuleRows.length <= 1" @click="removeRequirementProductModuleRow">
                    删除末行
                  </button>
                </div>
              </div>
              <div v-if="isRequirementSectionExpanded('productModule')" class="resource-cost-table-wrap">
                <table v-resizable-table="'requirement-product-module'" class="resource-cost-table requirement-table">
                  <thead>
                    <tr>
                      <th>产品领域</th>
                      <th>模块</th>
                      <th>子模块</th>
                      <th>用户数</th>
                      <th>实施组织数</th>
                      <th>试点家数</th>
                      <th>乙方主导推广</th>
                      <th>甲方主导推广</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in requirementProductModuleRows" :key="row.rowId">
                      <td><input v-model.trim="row.productDomain" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.moduleName" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.subModule" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.userCount" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.implementationOrgCount" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.pilotOrgCount" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.partyBLead" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.partyALead" class="resource-input" type="text" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="meta requirement-collapsed-tip">已折叠，可点击“展开”查看详情。</p>
              <div
                v-if="collapsibleHintVisible['requirement:productModule']"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('requirement:productModule')"
              >
                双击空白处可{{ isRequirementSectionExpanded("productModule") ? "折叠" : "展开" }}
              </div>
            </article>

            <article
              class="panel requirement-extended-panel collapsible-hover-target"
              @mouseenter="scheduleCollapsibleHint('requirement:implementationScope', $event)"
              @mousemove="onCollapsibleMouseMove('requirement:implementationScope', $event)"
              @mouseleave="clearCollapsibleHover('requirement:implementationScope')"
              @dblclick="onCollapsibleBlankDblClick('requirement:implementationScope', $event)"
            >
              <div class="section-head">
                <h3 class="section-title">实施组织范围</h3>
                <div class="resource-toolbar-actions">
                  <button type="button" class="mini-btn" @click="addRequirementImplementationScopeRow">新增行</button>
                  <button type="button" class="mini-btn" :disabled="requirementImplementationScopeRows.length <= 1" @click="removeRequirementImplementationScopeRow">
                    删除末行
                  </button>
                </div>
              </div>
              <div v-if="isRequirementSectionExpanded('implementationScope')" class="resource-cost-table-wrap">
                <table v-resizable-table="'requirement-implementation-scope'" class="resource-cost-table requirement-table">
                  <thead>
                    <tr>
                      <th>公司名称</th>
                      <th>公司性质</th>
                      <th>实施模块范围说明</th>
                      <th>实施地点</th>
                      <th>实施/推广模式</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in requirementImplementationScopeRows" :key="row.rowId">
                      <td><input v-model.trim="row.companyName" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.companyType" class="resource-input" type="text" /></td>
                      <td><textarea v-model.trim="row.moduleScope" class="resource-input resource-input--textarea" rows="2"></textarea></td>
                      <td><input v-model.trim="row.location" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.implementationMode" class="resource-input" type="text" /></td>
                      <td><textarea v-model.trim="row.note" class="resource-input resource-input--textarea" rows="2"></textarea></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="meta requirement-collapsed-tip">已折叠，可点击“展开”查看详情。</p>
              <div
                v-if="collapsibleHintVisible['requirement:implementationScope']"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('requirement:implementationScope')"
              >
                双击空白处可{{ isRequirementSectionExpanded("implementationScope") ? "折叠" : "展开" }}
              </div>
            </article>

            <article
              class="panel requirement-extended-panel collapsible-hover-target"
              @mouseenter="scheduleCollapsibleHint('requirement:meetingNotes', $event)"
              @mousemove="onCollapsibleMouseMove('requirement:meetingNotes', $event)"
              @mouseleave="clearCollapsibleHover('requirement:meetingNotes')"
              @dblclick="onCollapsibleBlankDblClick('requirement:meetingNotes', $event)"
            >
              <div class="section-head">
                <h3 class="section-title">会议纪要或调研纪要</h3>
                <div class="resource-toolbar-actions">
                </div>
              </div>
              <textarea
                v-if="isRequirementSectionExpanded('meetingNotes')"
                v-model.trim="requirementMeetingNotes"
                class="resource-input resource-input--textarea requirement-note-textarea"
                rows="6"
                placeholder="请粘贴会议纪要、调研纪要或关键访谈记录"
              ></textarea>
              <p v-else class="meta requirement-collapsed-tip">已折叠，可点击“展开”查看详情。</p>
              <div
                v-if="collapsibleHintVisible['requirement:meetingNotes']"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('requirement:meetingNotes')"
              >
                双击空白处可{{ isRequirementSectionExpanded("meetingNotes") ? "折叠" : "展开" }}
              </div>
            </article>

            <article
              class="panel requirement-extended-panel collapsible-hover-target"
              @mouseenter="scheduleCollapsibleHint('requirement:keyPoints', $event)"
              @mousemove="onCollapsibleMouseMove('requirement:keyPoints', $event)"
              @mouseleave="clearCollapsibleHover('requirement:keyPoints')"
              @dblclick="onCollapsibleBlankDblClick('requirement:keyPoints', $event)"
            >
              <div class="section-head">
                <h3 class="section-title">需求、方案关键点（合同金额≥100万）</h3>
                <div class="resource-toolbar-actions">
                  <button type="button" class="mini-btn" @click="addRequirementKeyPointRow">新增行</button>
                  <button type="button" class="mini-btn" :disabled="requirementKeyPointRows.length <= 1" @click="removeRequirementKeyPointRow">
                    删除末行
                  </button>
                </div>
              </div>
              <div v-if="isRequirementSectionExpanded('keyPoints')" class="resource-cost-table-wrap">
                <table v-resizable-table="'requirement-key-points'" class="resource-cost-table requirement-table">
                  <thead>
                    <tr>
                      <th>分析项目</th>
                      <th>子项</th>
                      <th>明细内容</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in requirementKeyPointRows" :key="row.rowId">
                      <td><input v-model.trim="row.analysisCategory" class="resource-input" type="text" /></td>
                      <td><input v-model.trim="row.subItem" class="resource-input" type="text" /></td>
                      <td><textarea v-model.trim="row.detail" class="resource-input resource-input--textarea" rows="2"></textarea></td>
                      <td><textarea v-model.trim="row.note" class="resource-input resource-input--textarea" rows="2"></textarea></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="meta requirement-collapsed-tip">已折叠，可点击“展开”查看详情。</p>
              <div
                v-if="collapsibleHintVisible['requirement:keyPoints']"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('requirement:keyPoints')"
              >
                双击空白处可{{ isRequirementSectionExpanded("keyPoints") ? "折叠" : "展开" }}
              </div>
            </article>

            <div v-if="basicInfoImportVisible" class="basic-info-import-mask" @click.self="closeBasicInfoImportDialog">
              <div class="basic-info-import-dialog">
                <div class="basic-info-import-head">
                  <h4>导入Excel并解析基本情况</h4>
                  <button type="button" class="mini-btn" :disabled="basicInfoImporting" @click="closeBasicInfoImportDialog">
                    关闭
                  </button>
                </div>
                <div class="basic-info-import-body">
                  <label class="basic-info-import-field">
                    Excel 文件
                    <input type="file" accept=".xlsx,.xls" :disabled="basicInfoImporting" @change="onBasicInfoImportFileChange" />
                  </label>
                  <p class="basic-info-import-note">优先使用KIMI{{ basicInfoModelName }}模型，失败时自动规则回填</p>
                  <div v-if="basicInfoImporting" class="basic-info-import-loading" role="status" aria-live="polite">
                    <div class="basic-info-import-loading-row">
                      <span class="basic-info-spinner" aria-hidden="true"></span>
                      <span class="basic-info-loading-text">
                        正在解析中
                        <span class="basic-info-loading-dots" aria-hidden="true">
                          <i></i><i></i><i></i>
                        </span>
                      </span>
                    </div>
                    <div class="basic-info-loading-track" aria-hidden="true">
                      <span class="basic-info-loading-bar"></span>
                    </div>
                    <p class="basic-info-import-hint">已启动智能抽取，请稍候，完成后将自动回填内容。</p>
                  </div>
                  <p v-if="basicInfoImportError" class="error">{{ basicInfoImportError }}</p>
                </div>
                <div class="basic-info-import-foot">
                  <button type="button" class="mini-btn" :disabled="basicInfoImporting" @click="closeBasicInfoImportDialog">
                    取消
                  </button>
                  <button type="button" class="mini-btn mini-btn--primary" :disabled="basicInfoImporting" @click="onImportBasicInfoByExcel">
                    {{ basicInfoImporting ? "解析中..." : "开始解析并回填" }}
                  </button>
                </div>
              </div>
            </div>

            <div v-if="enterpriseProfilePreviewVisible" class="enterprise-profile-preview-mask" @click.self="closeEnterpriseProfilePreview">
              <div class="enterprise-profile-preview-dialog">
                <div class="enterprise-profile-preview-head">
                  <h4>KIMI 生成企业简介</h4>
                  <button type="button" class="mini-btn" @click="closeEnterpriseProfilePreview">关闭</button>
                </div>
                <div class="enterprise-profile-preview-body">
                  <p class="enterprise-profile-preview-tip">
                    已根据客户名称生成内容，请确认后再插入（模型：{{ basicInfoModelName }}）。
                  </p>
                  <div class="enterprise-profile-preview-fields">
                    <label>
                      客户行业（必填）
                      <input :value="enterpriseProfileGeneratedFields.customerIndustry" type="text" readonly />
                    </label>
                    <label>
                      企业应收/营收（必填）
                      <input :value="enterpriseProfileGeneratedFields.enterpriseRevenue" type="text" readonly />
                    </label>
                    <label>
                      信息化现状（必填）
                      <input :value="enterpriseProfileGeneratedFields.itStatus" type="text" readonly />
                    </label>
                  </div>
                  <textarea
                    v-model.trim="enterpriseProfileGeneratedText"
                    class="enterprise-profile-preview-textarea"
                    rows="6"
                    placeholder="暂无生成内容"
                  ></textarea>
                </div>
                <div class="enterprise-profile-preview-foot">
                  <button type="button" class="mini-btn" @click="closeEnterpriseProfilePreview">暂不插入</button>
                  <button type="button" class="mini-btn mini-btn--primary" @click="applyGeneratedEnterpriseProfile">插入并回填字段</button>
                </div>
              </div>
            </div>
          </section>
        </template>

        <template v-else-if="currentPage === 'assessment'">
          <!-- sticky 与长列表同属一节，父级足够高，吸顶才能在滚条目时持续生效 -->
          <section class="section assessment-workspace">
            <div
              class="assessment-sticky-shell assessment-grid--sticky collapsible-hover-target"
              :class="{ 'is-collapsed': !assessmentToolbarExpanded, 'is-auto-collapsed': assessmentAutoCollapsed }"
              :style="{ opacity: assessmentToolbarExpanded ? assessmentStickyOpacity : 1 }"
              @mouseenter="scheduleCollapsibleHint('assessmentToolbar', $event)"
              @mousemove="onCollapsibleMouseMove('assessmentToolbar', $event)"
              @mouseleave="clearCollapsibleHover('assessmentToolbar')"
              @dblclick="onCollapsibleBlankDblClick('assessmentToolbar', $event)"
            >
              <Transition name="sticky-toggle" mode="out-in">
                <div v-if="!assessmentToolbarExpanded" key="collapsed" class="assessment-sticky-collapsed-bar">
                  <div class="assessment-sticky-collapsed-summary">
                    <strong class="assessment-sticky-collapsed-kicker">参数与预览</strong>
                    <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                    <span class="assessment-sticky-collapsed-meta" :title="currentTemplateDisplay">
                      模板：{{ currentTemplateDisplay }}
                    </span>
                    <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                    <span>工作表 <span class="assessment-sticky-collapsed-stat">{{ selectedSheet || "—" }}</span></span>
                    <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                    <span>本表 <span class="assessment-sticky-collapsed-stat">{{ filteredItems.length }}</span> 条</span>
                    <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                    <span>勾选 <span class="assessment-sticky-collapsed-stat">{{ selectedCount }}</span></span>
                    <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                    <span>人天 <span class="assessment-sticky-collapsed-stat">{{ formatStandardDays(baseDays) }}</span></span>
                    <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                    <span>用户 <span class="assessment-sticky-collapsed-stat">{{ form.userCount }}</span></span>
                    <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                    <span>难度 <span class="assessment-sticky-collapsed-stat">{{ form.difficultyFactor }}</span></span>
                    <span class="assessment-sticky-collapsed-sep" aria-hidden="true">|</span>
                    <span>组织 <span class="assessment-sticky-collapsed-stat">{{ form.orgCount }}</span></span>
                  </div>
                </div>
                <div v-else key="expanded" class="assessment-sticky-expanded">
                  <div class="assessment-sticky-actions">
                    <h2 class="assessment-sticky-title">配置与实时预览</h2>
                  </div>
                  <div class="assessment-grid">
                    <article class="panel panel--config">
                      <div class="config-header">
                        <h2 class="section-title">参数配置</h2>
                        <div class="config-header-right">
                          <div class="config-version-badge config-version-badge--global" :class="{ 'is-empty': !activeGlobalPlanVersionCode }">
                            <span class="config-version-label">总方案版本号</span>
                            <input
                              class="config-version-input"
                              :value="activeGlobalPlanVersionCode || '未生成'"
                              type="text"
                              readonly
                            />
                          </div>
                          <div class="config-version-badge" :class="{ 'is-empty': !currentModeVersionCode }">
                            <span class="config-version-label">版本号</span>
                            <select
                              class="config-version-select"
                              :value="currentModeVersionCode"
                              :disabled="!resourceVersionOptions.length"
                              @change="onModeVersionChange"
                            >
                              <option value="" disabled>{{ resourceVersionOptions.length ? "请选择版本号" : "版本号未生成" }}</option>
                              <option v-for="option in resourceVersionOptions" :key="`config-version-${option.versionCode}`" :value="option.versionCode">
                                {{ option.versionCode }}（{{ option.sheetKey }}）
                              </option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <div class="field-grid">
                    <label>
                      模板
                      <select v-model="form.templateId" :disabled="initLoading" @change="onTemplateChange">
                        <option v-for="item in templateOptions" :key="item.templateId" :value="item.templateId">
                          金蝶AI星空-实施人天估算-R202602-V1.0（0303版本）.xlsx
                        </option>
                      </select>
                    </label>
                    <label>
                      规则集ID
                      <input v-model="form.ruleSetId" disabled />
                    </label>
                    <label>
                      用户数
                      <input v-model.number="form.userCount" type="number" min="0" />
                    </label>
                    <label>
                      难度系数
                      <input v-model.number="form.difficultyFactor" type="number" min="0" step="0.1" />
                    </label>
                    <label>
                      组织数
                      <input v-model.number="form.orgCount" type="number" min="1" />
                    </label>
                    <label>
                      组织相似度
                      <input v-model.number="form.orgSimilarityFactor" type="number" min="0" max="1" step="0.1" />
                    </label>
                      </div>
                    </article>

                    <article class="panel panel--preview">
                      <h2 class="section-title">实时预览</h2>
                      <div class="kpi-grid mini">
                        <article class="kpi-card">
                          <div>
                            <p class="kpi-label">当前工作表</p>
                            <p class="kpi-value">{{ selectedSheet }}</p>
                          </div>
                        </article>
                        <article class="kpi-card kpi-card--total-days">
                          <div>
                            <p class="kpi-label">总人天</p>
                            <p class="kpi-value">{{ formatStandardDays(realtimeBreakdown.total) }}</p>
                          </div>
                        </article>
                        <article class="kpi-card">
                          <div>
                            <p class="kpi-label">基础人天</p>
                            <p class="kpi-value">{{ baseDays }}</p>
                          </div>
                        </article>
                      </div>
                      <div class="realtime-charts">
                        <div class="chart-card">
                          <h3 class="chart-title">云产品工作量占比</h3>
                          <div class="chart-body">
                            <div class="pie" :style="{ background: cloudWorkloadPieStyle }"></div>
                            <ul class="chart-legend">
                              <li v-for="slice in cloudWorkloadSlices" :key="slice.label" class="chart-legend-item">
                                <span class="chart-dot" :style="{ background: slice.color }"></span>
                                <span class="chart-label">{{ slice.label }}</span>
                                <span class="chart-value">{{ formatStandardDays(slice.value) }} 人天（{{ slice.percent }}%）</span>
                              </li>
                              <li v-if="cloudWorkloadSlices.length === 0" class="chart-empty">暂无已选中云产品工作量</li>
                            </ul>
                          </div>
                        </div>
                        <div class="chart-card">
                          <h3 class="chart-title">人天构成占比</h3>
                          <div class="chart-body">
                            <div class="pie" :style="{ background: breakdownPieStyle }"></div>
                            <ul class="chart-legend">
                              <li v-for="slice in realtimeBreakdown.rows" :key="slice.label" class="chart-legend-item">
                                <span class="chart-dot" :style="{ background: slice.color }"></span>
                                <span class="chart-label">{{ slice.label }}</span>
                                <span class="chart-value">{{ formatStandardDays(slice.value) }} 人天（{{ slice.percent }}%）</span>
                              </li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </article>
                  </div>
                </div>
              </Transition>
              <div
                v-if="collapsibleHintVisible.assessmentToolbar"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('assessmentToolbar')"
              >
                双击空白处可{{ assessmentToolbarExpanded ? "折叠" : "展开" }}
              </div>
            </div>

            <div
              class="module-assessment-panel collapsible-hover-target"
              :class="{ 'is-collapsed': !moduleAssessmentPanelExpanded }"
              @mouseenter="scheduleCollapsibleHint('moduleAssessmentPanel', $event)"
              @mousemove="onCollapsibleMouseMove('moduleAssessmentPanel', $event)"
              @mouseleave="clearCollapsibleHover('moduleAssessmentPanel')"
              @dblclick="onCollapsibleBlankDblClick('moduleAssessmentPanel', $event)"
            >
              <div class="module-assessment-panel-head" :class="{ 'is-collapsed-row': !moduleAssessmentPanelExpanded }">
                <h2 class="module-assessment-panel-title">模块评估</h2>
                <div
                  v-show="moduleAssessmentPanelExpanded"
                  class="inline-controls module-assessment-toolbar"
                  role="toolbar"
                  aria-label="模块评估操作"
                >
                  <button class="mini-btn" @click="onManualSaveDraft">保存</button>
                  <button class="mini-btn" :disabled="exporting" @click="calculateAndExport('excel')">
                    {{ exporting ? "导出中..." : "导出Excel" }}
                  </button>
                  <button class="mini-btn" :disabled="exporting" @click="calculateAndExport('pdf')">
                    {{ exporting ? "导出中..." : "导出PDF" }}
                  </button>
                  <span v-if="saveNotice" class="mode-save-notice">{{ saveNotice }}</span>
                  <span v-if="currentModeSavedAt" class="mode-draft-hint">已保存：{{ formatDraftTime(currentModeSavedAt) }}</span>
                </div>
                <div
                  v-show="!moduleAssessmentPanelExpanded"
                  class="module-assessment-panel-collapsed-inline"
                  :title="moduleAssessmentCollapsedSummary"
                >
                  <span class="module-assessment-inline-value">{{ moduleAssessmentCollapsedSheetText }}</span>
                  <span class="module-assessment-inline-sep" aria-hidden="true">|</span>
                  <span class="module-assessment-inline-value">{{ moduleAssessmentCollapsedPresetText }}</span>
                  <span class="module-assessment-inline-sep" aria-hidden="true">|</span>
                  <span class="module-assessment-inline-value">{{ moduleAssessmentCollapsedCloudText }}</span>
                  <span class="module-assessment-inline-sep" aria-hidden="true">|</span>
                  <span class="module-assessment-inline-days">
                    共：<span class="module-assessment-inline-stat">{{ formatStandardDays(baseDays) }}</span> 人天
                  </span>
                </div>
              </div>

              <div v-show="moduleAssessmentPanelExpanded" class="module-assessment-panel-body">
              <div class="assessment-sheet-mode-card">
                <span class="assessment-sheet-mode-label">评估模式</span>
                <div class="sheet-tabs" role="tablist" aria-label="评估工作表">
                  <button
                    v-for="sheet in sheets"
                    :key="sheet"
                    type="button"
                    class="sheet-btn"
                    :class="{ active: selectedSheet === sheet }"
                    role="tab"
                    :aria-selected="selectedSheet === sheet"
                    @click="onSwitchSheet(sheet)"
                  >
                    {{ sheet }}
                  </button>
                </div>
              </div>
              <p v-if="error" class="error">{{ error }}</p>

            <div v-if="isModuleQuoteSheet" class="preset-modes-bar">
              <span class="preset-modes-label">预置选择模式</span>
              <div class="preset-modes-tags" role="group" aria-label="预置选择模式">
                <button
                  v-for="mode in presetModeOptions"
                  :key="mode"
                  type="button"
                  class="preset-mode-tag"
                  :class="{ active: selectedPresetMode === mode }"
                  :aria-pressed="selectedPresetMode === mode"
                  @click="selectPresetMode(mode)"
                >
                  {{ mode }}
                </button>
              </div>
            </div>

            <div
              v-if="hierarchy.length"
              class="cloud-tags-bar collapsible-hover-target"
              :class="{ 'is-collapsed': cloudTagsCollapsed }"
              @mouseenter.stop="scheduleCollapsibleHint('cloudTags', $event)"
              @mousemove.stop="onCollapsibleMouseMove('cloudTags', $event)"
              @mouseleave.stop="clearCollapsibleHover('cloudTags')"
              @dblclick.stop="onCollapsibleBlankDblClick('cloudTags', $event)"
            >
              <div class="cloud-tags-bar-head">
                <span class="cloud-tags-bar-label">云产品</span>
                <div class="cloud-tags" role="group" aria-label="云产品（可多选）">
                  <button
                    v-for="cloud in hierarchy"
                    :key="cloud.cloudName"
                    type="button"
                    class="cloud-tag"
                    :class="{ active: selectedCloudNameSet.has(cloud.cloudName) }"
                    :aria-pressed="selectedCloudNameSet.has(cloud.cloudName)"
                    @click="toggleCloudTag(cloud.cloudName)"
                  >
                    {{ cloud.cloudName }}
                  </button>
                </div>
              </div>
              <div v-if="!cloudTagsCollapsed" class="cloud-tags-bar-footer">
                <button
                  type="button"
                  class="mini-btn cloud-tags-sheet-bulk-btn"
                  :aria-label="cloudTagsSheetBulkShowsDeselect ? '全不选当前工作表条目' : '全选当前工作表条目'"
                  @click.stop="onCloudTagsSheetBulkClick"
                >
                  {{ cloudTagsSheetBulkShowsDeselect ? "全不选" : "全选" }}
                </button>
              </div>
              <div
                v-if="collapsibleHintVisible.cloudTags"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('cloudTags')"
              >
                双击空白处可{{ cloudTagsCollapsed ? "展开" : "折叠" }}
              </div>
            </div>

            <p v-if="hierarchy.length && visibleClouds.length === 0" class="cloud-panel-placeholder">请选择一个或多个云产品标签查看条目</p>

            <div v-if="visibleClouds.length" class="tree-grid">
              <article
                v-for="cloud in visibleClouds"
                :key="cloud.cloudName"
                :ref="(el) => setCloudCardRef(cloud.cloudName, el)"
                class="tree-card collapsible-hover-target"
                :class="{ 'tree-card--collapsed': !isCloudCardExpanded(cloud.cloudName) }"
                @mouseenter.stop="scheduleCollapsibleHint(`cloudCard:${cloud.cloudName}`, $event)"
                @mousemove.stop="onCollapsibleMouseMove(`cloudCard:${cloud.cloudName}`, $event)"
                @mouseleave.stop="clearCollapsibleHover(`cloudCard:${cloud.cloudName}`)"
                @dblclick.stop="onCollapsibleBlankDblClick(`cloudCard:${cloud.cloudName}`, $event)"
              >
                <Transition name="tree-head-switch" mode="out-in">
                  <div v-if="isCloudCardExpanded(cloud.cloudName)" :key="`${cloud.cloudName}-expanded`" class="tree-card-header">
                    <h3 class="tree-title">云产品：{{ cloud.cloudName }}</h3>
                    <div class="tree-card-header-actions">
                      <button type="button" class="mini-btn tree-card-toggle" @click="setCloudSelections(cloud, true)">全选</button>
                      <button type="button" class="mini-btn tree-card-toggle" @click="setCloudSelections(cloud, false)">全不选</button>
                      <button type="button" class="mini-btn tree-card-toggle" @click="clearCloudSelections(cloud)">清除</button>
                      <span class="tree-card-actions-sep" aria-hidden="true">|</span>
                      <button type="button" class="mini-btn tree-card-toggle" @click="toggleCustomMode">
                        {{ customModeEnabled ? "取消自定义" : "自定义" }}
                      </button>
                    </div>
                  </div>
                  <div v-else :key="`${cloud.cloudName}-collapsed`" class="tree-card-collapsed-row">
                    <div class="tree-card-summary">
                      <strong class="tree-card-summary-title">{{ cloud.cloudName }}</strong>
                      <span class="tree-card-summary-sep" aria-hidden="true">|</span>
                      <span v-if="isTableLayoutSheet" class="tree-card-summary-meta">
                        共 {{ cloudBasics(cloud).skuCount }} SKU / {{ cloudBasics(cloud).itemTotal }} 条
                      </span>
                      <span v-else class="tree-card-summary-meta">
                        共 {{ cloudBasics(cloud).skuCount }} SKU / {{ cloudBasics(cloud).groupCount }} 分组 / {{ cloudBasics(cloud).itemTotal }} 条
                      </span>
                      <span class="tree-card-summary-sep" aria-hidden="true">|</span>
                      <span class="tree-card-summary-item">
                        已选模块
                        <span class="tree-card-stat">{{ cloudPickStats(cloud).selectedModuleCount }}</span>
                      </span>
                      <span class="tree-card-summary-sep" aria-hidden="true">|</span>
                      <span class="tree-card-summary-item">
                        累计人天
                        <span class="tree-card-stat">{{ formatStandardDays(cloudPickStats(cloud).checkedPersonDays) }} 人天</span>
                      </span>
                      <span class="tree-card-summary-sep" aria-hidden="true">|</span>
                      <span class="tree-card-summary-item tree-card-summary-item--sku">
                        已选SKU
                        <span class="tree-card-summary-sku-text" :title="selectedSkuSummaryText(cloud)">
                          {{ selectedSkuSummaryText(cloud) }}
                        </span>
                      </span>
                    </div>
                  </div>
                </Transition>

                <Transition name="tree-expand">
                  <div v-show="isCloudCardExpanded(cloud.cloudName)" class="tree-card-body">
                  <div v-if="isTableLayoutSheet" class="tree-card-header-row tree-card-header-row--module">
                    <span class="tree-card-header-label">SKU</span>
                    <span class="tree-card-header-label tree-card-header-label--center">实施要点</span>
                    <span class="tree-card-header-label tree-card-header-label--center">评估说明</span>
                  </div>
                  <div
                    v-for="sku in cloud.skuList"
                    :key="`${cloud.cloudName}-${sku.skuName}`"
                    class="tree-level"
                    :class="{ 'tree-level--module': isTableLayoutSheet }"
                  >
                    <h4 class="tree-subtitle">{{ isTableLayoutSheet ? '' : 'SKU：' }}{{ sku.skuName }}</h4>
                    <template v-if="isTableLayoutSheet">
                      <div class="tree-level-items">
                        <div
                          v-for="item in flattenSkuItems(sku)"
                          :key="item.templateItemId"
                          class="tree-item tree-item--module tree-item--selectable"
                          :class="{ 'is-selected': itemSelection[item.templateItemId] }"
                          role="button"
                          tabindex="0"
                          :aria-pressed="itemSelection[item.templateItemId] ? 'true' : 'false'"
                          @click="toggleItemSelection(item.templateItemId)"
                          @keydown.enter.prevent="toggleItemSelection(item.templateItemId)"
                          @keydown.space.prevent="toggleItemSelection(item.templateItemId)"
                        >
                          <div class="tree-item-col tree-item-col--implementation">
                            <strong class="tree-item-content-label">{{ item.deliveryPoint || item.itemName }}</strong>
                            <span
                              v-if="
                                (item.deliveryModule || item.itemName) &&
                                (item.deliveryModule || item.itemName) !== (item.deliveryPoint || item.itemName)
                              "
                              class="tree-item-impl tree-item-impl--module"
                              :title="item.deliveryModule || item.itemName"
                            >
                              {{ item.deliveryModule || item.itemName }}
                            </span>
                          </div>
                          <div class="tree-item-col tree-item-col--evaluation">
                            <span v-if="item.evalDesc" class="tree-item-eval tree-item-eval--module" :title="item.evalDesc">
                              {{ item.evalDesc }}
                            </span>
                          </div>
                          <div class="tree-item-col tree-item-col--action">
                            <span class="item-badge item-badge--base">{{ formatStandardDays(item.standardDays) }} 人天</span>
                            <template v-if="customModeEnabled">
                              <span class="tree-item-custom-controls" @click.stop>
                                <button
                                  type="button"
                                  class="mini-btn custom-day-btn"
                                  :disabled="!itemSelection[item.templateItemId]"
                                  @click.stop="adjustCustomDays(item, 1)"
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  class="mini-btn custom-day-btn"
                                  :disabled="!itemSelection[item.templateItemId]"
                                  @click.stop="adjustCustomDays(item, -1)"
                                >
                                  -
                                </button>
                                <span class="item-badge item-badge--custom">{{ formatStandardDays(getEffectiveStandardDays(item)) }} 人天</span>
                              </span>
                            </template>
                          </div>
                        </div>
                      </div>
                    </template>
                    <template v-else>
                      <div
                        v-for="group in sku.groups"
                        :key="`${cloud.cloudName}-${sku.skuName}-${group.groupName}`"
                        class="tree-group"
                      >
                        <h5 class="tree-subtitle">应用分组：{{ group.groupName }}</h5>
                        <div
                          v-for="item in group.groupItems"
                          :key="item.templateItemId"
                          class="tree-item tree-item--selectable"
                          :class="{ 'is-selected': itemSelection[item.templateItemId] }"
                          role="button"
                          tabindex="0"
                          :aria-pressed="itemSelection[item.templateItemId] ? 'true' : 'false'"
                          @click="toggleItemSelection(item.templateItemId)"
                          @keydown.enter.prevent="toggleItemSelection(item.templateItemId)"
                          @keydown.space.prevent="toggleItemSelection(item.templateItemId)"
                        >
                          <span class="tree-item-left">
                            <span>
                              <strong>{{ item.deliveryModule || item.itemName }}</strong>
                              <small
                                v-if="
                                  (item.deliveryPoint || item.itemName) !==
                                  (item.deliveryModule || item.itemName)
                                "
                              >{{ item.deliveryPoint || item.itemName }}</small>
                              <span v-if="item.evalDesc" class="tree-item-eval" :title="item.evalDesc">
                                评估说明：{{ item.evalDesc }}
                              </span>
                            </span>
                          </span>
                          <span class="item-badge item-badge--base">{{ formatStandardDays(item.standardDays) }} 人天</span>
                          <template v-if="customModeEnabled">
                            <span class="tree-item-custom-controls" @click.stop>
                              <button
                                type="button"
                                class="mini-btn custom-day-btn"
                                :disabled="!itemSelection[item.templateItemId]"
                                @click.stop="adjustCustomDays(item, 1)"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                class="mini-btn custom-day-btn"
                                :disabled="!itemSelection[item.templateItemId]"
                                @click.stop="adjustCustomDays(item, -1)"
                              >
                                -
                              </button>
                              <span class="item-badge item-badge--custom">{{ formatStandardDays(getEffectiveStandardDays(item)) }} 人天</span>
                            </span>
                          </template>
                        </div>
                      </div>
                    </template>
                  </div>
                  </div>
                </Transition>
                <div
                  v-if="collapsibleHintVisible[`cloudCard:${cloud.cloudName}`]"
                  class="collapsible-hover-hint"
                  :style="collapsibleHintStyle(`cloudCard:${cloud.cloudName}`)"
                >
                  双击空白处可{{ isCloudCardExpanded(cloud.cloudName) ? "折叠" : "展开" }}
                </div>
              </article>
            </div>
              </div>
              <div
                v-if="collapsibleHintVisible.moduleAssessmentPanel"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('moduleAssessmentPanel')"
              >
                双击空白处可{{ moduleAssessmentPanelExpanded ? "折叠" : "展开" }}模块评估
              </div>
            </div>

            <div
              class="multi-org-estimation-panel collapsible-hover-target"
              :class="{ 'is-collapsed': !multiOrgPanelExpanded }"
              @mouseenter="scheduleCollapsibleHint('multiOrgPanel', $event)"
              @mousemove="onCollapsibleMouseMove('multiOrgPanel', $event)"
              @mouseleave="clearCollapsibleHover('multiOrgPanel')"
              @dblclick="onCollapsibleBlankDblClick('multiOrgPanel', $event)"
            >
              <div class="multi-org-estimation-head" :class="{ 'is-collapsed-row': !multiOrgPanelExpanded }">
                <h2 class="multi-org-estimation-title">多组织推广估算</h2>
                <div
                  v-show="multiOrgPanelExpanded"
                  class="inline-controls multi-org-estimation-toolbar"
                  role="toolbar"
                  aria-label="多组织推广估算操作"
                >
                  <button class="mini-btn" type="button" @click="addMultiOrgRow">新增组织</button>
                  <button class="mini-btn" type="button" @click="saveMultiOrgDraftForSheet(true)">保存</button>
                </div>
                <div
                  v-show="!multiOrgPanelExpanded"
                  class="multi-org-estimation-collapsed-summary"
                  :title="multiOrgCollapsedSummary"
                >
                  {{ multiOrgCollapsedSummary }}
                </div>
              </div>

              <div v-show="multiOrgPanelExpanded" class="multi-org-estimation-body">
                <div class="multi-org-table-wrap">
                  <table v-resizable-table="'multi-org-estimation'" class="multi-org-table">
                    <thead>
                      <tr>
                        <th>序号</th>
                        <th>组织名称</th>
                        <th>组织形态</th>
                        <th>实施地点</th>
                        <th>交付策略</th>
                        <th>用户数量</th>
                        <th v-for="scopeDef in multiOrgVisibleScopeDefs" :key="`multi-org-scope-head-${scopeDef.key}`">
                          {{ scopeDef.label }}
                        </th>
                        <th>其他业务</th>
                        <th>标准人天</th>
                        <th>难度系数</th>
                        <th>人天估算</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, idx) in multiOrgRows" :key="row.rowId">
                        <td class="multi-org-cell multi-org-cell--index">{{ idx + 1 }}</td>
                        <td class="multi-org-cell multi-org-cell--editor"><input v-model="row.orgName" type="text" placeholder="组织名称" /></td>
                        <td class="multi-org-cell multi-org-cell--editor">
                          <select v-model="row.orgType">
                            <option v-for="option in multiOrgOrgTypeOptions" :key="`org-type-${option}`" :value="option">{{ option }}</option>
                          </select>
                        </td>
                        <td class="multi-org-cell multi-org-cell--editor"><input v-model="row.location" type="text" placeholder="实施地点" /></td>
                        <td class="multi-org-cell multi-org-cell--editor">
                          <select v-model="row.deliveryStrategy" @change="onMultiOrgDeliveryStrategyChange(row)">
                            <option v-for="option in multiOrgDeliveryStrategyOptions" :key="`strategy-${option}`" :value="option">{{ option }}</option>
                          </select>
                        </td>
                        <td class="multi-org-cell multi-org-cell--editor"><input v-model.number="row.userCount" type="number" min="0" placeholder="用户数" /></td>
                        <td
                          v-for="scopeDef in multiOrgVisibleScopeDefs"
                          :key="`multi-org-scope-cell-${row.rowId}-${scopeDef.key}`"
                          class="multi-org-cell multi-org-cell--scope"
                        >
                          <input v-model="row.scope[scopeDef.key]" type="checkbox" />
                        </td>
                        <td class="multi-org-cell multi-org-cell--editor"><input v-model.number="row.otherBusinessDays" type="number" min="0" step="0.1" /></td>
                        <td class="multi-org-cell multi-org-cell--value">{{ formatStandardDays(calcMultiOrgStandardDays(row)) }}</td>
                        <td class="multi-org-cell multi-org-cell--editor"><input v-model.number="row.difficultyFactor" type="number" min="0" step="0.1" /></td>
                        <td class="multi-org-cell multi-org-cell--value">{{ formatStandardDays(calcMultiOrgEstimatedDays(row)) }}</td>
                        <td class="multi-org-cell multi-org-cell--action">
                          <button
                            class="mini-btn multi-org-delete-btn"
                            type="button"
                            :disabled="multiOrgRows.length <= 1"
                            @click="removeMultiOrgRow(row.rowId)"
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p class="multi-org-total-days">推广人天合计：{{ multiOrgTotalDays }} 人天</p>
              </div>

              <div
                v-if="collapsibleHintVisible.multiOrgPanel"
                class="collapsible-hover-hint"
                :style="collapsibleHintStyle('multiOrgPanel')"
              >
                双击空白处可{{ multiOrgPanelExpanded ? "折叠" : "展开" }}多组织推广估算
              </div>
            </div>

            <div class="assessment-grid" style="margin-top: 12px;">
              <article v-if="result" class="panel">
                <h2 class="section-title">计算结果</h2>
                <div class="kpi-grid mini">
                  <article class="kpi-card">
                    <div><p class="kpi-label">总人天</p><p class="kpi-value">{{ result.totalDays }}</p></div>
                  </article>
                  <article class="kpi-card">
                    <div><p class="kpi-label">基础人天</p><p class="kpi-value">{{ result.baseDays }}</p></div>
                  </article>
                  <article class="kpi-card">
                    <div><p class="kpi-label">用户增量</p><p class="kpi-value">{{ result.userIncrementDays }}</p></div>
                  </article>
                </div>
                <p class="meta">ruleVersion: {{ result.ruleVersion }} | pipelineVersion: {{ result.pipelineVersion }}</p>
              </article>

              <article class="panel">
                <h2 class="section-title">导出与历史</h2>
                <p v-if="exportInfo" class="meta">
                  最近导出：{{ exportInfo.totalDays }} 人天，
                  <a href="#" class="details-link" @click.prevent="onDownloadExportItem({ downloadUrl: exportInfo.downloadUrl, fileName: 'estimate' })">点击下载</a>
                </p>
                <ul class="history-list">
                  <li v-for="item in exportHistory" :key="item.fileName">
                    <a href="#" @click.prevent="onDownloadExportItem(item)">{{ item.fileName }}</a>
                    <span class="meta">{{ new Date(item.modifiedAt).toLocaleString() }}</span>
                  </li>
                </ul>
                <button v-if="hasMoreHistory" class="mini-btn" @click="loadExportHistory(false)">查看更多</button>
              </article>
            </div>
          </section>
        </template>
        <template v-else-if="currentPage === 'resourceCost'">
          <section class="section resource-cost-section">
            <article class="panel resource-cost-panel">
              <div class="resource-version-picker">
                <label for="resource-global-plan-version">总方案版本号</label>
                <input
                  id="resource-global-plan-version"
                  class="resource-version-value"
                  :value="activeGlobalPlanVersionCode"
                  type="text"
                  readonly
                  placeholder="请先新建方案或选择总方案"
                />
                <span class="resource-toolbar-sep" aria-hidden="true">|</span>
                <label for="resource-version-select">评估版本号</label>
                <select id="resource-version-select" v-model="selectedResourceVersionCode" @change="onResourceVersionChange">
                  <option value="">请选择已保存版本</option>
                  <option v-for="option in resourceVersionOptions" :key="option.versionCode" :value="option.versionCode">
                    {{ option.versionCode }}（{{ option.sheetKey }}，{{ formatDateTime(option.updatedAt) }}）
                  </option>
                </select>
                <span class="resource-toolbar-sep" aria-hidden="true">|</span>
                <label for="resource-draft-version">资源人天版本号</label>
                <select
                  id="resource-draft-version"
                  class="resource-version-value"
                  v-model="currentResourceVersionCode"
                  @change="onResourceDraftChange"
                >
                  <option value="">请选择已保存资源版本</option>
                  <option v-for="option in resourceDraftOptions" :key="option.versionCode" :value="option.versionCode">
                    {{ option.versionCode }}（评估：{{ option.selectedEstimateVersionCode || "未关联" }}，{{ formatDateTime(option.updatedAt) }}）
                  </option>
                </select>
                <button type="button" class="mini-btn" @click="onSaveResourceDraft">保存</button>
              </div>

              <div class="resource-chart-grid">
                <section class="resource-chart-block">
                  <h3 class="resource-chart-title">分配进度图</h3>
                  <div class="resource-chart-row">
                    <div class="resource-mini-chart">
                      <div v-if="resourceAllocationDaysSlices.length" class="resource-donut" :style="{ background: pieStyle(resourceAllocationDaysSlices) }">
                        <div class="resource-donut-center">
                          <strong>{{ formatStandardDays(resourceAssignedDays) }}</strong>
                          <span>/ {{ formatStandardDays(resourceUniverse.totalDays) }} 人天</span>
                        </div>
                      </div>
                      <div v-else class="resource-donut resource-donut--empty">暂无</div>
                      <div class="resource-chart-legend">
                        <p><span class="dot dot--violet"></span>已分配人天：{{ formatStandardDays(resourceAssignedDays) }}</p>
                        <p><span class="dot dot--gray"></span>未分配人天：{{ formatStandardDays(Math.max(0, resourceUniverse.totalDays - resourceAssignedDays)) }}</p>
                      </div>
                    </div>
                    <div class="resource-mini-chart">
                      <div v-if="resourceAllocationModuleSlices.length" class="resource-donut" :style="{ background: pieStyle(resourceAllocationModuleSlices) }">
                        <div class="resource-donut-center">
                          <strong>{{ resourceAssignedModules }}</strong>
                          <span>/ {{ resourceUniverse.totalModules }} 模块</span>
                        </div>
                      </div>
                      <div v-else class="resource-donut resource-donut--empty">暂无</div>
                      <div class="resource-chart-legend">
                        <p><span class="dot dot--blue"></span>已分配模块：{{ resourceAssignedModules }}</p>
                        <p><span class="dot dot--gray"></span>未分配模块：{{ Math.max(0, resourceUniverse.totalModules - resourceAssignedModules) }}</p>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="resource-chart-block">
                  <h3 class="resource-chart-title">成本结构图</h3>
                  <div class="resource-chart-row">
                    <div class="resource-mini-chart">
                      <div v-if="resourceCostTypeSlices.length" class="resource-donut" :style="{ background: pieStyle(resourceCostTypeSlices) }">
                        <div class="resource-donut-center">
                          <strong>{{ formatMoney(resourceCostTypeSlices.reduce((sum, x) => sum + x.value, 0)) }}</strong>
                          <span>总成本</span>
                        </div>
                      </div>
                      <div v-else class="resource-donut resource-donut--empty">暂无</div>
                      <div class="resource-chart-legend">
                        <p v-for="slice in resourceCostTypeSlices" :key="`type-${slice.label}`">
                          <span class="dot" :style="{ background: slice.color }"></span>{{ slice.label }}：{{ slice.percent }}%
                        </p>
                      </div>
                    </div>

                    <div class="resource-mini-chart">
                      <div
                        v-if="resourceRoleOuterSegments.length"
                        class="resource-nested-chart"
                        @mouseleave="resourceRoleHover = ''"
                      >
                        <svg viewBox="0 0 140 140" class="resource-nested-svg" role="img" aria-label="角色与顾问级别成本占比图">
                          <g transform="rotate(-90 70 70)">
                            <circle cx="70" cy="70" r="54" fill="none" stroke="#edf2f7" stroke-width="16" />
                            <circle cx="70" cy="70" r="34" fill="none" stroke="#f1f5f9" stroke-width="16" />
                            <circle
                              v-for="segment in resourceRoleOuterSegments"
                              :key="`outer-${segment.label}`"
                              cx="70"
                              cy="70"
                              r="54"
                              fill="none"
                              :stroke="segment.color"
                              stroke-width="16"
                              stroke-linecap="butt"
                              :stroke-dasharray="segment.dasharray"
                              :stroke-dashoffset="segment.dashoffset"
                              class="resource-segment"
                              @mouseenter="resourceRoleHover = segment.label"
                            />
                            <circle
                              v-for="segment in resourceLevelInnerSegments"
                              :key="`inner-${segment.label}`"
                              cx="70"
                              cy="70"
                              r="34"
                              fill="none"
                              :stroke="segment.color"
                              stroke-width="16"
                              stroke-linecap="butt"
                              :stroke-dasharray="segment.dasharray"
                              :stroke-dashoffset="segment.dashoffset"
                              class="resource-segment resource-segment--inner"
                            />
                          </g>
                          <circle cx="70" cy="70" r="22" fill="#fff" />
                          <text x="70" y="66" text-anchor="middle" class="nested-center-label">{{ resourceCompositeCenterLabel }}</text>
                          <text x="70" y="82" text-anchor="middle" class="nested-center-value">{{ formatMoney(resourceCompositeCenterValue) }}</text>
                        </svg>
                      </div>
                      <div v-else class="resource-donut resource-donut--empty">暂无</div>
                      <div class="resource-chart-legend">
                        <p v-for="slice in resourceRoleOuterSlices" :key="`role-${slice.label}`" @mouseenter="resourceRoleHover = slice.label">
                          <span class="dot" :style="{ background: slice.color }"></span>{{ slice.label }}：{{ slice.percent }}%
                        </p>
                        <p class="resource-legend-tip">悬停外环角色，可查看内环顾问级别占比</p>
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <div class="resource-toolbar">
                <button type="button" class="mini-btn" @click="addResourceRow">新增行</button>
                <button type="button" class="mini-btn" :disabled="!hasSelectedResourceRows" @click="deleteSelectedResourceRows">删除行</button>
                <span class="resource-toolbar-sep" aria-hidden="true">|</span>
                <button type="button" class="mini-btn" @click="addResourceMonth">增加投入月</button>
                <button type="button" class="mini-btn" :disabled="resourceMonthCount <= MIN_RESOURCE_MONTH_COUNT" @click="removeResourceMonth">
                  减少投入月
                </button>
                <span class="resource-toolbar-sep" aria-hidden="true">|</span>
                <button
                  type="button"
                  class="mini-btn resource-toolbar-travel-btn"
                  :class="{ 'is-active': resourceIncludeTravel }"
                  @click="toggleResourceIncludeTravel"
                >
                  {{ resourceIncludeTravel ? "不含差旅" : "含差旅" }}
                </button>
                <span class="resource-toolbar-meta">已选 {{ selectedResourceRowIds.length }} 行</span>
              </div>

              <div class="resource-cost-table-wrap">
                <table v-resizable-table="'resource-cost-main'" class="resource-cost-table">
                  <thead>
                    <tr>
                      <th rowspan="2">项目角色</th>
                      <th rowspan="2">人员类型</th>
                      <th rowspan="2">所属组织</th>
                      <th rowspan="2">姓名</th>
                      <th rowspan="2">顾问级别</th>
                      <th rowspan="2">交付产品</th>
                      <th rowspan="2">负责模块或任务</th>
                      <th rowspan="2">标准成本（人天单价）</th>
                      <th rowspan="2">预计投入人天</th>
                      <th rowspan="2">预计人天成本</th>
                      <th v-if="resourceIncludeTravel" colspan="2">交通费</th>
                      <th v-if="resourceIncludeTravel" colspan="2">住宿费</th>
                      <th v-if="resourceIncludeTravel" colspan="2">出差补贴</th>
                      <th rowspan="2">预计差旅费合计</th>
                      <th :colspan="resourceMonthColumns.length">项目分期及项目阶段（启动,需求,方案,构建,测试,上线,验收,运维）</th>
                    </tr>
                    <tr>
                      <template v-if="resourceIncludeTravel">
                        <th>次数</th>
                        <th>单价</th>
                        <th>天数</th>
                        <th>标准</th>
                        <th>天数</th>
                        <th>标准</th>
                      </template>
                      <th v-for="month in resourceMonthColumns" :key="month">{{ month }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in resourceCostRows"
                      :key="row.rowId"
                      :class="{ 'resource-row-selected': selectedResourceRowIds.includes(row.rowId) }"
                      class="resource-row"
                      @click="onResourceRowClick(row.rowId, $event)"
                    >
                      <td>
                        <select v-model="row.role" class="resource-input resource-input--select">
                          <option v-for="option in resourceRoleOptions" :key="option" :value="option">{{ option }}</option>
                        </select>
                      </td>
                      <td>
                        <select v-model="row.personType" class="resource-input resource-input--select resource-input--person-type">
                          <option v-for="option in resourcePersonTypeOptions" :key="option" :value="option">{{ option }}</option>
                        </select>
                      </td>
                      <td><input v-model.trim="row.orgName" class="resource-input" type="text" placeholder="如：广州分公司" /></td>
                      <td><input v-model.trim="row.name" class="resource-input resource-input--name" type="text" placeholder="姓名" /></td>
                      <td>
                        <select v-model="row.consultantLevel" class="resource-input resource-input--select">
                          <option v-for="option in resourceConsultantLevelOptions" :key="option" :value="option">{{ option }}</option>
                        </select>
                      </td>
                      <td><input v-model.trim="row.product" class="resource-input resource-input--product" type="text" /></td>
                      <td class="module-task-cell">
                        <div class="module-picker" @click.stop>
                          <button
                            type="button"
                            class="resource-input module-picker-trigger"
                            :title="moduleTaskDisplayValue(row) || '请选择负责模块'"
                            @click.stop="toggleResourceModulePicker(row.rowId)"
                          >
                            {{ moduleTaskDisplayValue(row) || "请选择负责模块" }}
                          </button>
                          <div v-if="resourceModulePickerRowId === row.rowId" class="module-picker-panel">
                            <p v-if="!selectedResourceVersionCode" class="module-picker-empty">请先选择版本号</p>
                            <p v-else-if="resourceVersionSkuGroups.length === 0" class="module-picker-empty">该版本暂无可选云产品/SKU</p>
                            <template v-else>
                              <div v-for="cloud in resourceVersionSkuGroupsForRow(row.rowId)" :key="cloud.cloudName" class="module-picker-cloud">
                                <div class="module-picker-cloud-head">
                                  <div class="module-picker-cloud-title">
                                    <span class="module-picker-cloud-name">{{ cloud.cloudName }}</span>
                                    <span class="module-picker-cloud-count">{{ cloudSelectedCount(row.rowId, cloud) }}/{{ cloud.skuNames.length }}</span>
                                  </div>
                                  <div class="module-picker-cloud-actions">
                                    <button type="button" class="module-chip module-chip--action" @click="onSelectCloudAll(row, cloud)">全选</button>
                                    <button type="button" class="module-chip module-chip--action" @click="onClearCloudSelection(row, cloud)">清空</button>
                                  </div>
                                </div>
                                <div class="module-picker-skus">
                                  <button
                                    v-for="skuName in cloud.skuNames"
                                    :key="`${cloud.cloudName}-${skuName}`"
                                    type="button"
                                    class="module-chip"
                                    :class="{ 'is-selected': isSkuChecked(row.rowId, cloud.cloudName, skuName) }"
                                    @click="onToggleSku(row, cloud.cloudName, skuName)"
                                  >
                                    {{ skuName }}
                                  </button>
                                </div>
                              </div>
                            </template>
                          </div>
                        </div>
                      </td>
                      <td><input v-model.number="row.unitCost" class="resource-input resource-input--number" type="number" min="0" step="1" /></td>
                      <td><input v-model.number="row.plannedDays" class="resource-input resource-input--number" type="number" min="0" step="0.1" /></td>
                      <td class="is-number">{{ formatMoney(resourceRowPlannedCost(row)) }}</td>
                      <template v-if="resourceIncludeTravel">
                        <td><input v-model.number="row.trafficCount" class="resource-input resource-input--number" type="number" min="0" step="1" /></td>
                        <td><input v-model.number="row.trafficUnitCost" class="resource-input resource-input--number" type="number" min="0" step="1" /></td>
                        <td><input v-model.number="row.stayDays" class="resource-input resource-input--number" type="number" min="0" step="1" /></td>
                        <td><input v-model.number="row.stayUnitCost" class="resource-input resource-input--number" type="number" min="0" step="1" /></td>
                        <td><input v-model.number="row.allowanceDays" class="resource-input resource-input--number" type="number" min="0" step="1" /></td>
                        <td><input v-model.number="row.allowanceUnitCost" class="resource-input resource-input--number" type="number" min="0" step="1" /></td>
                      </template>
                      <td class="is-number">{{ formatMoney(effectiveResourceRowTravelCost(row)) }}</td>
                      <td v-for="(_, mIdx) in resourceMonthColumns" :key="`${row.rowId}-${mIdx}`">
                        <input
                          v-model.number="row.monthDays[mIdx]"
                          class="resource-input resource-input--number"
                          type="number"
                          min="0"
                          step="0.1"
                        />
                      </td>
                    </tr>
                    <tr v-if="resourceCostRows.length === 0">
                      <td v-for="idx in resourceLeafColumnCount" :key="`resource-empty-${idx}`" class="resource-empty-cell">-</td>
                    </tr>
                  </tbody>
                  <tfoot v-if="resourceCostRows.length > 0">
                    <tr>
                      <td colspan="8">各项合计</td>
                      <td class="is-number">{{ formatStandardDays(resourceCostSummary.totalPlannedDays) }}</td>
                      <td class="is-number">{{ formatMoney(resourceCostSummary.totalPlannedCost) }}</td>
                      <td v-if="resourceIncludeTravel" colspan="6"></td>
                      <td class="is-number">{{ formatMoney(resourceCostSummary.totalTravelCost) }}</td>
                      <td v-for="(m, idx) in resourceCostSummary.monthTotals" :key="`sum-${idx}`" class="is-number">{{ formatStandardDays(m) }}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </article>
          </section>
        </template>
        <template v-else-if="currentPage === 'wbs'">
          <section class="section">
            <article class="panel">
              <h2 class="section-title">WBS 可视化（占位）</h2>
              <p class="meta">当前为占位页面，后续将接入实际 WBS 数据与联动规则。</p>
              <div class="wbs-review-grid">
                <section class="resource-chart-block">
                  <h3 class="resource-chart-title">工作包进度分布</h3>
                  <div class="resource-mini-chart">
                    <div class="resource-donut" :style="{ background: pieStyle(wbsProgressSlices) }"></div>
                    <div class="resource-chart-legend">
                      <p v-for="slice in wbsProgressSlices" :key="`wbs-p-${slice.label}`">
                        <span class="dot" :style="{ background: slice.color }"></span>{{ slice.label }}：{{ slice.value }}（{{ slice.percent }}%）
                      </p>
                    </div>
                  </div>
                </section>
                <section class="resource-chart-block">
                  <h3 class="resource-chart-title">阶段人天占比</h3>
                  <div class="resource-mini-chart">
                    <div class="resource-donut" :style="{ background: pieStyle(wbsEffortSlices) }"></div>
                    <div class="resource-chart-legend">
                      <p v-for="slice in wbsEffortSlices" :key="`wbs-e-${slice.label}`">
                        <span class="dot" :style="{ background: slice.color }"></span>{{ slice.label }}：{{ slice.value }}（{{ slice.percent }}%）
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </article>
          </section>
        </template>
        <template v-else-if="currentPage === 'review'">
          <section class="section">
            <article class="panel">
              <h2 class="section-title">评审可视化（占位）</h2>
              <p class="meta">当前为占位页面，后续将接入评审记录、意见闭环与版本追踪。</p>
              <div class="wbs-review-grid">
                <section class="resource-chart-block">
                  <h3 class="resource-chart-title">问题级别分布</h3>
                  <div class="resource-mini-chart">
                    <div class="resource-donut" :style="{ background: pieStyle(reviewIssueSlices) }"></div>
                    <div class="resource-chart-legend">
                      <p v-for="slice in reviewIssueSlices" :key="`review-i-${slice.label}`">
                        <span class="dot" :style="{ background: slice.color }"></span>{{ slice.label }}：{{ slice.value }}（{{ slice.percent }}%）
                      </p>
                    </div>
                  </div>
                </section>
                <section class="resource-chart-block">
                  <h3 class="resource-chart-title">评审状态分布</h3>
                  <div class="resource-mini-chart">
                    <div class="resource-donut" :style="{ background: pieStyle(reviewStatusSlices) }"></div>
                    <div class="resource-chart-legend">
                      <p v-for="slice in reviewStatusSlices" :key="`review-s-${slice.label}`">
                        <span class="dot" :style="{ background: slice.color }"></span>{{ slice.label }}：{{ slice.value }}（{{ slice.percent }}%）
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </article>
          </section>
        </template>
        <template v-else-if="currentPage === 'devAssessment'">
          <section class="section">
            <article class="panel dev-assessment-panel">
              <div class="section-head">
                <div class="dev-assessment-toolbar">
                  <div class="dev-assessment-toolbar-row">
                    <label class="dev-version-field">
                      总方案版本号
                      <input
                        :value="activeGlobalPlanVersionCode"
                        class="resource-version-value"
                        type="text"
                        readonly
                        placeholder="请先新建方案或选择总方案"
                      />
                    </label>
                    <label class="dev-version-field">
                      关联实施评估版本号
                      <select v-model="selectedDevAssessmentEstimateVersionCode" class="resource-version-value">
                        <option value="">不关联（可选模块报价全部SKU）</option>
                        <option v-for="option in resourceVersionOptions" :key="`dev-est-${option.versionCode}`" :value="option.versionCode">
                          {{ option.versionCode }}（{{ option.sheetKey }}）
                        </option>
                      </select>
                    </label>
                    <label class="dev-version-field">
                      开发评估版本号
                      <select v-model="currentDevAssessmentVersionCode" class="resource-version-value" @change="onDevAssessmentDraftChange">
                        <option value="">请选择开发评估版本</option>
                        <option v-for="option in devAssessmentDraftOptions" :key="option.versionCode" :value="option.versionCode">
                          {{ option.versionCode }}（{{ formatDateTime(option.updatedAt) }}）
                        </option>
                      </select>
                    </label>
                    <label class="dev-evaluator-field">
                      评估人
                      <input v-model.trim="devAssessmentEvaluator" type="text" class="resource-input" placeholder="请输入评估人" />
                    </label>
                  </div>
                  <div class="dev-assessment-toolbar-row dev-assessment-toolbar-row--actions">
                    <button type="button" class="mini-btn" @click="addDevAssessmentRow">新增行</button>
                    <button
                      type="button"
                      class="mini-btn"
                      :disabled="!hasSelectedDevAssessmentRows"
                      @click="deleteSelectedDevAssessmentRows"
                    >
                      删除行
                    </button>
                    <button type="button" class="mini-btn mini-btn--primary" @click="saveDevAssessmentDraft">保存</button>
                    <span class="resource-toolbar-meta">已选 {{ selectedDevAssessmentRowIds.length }} 行</span>
                  </div>
                </div>
              </div>
              <p class="meta">
                字段规则：需求规划 = 编码人天 * 20%，功能测试 = 编码人天 * 40%，合计 = 编码人天 + 需求规划 + 功能测试。
              </p>
              <div class="dev-assessment-kpis">
                <span>编码人天：<strong>{{ formatStandardDays(devAssessmentSummary.codingDays) }}</strong></span>
                <span>需求规划：<strong>{{ formatStandardDays(devAssessmentSummary.planningDays) }}</strong></span>
                <span>功能测试：<strong>{{ formatStandardDays(devAssessmentSummary.testingDays) }}</strong></span>
                <span>总合计：<strong>{{ formatStandardDays(devAssessmentSummary.totalDays) }}</strong></span>
              </div>

              <div class="resource-cost-table-wrap dev-assessment-table-wrap">
                <table v-resizable-table="'dev-assessment-main'" class="resource-cost-table dev-assessment-table">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>业务领域</th>
                      <th>模块名称</th>
                      <th>模块简述</th>
                      <th>功能说明（必填）</th>
                      <th>开发类型</th>
                      <th>估算依据（描述）</th>
                      <th>编码人天（基准）</th>
                      <th>需求规划（20%）</th>
                      <th>功能测试（40%）</th>
                      <th>合计</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(row, idx) in devAssessmentRows"
                      :key="row.rowId"
                      :class="{ 'resource-row-selected': selectedDevAssessmentRowIds.includes(row.rowId) }"
                      class="resource-row"
                      @click="onDevAssessmentRowClick(row.rowId, $event)"
                    >
                      <td class="is-number">{{ idx + 1 }}</td>
                      <td class="dev-business-domain-cell">
                        <div class="module-picker dev-module-picker" @click.stop>
                          <button
                            type="button"
                            class="module-picker-trigger module-picker-trigger--tags"
                            :class="{ 'is-empty': !devAssessmentBusinessDomainDisplayValue(row) }"
                            :title="devAssessmentBusinessDomainDisplayValue(row)"
                            @click.stop="toggleDevAssessmentModulePicker(row.rowId)"
                          >
                            <span v-if="devAssessmentSelectedSkuNames(row).length" class="module-picker-selected-tags">
                              <span
                                v-for="skuName in devAssessmentSelectedSkuPreviewNames(row)"
                                :key="`dev-selected-${row.rowId}-${skuName}`"
                                class="module-picker-selected-tag"
                              >
                                {{ skuName }}
                              </span>
                              <span v-if="devAssessmentSelectedSkuOverflowCount(row) > 0" class="module-picker-selected-tag module-picker-selected-tag--count">
                                +{{ devAssessmentSelectedSkuOverflowCount(row) }}
                              </span>
                            </span>
                            <span v-else class="module-picker-placeholder">请选择业务领域（SKU）</span>
                            <span class="module-picker-caret" aria-hidden="true">▾</span>
                          </button>
                          <div v-if="devAssessmentModulePickerRowId === row.rowId" class="module-picker-panel">
                            <p v-if="!selectedDevAssessmentEstimateVersionCode" class="module-picker-tip">当前未关联实施评估版本，展示“模块报价”下全部SKU</p>
                            <p v-if="devAssessmentSkuGroups.length === 0" class="module-picker-empty">暂无可选云产品/SKU</p>
                            <template v-else>
                              <div v-for="cloud in devAssessmentSkuGroups" :key="`dev-${cloud.cloudName}`" class="module-picker-cloud">
                                <div class="module-picker-cloud-head">
                                  <strong>{{ cloud.cloudName }}</strong>
                                  <div class="module-picker-actions">
                                    <button type="button" class="module-chip module-chip--action" @click="selectAllDevRowSkuInCloud(row, cloud)">全选</button>
                                    <button type="button" class="module-chip module-chip--action" @click="clearAllDevRowSkuInCloud(row, cloud)">清空</button>
                                  </div>
                                </div>
                                <div class="module-picker-chip-wrap">
                                  <button
                                    v-for="skuName in cloud.skuNames"
                                    :key="`dev-${cloud.cloudName}-${skuName}`"
                                    type="button"
                                    class="module-chip"
                                    :class="{ 'is-selected': isDevSkuChecked(row.rowId, cloud.cloudName, skuName) }"
                                    @click="toggleDevRowSku(row, cloud.cloudName, skuName)"
                                  >
                                    {{ skuName }}
                                  </button>
                                </div>
                              </div>
                            </template>
                          </div>
                        </div>
                      </td>
                      <td><input v-model.trim="row.moduleName" class="resource-input" type="text" placeholder="请输入模块名称" /></td>
                      <td><input v-model.trim="row.moduleBrief" class="resource-input" type="text" placeholder="请输入模块简述" /></td>
                      <td>
                        <textarea
                          v-model.trim="row.functionDesc"
                          class="resource-input resource-input--textarea"
                          rows="2"
                          placeholder="请输入功能说明"
                        ></textarea>
                      </td>
                      <td>
                        <select v-model="row.devType" class="resource-input">
                          <option v-for="type in devTypeOptions" :key="`dev-type-${type}`" :value="type">{{ type }}</option>
                        </select>
                      </td>
                      <td>
                        <textarea
                          v-model.trim="row.estimateBasis"
                          class="resource-input resource-input--textarea"
                          rows="2"
                          placeholder="请输入估算依据"
                        ></textarea>
                      </td>
                      <td><input v-model.number="row.codingDays" class="resource-input resource-input--number" type="number" min="0" step="0.1" /></td>
                      <td class="is-number">{{ formatStandardDays(devAssessmentPlanningDays(row)) }}</td>
                      <td class="is-number">{{ formatStandardDays(devAssessmentTestingDays(row)) }}</td>
                      <td class="is-number">{{ formatStandardDays(devAssessmentTotalDays(row)) }}</td>
                    </tr>
                    <tr v-if="devAssessmentRows.length === 0">
                      <td colspan="11" class="resource-empty-cell">暂无开发评估条目，请先新增</td>
                    </tr>
                  </tbody>
                  <tfoot v-if="devAssessmentRows.length > 0">
                    <tr>
                      <td colspan="7">总合计（自动汇总）</td>
                      <td class="is-number">{{ formatStandardDays(devAssessmentSummary.codingDays) }}</td>
                      <td class="is-number">{{ formatStandardDays(devAssessmentSummary.planningDays) }}</td>
                      <td class="is-number">{{ formatStandardDays(devAssessmentSummary.testingDays) }}</td>
                      <td class="is-number">{{ formatStandardDays(devAssessmentSummary.totalDays) }}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div class="dev-assessment-footer">
                <p class="meta">评估人：{{ devAssessmentEvaluator || "未填写" }}</p>
                <p class="meta">评估时间：{{ devAssessmentDate }}</p>
              </div>
            </article>
          </section>
        </template>
        <template v-else-if="currentPage === 'userManagement'">
          <section class="section">
            <article class="panel">
              <div class="section-head">
                <h2 class="section-title">系统用户管理</h2>
                <button v-if="authUser?.role === 'admin'" type="button" class="mini-btn" :disabled="userMgmtLoading" @click="loadUserManagementUsers">
                  {{ userMgmtLoading ? "刷新中..." : "刷新" }}
                </button>
              </div>
              <p class="meta">支持查看账号状态并启用/禁用用户（管理员权限）。</p>
              <p v-if="userMgmtError" class="error">{{ userMgmtError }}</p>

              <div v-if="authUser?.role !== 'admin'" class="user-mgmt-empty">
                当前账号非管理员，暂无权限访问该页面。
              </div>
              <div v-else class="resource-table-wrap user-mgmt-table-wrap">
                <table v-resizable-table="'user-management-main'" class="resource-table user-mgmt-table">
                  <thead>
                    <tr>
                      <th>用户名</th>
                      <th>角色</th>
                      <th>状态</th>
                      <th>创建时间</th>
                      <th>最近登录</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="user in userMgmtUsers" :key="user.id">
                      <td>{{ user.username }}</td>
                      <td>{{ user.role === "admin" ? "管理员" : "普通用户" }}</td>
                      <td>
                        <span class="user-status-tag" :class="{ 'is-disabled': user.status === 'disabled' }">
                          {{ user.status === "active" ? "启用中" : "已禁用" }}
                        </span>
                      </td>
                      <td>{{ formatDateTime(user.createdAt) }}</td>
                      <td>{{ formatDateTime(user.lastLoginAt) }}</td>
                      <td>
                        <button
                          type="button"
                          class="mini-btn"
                          :disabled="user.id === authUser?.id || userMgmtSubmittingUserId === user.id"
                          @click="onToggleUserStatus(user)"
                        >
                          {{
                            userMgmtSubmittingUserId === user.id
                              ? "处理中..."
                              : user.status === "active"
                                ? "禁用"
                                : "启用"
                          }}
                        </button>
                      </td>
                    </tr>
                    <tr v-if="!userMgmtLoading && userMgmtUsers.length === 0">
                      <td colspan="6" class="resource-empty-cell">暂无用户数据</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="authUser?.role === 'admin'" class="invite-panel">
                <div class="section-head invite-panel-head">
                  <h3 class="section-title invite-title">推荐码管理</h3>
                  <div class="invite-actions">
                    <button type="button" class="mini-btn" :disabled="inviteCodeLoading" @click="loadInviteCodes">
                      {{ inviteCodeLoading ? "刷新中..." : "刷新推荐码" }}
                    </button>
                    <button type="button" class="mini-btn mini-btn--primary" :disabled="inviteCodeGenerating" @click="onGenerateInviteCode">
                      {{ inviteCodeGenerating ? "生成中..." : "生成推荐码" }}
                    </button>
                  </div>
                </div>
                <p class="meta">每次点击“生成推荐码”会生成一个新码，且全局不重复；注册码默认单次使用。</p>
                <p v-if="inviteCodeError" class="error">{{ inviteCodeError }}</p>
                <div class="invite-filters">
                  <label class="invite-filter-field">
                    搜索
                    <input v-model.trim="inviteCodeKeyword" type="text" placeholder="按推荐码或使用人筛选" />
                  </label>
                  <label class="invite-filter-field">
                    状态
                    <select v-model="inviteCodeStatusFilter">
                      <option value="active">未使用（默认）</option>
                      <option value="used">已使用</option>
                      <option value="all">全部</option>
                    </select>
                  </label>
                </div>
                <div class="resource-table-wrap user-mgmt-table-wrap">
                  <table v-resizable-table="'user-management-invite'" class="resource-table invite-table">
                    <thead>
                      <tr>
                        <th>推荐码</th>
                        <th>状态</th>
                        <th>生成时间</th>
                        <th>使用时间</th>
                        <th>使用人</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="item in filteredInviteCodes" :key="item.code">
                        <td><code>{{ item.code }}</code></td>
                        <td>
                          <span class="user-status-tag" :class="{ 'is-disabled': item.status === 'used' }">
                            {{ item.status === "active" ? "未使用" : "已使用" }}
                          </span>
                        </td>
                        <td>{{ formatDateTime(item.createdAt) }}</td>
                        <td>{{ formatDateTime(item.usedAt || "") || "-" }}</td>
                        <td>{{ item.usedByUsername || "-" }}</td>
                        <td>
                          <button type="button" class="mini-btn" @click="onCopyInviteCode(item.code)">复制</button>
                        </td>
                      </tr>
                      <tr v-if="!inviteCodeLoading && filteredInviteCodes.length === 0">
                        <td colspan="6" class="resource-empty-cell">暂无匹配推荐码</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </article>
          </section>
        </template>
        <template v-else>
          <section class="section">
            <div class="section-head">
              <h2 class="section-title">API Keys / API 文档</h2>
            </div>
            <p class="meta" style="margin-bottom: 12px;">
              当前先展示系统可调用 API 文档，后续可在此扩展 Key 管理能力。
            </p>
            <div class="api-doc-grid">
              <article v-for="group in apiDocGroups" :key="group.title" class="panel api-doc-card">
                <h3 class="api-doc-title">{{ group.title }}</h3>
                <ul class="api-doc-list">
                  <li v-for="ep in group.endpoints" :key="ep"><code>{{ ep }}</code></li>
                </ul>
              </article>
            </div>
            <article class="panel" style="margin-top: 12px;">
              <h3 class="api-doc-title">调用约束</h3>
              <ul class="api-doc-list">
                <li><code>/auth/register</code> 需携带推荐码 <code>inviteCode</code>，且必须是后台已生成且未使用的合法推荐码</li>
                <li>除 <code>/health</code>、<code>/auth/register</code>、<code>/auth/login</code> 外，接口需携带 <code>Authorization: Bearer &lt;token&gt;</code></li>
                <li>导入类接口需 <code>admin</code> 角色，其它业务接口默认 <code>user/admin</code> 可访问</li>
                <li>导出接口支持 <code>Idempotency-Key</code> 幂等重放</li>
                <li>详情可参考 <code>docs/openapi.yaml</code> 与 <code>docs/LLM_API_CALLING_GUIDE.md</code></li>
              </ul>
            </article>
          </section>
        </template>
      </main>

      <div class="kimi-float-widget" :style="kimiFloatStyle">
        <button
          type="button"
          class="kimi-fab"
          :class="{ 'is-dragging': kimiFabDragging }"
          :title="kimiChatVisible ? '收起 KIMI' : '打开 KIMI'"
          :aria-label="kimiChatVisible ? '收起 KIMI' : '打开 KIMI'"
          @mousedown="onKimiFabMouseDown"
          @click="toggleKimiChatPanel"
        >
          <img class="kimi-fab-icon" :src="kimiLogoUrl" alt="KIMI" />
        </button>

        <div v-if="kimiChatVisible" class="kimi-chat-popover">
          <div class="kimi-chat-head">
            <strong>KIMI 助手</strong>
            <button type="button" class="mini-btn kimi-chat-close" @click="toggleKimiChatPanel">关闭</button>
          </div>
          <div ref="kimiChatBodyRef" class="kimi-chat-body">
            <div
              v-for="item in kimiChatMessages"
              :key="item.id"
              class="kimi-chat-msg"
              :class="item.role === 'user' ? 'is-user' : 'is-assistant'"
            >
              {{ item.content }}
            </div>
          </div>
          <div class="kimi-chat-foot">
            <textarea
              v-model.trim="kimiChatInput"
              class="kimi-chat-input"
              rows="2"
              placeholder="请输入问题，回车发送"
              @keydown.enter.exact.prevent="sendKimiChatMessage"
            ></textarea>
            <button type="button" class="mini-btn mini-btn--primary" :disabled="kimiChatSending || !kimiChatInput.trim()" @click="sendKimiChatMessage">
              {{ kimiChatSending ? "发送中..." : "发送" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>

<style scoped>
.auth-gate {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 20px;
  overflow: auto;
  background: linear-gradient(180deg, #f5f7ff 0%, #eef2ff 100%);
}

.auth-card {
  width: min(380px, 100%);
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(30, 41, 59, 0.08);
  padding: 18px 16px;
  display: grid;
  gap: 10px;
}

.auth-card--loading {
  text-align: center;
}

.auth-title {
  margin: 0;
  font-size: 20px;
  color: #111827;
}

.auth-subtitle {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
}

.auth-field {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: #374151;
}

.auth-field input {
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  padding: 8px 10px;
  font-size: 13px;
  color: #111827;
  background: #fff;
}

.auth-field input:focus {
  outline: none;
  border-color: #8b5cf6;
  box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.12);
}

.auth-submit,
.auth-switch {
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 9px 10px;
  font-size: 13px;
  cursor: pointer;
}

.auth-submit {
  color: #fff;
  background: #7c3aed;
}

.auth-submit:disabled,
.auth-switch:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.auth-switch {
  color: #6d28d9;
  background: #f5f3ff;
  border-color: #ddd6fe;
}

.auth-error {
  margin: 0;
  font-size: 12px;
  color: #b42318;
}

.dashboard-shell {
  min-height: 100vh;
  height: 100vh;
  max-height: 100vh;
  overflow: hidden;
  display: flex;
  background: #f8fafc;
  color: #111827;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  transition: width 220ms ease;
}

.sidebar.is-collapsed {
  width: 72px;
}

.sidebar-inner {
  padding: 16px 14px;
}

.brand {
  display: flex;
  align-items: center;
  margin-bottom: 24px;
}

.brand-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #7c3aed;
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 14px;
}

.brand-text {
  margin-left: 8px;
  font-weight: 600;
  font-size: 13px;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: opacity 180ms ease, width 180ms ease, margin 180ms ease;
}

.sidebar-toggle-btn {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid #ddd6fe;
  background: #faf5ff;
  color: #6d28d9;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 180ms ease, border-color 180ms ease, transform 180ms ease;
}

.sidebar-toggle-btn:hover {
  background: #f3e8ff;
  border-color: #c4b5fd;
}

.sidebar-toggle-icon {
  font-size: 12px;
  line-height: 1;
  transition: transform 220ms ease;
}

.sidebar-footer-tools {
  display: flex;
  justify-content: flex-end;
  padding: 0 14px 10px;
  transition: padding 180ms ease, justify-content 180ms ease;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: #4b5563;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  padding: 8px 8px;
  transition: padding 180ms ease, gap 180ms ease;
}

.nav-item:hover {
  background: #f9fafb;
}

.nav-item.active {
  background: #f5f3ff;
  color: #6d28d9;
}

.nav-icon {
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.nav-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: opacity 180ms ease, width 180ms ease;
}

.profile {
  border-top: 1px solid #e5e7eb;
  padding: 14px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: padding 180ms ease, justify-content 180ms ease;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  object-fit: cover;
}

.profile-name {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.profile-role {
  margin: 0;
  font-size: 12px;
  color: #9ca3af;
}

.profile-meta {
  min-width: 0;
  transition: opacity 180ms ease, width 180ms ease;
}

.profile-logout-btn {
  margin-left: auto;
  padding: 4px 8px;
  font-size: 12px;
}

.sidebar.is-collapsed .brand {
  margin-bottom: 16px;
}

.sidebar.is-collapsed .brand-text {
  opacity: 0;
  width: 0;
  margin-left: 0;
}

.sidebar.is-collapsed .sidebar-toggle-icon {
  transform: rotate(180deg);
}

.sidebar.is-collapsed .sidebar-inner {
  padding: 14px 10px;
}

.sidebar.is-collapsed .sidebar-footer-tools {
  justify-content: center;
  padding: 0 10px 8px;
}

.sidebar.is-collapsed .nav-item {
  justify-content: center;
  padding: 8px 6px;
  gap: 0;
}

.sidebar.is-collapsed .nav-text {
  opacity: 0;
  width: 0;
}

.sidebar.is-collapsed .profile {
  justify-content: center;
  padding: 12px 10px;
}

.sidebar.is-collapsed .profile-meta {
  opacity: 0;
  width: 0;
}

.sidebar.is-collapsed .profile-logout-btn {
  display: none;
}

.content-wrap {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  padding: 7px 20px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.page-title {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  color: #111827;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.link-btn {
  border: 0;
  background: transparent;
  color: #374151;
  font-size: 13px;
  cursor: pointer;
}

.link-btn:hover {
  color: #6d28d9;
}

.upgrade-btn {
  border: 0;
  border-radius: 8px;
  background: #7c3aed;
  color: #fff;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.upgrade-btn:hover {
  background: #6d28d9;
}

.main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px;
}

/* 评估页吸顶条紧贴顶栏，避免 main 上大 padding-top 在滚动时露出下方内容 */
.main--assessment {
  padding-top: 2px;
}

.main--dashboard {
  padding-top: 10px;
}

.main--resource-cost {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.section {
  margin-bottom: 30px;
  min-width: 0;
}

.resource-cost-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
  padding-bottom: 24px;
}

.module-assessment-panel {
  margin-top: 16px;
  padding: 16px;
  border-radius: 14px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.module-assessment-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  flex-wrap: wrap;
}

.module-assessment-panel-head.is-collapsed-row {
  flex-wrap: nowrap;
  gap: 10px;
}

.module-assessment-panel-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
  line-height: 1.3;
  flex-shrink: 0;
}

.module-assessment-panel-head .module-assessment-toolbar {
  justify-content: flex-end;
  flex: 1;
  min-width: 0;
}

.module-assessment-panel-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.module-assessment-panel.is-collapsed {
  gap: 0;
}

.module-assessment-panel-collapsed-inline {
  margin-left: 2px;
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #4b5563;
  line-height: 1.45;
  overflow: hidden;
  white-space: nowrap;
}

.module-assessment-inline-value {
  color: #6d28d9;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.module-assessment-inline-sep {
  color: #d1d5db;
  font-weight: 600;
  flex-shrink: 0;
}

.module-assessment-inline-days {
  color: #374151;
  flex-shrink: 0;
}

.module-assessment-inline-stat {
  color: #6d28d9;
  font-weight: 700;
}

.multi-org-estimation-panel {
  margin-top: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.multi-org-estimation-panel.is-collapsed {
  gap: 0;
}

.multi-org-estimation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  flex-wrap: wrap;
}

.multi-org-estimation-head.is-collapsed-row {
  flex-wrap: nowrap;
}

.multi-org-estimation-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #111827;
  flex-shrink: 0;
}

.multi-org-estimation-toolbar {
  justify-content: flex-end;
}

.multi-org-estimation-collapsed-summary {
  min-width: 0;
  flex: 1;
  color: #6d28d9;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.multi-org-estimation-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.multi-org-table-wrap {
  overflow-x: auto;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
}

.multi-org-table {
  width: 100%;
  min-width: 1520px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}

.multi-org-table th,
.multi-org-table td {
  border: 1px solid #e9edf5;
  text-align: center;
  vertical-align: middle;
  white-space: nowrap;
}

.multi-org-table thead th {
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
  height: 36px;
  padding: 6px 8px;
  position: sticky;
  top: 0;
  z-index: 1;
}

.multi-org-table th {
  position: relative;
}

.multi-org-table tbody td {
  height: 36px;
  padding: 0;
  color: #334155;
  background: #fff;
}

.multi-org-cell--editor > input[type="text"],
.multi-org-cell--editor > input[type="number"],
.multi-org-cell--editor > select {
  display: block;
  width: 100%;
  min-width: 0;
  height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 0 8px;
  font-size: 12px;
  color: #111827;
  box-sizing: border-box;
}

.multi-org-cell--editor > input[type="text"]:focus,
.multi-org-cell--editor > input[type="number"]:focus,
.multi-org-cell--editor > select:focus {
  outline: none;
  border: 0;
  box-shadow: none;
  background: rgba(99, 102, 241, 0.06);
}

.multi-org-cell--scope {
  padding: 0;
}

.multi-org-cell--scope > input[type="checkbox"] {
  width: 14px;
  height: 14px;
}

.multi-org-cell--value {
  font-weight: 600;
  color: #4b5563;
}

.multi-org-cell--action {
  padding: 0 6px;
}

.multi-org-delete-btn {
  width: 100%;
  min-width: 52px;
  height: 28px;
}

.table-resizable-enabled {
  table-layout: fixed;
}

.table-resizable-enabled th.table-resizable-th {
  position: relative;
}

.table-col-resize {
  position: absolute;
  top: 0;
  right: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
}

.table-col-resize::after {
  content: "";
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 3px;
  width: 1px;
  background: #dbe3ef;
  opacity: 0;
}

.table-resizable-enabled th.table-resizable-th:hover .table-col-resize::after {
  opacity: 1;
}

.multi-org-total-days {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #6d28d9;
}

.assessment-sheet-mode-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
}

.assessment-sheet-mode-label {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  flex-shrink: 0;
  white-space: nowrap;
  line-height: 1.25;
  padding-top: 7px;
}

.assessment-sheet-mode-card .sheet-tabs {
  margin-bottom: 0;
  flex: 1;
  min-width: 0;
}

.module-assessment-panel .preset-modes-bar,
.module-assessment-panel .cloud-tags-bar {
  margin-bottom: 0;
}

.module-assessment-panel .error {
  margin: 0;
}

.assessment-workspace {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.section-title {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.kpi-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  padding: 18px;
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.global-plan-toolbar {
  display: grid;
  grid-template-columns: repeat(3, minmax(220px, 1fr)) auto;
  gap: 10px 12px;
  align-items: end;
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
}

.global-plan-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.global-plan-field label {
  font-size: 12px;
  font-weight: 600;
  color: #374151;
}

.global-plan-field--wide {
  min-width: 260px;
}

.global-plan-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-self: end;
}

.requirement-version-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
}

.requirement-version-toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dashboard-chart-card {
  flex-direction: column;
  gap: 8px;
  padding: 14px;
}

.dashboard-analysis-panel {
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #f8fafc;
  padding: 10px;
}

.collapsible-hover-target {
  position: relative;
  transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
  will-change: transform;
}

.collapsible-hover-target.collapsible-dblclick-anim {
  animation: collapsible-dblclick-pop 300ms ease;
}

@keyframes collapsible-dblclick-pop {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(124, 58, 237, 0);
  }
  45% {
    transform: scale(0.9965);
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.14);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(124, 58, 237, 0);
  }
}

.collapsible-hover-hint {
  position: fixed;
  z-index: 6;
  pointer-events: none;
  max-width: 320px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.2;
  color: #1e3a8a;
  background: rgba(239, 246, 255, 0.95);
  border: 1px solid #bfdbfe;
  box-shadow: 0 6px 18px rgba(30, 58, 138, 0.12);
  animation: collapsible-hint-fade-in 180ms ease-out;
}

@keyframes collapsible-hint-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dashboard-analysis-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.dashboard-analysis-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.dashboard-analysis-toggle {
  padding: 4px 8px;
  font-size: 11px;
}

.plan-preview-mask {
  position: fixed;
  inset: 0;
  z-index: 14;
  padding: 72px 18px 20px;
  background: rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(1px);
}

.plan-preview-dialog {
  width: min(1180px, 100%);
  height: min(700px, 100%);
  margin: 0 auto;
  border-radius: 14px;
  border: 1px solid #dbe3f0;
  background: #f8fbff;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.plan-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
}

.plan-preview-head h4 {
  margin: 0;
  font-size: 15px;
  color: #1f2937;
}

.plan-preview-head-meta {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #475569;
}

.plan-preview-head-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.plan-preview-head-meta strong {
  color: #0f172a;
}

.plan-preview-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: grid;
  gap: 12px;
}

.plan-preview-panel {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  padding: 10px;
}

.plan-preview-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.plan-relation-map {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.plan-relation-root,
.plan-relation-node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #dbeafe;
  background: #f0f7ff;
  font-size: 12px;
  color: #1e3a8a;
}

.plan-relation-version-link {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-weight: 700;
  font-size: 12px;
  color: #2563eb;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.plan-relation-version-link:hover {
  color: #1d4ed8;
}

.plan-relation-version-fallback {
  font-weight: 700;
  color: #0f172a;
}

.plan-relation-branches {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.plan-relation-label {
  color: #334155;
}

.plan-relation-arrow {
  color: #64748b;
}

.plan-relation-empty {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
}

.plan-preview-blocks {
  display: grid;
  gap: 10px;
}

.plan-preview-block {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
  padding: 10px;
}

.plan-preview-block-head {
  margin-bottom: 6px;
  font-size: 13px;
  color: #1f2937;
}

.plan-preview-block-head.is-collapsed-row {
  margin-bottom: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.plan-preview-block-summary {
  display: flex;
  align-items: center;
  gap: 10px 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #475569;
}

.plan-preview-block-summary--inline {
  min-width: 0;
  flex: 1;
  flex-wrap: nowrap;
  overflow: hidden;
  gap: 8px 10px;
}

.plan-preview-block-summary--inline > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-preview-key {
  color: #6d28d9;
  font-style: normal;
  font-weight: 600;
}

.plan-preview-block-detail {
  margin-top: 8px;
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: #334155;
}

.plan-preview-block-detail p {
  margin: 0;
}

.dashboard-my-evaluations-panel {
  margin-top: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #ffffff;
  padding: 12px;
}

.dashboard-my-evaluations-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.dashboard-my-evaluations-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.dashboard-my-evaluations-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dashboard-my-evaluations-table-wrap {
  max-height: 320px;
}

.dashboard-my-evaluations-table th:nth-child(1),
.dashboard-my-evaluations-table td:nth-child(1) {
  min-width: 48px;
  width: 1%;
  text-align: center;
}

.dashboard-my-evaluations-table th:nth-child(2),
.dashboard-my-evaluations-table td:nth-child(2) {
  min-width: 140px;
}

.dashboard-my-evaluations-table tbody tr.is-selected td {
  background: #eef2ff;
}

.plan-guide-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(15, 23, 42, 0.38);
  display: grid;
  place-items: center;
  padding: 16px;
}

.plan-guide-dialog {
  width: min(760px, 100%);
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.2);
  overflow: hidden;
}

.plan-guide-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #eef2f7;
}

.plan-guide-head h4 {
  margin: 0;
  font-size: 14px;
  color: #0f172a;
}

.plan-guide-body {
  padding: 12px;
  display: grid;
  gap: 8px;
}

.plan-guide-version {
  margin: 0;
  font-size: 13px;
  color: #111827;
}

.plan-guide-version strong {
  color: #6d28d9;
}

.plan-guide-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.plan-guide-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #374151;
  min-width: 0;
}

.plan-guide-field-title {
  display: inline-flex;
  align-items: center;
  line-height: 18px;
  min-height: 18px;
}

.plan-guide-field input {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #111827;
  background: #fff;
  width: 100%;
  box-sizing: border-box;
}

.plan-guide-field input[readonly] {
  color: #64748b;
  background: #f8fafc;
}

.plan-guide-required {
  color: #dc2626;
  margin-left: 2px;
}

.plan-guide-tip {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}

.plan-guide-steps {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 10px;
  border: 1px dashed #ddd6fe;
  border-radius: 10px;
  background: #faf5ff;
}

.plan-guide-link {
  border: 0;
  background: transparent;
  color: #5b21b6;
  font-size: 13px;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
}

.plan-guide-link:hover {
  color: #7c3aed;
}

.plan-guide-arrow {
  color: #94a3b8;
}

.plan-guide-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px 12px;
}

.dashboard-basic-info-panel {
  margin-top: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #ffffff;
  padding: 12px;
}

.requirement-extended-panel {
  margin-top: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #ffffff;
  padding: 12px;
}

.requirement-table {
  width: max-content;
  min-width: 100%;
}

.requirement-note-textarea {
  width: 100%;
  min-height: 140px;
}

.requirement-toggle-btn {
  min-width: 48px;
}

.requirement-collapsed-tip {
  margin: 2px 0 0;
}

.requirement-basic-collapsed {
  margin-top: 12px;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  background: linear-gradient(135deg, #f8fbff 0%, #eff6ff 100%);
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.08);
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.requirement-basic-collapsed-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
}

.requirement-basic-collapsed-kicker {
  font-size: 12px;
  color: #1d4ed8;
}

.requirement-basic-collapsed-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dashboard-basic-info-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.dashboard-basic-info-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dashboard-basic-info-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.dashboard-basic-info-tip {
  font-size: 11px;
  color: #64748b;
  white-space: nowrap;
}

.dashboard-basic-info-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 10px;
}

.dashboard-basic-field {
  gap: 4px;
  font-size: 12px;
}

.dashboard-basic-ai-btn {
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.4;
}

.kimi-float-widget {
  position: fixed;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.kimi-fab {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 50%;
  cursor: grab;
  background: #05090f;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.38);
  display: grid;
  place-items: center;
  padding: 0;
  overflow: hidden;
}

.kimi-fab.is-dragging {
  cursor: grabbing;
}

.kimi-fab-icon {
  width: 88%;
  height: 88%;
  object-fit: contain;
  image-rendering: -webkit-optimize-contrast;
  filter: contrast(1.08) saturate(1.05);
  user-select: none;
  pointer-events: none;
}

.kimi-chat-popover {
  width: min(320px, calc(100vw - 24px));
  border: 1px solid #ddd6fe;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.2);
  overflow: hidden;
}

.kimi-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #ede9fe;
  background: #faf5ff;
  color: #4c1d95;
  font-size: 12px;
}

.kimi-chat-close {
  padding: 2px 8px;
  font-size: 11px;
}

.kimi-chat-body {
  max-height: 240px;
  min-height: 120px;
  overflow: auto;
  padding: 8px;
  display: grid;
  gap: 6px;
  background: #fcfcff;
}

.kimi-chat-msg {
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.kimi-chat-msg.is-user {
  background: #ede9fe;
  color: #4c1d95;
  justify-self: end;
}

.kimi-chat-msg.is-assistant {
  background: #f3f4f6;
  color: #1f2937;
  justify-self: start;
}

.kimi-chat-foot {
  border-top: 1px solid #ede9fe;
  padding: 8px;
  display: grid;
  gap: 6px;
}

.kimi-chat-input {
  width: 100%;
  min-height: 50px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 12px;
  box-sizing: border-box;
  resize: vertical;
  outline: none;
}

.kimi-chat-input:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.18);
}

.dashboard-basic-field input,
.dashboard-basic-field textarea {
  padding: 6px 8px;
  font-size: 12px;
}

.dashboard-basic-field textarea {
  min-height: 56px;
  resize: vertical;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  color: #111827;
  box-sizing: border-box;
  outline: none;
}

.dashboard-basic-field textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.18);
}

.dashboard-basic-field--full {
  grid-column: 1 / -1;
}

.basic-info-import-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: grid;
  place-items: center;
  z-index: 70;
  padding: 16px;
}

.basic-info-import-dialog {
  width: min(680px, 100%);
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
  overflow: hidden;
}

.basic-info-import-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #eef2f7;
}

.basic-info-import-head h4 {
  margin: 0;
  font-size: 14px;
  color: #0f172a;
}

.basic-info-import-body {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.basic-info-import-field {
  gap: 4px;
  font-size: 12px;
}

.basic-info-import-field input {
  font-size: 12px;
  padding: 7px 8px;
}

.basic-info-import-note {
  margin: 2px 0 0;
  font-size: 12px;
  color: #64748b;
}

.basic-info-import-loading {
  border: 1px solid #ddd6fe;
  border-radius: 10px;
  background: linear-gradient(135deg, #faf5ff 0%, #eef2ff 100%);
  padding: 9px 10px;
  display: grid;
  gap: 7px;
}

.basic-info-import-loading-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.basic-info-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #ddd6fe;
  border-top-color: #7c3aed;
  border-radius: 50%;
  animation: basic-info-spin 900ms linear infinite;
}

.basic-info-loading-text {
  font-size: 12px;
  font-weight: 600;
  color: #5b21b6;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.basic-info-loading-dots {
  display: inline-flex;
  gap: 3px;
}

.basic-info-loading-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #8b5cf6;
  opacity: 0.25;
  animation: basic-info-dot 1s ease-in-out infinite;
}

.basic-info-loading-dots i:nth-child(2) {
  animation-delay: 120ms;
}

.basic-info-loading-dots i:nth-child(3) {
  animation-delay: 240ms;
}

.basic-info-loading-track {
  position: relative;
  height: 4px;
  background: rgba(124, 58, 237, 0.12);
  border-radius: 999px;
  overflow: hidden;
}

.basic-info-loading-bar {
  position: absolute;
  top: 0;
  left: -35%;
  width: 35%;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #7c3aed 0%, #a78bfa 100%);
  animation: basic-info-progress 1.4s ease-in-out infinite;
}

.basic-info-import-hint {
  margin: 0;
  font-size: 11px;
  color: #6b7280;
}

.basic-info-import-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px 12px;
}

.enterprise-profile-preview-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: grid;
  place-items: center;
  z-index: 72;
  padding: 16px;
}

.enterprise-profile-preview-dialog {
  width: min(640px, 100%);
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
  overflow: hidden;
}

.enterprise-profile-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid #eef2f7;
}

.enterprise-profile-preview-head h4 {
  margin: 0;
  font-size: 14px;
  color: #111827;
}

.enterprise-profile-preview-body {
  padding: 12px 14px;
  display: grid;
  gap: 8px;
}

.enterprise-profile-preview-tip {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}

.enterprise-profile-preview-fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
}

.enterprise-profile-preview-fields label {
  gap: 4px;
  font-size: 12px;
  color: #334155;
}

.enterprise-profile-preview-fields input[readonly] {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 12px;
  color: #334155;
  background: #f8fafc;
}

.enterprise-profile-preview-textarea {
  width: 100%;
  min-height: 132px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #111827;
  background: #fff;
  resize: vertical;
  box-sizing: border-box;
  outline: none;
}

.enterprise-profile-preview-textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.18);
}

.enterprise-profile-preview-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid #eef2f7;
  background: #f8fafc;
}

@keyframes basic-info-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes basic-info-dot {
  0%,
  80%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-1px);
  }
}

@keyframes basic-info-progress {
  0% {
    left: -35%;
  }
  50% {
    left: 35%;
  }
  100% {
    left: 100%;
  }
}

.dashboard-chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.dashboard-chart-sub {
  margin: 0;
  color: #6b7280;
  font-size: 11px;
}

.dashboard-chart-body {
  display: grid;
  grid-template-columns: minmax(108px, 138px) minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.dashboard-donut {
  width: 132px;
  height: 132px;
  justify-self: center;
}

.kpi-icon {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 20px;
}

.kpi-icon.violet {
  background: #ede9fe;
}

.kpi-icon.blue {
  background: #dbeafe;
}

.kpi-icon.green {
  background: #dcfce7;
}

.kpi-label {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
}

.kpi-value {
  margin: 4px 0 0;
  font-size: 30px;
  line-height: 1;
  font-weight: 700;
  color: #111827;
}

.kpi-change {
  margin: 12px 0 0;
  font-size: 13px;
}

.kpi-change.positive {
  color: #16a34a;
}

.kpi-change span {
  margin-left: 6px;
  color: #6b7280;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.view-all {
  color: #7c3aed;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.api-doc-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.api-doc-card {
  padding: 12px 14px;
}

.api-doc-title {
  margin: 0 0 8px;
  font-size: 14px;
  color: #111827;
}

.api-doc-list {
  margin: 0;
  padding-left: 18px;
  color: #4b5563;
  font-size: 12px;
  line-height: 1.5;
}

.api-doc-list code {
  font-size: 11px;
}

.table-card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead {
  background: #f9fafb;
}

th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6b7280;
  font-weight: 600;
  padding: 12px 16px;
}

td {
  border-top: 1px solid #f3f4f6;
  padding: 12px 16px;
  font-size: 13px;
  color: #4b5563;
  vertical-align: middle;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mini-avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: #e5e7eb;
}

.user-name {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
}

.user-mail {
  margin: 2px 0 0;
  font-size: 12px;
  color: #6b7280;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 600;
}

.badge.success {
  background: #dcfce7;
  color: #166534;
}

.badge.pending {
  background: #fef3c7;
  color: #92400e;
}

.details-link {
  color: #7c3aed;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.assessment-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 16px;
}

/* 评估页：参数 + 预览在正文滚动时保持吸顶；外壳含收起/展开工具栏 */
.assessment-grid--sticky {
  position: sticky;
  top: 0;
  z-index: 4;
  margin-bottom: 4px;
  padding: 3px 5px 4px;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  background: #f8fafc;
  box-shadow: 0 10px 18px -14px rgba(15, 23, 42, 0.35);
  transition: opacity 120ms linear;
}

.assessment-grid--sticky.is-collapsed {
  align-self: flex-end;
  margin-left: auto;
  width: fit-content;
  max-width: 100%;
  padding: 5px 8px;
  border-color: #dbeafe;
  background: linear-gradient(135deg, #f5f8ff 0%, #eef7ff 52%, #eaf4ff 100%);
  box-shadow: 0 8px 16px -14px rgba(37, 99, 235, 0.5);
}

.assessment-sticky-collapsed-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 10px;
}

.assessment-sticky-collapsed-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px 6px;
  min-width: 0;
  font-size: 10px;
  color: #374151;
  line-height: 1.35;
}

.assessment-sticky-collapsed-kicker {
  font-size: 10px;
  font-weight: 600;
  color: #111827;
}

.assessment-sticky-collapsed-sep {
  color: #e5e7eb;
  font-weight: 300;
  flex-shrink: 0;
  user-select: none;
}

.assessment-sticky-collapsed-meta {
  max-width: min(220px, 32vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #6b7280;
}

.assessment-sticky-collapsed-stat {
  margin-left: 2px;
  font-weight: 700;
  color: #6d28d9;
}

.assessment-sticky-actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
}

.assessment-sticky-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
  line-height: 1.2;
}

.assessment-grid--sticky:not(.is-collapsed) .assessment-sticky-actions {
  margin-bottom: 4px;
  padding-bottom: 3px;
  border-bottom: 1px solid #e5e7eb;
}

.assessment-grid--sticky .assessment-sticky-title {
  font-size: 18px;
}

.assessment-sticky-toggle {
  flex-shrink: 0;
}

.assessment-sticky-expanded {
  width: 100%;
}

.sticky-toggle-enter-active,
.sticky-toggle-leave-active {
  transition: opacity 220ms ease, transform 220ms ease;
}

.sticky-toggle-enter-from,
.sticky-toggle-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* 仅吸顶内双栏：紧凑，不作用到底部「计算结果」区 */
.assessment-grid--sticky .assessment-grid {
  grid-template-columns: minmax(280px, 0.82fr) minmax(0, 1.58fr);
  gap: 8px;
  align-items: start;
}

.assessment-grid--sticky .panel {
  padding: 6px 8px;
  border-radius: 10px;
}

.assessment-grid--sticky .panel--config {
  max-width: 100%;
  padding: 6px 8px;
  min-height: 252px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(124, 58, 237, 0.08) 0%, rgba(255, 255, 255, 0.98) 34%, #ffffff 100%);
}

.assessment-grid--sticky .panel--preview {
  min-height: 252px;
  padding: 6px 8px;
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.07) 0%, rgba(255, 255, 255, 0.98) 36%, #ffffff 100%);
}

.assessment-grid--sticky .panel--preview .kpi-grid.mini {
  gap: 4px;
}

.assessment-grid--sticky .panel--preview .kpi-grid.mini .kpi-card {
  padding: 5px 7px;
}

.assessment-grid--sticky .panel--preview .kpi-grid.mini .kpi-card--total-days .kpi-label {
  color: #b45309;
}

.assessment-grid--sticky .panel--preview .kpi-grid.mini .kpi-card--total-days .kpi-value {
  color: #c2410c;
  font-weight: 800;
}

.assessment-grid--sticky .panel--preview .realtime-charts {
  margin-top: 4px;
}

.assessment-grid--sticky .panel .section-title {
  margin: 0 0 6px;
  font-size: 13px;
  line-height: 1.25;
}

.assessment-grid--sticky .field-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 10px;
  align-content: start;
  flex: 1;
}

.assessment-grid--sticky .field-grid label {
  font-size: 11px;
  gap: 4px;
}

.assessment-grid--sticky .field-grid input,
.assessment-grid--sticky .field-grid select {
  box-sizing: border-box;
  height: 30px;
  min-height: 30px;
  max-height: 30px;
  padding: 0 8px;
  line-height: 1.2;
  font-size: 12px;
  border-radius: 6px;
}

.assessment-grid--sticky .kpi-grid.mini {
  gap: 4px;
}

.assessment-grid--sticky .kpi-grid.mini .kpi-card {
  padding: 6px 8px;
  gap: 5px;
  border-radius: 10px;
}

.assessment-grid--sticky .kpi-grid.mini .kpi-label {
  font-size: 9px;
}

.assessment-grid--sticky .kpi-grid.mini .kpi-value {
  font-size: 14px;
  margin: 2px 0 0;
  line-height: 1.1;
}

.realtime-charts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 4px;
}

.chart-card {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 6px;
  background: #fff;
  min-height: 166px;
}

.chart-title {
  margin: 0 0 4px;
  font-size: 11px;
  color: #374151;
}

.chart-body {
  display: grid;
  grid-template-columns: 1.4fr 0.6fr;
  column-gap: 8px;
  align-items: flex-start;
}

.pie {
  width: 112px;
  height: 112px;
  border-radius: 999px;
  border: 1px solid #e5e7eb;
  flex-shrink: 0;
  justify-self: center;
}

.chart-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  max-width: 120px;
}

.chart-legend-item {
  display: grid;
  grid-template-columns: 10px 1fr;
  column-gap: 6px;
  row-gap: 1px;
  align-items: center;
}

.chart-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.chart-label {
  font-size: 11px;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chart-value {
  grid-column: 2;
  font-size: 10px;
  line-height: 1.25;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chart-empty {
  font-size: 11px;
  color: #9ca3af;
}

.panel {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  padding: 16px;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

input,
select {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 9px 10px;
  font-size: 13px;
  background: #fff;
}

.kpi-grid.mini {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.inline-controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.mode-draft-hint {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  color: #6b7280;
  margin-left: 2px;
}

.mode-save-notice {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  color: #166534;
  background: #dcfce7;
  border: 1px solid #bbf7d0;
  border-radius: 999px;
  padding: 2px 8px;
}

.mini-btn {
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  background: #faf5ff;
  color: #6d28d9;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
  cursor: pointer;
}

.mini-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.mini-btn--primary {
  background: #6d28d9;
  border-color: #6d28d9;
  color: #fff;
}

.assessment-grid--sticky .mini-btn.assessment-sticky-toggle {
  padding: 4px 8px;
  font-size: 11px;
}

.sheet-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.sheet-btn {
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  background: #fff;
  color: #4b5563;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.sheet-btn.active {
  border-color: #c4b5fd;
  background: #f5f3ff;
  color: #6d28d9;
}

.preset-modes-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
}

.preset-modes-label {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  flex-shrink: 0;
  white-space: nowrap;
}

.preset-modes-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.preset-mode-tag {
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  background: #f9fafb;
  color: #374151;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  cursor: pointer;
}

.preset-mode-tag:hover {
  background: #f3f4f6;
}

.preset-mode-tag.active {
  border-color: #a78bfa;
  background: #f5f3ff;
  color: #6d28d9;
}

.cloud-tags-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
}

.cloud-tags-bar-head {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-width: 0;
}

.cloud-tags-bar-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 2px;
  padding-top: 2px;
}

.cloud-tags-sheet-bulk-btn {
  flex-shrink: 0;
}

.cloud-tags-bar-label {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  flex-shrink: 0;
}

.cloud-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
  min-width: 0;
  max-height: 200px;
  overflow: hidden;
  transition: max-height 220ms ease;
}

.cloud-tags-bar.is-collapsed .cloud-tags {
  max-height: 32px;
}

.cloud-tags-toggle {
  margin-left: auto;
  flex-shrink: 0;
}

.cloud-tag {
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  background: #f9fafb;
  color: #374151;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  cursor: pointer;
  max-width: min(100%, 320px);
  text-align: left;
}

.cloud-tag:hover {
  background: #f3f4f6;
}

.cloud-tag.active {
  border-color: #a78bfa;
  background: #f5f3ff;
  color: #6d28d9;
}

.cloud-panel-placeholder {
  margin: 0 0 16px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px dashed #d1d5db;
  background: #f9fafb;
  color: #6b7280;
  font-size: 13px;
}

.tree-grid {
  display: grid;
  gap: 8px;
}

.tree-card {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  padding: 8px 10px;
  min-width: 0;
}

.tree-card--collapsed {
  padding: 6px 10px;
}

.tree-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.tree-card-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.tree-card-actions-sep {
  color: #d1d5db;
  font-weight: 600;
  user-select: none;
  padding: 0 2px;
  flex-shrink: 0;
  line-height: 1;
}

.tree-card-header .tree-title {
  margin: 0;
  flex: 1;
  min-width: 0;
}

.tree-card-toggle {
  flex-shrink: 0;
  margin-left: auto;
}

.tree-card-collapsed-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tree-card-collapsed-row .tree-card-summary {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
  padding: 5px 8px;
}

.tree-card-collapsed-row .tree-card-toggle {
  margin-left: 0;
  align-self: center;
}

.tree-card-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: #f9fafb;
  border: 1px solid #f3f4f6;
  font-size: 11px;
  color: #374151;
  line-height: 1.35;
}

.tree-card-summary-title {
  font-size: 11px;
  font-weight: 600;
  color: #6d28d9;
  flex-shrink: 0;
}

.tree-card-summary-sep {
  color: #e5e7eb;
  font-weight: 300;
  flex-shrink: 0;
  user-select: none;
}

.tree-card-summary-meta {
  color: #6b7280;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: min(100%, 340px);
  flex-shrink: 1;
  min-width: 0;
}

.tree-card-summary-item {
  flex-shrink: 0;
  white-space: nowrap;
}

.tree-card-summary-item--sku {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.tree-card-summary-sku-text {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #374151;
}

.tree-card-stat {
  margin-left: 4px;
  font-weight: 700;
  color: #6d28d9;
}

.tree-card-body {
  margin-top: 4px;
  overflow: hidden;
}

.tree-expand-enter-active,
.tree-expand-leave-active {
  transition: max-height 260ms ease, opacity 220ms ease, transform 220ms ease;
  transform-origin: top;
}

.tree-expand-enter-from,
.tree-expand-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}

.tree-expand-enter-to,
.tree-expand-leave-from {
  max-height: 6000px;
  opacity: 1;
  transform: translateY(0);
}

.tree-head-switch-enter-active,
.tree-head-switch-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.tree-head-switch-enter-from,
.tree-head-switch-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

.tree-card-header-row {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 12px;
  align-items: center;
  padding: 4px 6px 2px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 4px;
}

.tree-card-header-row--module {
  display: grid;
  grid-template-columns: 120px minmax(170px, 0.62fr) minmax(420px, 1.58fr) auto;
  column-gap: 12px;
  align-items: center;
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 2px solid #e5e7eb;
  border-radius: 6px 6px 0 0;
  margin-bottom: 6px;
}

.tree-card-header-row--module .tree-card-header-label:nth-child(1) {
  grid-column: 1;
}

.tree-card-header-row--module .tree-card-header-label:nth-child(2) {
  grid-column: 2;
  text-align: left;
  padding-left: 4px;
}

.tree-card-header-row--module .tree-card-header-label:nth-child(3) {
  grid-column: 3;
  text-align: left;
  padding-left: 0;
}

.tree-card-header-label {
  font-size: 11px;
  font-weight: 600;
  color: #6d28d9;
  white-space: nowrap;
}

.tree-card-header-label--center {
  text-align: center;
}

.tree-title {
  margin: 0 0 6px;
  font-size: 14px;
  color: #111827;
  line-height: 1.25;
}

.tree-level {
  margin-left: 6px;
  padding-left: 8px;
  border-left: 2px solid #ede9fe;
}

.tree-level--module {
  display: grid;
  grid-template-columns: 120px 1fr;
  column-gap: 12px;
  align-items: start;
  margin-bottom: 8px;
  padding: 10px 12px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.tree-level--module:last-child {
  margin-bottom: 0;
}

.tree-level--module .tree-subtitle {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  grid-column: 1;
  align-self: center;
  padding-top: 6px;
}

.tree-level--module .tree-level-items {
  grid-column: 2;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.tree-level-items {
  min-width: 0;
}

.tree-subtitle {
  margin: 3px 0;
  font-size: 11px;
  color: #4b5563;
  line-height: 1.25;
}

.tree-group {
  margin-bottom: 3px;
}

.tree-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  column-gap: 10px;
  margin: 2px 0;
  padding: 3px 6px;
  border: 1px solid #f3f4f6;
  border-radius: 6px;
  background: #fcfcfd;
  width: 100%;
  max-width: 100%;
  text-align: left;
  min-height: 0;
  box-sizing: border-box;
}

.tree-item--selectable {
  cursor: pointer;
  transition: background-color 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}

.tree-item--selectable:hover {
  border-color: #ddd6fe;
  background: #faf7ff;
}

.tree-item--selectable:focus-visible {
  outline: none;
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.22);
}

.tree-item.is-selected {
  border-color: #c4b5fd;
  background: #f3efff;
}

.tree-item-left {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 6px;
  min-width: 0;
  text-align: left;
}

.tree-item-left > span {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  min-width: 0;
  overflow-wrap: anywhere;
}

.tree-item-left strong {
  display: block;
  font-size: 11px;
  line-height: 1.2;
  color: #111827;
}

.tree-item-left small {
  display: block;
  margin-top: 0;
  font-size: 10px;
  line-height: 1.2;
  color: #6b7280;
}

.tree-item-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.tree-item-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  min-width: 0;
  overflow-wrap: anywhere;
}

.tree-item-content strong {
  display: block;
  font-size: 11px;
  line-height: 1.2;
  color: #111827;
}



.tree-item-content-label {
  font-size: 11px;
  font-weight: 600;
  color: #111827;
}

.tree-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.tree-item-head strong {
  flex-shrink: 0;
}

.tree-item--module {
  display: grid;
  grid-template-columns: minmax(170px, 0.62fr) minmax(420px, 1.58fr) auto;
  column-gap: 12px;
  align-items: center;
  margin: 3px 0;
  padding: 6px 8px;
  border: 1px solid #f3f4f6;
  border-radius: 6px;
  background: #fcfcfd;
  min-height: 32px;
}

.tree-item--module.is-selected {
  border-color: #b9a7fd;
  background: #efe9ff;
}

.tree-item--module:first-child {
  margin-top: 0;
}

.tree-item--module:last-child {
  margin-bottom: 0;
}

.tree-item-col {
  display: flex;
  align-items: center;
  min-width: 0;
}

.tree-item-col--implementation {
  grid-column: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.tree-item-col--evaluation {
  grid-column: 2;
  justify-content: flex-start;
}

.tree-item-col--action {
  grid-column: 3;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.tree-item--module .tree-item-content-label {
  font-size: 11px;
  font-weight: 600;
  color: #111827;
  line-height: 1.3;
}

.tree-item--module .tree-item-impl--module {
  font-size: 10px;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  line-height: 1.2;
}

.tree-item--module .tree-item-eval--module {
  font-size: 10px;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  line-height: 1.2;
}

.tree-item--module .item-badge {
  margin-top: 0;
  margin-left: 0;
}

.tree-item-impl {
  display: block;
  margin-top: 1px;
  max-width: min(100%, 460px);
  font-size: 9px;
  line-height: 1.2;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-item-eval {
  display: block;
  margin-top: 1px;
  max-width: min(100%, 460px);
  font-size: 9px;
  line-height: 1.2;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-item-head .tree-item-eval {
  margin-top: 0;
  flex: 1;
  min-width: 0;
  text-align: right;
}

.item-badge {
  display: inline-flex;
  align-items: center;
  align-self: center;
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 9px;
  font-weight: 600;
  background: #f5f3ff;
  color: #6d28d9;
  white-space: nowrap;
  justify-self: end;
}

.item-badge--base {
  background: #f5f3ff;
  color: #6d28d9;
}

.item-badge--custom {
  background: #eff6ff;
  color: #1d4ed8;
}

.tree-item-custom-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.custom-day-btn {
  min-width: 22px;
  height: 20px;
  padding: 0 4px;
  line-height: 1;
}

.custom-day-btn:disabled {
  border-color: #d1d5db;
  background: #f3f4f6;
  color: #9ca3af;
  opacity: 1;
  cursor: not-allowed;
}

.history-list {
  margin: 8px 0 0;
  padding-left: 18px;
}

.history-list li {
  margin: 6px 0;
}

.resource-cost-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px;
  max-width: 100%;
  overflow-x: hidden;
}

.resource-cost-panel > .resource-cost-table-wrap {
  flex: 1;
  min-height: 0;
  margin-bottom: 0;
}

.resource-version-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.resource-version-picker label {
  font-size: 12px;
  color: #334155;
  flex-shrink: 0;
}

.resource-version-picker select {
  min-width: 280px;
  max-width: 420px;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 12px;
  color: #1f2937;
  background: #fff;
}

.resource-version-value {
  min-width: 200px;
  max-width: 340px;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 12px;
  color: #111827;
  background: #fff;
}

.resource-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 8px;
}

.resource-toolbar .mini-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.resource-toolbar-meta {
  margin-left: auto;
  color: #64748b;
  font-size: 12px;
}

.resource-toolbar-sep {
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1;
}

.resource-toolbar-travel-btn.is-active {
  background-color: #4f46e5;
  color: #ffffff;
  border-color: #4f46e5;
}

.resource-chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(460px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}

.wbs-review-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.resource-chart-block {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 8px;
  background: #fff;
  min-width: 0;
  overflow: hidden;
}

.resource-chart-title {
  margin: 0 0 8px;
  font-size: 12px;
  color: #334155;
}

.resource-chart-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
  min-width: 0;
}

.resource-mini-chart {
  border: 1px solid #eef2f7;
  border-radius: 8px;
  padding: 6px;
  display: grid;
  grid-template-columns: minmax(88px, 104px) minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  min-height: 124px;
  min-width: 0;
  overflow: hidden;
}

.resource-donut {
  width: 104px;
  height: 104px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  margin: 0 auto;
  position: relative;
}

.resource-donut::after {
  content: "";
  width: 62px;
  height: 62px;
  border-radius: 999px;
  background: #fff;
  position: absolute;
  inset: 0;
  margin: auto;
}

.resource-donut-center {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.2;
  color: #334155;
}

.resource-donut-center strong {
  font-size: 12px;
  color: #111827;
}

.resource-donut-center span {
  font-size: 10px;
}

.resource-donut--empty {
  border: 1px dashed #cbd5e1;
  background: #f8fafc;
  color: #94a3b8;
  font-size: 12px;
}

.resource-donut--empty::after {
  display: none;
}

.resource-chart-legend p {
  margin: 0 0 4px;
  font-size: 11px;
  color: #475569;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
  flex-shrink: 0;
}

.dot--violet {
  background: #7c3aed;
}

.dot--blue {
  background: #2563eb;
}

.dot--gray {
  background: #cbd5e1;
}

.resource-legend-tip {
  color: #94a3b8;
  font-size: 10px;
}

.resource-nested-chart {
  width: 112px;
  height: 112px;
  margin: 0 auto;
}

.resource-nested-svg {
  width: 112px;
  height: 112px;
  display: block;
}

.resource-segment {
  cursor: pointer;
  transition: opacity 120ms ease;
}

.resource-segment:hover {
  opacity: 0.78;
}

.resource-segment--inner {
  cursor: default;
}

.nested-center-label {
  font-size: 9px;
  fill: #64748b;
}

.nested-center-value {
  font-size: 10px;
  font-weight: 700;
  fill: #111827;
}

.resource-cost-table-wrap {
  overflow: auto;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
}

.resource-cost-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  background: #fff;
  table-layout: auto;
}

.resource-cost-table thead th {
  background: #f8fafc;
  color: #475569;
  border: 1px solid #e5e7eb;
  padding: 6px 8px;
  font-size: 11px;
  text-transform: none;
  letter-spacing: 0;
  white-space: nowrap;
}

.resource-cost-table tbody td,
.resource-cost-table tfoot td {
  border: 1px solid #eef2f7;
  padding: 6px 8px;
  font-size: 11px;
  color: #334155;
  vertical-align: middle;
  white-space: nowrap;
}

.resource-cost-table th,
.resource-cost-table td {
  width: auto;
}

.resource-cost-table th:nth-child(2),
.resource-cost-table td:nth-child(2) {
  width: 76px;
  min-width: 76px;
  max-width: 92px;
}

.resource-cost-table th:nth-child(6),
.resource-cost-table td:nth-child(6) {
  width: 88px;
  min-width: 88px;
  max-width: 88px;
}

.resource-cost-table th:nth-child(4),
.resource-cost-table td:nth-child(4) {
  width: 88px;
  min-width: 88px;
  max-width: 88px;
}

.resource-row-selected td {
  background: #f8faff;
}

.resource-row {
  cursor: pointer;
}

.module-task-cell {
  min-width: 180px;
  max-width: 260px;
}

.module-picker {
  position: relative;
}

.module-picker-trigger {
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.module-picker-trigger--tags {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  white-space: normal;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid #dbe3ef;
  background: #fff;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.module-picker-trigger--tags:hover {
  border-color: #c4b5fd;
  background: #faf7ff;
}

.module-picker-trigger--tags:focus-visible {
  outline: none;
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.2);
}

.module-picker-trigger--tags.is-empty {
  color: #64748b;
}

.module-picker-selected-tags {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-height: 24px;
  overflow: hidden;
}

.module-picker-selected-tag {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  border-radius: 999px;
  border: 1px solid #c4b5fd;
  background: #f5f3ff;
  color: #5b21b6;
  font-size: 11px;
  line-height: 1.2;
  padding: 2px 7px;
}

.module-picker-selected-tag--count {
  border-style: dashed;
  background: #f8fafc;
  color: #475569;
}

.module-picker-placeholder {
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.module-picker-caret {
  margin-left: auto;
  color: #94a3b8;
  font-size: 11px;
  line-height: 1;
  flex-shrink: 0;
}

.module-picker-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 8;
  width: min(460px, 60vw);
  max-height: 320px;
  overflow: auto;
  border: 1px solid #dbe3ef;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.15);
  padding: 8px;
}

.module-picker-empty {
  margin: 6px 2px;
  font-size: 12px;
  color: #64748b;
}

.module-picker-cloud {
  border: 1px solid #eef2f7;
  border-radius: 8px;
  padding: 6px;
  margin-bottom: 6px;
}

.module-picker-cloud:last-child {
  margin-bottom: 0;
}

.module-picker-cloud-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.module-picker-cloud-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.module-picker-cloud-name {
  font-size: 12px;
  font-weight: 700;
  color: #334155;
}

.module-picker-cloud-count {
  font-size: 11px;
  color: #64748b;
}

.module-picker-cloud-actions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.module-picker-skus {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.module-chip {
  border: 1px solid #dbe3ef;
  background: #f8fafc;
  color: #334155;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  line-height: 1.4;
  cursor: pointer;
  transition: all 140ms ease;
}

.module-chip:hover {
  border-color: #c4b5fd;
  background: #f5f3ff;
}

.module-chip.is-selected {
  border-color: #7c3aed;
  background: #ede9fe;
  color: #5b21b6;
  font-weight: 600;
}

.module-chip--action {
  padding: 2px 8px;
  font-size: 10px;
  background: #fff;
}

.module-picker-sku {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #475569;
  min-width: 0;
}

.resource-input {
  width: 100%;
  min-width: 72px;
  border: 1px solid #dbe3ef;
  border-radius: 6px;
  padding: 4px 6px;
  font-size: 11px;
  color: #1f2937;
  background: #fff;
  box-sizing: border-box;
}

.resource-input:focus {
  outline: none;
  border-color: #a78bfa;
  box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.18);
}

.resource-input--select {
  padding-right: 20px;
}

.resource-input--person-type {
  min-width: 66px;
}

.resource-input--name,
.resource-input--product {
  min-width: 88px;
  max-width: 88px;
}

.resource-input--number {
  text-align: right;
  min-width: 82px;
}

.resource-input--textarea {
  resize: none;
  min-height: 52px;
  line-height: 1.4;
  font-family: inherit;
  overflow: hidden;
}

/* 表格内编辑控件：去边框，呈现单元格内直接编辑效果 */
.resource-cost-table td:has(> input),
.resource-cost-table td:has(> select),
.resource-cost-table td:has(> textarea),
.resource-cost-table td:has(> .module-picker),
.resource-cost-table td:has(> .resource-input),
.resource-cost-table td:has(> .resource-input--select),
.resource-cost-table td:has(> .resource-input--textarea) {
  padding: 0;
}

.resource-cost-table td .resource-input,
.resource-cost-table td .resource-input--select,
.resource-cost-table td .resource-input--textarea {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 6px 8px;
  box-sizing: border-box;
}

.resource-cost-table td .resource-input:focus,
.resource-cost-table td .resource-input--select:focus,
.resource-cost-table td .resource-input--textarea:focus {
  outline: none;
  border: 0;
  box-shadow: none;
  background: rgba(99, 102, 241, 0.06);
}

.resource-cost-table td.table-textarea-cell-expanded,
.resource-table td.table-textarea-cell-expanded,
.multi-org-table td.table-textarea-cell-expanded {
  position: relative;
  z-index: 8;
}

table .resource-input--textarea.table-textarea-expanded {
  min-height: 140px;
  border: 1px solid #a78bfa;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.18);
}

.resource-cost-table td .module-picker-trigger--tags {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 6px 8px;
  min-height: auto;
  box-sizing: border-box;
}

.resource-cost-table td .module-picker-trigger--tags:hover,
.resource-cost-table td .module-picker-trigger--tags:focus-visible {
  border: 0;
  background: rgba(99, 102, 241, 0.06);
  box-shadow: none;
}

.dev-assessment-table-wrap {
  margin-top: 10px;
}

.dev-assessment-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dev-assessment-panel .section-head {
  align-items: flex-start;
  flex-direction: column;
  gap: 8px;
}

.dev-assessment-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.dev-assessment-toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}

.dev-assessment-toolbar-row--actions {
  justify-content: flex-end;
}

.dev-assessment-kpis {
  margin-top: -2px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dev-assessment-kpis span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: #475569;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
}

.dev-assessment-kpis strong {
  color: #1f2937;
}

.dev-assessment-table {
  width: max-content;
  min-width: 100%;
}

.dev-assessment-table th,
.dev-assessment-table td {
  width: auto;
}

.dev-assessment-table .resource-input {
  min-width: 0;
}

.dev-assessment-table td {
  vertical-align: top;
}

.dev-business-domain-cell {
  min-width: 180px;
}

.dev-assessment-table th:nth-child(1),
.dev-assessment-table td:nth-child(1) {
  min-width: 32px;
  width: 1%;
  text-align: center;
}

.dev-assessment-table tfoot td {
  background: #eef2ff;
  font-weight: 700;
  color: #3730a3;
}

.dev-evaluator-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #475569;
  font-size: 12px;
}

.dev-version-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #475569;
  font-size: 12px;
  min-width: 0;
}

.dev-version-field .resource-version-value {
  min-width: 220px;
  max-width: 320px;
}

.dev-evaluator-field .resource-input {
  min-width: 120px;
}

.dev-assessment-footer {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.module-picker-tip {
  margin: 0 0 8px;
  font-size: 11px;
  color: #64748b;
}

.resource-cost-table .is-number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.resource-cost-table tfoot td {
  background: #faf5ff;
  font-weight: 700;
  color: #5b21b6;
}

.resource-empty-cell {
  text-align: center;
  color: #cbd5e1;
  padding: 10px 8px;
}

.config-header {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 10px;
  align-items: start;
  margin-bottom: 8px;
}

.config-header .section-title {
  grid-column: 1 / -1;
  margin: 0;
  padding-top: 4px;
}

.config-header-right {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  align-items: stretch;
}

.config-version-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  box-sizing: border-box;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid #fdba74;
  background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%);
  color: #9a3412;
  box-shadow: 0 2px 10px rgba(249, 115, 22, 0.15);
}

.config-version-badge--global {
  border-color: #bfdbfe;
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  color: #1e3a8a;
  box-shadow: 0 2px 10px rgba(59, 130, 246, 0.16);
}

.config-version-label {
  font-size: 11px;
  opacity: 0.9;
}

.config-version-value {
  font-size: 12px;
  letter-spacing: 0.3px;
}

.config-version-select {
  width: 100%;
  min-width: 0;
  max-width: none;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.config-version-input {
  width: 100%;
  min-width: 0;
  max-width: none;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 700;
}

.config-version-select:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.config-version-badge.is-empty {
  border-color: #e5e7eb;
  background: #f8fafc;
  color: #64748b;
  box-shadow: none;
}

.error {
  margin: 8px 0 0;
  color: #b42318;
  font-size: 12px;
}

.user-mgmt-empty {
  margin-top: 12px;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
  background: #f9fafb;
  color: #6b7280;
  font-size: 13px;
  padding: 12px;
}

.user-mgmt-table-wrap {
  margin-top: 10px;
}

.user-mgmt-table th,
.user-mgmt-table td {
  white-space: nowrap;
}

.user-status-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #065f46;
  border: 1px solid #a7f3d0;
  background: #ecfdf5;
}

.user-status-tag.is-disabled {
  color: #9a3412;
  border-color: #fed7aa;
  background: #fff7ed;
}

.invite-panel {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed #e5e7eb;
}

.invite-panel-head {
  margin-bottom: 6px;
}

.invite-title {
  margin: 0;
  font-size: 16px;
}

.invite-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.invite-table th,
.invite-table td {
  white-space: nowrap;
}

.invite-filters {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.invite-filter-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #475569;
}

.invite-filter-field input,
.invite-filter-field select {
  height: 30px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 12px;
  color: #111827;
  background: #fff;
}

.invite-filter-field input {
  min-width: 220px;
}

@media (max-width: 1080px) {
  .dashboard-shell {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
  }

  .kpi-grid {
    grid-template-columns: 1fr;
  }

  .kpi-grid.mini,
  .assessment-grid,
  .field-grid {
    grid-template-columns: 1fr;
  }

  .realtime-charts {
    grid-template-columns: 1fr;
  }

  .api-doc-grid {
    grid-template-columns: 1fr;
  }

  .global-plan-toolbar {
    grid-template-columns: 1fr;
  }

  .global-plan-actions {
    justify-self: start;
    flex-wrap: wrap;
  }

  .dashboard-chart-body {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }

  .dashboard-basic-info-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .dashboard-basic-info-actions {
    width: 100%;
    justify-content: space-between;
  }

  .requirement-version-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .requirement-version-toolbar-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .requirement-basic-collapsed {
    align-items: flex-start;
    flex-direction: column;
  }

  .requirement-basic-collapsed-summary {
    width: 100%;
    white-space: normal;
    flex-wrap: wrap;
  }

  .requirement-basic-collapsed-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .dashboard-basic-info-tip {
    white-space: normal;
  }

  .dashboard-basic-info-grid {
    grid-template-columns: 1fr;
  }

  .config-header-right {
    grid-template-columns: 1fr;
  }

  .resource-chart-grid,
  .resource-chart-row {
    grid-template-columns: 1fr;
  }

  .resource-mini-chart {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }

  .plan-guide-form {
    grid-template-columns: 1fr;
  }

  .dev-assessment-toolbar-row,
  .dev-assessment-toolbar-row--actions {
    justify-content: flex-start;
  }

  .dev-version-field {
    width: 100%;
  }

  .dev-version-field .resource-version-value {
    min-width: 0;
    width: 100%;
    max-width: none;
  }

  .dev-evaluator-field {
    width: 100%;
  }

  .main {
    padding: 16px;
  }

  .main--assessment {
    padding-top: 2px;
  }
}
</style>
