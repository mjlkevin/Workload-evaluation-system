<template>
  <div class="presales-detail-page">
    <!-- 基础信息 -->
    <el-card v-loading="loadingPack">
      <template #header>
        <div class="page-header">
          <span>需求包详情</span>
          <div class="header-actions">
            <el-button type="primary" :loading="reviewing" @click="handleReview">审阅</el-button>
            <el-button @click="$router.push(`/presales/${packId}/initial-estimate`)">初估包</el-button>
            <el-button @click="$router.push(`/presales/${packId}/sow`)">SOW</el-button>
          </div>
        </div>
      </template>

      <el-descriptions :column="2" border>
        <el-descriptions-item label="ID">{{ pack?.requirementPackId }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="statusType(pack?.status)">{{ statusLabel(pack?.status) }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="行业">{{ pack?.industry || '-' }}</el-descriptions-item>
        <el-descriptions-item label="规模">{{ pack?.scale || '-' }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDate(pack?.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ formatDate(pack?.updatedAt) }}</el-descriptions-item>
      </el-descriptions>

      <div class="section-title">模块</div>
      <el-table :data="pack?.modules || []" stripe size="small" border>
        <el-table-column prop="moduleName" label="模块名" />
        <el-table-column prop="subModules" label="子模块">
          <template #default="{ row }">
            <el-tag v-for="(s, i) in row.subModules || []" :key="i" size="small" style="margin-right: 4px;">{{ s }}</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <div class="section-title">约束条件</div>
      <el-tag v-for="(c, i) in pack?.constraints || []" :key="i" type="warning" style="margin-right: 4px; margin-bottom: 4px;">
        {{ typeof c === 'string' ? c : JSON.stringify(c) }}
      </el-tag>
      <el-empty v-if="!pack?.constraints?.length" description="无约束条件" :image-size="60" />
    </el-card>

    <!-- 审阅结果 -->
    <el-card v-if="reviewResult" class="review-card">
      <template #header>
        <div class="page-header">
          <span>审阅结果</span>
          <el-tag :type="reviewResult.confidenceSummary.overall >= 0.8 ? 'success' : 'warning'">
            置信度 {{ (reviewResult.confidenceSummary.overall * 100).toFixed(1) }}%
          </el-tag>
        </div>
      </template>

      <!-- Violations -->
      <div class="section-title">违规项</div>
      <div v-for="sev in (['error', 'warning', 'info'] as const)" :key="sev">
        <div v-for="(v, idx) in groupedViolations[sev]" :key="idx" class="review-item" :class="sev">
          <el-alert
            :title="v.message"
            :type="sev"
            :description="`规则: ${v.ruleId}${v.fieldPath ? ' | 字段: ' + v.fieldPath : ''}`"
            :closable="false"
            show-icon
          />
        </div>
      </div>
      <el-empty v-if="!reviewResult.violations.length" description="无违规项" :image-size="60" />

      <!-- Inquiries -->
      <div class="section-title">问询项</div>
      <div v-for="sev in (['error', 'warning', 'info'] as const)" :key="sev">
        <div v-for="(inq, idx) in groupedInquiries[sev]" :key="idx" class="review-item" :class="sev">
          <el-alert
            :title="inq.question"
            :type="sev"
            :description="inq.suggestion"
            :closable="false"
            show-icon
          />
        </div>
      </div>
      <el-empty v-if="!reviewResult.inquiries.length" description="无问询项" :image-size="60" />

      <!-- Confidence Summary -->
      <div class="section-title">置信度维度</div>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item v-for="(val, key) in reviewResult.confidenceSummary.byDimension" :key="key" :label="key">
          {{ (val * 100).toFixed(1) }}%
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 字段级置信度 -->
    <el-card v-loading="loadingConfidences">
      <template #header>
        <span>字段级置信度</span>
      </template>
      <el-table :data="confidences" stripe size="small" border>
        <el-table-column prop="fieldPath" label="字段" min-width="160" />
        <el-table-column prop="value" label="值" min-width="140" />
        <el-table-column prop="confidence" label="置信度" width="120">
          <template #default="{ row }">
            <el-progress :percentage="Math.round(row.confidence * 100)" :color="progressColor" />
          </template>
        </el-table-column>
        <el-table-column prop="method" label="方法" width="120" />
        <el-table-column prop="sourceKind" label="来源" width="120" />
      </el-table>
      <el-empty v-if="!confidences.length" description="无字段置信度数据" :image-size="60" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  getPack,
  reviewPack,
  getPackConfidences,
  type RequirementPack,
  type ReviewResult,
  type FieldConfidence,
} from '@/api/presales'

const route = useRoute()
const packId = computed(() => route.params.id as string)

const pack = ref<RequirementPack | null>(null)
const reviewResult = ref<ReviewResult | null>(null)
const confidences = ref<FieldConfidence[]>([])
const loadingPack = ref(false)
const reviewing = ref(false)
const loadingConfidences = ref(false)

const groupedViolations = computed(() => ({
  error: reviewResult.value?.violations.filter((v) => v.severity === 'error') || [],
  warning: reviewResult.value?.violations.filter((v) => v.severity === 'warning') || [],
  info: reviewResult.value?.violations.filter((v) => v.severity === 'info') || [],
}))

const groupedInquiries = computed(() => ({
  error: reviewResult.value?.inquiries.filter((i) => i.severity === 'error') || [],
  warning: reviewResult.value?.inquiries.filter((i) => i.severity === 'warning') || [],
  info: reviewResult.value?.inquiries.filter((i) => i.severity === 'info') || [],
}))

const progressColor = [
  { color: '#f56c6c', percentage: 50 },
  { color: '#e6a23c', percentage: 80 },
  { color: '#67c23a', percentage: 100 },
]

function statusType(status?: string) {
  const map: Record<string, string> = { draft: 'info', confirmed: 'success', deprecated: 'danger' }
  return map[status || ''] || 'info'
}

function statusLabel(status?: string) {
  const map: Record<string, string> = { draft: '草稿', confirmed: '已确认', deprecated: '已废弃' }
  return map[status || ''] || status || '-'
}

function formatDate(d?: string | null) {
  if (!d) return '-'
  return new Date(d).toLocaleString('zh-CN')
}

async function fetchPack() {
  loadingPack.value = true
  try {
    pack.value = await getPack(packId.value)
  } catch (e) {
    ElMessage.error('加载需求包失败')
  } finally {
    loadingPack.value = false
  }
}

async function fetchConfidences() {
  loadingConfidences.value = true
  try {
    confidences.value = await getPackConfidences(packId.value)
  } catch (e) {
    console.error(e)
  } finally {
    loadingConfidences.value = false
  }
}

async function handleReview() {
  reviewing.value = true
  try {
    reviewResult.value = await reviewPack(packId.value)
    ElMessage.success('审阅完成')
  } catch (e) {
    ElMessage.error('审阅失败')
  } finally {
    reviewing.value = false
  }
}

onMounted(() => {
  fetchPack()
  fetchConfidences()
})
</script>

<style scoped>
.presales-detail-page {
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
.header-actions {
  display: flex;
  gap: 8px;
}
.section-title {
  margin: 16px 0 8px;
  font-weight: 600;
  font-size: 15px;
  color: #303133;
}
.review-card {
  margin-top: 16px;
}
.review-item {
  margin-bottom: 8px;
}
</style>
