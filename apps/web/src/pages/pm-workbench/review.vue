<template>
  <div class="pm-page">
    <el-card>
      <template #header>
        <div class="page-header">
          <span>质量门审</span>
          <el-button type="primary" :loading="reviewing" @click="handleAutoReview">自动审阅</el-button>
        </div>
      </template>

      <template v-if="review">
        <el-descriptions :column="2" border size="small" class="meta-desc">
          <el-descriptions-item label="ID">{{ review.reviewId }}</el-descriptions-item>
          <el-descriptions-item label="结论">
            <el-tag :type="review.verdict === 'pass' ? 'success' : 'danger'" size="large" effect="dark">
              {{ review.verdict === 'pass' ? '✅ 通过' : '❌ 拒绝' }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <div class="section-title">检查清单</div>
        <el-table :data="checklistItems" stripe border size="small">
          <el-table-column prop="label" label="检查项" min-width="240" />
          <el-table-column prop="pass" label="结果" width="100">
            <template #default="{ row }">
              <el-tag :type="row.pass ? 'success' : 'danger'">{{ row.pass ? '通过' : '未通过' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>

        <div class="section-title" v-if="review.rejectionReasons?.length">拒绝原因</div>
        <el-alert
          v-for="(r, i) in review.rejectionReasons"
          :key="i"
          :title="r.field"
          :description="r.reason + (r.suggestion ? ` | 建议: ${r.suggestion}` : '')"
          type="error"
          show-icon
          :closable="false"
          style="margin-bottom: 8px;"
        />

        <div class="section-title" v-if="review.notes">备注</div>
        <p class="notes">{{ review.notes }}</p>
      </template>

      <el-empty v-else description="暂无审阅记录，点击上方按钮生成">
        <el-button type="primary" @click="handleAutoReview">自动审阅</el-button>
      </el-empty>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { autoReview, type QualityGateReview } from '@/api/pm'

const review = ref<QualityGateReview | null>(null)
const reviewing = ref(false)

const checklistItems = computed(() => {
  if (!review.value) return []
  const c = review.value.checklist
  return [
    { label: '交付物齐全', pass: c.deliverablesComplete },
    { label: '七阶段方法论', pass: c.methodologySevenPhases },
    { label: '费率正确', pass: c.rateCardCorrect },
    { label: '叙事完整', pass: c.narrativeComplete },
    { label: '假设已记录', pass: c.assumptionsDocumented },
  ]
})

async function handleAutoReview() {
  reviewing.value = true
  try {
    const r = await autoReview({
      assessmentVersionId: '00000000-0000-0000-0000-000000000000',
      deliverables: [],
    })
    review.value = r
    ElMessage.success('审阅完成')
  } catch (e) {
    ElMessage.error('审阅失败')
  } finally {
    reviewing.value = false
  }
}
</script>

<style scoped>
.pm-page {
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
.meta-desc {
  margin-bottom: 16px;
}
.section-title {
  margin: 16px 0 8px;
  font-weight: 600;
  font-size: 15px;
  color: #303133;
}
.notes {
  color: #606266;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}
</style>
