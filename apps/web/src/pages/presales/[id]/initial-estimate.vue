<template>
  <div class="presales-estimate-page">
    <el-card v-loading="loading">
      <template #header>
        <div class="page-header">
          <span>初估包</span>
          <el-button type="primary" :loading="generating" @click="handleGenerate">生成初估</el-button>
        </div>
      </template>

      <template v-if="estimate">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="ID">{{ estimate.initialEstimateId }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(estimate.status)">{{ statusLabel(estimate.status) }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <div class="section-title">工作量估算</div>
        <el-table :data="estimate.effortEstimate" stripe border size="small">
          <el-table-column prop="module" label="模块" min-width="160" />
          <el-table-column prop="days" label="人天" width="100" />
          <el-table-column prop="basis" label="依据" min-width="200" />
        </el-table>

        <div class="section-title">风险标签</div>
        <el-tag
          v-for="(tag, i) in estimate.riskTags"
          :key="i"
          type="danger"
          effect="dark"
          style="margin-right: 6px; margin-bottom: 4px;"
        >
          {{ tag }}
        </el-tag>
        <el-empty v-if="!estimate.riskTags.length" description="无风险标签" :image-size="60" />

        <div class="section-title">假设条件</div>
        <el-table :data="estimate.assumptions" stripe border size="small">
          <el-table-column prop="assumption" label="假设" min-width="200" />
          <el-table-column prop="rationale" label="理由" min-width="200" />
          <el-table-column prop="riskIfInvalid" label="失效风险" min-width="200" />
        </el-table>

        <div class="section-title">置信度评分</div>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item
            v-for="(val, key) in estimate.confidenceScores"
            :key="key"
            :label="key"
          >
            {{ (Number(val) * 100).toFixed(1) }}%
          </el-descriptions-item>
        </el-descriptions>

        <div class="section-title">分期方案</div>
        <el-table :data="estimate.phaseProposal" stripe border size="small">
          <el-table-column prop="phase" label="阶段" width="120" />
          <el-table-column prop="modules" label="模块" min-width="200">
            <template #default="{ row }">
              <el-tag v-for="(m, i) in row.modules" :key="i" size="small" style="margin-right: 4px;">{{ m }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="estimatedDays" label="预估人天" width="100" />
          <el-table-column prop="milestone" label="里程碑" min-width="200" />
        </el-table>
      </template>

      <el-empty v-else description="暂无初估包，点击上方按钮生成" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { generateInitialEstimate, type InitialEstimate } from '@/api/presales'

const route = useRoute()
const packId = computed(() => route.params.id as string)

const estimate = ref<InitialEstimate | null>(null)
const loading = ref(false)
const generating = ref(false)

function statusType(status?: string) {
  const map: Record<string, string> = {
    draft: 'info',
    reviewed: 'success',
    handed_off: 'primary',
    deprecated: 'danger',
  }
  return map[status || ''] || 'info'
}

function statusLabel(status?: string) {
  const map: Record<string, string> = {
    draft: '草稿',
    reviewed: '已审阅',
    handed_off: '已交接',
    deprecated: '已废弃',
  }
  return map[status || ''] || status || '-'
}

async function handleGenerate() {
  generating.value = true
  try {
    estimate.value = await generateInitialEstimate(packId.value)
    ElMessage.success('初估生成成功')
  } catch (e) {
    ElMessage.error('生成失败')
  } finally {
    generating.value = false
  }
}

onMounted(() => {
  // No list endpoint for estimates by pack; user clicks generate
})
</script>

<style scoped>
.presales-estimate-page {
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
.section-title {
  margin: 16px 0 8px;
  font-weight: 600;
  font-size: 15px;
  color: #303133;
}
</style>
