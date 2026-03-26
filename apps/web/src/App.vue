<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

type PageKey = "dashboard" | "assessment" | "resourceCost" | "apiKeys";

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

const currentPage = ref<PageKey>("dashboard");
const sidebarCollapsed = ref(false);
/** 评估页顶部「参数 + 预览」大块是否展开 */
const assessmentToolbarExpanded = ref(true);
const initLoading = ref(false);
const loading = ref(false);
const exporting = ref(false);
const error = ref("");

const templateOptions = ref<TemplateOption[]>([]);
const templateDetail = ref<TemplateDetail | null>(null);
const activeRuleSet = ref<RuleSetActive | null>(null);
const difficultyOptions = ref<number[]>([0, 0.1, 0.2, 0.3]);
const selectedSheet = ref("");
/** 已选中的云产品标签（多选），为空时下方不展示大容器 */
const selectedCloudNames = ref<string[]>([]);
const cloudTagsCollapsed = ref(false);
const presetModeOptions = ["简单纯财", "标准财务供应链", "标准财务供应链生产", "标准PLM"] as const;
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
  updatedAt: number;
};
const MODE_DRAFT_STORAGE_KEY = "workload-mode-drafts-v1";
const modeDrafts = ref<Record<string, ModeDraft>>({});
const saveNotice = ref("");
let saveNoticeTimer: ReturnType<typeof setTimeout> | null = null;
const exportHistory = ref<ExportHistoryItem[]>([]);
const historyPage = ref(1);
const historyTotal = ref(0);
const apiDocGroups = [
  {
    title: "基础",
    endpoints: ["GET /api/v1/health"]
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

const result = ref<CalculateResult | null>(null);
const exportInfo = ref<ExportResult | null>(null);

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function currentDraftStorageKey(): string {
  const templateKey = form.value.templateId || "default";
  return `${MODE_DRAFT_STORAGE_KEY}:${templateKey}`;
}

function persistModeDrafts(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(currentDraftStorageKey(), JSON.stringify(modeDrafts.value));
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
  modeDrafts.value[key] = {
    selectedCloudNames: [...selectedCloudNames.value],
    itemSelection: { ...itemSelection.value },
    customModeEnabled: customModeEnabled.value,
    itemCustomDays: { ...itemCustomDays.value },
    updatedAt: Date.now()
  };
  persistModeDrafts();
}

function onManualSaveDraft(): void {
  saveCurrentModeDraft();
  showTimedNotice("已临时保存");
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

const selectedCount = computed(
  () => visibleItems.value.filter((item) => itemSelection.value[item.templateItemId]).length
);
const baseDays = computed(() =>
  visibleItems.value.reduce(
    (sum, item) => sum + (itemSelection.value[item.templateItemId] ? getEffectiveStandardDays(item) : 0),
    0
  )
);

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

const realtimeBreakdown = computed(() => {
  const base = round1(baseDays.value);
  const tiers = activeRuleSet.value?.baseRule?.userCountTiers || [];
  const tier = tiers.find((x) => form.value.userCount >= x.min && form.value.userCount <= x.max) || {
    min: 0,
    max: 0,
    factor: 0
  };
  const userRaw = base * tier.factor;
  const userIncrement =
    activeRuleSet.value?.baseRule?.userIncrementRounding === "ceil_int" ? Math.ceil(userRaw) : round1(userRaw);
  const difficultyIncrement = round1(base * Number(form.value.difficultyFactor || 0));
  const orgRule = activeRuleSet.value?.orgIncrementRule;
  const orgFactor = Number(orgRule?.factor ?? 0.1);
  const orgEnabled = orgRule?.enabled !== false;
  const orgIncrement = orgEnabled
    ? round1(base * Math.max(0, Number(form.value.orgCount || 0) - 1) * (1 - Number(form.value.orgSimilarityFactor || 0)) * orgFactor)
    : 0;
  const total = round1(base + userIncrement + difficultyIncrement + orgIncrement);

  const rows = [
    { label: "模块基础人天", value: base, color: "#7c3aed" },
    { label: "难度系数增量", value: difficultyIncrement, color: "#2563eb" },
    { label: "多组织相似度增量", value: orgIncrement, color: "#10b981" },
    { label: "用户数增量", value: userIncrement, color: "#f59e0b" }
  ];
  return {
    total,
    rows: rows.map((row) => ({ ...row, percent: safePercent(row.value, total) }))
  };
});

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
const resourceMonthColumns = ["2025年4月人天投入", "2025年5月人天投入", "2025年6月人天投入", "2025年7月人天投入", "2025年8月人天投入", "2025年9月人天投入", "2025年10月人天投入"] as const;

const resourceCostRows = computed<ResourceCostRow[]>(() => {
  const rows =
    templateDetail.value?.items
      .filter((item) => !isSummaryCloudProduct(item.cloudProduct))
      .filter((item) => itemSelection.value[item.templateItemId])
      .slice(0, 60) || [];
  return rows.map((item) => {
    const plannedDays = getEffectiveStandardDays(item);
    const unitCost = 1390;
    return {
      role: "实施顾问",
      personType: "员工",
      orgName: "广州分公司",
      name: "",
      consultantLevel: "2-1",
      product: item.cloudProduct || "金蝶云星空实施",
      moduleTask: item.deliveryModule || item.itemName,
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
      monthDays: [plannedDays, 0, 0, 0, 0, 0, 0]
    };
  });
});

const resourceCostSummary = computed(() => {
  const totalPlannedDays = round1(resourceCostRows.value.reduce((sum, row) => sum + row.plannedDays, 0));
  const totalPlannedCost = Math.round(resourceCostRows.value.reduce((sum, row) => sum + row.plannedCost, 0));
  const totalTravelCost = Math.round(resourceCostRows.value.reduce((sum, row) => sum + row.travelCostTotal, 0));
  const monthTotals = resourceMonthColumns.map((_, idx) =>
    round1(resourceCostRows.value.reduce((sum, row) => sum + (row.monthDays[idx] || 0), 0))
  );
  return { totalPlannedDays, totalPlannedCost, totalTravelCost, monthTotals };
});

function formatMoney(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

const apiBaseUrl = (() => {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (raw) return raw.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return `http://localhost:3000`;
  }
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
  const response = await fetch(`/api/v1/templates/${templateId}`);
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
  applyModeDraftForSheet(selectedSheet.value);
}

async function loadInitialAssessmentData(): Promise<void> {
  initLoading.value = true;
  error.value = "";
  try {
    const [templatesRes, rulesRes] = await Promise.all([fetch("/api/v1/templates"), fetch("/api/v1/rule-sets/active")]);
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

async function calculateEstimateRequest(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/v1/estimates/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.value)
    });
    const data = (await response.json()) as ApiResponse<CalculateResult>;
    if (!response.ok || data.code !== 0) {
      throw new Error(data.message || "计算失败");
    }
    result.value = data.data;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "计算失败";
  } finally {
    loading.value = false;
  }
}

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
    const response = await fetch("/api/v1/estimates/calculate-and-export", {
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
    window.open(resolveDownloadUrl(data.data.downloadUrl), "_blank");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "导出失败";
  } finally {
    exporting.value = false;
  }
}

async function loadExportHistory(reset: boolean): Promise<void> {
  const page = reset ? 1 : historyPage.value;
  const response = await fetch(`/api/v1/exports/history?page=${page}&pageSize=8`);
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

const hasMoreHistory = computed(() => exportHistory.value.length < historyTotal.value);

onMounted(() => {
  void loadInitialAssessmentData();
});

onBeforeUnmount(() => {
  if (saveNoticeTimer) {
    clearTimeout(saveNoticeTimer);
  }
});
</script>

<template>
  <div class="dashboard-shell">
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
          <a href="#" class="nav-item" :class="{ active: currentPage === 'assessment' }" @click.prevent="currentPage = 'assessment'">
            <span class="nav-icon">👥</span>
            <span class="nav-text">评估</span>
          </a>
          <a href="#" class="nav-item" :class="{ active: currentPage === 'resourceCost' }" @click.prevent="currentPage = 'resourceCost'">
            <span class="nav-icon">📊</span>
            <span class="nav-text">资源人天及成本</span>
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
          <p class="profile-name">Tom Cook</p>
          <p class="profile-role">Admin</p>
        </div>
      </div>
    </aside>

    <div class="content-wrap">
      <header class="topbar">
        <h1 class="page-title">
          {{
            currentPage === "dashboard"
              ? "Dashboard"
              : currentPage === "assessment"
                ? "评估工作台"
                : currentPage === "resourceCost"
                  ? "资源人天及成本"
                  : "API 文档"
          }}
        </h1>
      </header>

      <main class="main" :class="{ 'main--assessment': currentPage === 'assessment' }">
        <template v-if="currentPage === 'dashboard'">
          <section class="section">
          <h2 class="section-title">Overview</h2>
          <div class="kpi-grid">
            <article class="kpi-card">
              <div class="kpi-icon violet">👤</div>
              <div>
                <p class="kpi-label">Total Users</p>
                <p class="kpi-value">12,721</p>
                <p class="kpi-change positive">↑ 12.5% <span>from last month</span></p>
              </div>
            </article>
            <article class="kpi-card">
              <div class="kpi-icon blue">📶</div>
              <div>
                <p class="kpi-label">Active Sessions</p>
                <p class="kpi-value">1,843</p>
                <p class="kpi-change positive">↑ 8.2% <span>from last week</span></p>
              </div>
            </article>
            <article class="kpi-card">
              <div class="kpi-icon green">✅</div>
              <div>
                <p class="kpi-label">Conversion Rate</p>
                <p class="kpi-value">89.2%</p>
                <p class="kpi-change positive">↑ 3.1% <span>from last month</span></p>
              </div>
            </article>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <h2 class="section-title">Recent Signups</h2>
            <a href="#" class="view-all">View all</a>
          </div>

          <div class="table-card">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Auth Provider</th>
                  <th>Status</th>
                  <th>Signed Up</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <div class="user-cell">
                      <div class="mini-avatar"></div>
                      <div>
                        <p class="user-name">Jane Cooper</p>
                        <p class="user-mail">jane.cooper@example.com</p>
                      </div>
                    </div>
                  </td>
                  <td>GitHub</td>
                  <td><span class="badge success">Active</span></td>
                  <td>5 minutes ago</td>
                  <td><a href="#" class="details-link">Details</a></td>
                </tr>
                <tr>
                  <td>
                    <div class="user-cell">
                      <div class="mini-avatar"></div>
                      <div>
                        <p class="user-name">Devon Lane</p>
                        <p class="user-mail">devon.lane@example.com</p>
                      </div>
                    </div>
                  </td>
                  <td>Facebook</td>
                  <td><span class="badge success">Active</span></td>
                  <td>10 minutes ago</td>
                  <td><a href="#" class="details-link">Details</a></td>
                </tr>
                <tr>
                  <td>
                    <div class="user-cell">
                      <div class="mini-avatar"></div>
                      <div>
                        <p class="user-name">Darlene Robertson</p>
                        <p class="user-mail">darlene@example.com</p>
                      </div>
                    </div>
                  </td>
                  <td>Email</td>
                  <td><span class="badge pending">Pending</span></td>
                  <td>15 minutes ago</td>
                  <td><a href="#" class="details-link">Details</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        </template>

        <template v-else-if="currentPage === 'assessment'">
          <!-- sticky 与长列表同属一节，父级足够高，吸顶才能在滚条目时持续生效 -->
          <section class="section assessment-workspace">
            <div class="assessment-sticky-shell assessment-grid--sticky" :class="{ 'is-collapsed': !assessmentToolbarExpanded }">
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
                  <button
                    type="button"
                    class="mini-btn assessment-sticky-toggle"
                    aria-expanded="false"
                    @click="assessmentToolbarExpanded = true"
                  >
                    展开
                  </button>
                </div>
                <div v-else key="expanded" class="assessment-sticky-expanded">
                  <div class="assessment-sticky-actions">
                    <h2 class="assessment-sticky-title">配置与实时预览</h2>
                    <button
                      type="button"
                      class="mini-btn assessment-sticky-toggle"
                      :aria-expanded="assessmentToolbarExpanded"
                      @click="assessmentToolbarExpanded = false"
                    >
                      收起
                    </button>
                  </div>
                  <div class="assessment-grid">
                    <article class="panel panel--config">
                      <h2 class="section-title">参数配置</h2>
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
            </div>

            <div class="section-head assessment-items-head">
              <h2 class="section-title">评估模式</h2>
              <div class="inline-controls">
                <button class="mini-btn" @click="onManualSaveDraft">临时保存</button>
                <button class="mini-btn" @click="selectAllInSheet(true)">全选</button>
                <button class="mini-btn" @click="selectAllInSheet(false)">全不选</button>
                <button class="mini-btn" :disabled="loading" @click="calculateEstimateRequest">
                  {{ loading ? "计算中..." : "计算" }}
                </button>
                <button class="mini-btn" :disabled="exporting" @click="calculateAndExport('excel')">
                  {{ exporting ? "导出中..." : "导出Excel" }}
                </button>
                <button class="mini-btn" :disabled="exporting" @click="calculateAndExport('pdf')">
                  {{ exporting ? "导出中..." : "导出PDF" }}
                </button>
                <span v-if="saveNotice" class="mode-save-notice">{{ saveNotice }}</span>
                <span v-if="currentModeSavedAt" class="mode-draft-hint">已保存：{{ formatDraftTime(currentModeSavedAt) }}</span>
              </div>
            </div>
            <p v-if="error" class="error">{{ error }}</p>

            <div class="sheet-tabs">
              <button
                v-for="sheet in sheets"
                :key="sheet"
                class="sheet-btn"
                :class="{ active: selectedSheet === sheet }"
                @click="onSwitchSheet(sheet)"
              >
                {{ sheet }}
              </button>
            </div>

            <div class="preset-modes-bar">
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

            <div v-if="hierarchy.length" class="cloud-tags-bar" :class="{ 'is-collapsed': cloudTagsCollapsed }">
              <div class="cloud-tags-bar-head">
                <span class="cloud-tags-bar-label">云产品</span>
                <button type="button" class="mini-btn cloud-tags-toggle" @click="toggleCloudTagsCollapsed">
                  {{ cloudTagsCollapsed ? "展开" : "折叠" }}
                </button>
              </div>
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

            <p v-if="hierarchy.length && visibleClouds.length === 0" class="cloud-panel-placeholder">请选择一个或多个云产品标签查看条目</p>

            <div v-if="visibleClouds.length" class="tree-grid">
              <article
                v-for="cloud in visibleClouds"
                :key="cloud.cloudName"
                class="tree-card"
                :class="{ 'tree-card--collapsed': !isCloudCardExpanded(cloud.cloudName) }"
              >
                <Transition name="tree-head-switch" mode="out-in">
                  <div v-if="isCloudCardExpanded(cloud.cloudName)" :key="`${cloud.cloudName}-expanded`" class="tree-card-header">
                    <h3 class="tree-title">云产品：{{ cloud.cloudName }}</h3>
                    <div class="tree-card-header-actions">
                      <button type="button" class="mini-btn tree-card-toggle" @click="toggleCustomMode">
                        {{ customModeEnabled ? "取消自定义" : "自定义" }}
                      </button>
                      <button type="button" class="mini-btn tree-card-toggle" @click="clearCloudSelections(cloud)">清除</button>
                      <button
                        type="button"
                        class="mini-btn tree-card-toggle"
                        :aria-expanded="true"
                        @click="toggleCloudCardExpand(cloud.cloudName)"
                      >
                        收起
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
                    <button
                      type="button"
                      class="mini-btn tree-card-toggle"
                      :aria-expanded="false"
                      @click="toggleCloudCardExpand(cloud.cloudName)"
                    >
                      展开
                    </button>
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
              </article>
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
                  <a :href="resolveDownloadUrl(exportInfo.downloadUrl)" target="_blank" class="details-link">点击下载</a>
                </p>
                <ul class="history-list">
                  <li v-for="item in exportHistory" :key="item.fileName">
                    <a :href="resolveDownloadUrl(item.downloadUrl)" target="_blank">{{ item.fileName }}</a>
                    <span class="meta">{{ new Date(item.modifiedAt).toLocaleString() }}</span>
                  </li>
                </ul>
                <button v-if="hasMoreHistory" class="mini-btn" @click="loadExportHistory(false)">查看更多</button>
              </article>
            </div>
          </section>
        </template>
        <template v-else-if="currentPage === 'resourceCost'">
          <section class="section">
            <div class="section-head">
              <h2 class="section-title">资源人天及成本</h2>
            </div>
            <p class="meta" style="margin-bottom: 10px;">结构参考《项目资源人天及成本表模板》，并基于当前勾选条目生成人天成本明细。</p>
            <article class="panel resource-cost-panel">
              <div class="resource-cost-table-wrap">
                <table class="resource-cost-table">
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
                      <th colspan="2">交通费</th>
                      <th colspan="2">住宿费</th>
                      <th colspan="2">出差补贴</th>
                      <th rowspan="2">预计差旅费合计</th>
                      <th :colspan="resourceMonthColumns.length">项目分期及项目阶段（启动,需求,方案,构建,测试,上线,验收,运维）</th>
                    </tr>
                    <tr>
                      <th>次数</th>
                      <th>单价</th>
                      <th>天数</th>
                      <th>标准</th>
                      <th>天数</th>
                      <th>标准</th>
                      <th v-for="month in resourceMonthColumns" :key="month">{{ month }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, idx) in resourceCostRows" :key="`${row.moduleTask}-${idx}`">
                      <td>{{ row.role }}</td>
                      <td>{{ row.personType }}</td>
                      <td>{{ row.orgName }}</td>
                      <td>{{ row.name || "-" }}</td>
                      <td>{{ row.consultantLevel }}</td>
                      <td>{{ row.product }}</td>
                      <td :title="row.moduleTask">{{ row.moduleTask }}</td>
                      <td class="is-number">{{ formatMoney(row.unitCost) }}</td>
                      <td class="is-number">{{ formatStandardDays(row.plannedDays) }}</td>
                      <td class="is-number">{{ formatMoney(row.plannedCost) }}</td>
                      <td class="is-number">{{ row.trafficCount }}</td>
                      <td class="is-number">{{ formatMoney(row.trafficUnitCost) }}</td>
                      <td class="is-number">{{ row.stayDays }}</td>
                      <td class="is-number">{{ formatMoney(row.stayUnitCost) }}</td>
                      <td class="is-number">{{ row.allowanceDays }}</td>
                      <td class="is-number">{{ formatMoney(row.allowanceUnitCost) }}</td>
                      <td class="is-number">{{ formatMoney(row.travelCostTotal) }}</td>
                      <td v-for="(m, mIdx) in row.monthDays" :key="`${idx}-${mIdx}`" class="is-number">{{ formatStandardDays(m) }}</td>
                    </tr>
                    <tr v-if="resourceCostRows.length === 0">
                      <td :colspan="18 + resourceMonthColumns.length" class="resource-empty">当前暂无已勾选项，请先在“评估”页面勾选条目。</td>
                    </tr>
                  </tbody>
                  <tfoot v-if="resourceCostRows.length > 0">
                    <tr>
                      <td colspan="8">各项合计</td>
                      <td class="is-number">{{ formatStandardDays(resourceCostSummary.totalPlannedDays) }}</td>
                      <td class="is-number">{{ formatMoney(resourceCostSummary.totalPlannedCost) }}</td>
                      <td colspan="6"></td>
                      <td class="is-number">{{ formatMoney(resourceCostSummary.totalTravelCost) }}</td>
                      <td v-for="(m, idx) in resourceCostSummary.monthTotals" :key="`sum-${idx}`" class="is-number">{{ formatStandardDays(m) }}</td>
                    </tr>
                  </tfoot>
                </table>
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
                <li><code>X-Role</code> 默认 <code>operator</code>，导入接口需 <code>admin</code></li>
                <li>导出接口支持 <code>Idempotency-Key</code> 幂等重放</li>
                <li>详情可参考 <code>docs/openapi.yaml</code> 与 <code>docs/LLM_API_CALLING_GUIDE.md</code></li>
              </ul>
            </article>
          </section>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
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

.content-wrap {
  flex: 1;
  min-height: 0;
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
  padding: 24px;
}

/* 评估页吸顶条紧贴顶栏，避免 main 上大 padding-top 在滚动时露出下方内容 */
.main--assessment {
  padding-top: 2px;
}

.section {
  margin-bottom: 30px;
}

.assessment-items-head {
  margin-top: 16px;
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
}

.assessment-grid--sticky.is-collapsed {
  align-self: flex-end;
  margin-left: auto;
  width: fit-content;
  max-width: 100%;
  padding: 5px 8px;
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
  justify-content: space-between;
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
  margin: 0 0 3px;
  font-size: 12px;
  line-height: 1.25;
}

.assessment-grid--sticky .field-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3px 5px;
}

.assessment-grid--sticky .field-grid label {
  font-size: 9px;
  gap: 2px;
}

.assessment-grid--sticky .field-grid input,
.assessment-grid--sticky .field-grid select {
  padding: 2px 5px;
  font-size: 9px;
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
  flex-direction: column;
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
}

.preset-modes-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  justify-content: space-between;
  gap: 8px;
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
  min-width: 0;
  max-height: 200px;
  overflow: hidden;
  transition: max-height 220ms ease;
}

.cloud-tags-bar.is-collapsed .cloud-tags {
  max-height: 32px;
}

.cloud-tags-toggle {
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
  padding: 10px;
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

.resource-cost-table td:nth-child(6),
.resource-cost-table td:nth-child(7) {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
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

.resource-empty {
  text-align: center;
  color: #64748b;
  padding: 14px 8px;
}

.error {
  margin: 8px 0 0;
  color: #b42318;
  font-size: 12px;
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

  .main {
    padding: 16px;
  }

  .main--assessment {
    padding-top: 2px;
  }
}
</style>
