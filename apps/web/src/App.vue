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
  baseDays: number;
  userIncrementDays: number;
  difficultyIncrementDays: number;
  orgIncrementDays: number;
  totalDays: number;
  ruleVersion: string;
  pipelineVersion: string;
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

const form = ref({
  templateId: "tmpl-demo-001",
  ruleSetId: "rules-demo-001",
  userCount: 120,
  difficultyFactor: 0.2,
  orgCount: 3,
  orgSimilarityFactor: 0.6,
  included: true
});

const loading = ref(false);
const exporting = ref(false);
const historyLoading = ref(false);
const historyLoadingMore = ref(false);
const error = ref("");
const result = ref<CalculateResult | null>(null);
const exportInfo = ref<ExportResult | null>(null);
const exportHistory = ref<ExportHistoryItem[]>([]);
const historyError = ref("");
const historyPage = ref(1);
const historyPageSize = ref(8);
const historyTotal = ref(0);

const payload = computed(() => ({
  templateId: form.value.templateId,
  ruleSetId: form.value.ruleSetId,
  userCount: Number(form.value.userCount),
  difficultyFactor: Number(form.value.difficultyFactor),
  orgCount: Number(form.value.orgCount),
  orgSimilarityFactor: Number(form.value.orgSimilarityFactor),
  items: [{ templateItemId: "item-finance-voucher", included: form.value.included }]
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
  } catch (err) {
    result.value = null;
    error.value = err instanceof Error ? err.message : "计算失败";
  } finally {
    loading.value = false;
  }
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
    await loadExportHistory(true);
    window.open(data.data.downloadUrl, "_blank");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "导出失败";
  } finally {
    exporting.value = false;
  }
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

onMounted(() => {
  void loadExportHistory(true);
});
</script>

<template>
  <main class="page">
    <section class="card">
      <h1>工作量评估系统</h1>
      <p class="subtitle">Calendly 风格录入页（最小闭环）</p>

      <div class="grid">
        <label>模板 ID<input v-model="form.templateId" /></label>
        <label>规则集 ID<input v-model="form.ruleSetId" /></label>
        <label>用户数<input v-model.number="form.userCount" type="number" min="0" /></label>
        <label>
          难度系数
          <select v-model.number="form.difficultyFactor">
            <option :value="0">0</option>
            <option :value="0.1">0.1</option>
            <option :value="0.2">0.2</option>
            <option :value="0.3">0.3</option>
          </select>
        </label>
        <label>组织数<input v-model.number="form.orgCount" type="number" min="0" /></label>
        <label>
          组织相似度
          <input v-model.number="form.orgSimilarityFactor" type="number" min="0" max="1" step="0.1" />
        </label>
      </div>

      <label class="checkbox">
        <input v-model="form.included" type="checkbox" />
        包含“凭证管理”条目
      </label>

      <button class="btn" :disabled="loading" @click="calculate">
        {{ loading ? "计算中..." : "计算人天" }}
      </button>
      <div class="actions">
        <button class="btn secondary" :disabled="exporting" @click="calculateAndExport('excel')">
          {{ exporting ? "导出中..." : "计算并导出 Excel" }}
        </button>
        <button class="btn ghost" :disabled="exporting" @click="calculateAndExport('pdf')">
          {{ exporting ? "导出中..." : "计算并导出 PDF" }}
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <section v-if="result" class="result">
        <h2>计算结果</h2>
        <p>总人天：<strong>{{ result.totalDays }}</strong></p>
        <p>基础人天：{{ result.baseDays }}</p>
        <p>用户增量：{{ result.userIncrementDays }}</p>
        <p>难度增量：{{ result.difficultyIncrementDays }}</p>
        <p>组织增量：{{ result.orgIncrementDays }}</p>
        <p class="meta">ruleVersion: {{ result.ruleVersion }} | pipelineVersion: {{ result.pipelineVersion }}</p>
      </section>

      <section v-if="exportInfo" class="result">
        <h2>导出结果</h2>
        <p>总人天：{{ exportInfo.totalDays }}</p>
        <p>
          下载链接：
          <a :href="exportInfo.downloadUrl" target="_blank">{{ exportInfo.downloadUrl }}</a>
        </p>
        <p class="meta">过期时间：{{ exportInfo.expireAt }}</p>
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
</style>
