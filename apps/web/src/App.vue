<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
  details?: Array<{ field: string; reason: string }>;
  requestId?: string;
};

type CalculateResult = {
  templateId: string;
  ruleSetId: string;
  templateVersion: string;
  baseDays: number;
  userIncrementDays: number;
  difficultyIncrementDays: number;
  orgIncrementDays: number;
  totalDays: number;
  ruleVersion: string;
  pipelineVersion: string;
  groupSubtotals: Array<{ groupId: string; groupName: string; subtotalDays: number }>;
  itemResults: Array<{
    templateItemId: string;
    included: boolean;
    standardDays: number;
    itemSubtotalDays: number;
  }>;
  calculationBreakdown: {
    userCountTier: { hitRange: string; factor: number; incrementDays: number };
    difficulty: { factor: number; incrementDays: number };
    organization: { orgCount: number; similarityFactor: number; incrementDays: number };
  };
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

type TemplateOption = {
  templateId: string;
  templateVersion: string;
  templateName: string;
};

type TemplateGroup = {
  groupId: string;
  groupName: string;
};

type TemplateItem = {
  templateItemId: string;
  groupId: string;
  itemName: string;
  standardDays: number;
};

type TemplateDetail = {
  templateId: string;
  templateVersion: string;
  templateName: string;
  groups: TemplateGroup[];
  items: TemplateItem[];
};

type RuleSetActive = {
  ruleSetId: string;
  baseRule: {
    difficultyFactorList: number[];
  };
};

const form = ref({
  templateId: "tmpl-demo-001",
  ruleSetId: "rules-demo-001",
  userCount: 120,
  difficultyFactor: 0.2,
  orgCount: 3,
  orgSimilarityFactor: 0.6
});

const loading = ref(false);
const exporting = ref(false);
const initLoading = ref(false);
const historyLoading = ref(false);
const historyLoadingMore = ref(false);
const error = ref("");
const initError = ref("");
const actionMessage = ref("");
const result = ref<CalculateResult | null>(null);
const calculateRequestId = ref("");
const exportInfo = ref<ExportResult | null>(null);
const exportRequestId = ref("");
const exportHistory = ref<ExportHistoryItem[]>([]);
const historyError = ref("");
const historyPage = ref(1);
const historyPageSize = ref(8);
const historyTotal = ref(0);
const templateOptions = ref<TemplateOption[]>([]);
const difficultyOptions = ref<number[]>([0, 0.1, 0.2, 0.3]);
const templateDetail = ref<TemplateDetail | null>(null);
const itemSelection = ref<Record<string, boolean>>({});

const payload = computed(() => ({
  templateId: form.value.templateId,
  ruleSetId: form.value.ruleSetId,
  userCount: Number(form.value.userCount),
  difficultyFactor: Number(form.value.difficultyFactor),
  orgCount: Number(form.value.orgCount),
  orgSimilarityFactor: Number(form.value.orgSimilarityFactor),
  items:
    templateDetail.value?.items.map((item) => ({
      templateItemId: item.templateItemId,
      included: itemSelection.value[item.templateItemId] ?? false
    })) ?? []
}));

async function calculate() {
  loading.value = true;
  error.value = "";
  exportInfo.value = null;
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
    calculateRequestId.value = data.requestId || "";
  } catch (err) {
    result.value = null;
    error.value = err instanceof Error ? err.message : "计算失败";
  } finally {
    loading.value = false;
  }
}

async function loadInitialOptions() {
  initLoading.value = true;
  initError.value = "";
  try {
    const [templatesRes, rulesRes] = await Promise.all([
      fetch("/api/v1/templates"),
      fetch("/api/v1/rule-sets/active")
    ]);
    const templatesPayload = (await templatesRes.json()) as ApiResponse<{ list: TemplateOption[] }>;
    const rulesPayload = (await rulesRes.json()) as ApiResponse<RuleSetActive>;

    if (!templatesRes.ok || templatesPayload.code !== 0) {
      throw new Error(templatesPayload.message || "读取模板列表失败");
    }
    if (!rulesRes.ok || rulesPayload.code !== 0) {
      throw new Error(rulesPayload.message || "读取规则集失败");
    }

    templateOptions.value = templatesPayload.data.list || [];
    if (templateOptions.value.length > 0) {
      form.value.templateId = templateOptions.value[0].templateId;
      await loadTemplateDetail(form.value.templateId);
    }
    form.value.ruleSetId = rulesPayload.data.ruleSetId;
    if (Array.isArray(rulesPayload.data.baseRule?.difficultyFactorList)) {
      difficultyOptions.value = rulesPayload.data.baseRule.difficultyFactorList;
      if (!difficultyOptions.value.includes(form.value.difficultyFactor)) {
        form.value.difficultyFactor = difficultyOptions.value[0] ?? 0;
      }
    }
  } catch (err) {
    initError.value = err instanceof Error ? err.message : "初始化失败";
  } finally {
    initLoading.value = false;
  }
}

async function loadTemplateDetail(templateId: string) {
  const response = await fetch(`/api/v1/templates/${templateId}`);
  const payload = (await response.json()) as ApiResponse<TemplateDetail>;
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || "读取模板详情失败");
  }
  templateDetail.value = payload.data;
  const nextSelection: Record<string, boolean> = {};
  for (const item of payload.data.items) {
    // Default checked to keep behavior close to spreadsheet baseline.
    nextSelection[item.templateItemId] = true;
  }
  itemSelection.value = nextSelection;
}

async function onTemplateChange() {
  initError.value = "";
  initLoading.value = true;
  try {
    await loadTemplateDetail(form.value.templateId);
    result.value = null;
    exportInfo.value = null;
  } catch (err) {
    initError.value = err instanceof Error ? err.message : "读取模板详情失败";
  } finally {
    initLoading.value = false;
  }
}

function selectAllItems(checked: boolean) {
  if (!templateDetail.value) {
    return;
  }
  const nextSelection: Record<string, boolean> = {};
  for (const item of templateDetail.value.items) {
    nextSelection[item.templateItemId] = checked;
  }
  itemSelection.value = nextSelection;
}

async function calculateAndExport(exportType: "excel" | "pdf") {
  exporting.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/v1/estimates/calculate-and-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload.value, exportType })
    });
    const data = (await response.json()) as ApiResponse<ExportResult>;
    if (!response.ok || data.code !== 0) {
      throw new Error(data.message || "导出失败");
    }
    exportInfo.value = data.data;
    exportRequestId.value = data.requestId || "";
    await loadExportHistory(true);
    window.open(data.data.downloadUrl, "_blank");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "导出失败";
  } finally {
    exporting.value = false;
  }
}

async function copyText(text: string, successText: string) {
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    actionMessage.value = successText;
    setTimeout(() => {
      actionMessage.value = "";
    }, 1800);
  } catch (_err) {
    actionMessage.value = "复制失败，请手动复制";
  }
}

async function copyResultJson() {
  if (!result.value) {
    return;
  }
  const payload = {
    requestId: calculateRequestId.value || undefined,
    result: result.value
  };
  await copyText(JSON.stringify(payload, null, 2), "结果 JSON 已复制");
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadExportHistory(reset = false) {
  if (reset) {
    historyPage.value = 1;
  }
  if (reset) {
    historyLoading.value = true;
  } else {
    historyLoadingMore.value = true;
  }
  historyError.value = "";
  try {
    const response = await fetch(
      `/api/v1/exports/history?page=${historyPage.value}&pageSize=${historyPageSize.value}`
    );
    const payload = (await response.json()) as ApiResponse<{
      page: number;
      pageSize: number;
      total: number;
      items: ExportHistoryItem[];
    }>;
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.message || "读取导出历史失败");
    }
    historyTotal.value = payload.data.total;
    if (reset) {
      exportHistory.value = payload.data.items;
    } else {
      exportHistory.value = [...exportHistory.value, ...payload.data.items];
    }
    historyPage.value += 1;
  } catch (err) {
    historyError.value = err instanceof Error ? err.message : "读取导出历史失败";
  } finally {
    historyLoading.value = false;
    historyLoadingMore.value = false;
  }
}

async function refreshExportHistory() {
  await loadExportHistory(true);
}

const hasMoreHistory = computed(() => exportHistory.value.length < historyTotal.value);
const selectedItemCount = computed(
  () => Object.values(itemSelection.value).filter(Boolean).length
);
const groupedTemplateItems = computed(() => {
  if (!templateDetail.value) {
    return [];
  }
  return templateDetail.value.groups.map((group) => ({
    groupId: group.groupId,
    groupName: group.groupName,
    items: templateDetail.value?.items.filter((item) => item.groupId === group.groupId) ?? []
  }));
});
const groupPreviewRows = computed(() =>
  groupedTemplateItems.value.map((group) => {
    const selectedCount = group.items.filter((item) => itemSelection.value[item.templateItemId]).length;
    const subtotalDays = group.items.reduce((sum, item) => {
      return sum + (itemSelection.value[item.templateItemId] ? item.standardDays : 0);
    }, 0);
    return {
      groupId: group.groupId,
      groupName: group.groupName,
      selectedCount,
      totalCount: group.items.length,
      subtotalDays
    };
  })
);
const localBasePreview = computed(() =>
  groupPreviewRows.value.reduce((sum, row) => sum + row.subtotalDays, 0)
);
const includedItemResults = computed(
  () => result.value?.itemResults.filter((item) => item.included) ?? []
);
function getTemplateItemName(templateItemId: string): string {
  return templateDetail.value?.items.find((item) => item.templateItemId === templateItemId)?.itemName || templateItemId;
}

onMounted(() => {
  void loadInitialOptions();
  void loadExportHistory(true);
});
</script>

<template>
  <main class="page">
    <section class="card">
      <h1>工作量评估系统</h1>
      <p class="subtitle">Calendly 风格录入页（最小闭环）</p>
      <p v-if="initError" class="error">{{ initError }}</p>

      <div class="grid">
        <label>
          模板
          <select
            v-model="form.templateId"
            :disabled="initLoading || templateOptions.length === 0"
            @change="onTemplateChange"
          >
            <option v-for="item in templateOptions" :key="item.templateId" :value="item.templateId">
              {{ item.templateName }} ({{ item.templateVersion }})
            </option>
          </select>
        </label>
        <label>
          规则集 ID
          <input v-model="form.ruleSetId" :disabled="initLoading" />
        </label>
        <label>用户数<input v-model.number="form.userCount" type="number" min="0" /></label>
        <label>
          难度系数
          <select v-model.number="form.difficultyFactor">
            <option v-for="item in difficultyOptions" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label>组织数<input v-model.number="form.orgCount" type="number" min="0" /></label>
        <label>
          组织相似度
          <input v-model.number="form.orgSimilarityFactor" type="number" min="0" max="1" step="0.1" />
        </label>
      </div>

      <section class="result">
        <div class="history-head">
          <h2>模板条目勾选</h2>
          <div class="actions">
            <button class="link-btn" @click="selectAllItems(true)">全选</button>
            <button class="link-btn" @click="selectAllItems(false)">全不选</button>
          </div>
        </div>
        <p class="meta">
          已勾选 {{ selectedItemCount }} / {{ templateDetail?.items.length ?? 0 }} 项
        </p>
        <p v-if="!templateDetail" class="meta">暂无模板条目</p>
        <div v-else class="group-list">
          <div v-for="group in groupedTemplateItems" :key="group.groupId" class="group-card">
            <h3>{{ group.groupName }}</h3>
            <label v-for="item in group.items" :key="item.templateItemId" class="checkbox row">
              <span class="left">
                <input v-model="itemSelection[item.templateItemId]" type="checkbox" />
                {{ item.itemName }}
              </span>
              <span class="meta">{{ item.standardDays }} 人天</span>
            </label>
          </div>
        </div>
        <div v-if="groupPreviewRows.length > 0" class="preview-card">
          <h3>本地实时预览（未叠加增量规则）</h3>
          <p class="meta">基础人天预估：{{ localBasePreview }}</p>
          <ul class="history-list compact">
            <li v-for="row in groupPreviewRows" :key="row.groupId">
              <span>{{ row.groupName }}</span>
              <span class="meta">
                {{ row.selectedCount }}/{{ row.totalCount }} 项 · 小计 {{ row.subtotalDays }} 人天
              </span>
            </li>
          </ul>
        </div>
      </section>

      <button class="btn" :disabled="loading || initLoading" @click="calculate">
        {{ loading ? "计算中..." : "计算人天" }}
      </button>
      <div class="actions">
        <button class="btn secondary" :disabled="exporting || initLoading" @click="calculateAndExport('excel')">
          {{ exporting ? "导出中..." : "计算并导出 Excel" }}
        </button>
        <button class="btn ghost" :disabled="exporting || initLoading" @click="calculateAndExport('pdf')">
          {{ exporting ? "导出中..." : "计算并导出 PDF" }}
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="actionMessage" class="meta">{{ actionMessage }}</p>

      <section v-if="result" class="result">
        <h2>计算结果</h2>
        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="meta">总人天</span>
            <strong>{{ result.totalDays }}</strong>
          </div>
          <div class="kpi-card">
            <span class="meta">基础人天</span>
            <strong>{{ result.baseDays }}</strong>
          </div>
          <div class="kpi-card">
            <span class="meta">用户增量</span>
            <strong>{{ result.userIncrementDays }}</strong>
          </div>
          <div class="kpi-card">
            <span class="meta">难度增量</span>
            <strong>{{ result.difficultyIncrementDays }}</strong>
          </div>
          <div class="kpi-card">
            <span class="meta">组织增量</span>
            <strong>{{ result.orgIncrementDays }}</strong>
          </div>
        </div>
        <p class="meta">
          template={{ result.templateId }}@{{ result.templateVersion }} | rule={{ result.ruleVersion }} | pipeline={{
            result.pipelineVersion
          }}
        </p>
        <div class="inline-actions">
          <p v-if="calculateRequestId" class="meta">requestId: {{ calculateRequestId }}</p>
          <button v-if="calculateRequestId" class="link-btn" @click="copyText(calculateRequestId, 'requestId 已复制')">
            复制 requestId
          </button>
          <button class="link-btn" @click="copyResultJson">复制 JSON</button>
        </div>

        <div class="split">
          <div class="result-card">
            <h3>增量解释</h3>
            <p class="meta">
              用户分段：{{ result.calculationBreakdown.userCountTier.hitRange }}，系数
              {{ result.calculationBreakdown.userCountTier.factor }}，增量
              {{ result.calculationBreakdown.userCountTier.incrementDays }}
            </p>
            <p class="meta">
              难度系数：{{ result.calculationBreakdown.difficulty.factor }}，增量
              {{ result.calculationBreakdown.difficulty.incrementDays }}
            </p>
            <p class="meta">
              组织：{{ result.calculationBreakdown.organization.orgCount }} 个，相似度
              {{ result.calculationBreakdown.organization.similarityFactor }}，增量
              {{ result.calculationBreakdown.organization.incrementDays }}
            </p>
          </div>
          <div class="result-card">
            <h3>分组小计</h3>
            <ul class="history-list compact">
              <li v-for="group in result.groupSubtotals" :key="group.groupId">
                <span>{{ group.groupName }}</span>
                <span class="meta">{{ group.subtotalDays }} 人天</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="result-card">
          <h3>已选条目明细</h3>
          <ul class="history-list compact">
            <li v-for="item in includedItemResults" :key="item.templateItemId">
              <span>{{ getTemplateItemName(item.templateItemId) }}</span>
              <span class="meta">{{ item.itemSubtotalDays }} 人天（标准 {{ item.standardDays }}）</span>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="exportInfo" class="result">
        <h2>导出结果</h2>
        <p>总人天：{{ exportInfo.totalDays }}</p>
        <p>
          下载链接：
          <a :href="exportInfo.downloadUrl" target="_blank">{{ exportInfo.downloadUrl }}</a>
        </p>
        <p class="meta">过期时间：{{ exportInfo.expireAt }}</p>
        <div class="inline-actions">
          <p v-if="exportRequestId" class="meta">requestId: {{ exportRequestId }}</p>
          <button v-if="exportRequestId" class="link-btn" @click="copyText(exportRequestId, 'requestId 已复制')">
            复制 requestId
          </button>
        </div>
      </section>

      <section class="result">
        <div class="history-head">
          <h2>最近导出记录</h2>
          <button class="link-btn" :disabled="historyLoading || historyLoadingMore" @click="refreshExportHistory">
            {{ historyLoading ? "刷新中..." : "刷新" }}
          </button>
        </div>
        <p v-if="!historyError" class="meta">共 {{ historyTotal }} 条记录</p>
        <p v-if="historyError" class="error">{{ historyError }}</p>
        <p v-else-if="historyLoading" class="meta">正在加载导出记录...</p>
        <p v-else-if="exportHistory.length === 0" class="meta">暂无导出记录</p>
        <ul v-else class="history-list">
          <li v-for="item in exportHistory" :key="item.fileName">
            <a :href="item.downloadUrl" target="_blank">{{ item.fileName }}</a>
            <span class="meta">{{ formatBytes(item.size) }} · {{ new Date(item.modifiedAt).toLocaleString() }}</span>
          </li>
        </ul>
        <button
          v-if="!historyError && !historyLoading && hasMoreHistory"
          class="link-btn"
          :disabled="historyLoadingMore"
          @click="loadExportHistory(false)"
        >
          {{ historyLoadingMore ? "加载中..." : "查看更多" }}
        </button>
      </section>
    </section>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  margin: 0;
  padding: 24px;
  background: #f8fafc;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #0f172a;
}

.card {
  width: min(780px, 96vw);
  margin: 0 auto;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 24px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.06);
}

h1 {
  margin: 0;
  font-size: 28px;
}

.subtitle {
  margin: 6px 0 20px;
  color: #475569;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
}

input,
select {
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
}

.checkbox {
  margin: 14px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkbox input {
  width: 16px;
  height: 16px;
}

.btn {
  border: 0;
  border-radius: 10px;
  background: #0b57d0;
  color: #fff;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.actions {
  margin-top: 10px;
  display: flex;
  gap: 10px;
}

.secondary {
  background: #2563eb;
}

.ghost {
  background: #0f172a;
}

.error {
  margin: 12px 0 0;
  color: #b42318;
}

.result {
  margin-top: 18px;
  border-top: 1px solid #e2e8f0;
  padding-top: 14px;
}

h2 {
  margin: 0 0 8px;
  font-size: 18px;
}

.result p {
  margin: 6px 0;
}

.meta {
  color: #64748b;
  font-size: 13px;
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.link-btn {
  border: 0;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  font-size: 13px;
}

.history-list {
  margin: 8px 0 0;
  padding-left: 18px;
}

.history-list li {
  margin: 8px 0;
}

.history-list a {
  color: #0b57d0;
  text-decoration: none;
  margin-right: 8px;
}

.group-list {
  display: grid;
  gap: 10px;
}

.group-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
}

h3 {
  margin: 0 0 8px;
  font-size: 15px;
}

.row {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin: 6px 0;
}

.left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.preview-card {
  margin-top: 12px;
  border: 1px dashed #cbd5e1;
  border-radius: 10px;
  padding: 10px 12px;
}

.compact {
  margin-top: 6px;
}

.inline-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.kpi-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kpi-card strong {
  font-size: 18px;
}

.split {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.result-card {
  margin-top: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
}
</style>
