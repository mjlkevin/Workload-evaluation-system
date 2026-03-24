<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type PageKey = "dashboard" | "assessment";

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

const currentPage = ref<PageKey>("dashboard");
const initLoading = ref(false);
const loading = ref(false);
const exporting = ref(false);
const error = ref("");

const templateOptions = ref<TemplateOption[]>([]);
const templateDetail = ref<TemplateDetail | null>(null);
const difficultyOptions = ref<number[]>([0, 0.1, 0.2, 0.3]);
const selectedSheet = ref("");
const itemSelection = ref<Record<string, boolean>>({});
const exportHistory = ref<ExportHistoryItem[]>([]);
const historyPage = ref(1);
const historyTotal = ref(0);

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

const sheets = computed(() => {
  if (!templateDetail.value) return [];
  if (templateDetail.value.sheets?.length) {
    return templateDetail.value.sheets.map((x) => x.sheetName);
  }
  return Array.from(new Set(templateDetail.value.items.map((item) => item.sheetName || "未分工作表")));
});

const filteredItems = computed(() => {
  if (!templateDetail.value) return [];
  const sheet = selectedSheet.value;
  if (!sheet) return templateDetail.value.items;
  return templateDetail.value.items.filter((item) => (item.sheetName || "未分工作表") === sheet);
});

const hierarchy = computed(() => {
  const cloudMap = new Map<string, Map<string, Map<string, TemplateItem[]>>>();
  for (const item of filteredItems.value) {
    const cloud = item.cloudProduct || "未分类云产品";
    const sku = item.skuName || "未分类SKU";
    const group = item.appGroup || "未分类应用分组";
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
        groupName,
        groupItems
      }))
    }))
  }));
});

const selectedCount = computed(
  () => filteredItems.value.filter((item) => itemSelection.value[item.templateItemId]).length
);
const baseDays = computed(() =>
  filteredItems.value.reduce((sum, item) => sum + (itemSelection.value[item.templateItemId] ? item.standardDays : 0), 0)
);

const payload = computed(() => ({
  templateId: form.value.templateId,
  ruleSetId: form.value.ruleSetId,
  userCount: Number(form.value.userCount),
  difficultyFactor: Number(form.value.difficultyFactor),
  orgCount: Number(form.value.orgCount),
  orgSimilarityFactor: Number(form.value.orgSimilarityFactor),
  items: (templateDetail.value?.items || []).map((item) => ({
    templateItemId: item.templateItemId,
    included: itemSelection.value[item.templateItemId] ?? false
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
  selectedSheet.value = data.data.sheets?.[0]?.sheetName || data.data.items[0]?.sheetName || "";
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
    window.open(data.data.downloadUrl, "_blank");
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
</script>

<template>
  <div class="dashboard-shell">
    <aside class="sidebar">
      <div class="sidebar-inner">
        <div class="brand">
          <div class="brand-icon">C</div>
          <span class="brand-text">Auth Portal</span>
        </div>

        <nav class="nav">
          <a href="#" class="nav-item" :class="{ active: currentPage === 'dashboard' }" @click.prevent="currentPage = 'dashboard'">
            <span class="nav-icon">🏠</span>
            <span>Dashboard</span>
          </a>
          <a href="#" class="nav-item" :class="{ active: currentPage === 'assessment' }" @click.prevent="currentPage = 'assessment'">
            <span class="nav-icon">👥</span>
            <span>评估</span>
          </a>
          <a href="#" class="nav-item">
            <span class="nav-icon">🔑</span>
            <span>API Keys</span>
          </a>
          <a href="#" class="nav-item">
            <span class="nav-icon">📄</span>
            <span>Logs</span>
          </a>
          <a href="#" class="nav-item">
            <span class="nav-icon">⚙️</span>
            <span>Settings</span>
          </a>
        </nav>
      </div>

      <div class="profile">
        <img
          class="avatar"
          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=facearea&facepad=2&w=120&h=120&q=80"
          alt="profile"
        />
        <div>
          <p class="profile-name">Tom Cook</p>
          <p class="profile-role">Admin</p>
        </div>
      </div>
    </aside>

    <div class="content-wrap">
      <header class="topbar">
        <h1 class="page-title">{{ currentPage === "dashboard" ? "Dashboard" : "评估工作台" }}</h1>
        <div class="topbar-actions">
          <button class="link-btn">Help</button>
          <button class="upgrade-btn">Upgrade Plan</button>
        </div>
      </header>

      <main class="main">
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

        <template v-else>
          <section class="section">
            <div class="assessment-grid">
              <article class="panel">
                <h2 class="section-title">参数配置</h2>
                <div class="field-grid">
                  <label>
                    模板
                    <select v-model="form.templateId" :disabled="initLoading" @change="onTemplateChange">
                      <option v-for="item in templateOptions" :key="item.templateId" :value="item.templateId">
                        {{ item.templateName }} ({{ item.templateVersion }})
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

              <article class="panel">
                <h2 class="section-title">实时预览</h2>
                <div class="kpi-grid mini">
                  <article class="kpi-card">
                    <div>
                      <p class="kpi-label">当前工作表</p>
                      <p class="kpi-value">{{ selectedSheet }}</p>
                    </div>
                  </article>
                  <article class="kpi-card">
                    <div>
                      <p class="kpi-label">已勾选项</p>
                      <p class="kpi-value">{{ selectedCount }}</p>
                    </div>
                  </article>
                  <article class="kpi-card">
                    <div>
                      <p class="kpi-label">基础人天</p>
                      <p class="kpi-value">{{ baseDays }}</p>
                    </div>
                  </article>
                </div>
              </article>
            </div>
          </section>

          <section class="section">
            <div class="section-head">
              <h2 class="section-title">模板条目勾选</h2>
              <div class="inline-controls">
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
              </div>
            </div>
            <p v-if="error" class="error">{{ error }}</p>

            <div class="sheet-tabs">
              <button
                v-for="sheet in sheets"
                :key="sheet"
                class="sheet-btn"
                :class="{ active: selectedSheet === sheet }"
                @click="selectedSheet = sheet"
              >
                {{ sheet }}
              </button>
            </div>

            <div class="tree-grid">
              <article v-for="cloud in hierarchy" :key="cloud.cloudName" class="tree-card">
                <h3 class="tree-title">云产品：{{ cloud.cloudName }}</h3>
                <div v-for="sku in cloud.skuList" :key="`${cloud.cloudName}-${sku.skuName}`" class="tree-level">
                  <h4 class="tree-subtitle">SKU：{{ sku.skuName }}</h4>
                  <div
                    v-for="group in sku.groups"
                    :key="`${cloud.cloudName}-${sku.skuName}-${group.groupName}`"
                    class="tree-group"
                  >
                    <h5 class="tree-subtitle">应用分组：{{ group.groupName }}</h5>
                    <label v-for="item in group.groupItems" :key="item.templateItemId" class="tree-item">
                      <span class="tree-item-left">
                        <input v-model="itemSelection[item.templateItemId]" type="checkbox" />
                        <span>
                          <strong>{{ item.deliveryModule || item.itemName }}</strong>
                          <small>{{ item.deliveryPoint || item.itemName }}</small>
                        </span>
                      </span>
                      <span class="item-badge">{{ item.standardDays }} 人天</span>
                    </label>
                  </div>
                </div>
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
                  <a :href="exportInfo.downloadUrl" target="_blank" class="details-link">点击下载</a>
                </p>
                <ul class="history-list">
                  <li v-for="item in exportHistory" :key="item.fileName">
                    <a :href="item.downloadUrl" target="_blank">{{ item.fileName }}</a>
                    <span class="meta">{{ new Date(item.modifiedAt).toLocaleString() }}</span>
                  </li>
                </ul>
                <button v-if="hasMoreHistory" class="mini-btn" @click="loadExportHistory(false)">查看更多</button>
              </article>
            </div>
          </section>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
.dashboard-shell {
  min-height: 100vh;
  display: flex;
  background: #f8fafc;
  color: #111827;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.sidebar {
  width: 256px;
  background: #fff;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.sidebar-inner {
  padding: 24px;
}

.brand {
  display: flex;
  align-items: center;
  margin-bottom: 32px;
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
  margin-left: 12px;
  font-weight: 600;
  color: #111827;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: #4b5563;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
  padding: 9px 10px;
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
}

.profile {
  border-top: 1px solid #e5e7eb;
  padding: 18px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
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

.content-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: #111827;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.link-btn {
  border: 0;
  background: transparent;
  color: #374151;
  font-size: 14px;
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
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.upgrade-btn:hover {
  background: #6d28d9;
}

.main {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.section {
  margin-bottom: 30px;
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

.tree-grid {
  display: grid;
  gap: 12px;
}

.tree-card {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  padding: 10px 12px;
}

.tree-title {
  margin: 0 0 10px;
  font-size: 14px;
  color: #111827;
}

.tree-level {
  margin-left: 6px;
  padding-left: 8px;
  border-left: 2px solid #ede9fe;
}

.tree-subtitle {
  margin: 6px 0;
  font-size: 12px;
  color: #4b5563;
}

.tree-group {
  margin-bottom: 6px;
}

.tree-item {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 8px;
  margin: 4px 0;
  padding: 6px 8px;
  border: 1px solid #f3f4f6;
  border-radius: 8px;
  background: #fcfcfd;
  width: 100%;
  text-align: left;
}

.tree-item-left {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  flex: 1;
  text-align: left;
  justify-content: flex-start;
}

.tree-item-left input {
  margin-top: 1px;
}

.tree-item-left > span {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.tree-item-left strong {
  display: block;
  font-size: 12px;
  line-height: 1.25;
  color: #111827;
}

.tree-item-left small {
  display: block;
  margin-top: 1px;
  font-size: 11px;
  color: #6b7280;
}

.item-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  background: #f5f3ff;
  color: #6d28d9;
  margin-left: auto;
  white-space: nowrap;
}

.history-list {
  margin: 8px 0 0;
  padding-left: 18px;
}

.history-list li {
  margin: 6px 0;
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

  .main {
    padding: 16px;
  }
}
</style>
