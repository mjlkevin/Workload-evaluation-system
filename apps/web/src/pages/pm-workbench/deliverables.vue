<template>
  <div class="pm-page">
    <el-card>
      <template #header>
        <div class="page-header">
          <span>四大交付物</span>
          <el-button type="primary" :loading="generating" @click="handleGenerate">生成交付物</el-button>
        </div>
      </template>

      <el-row :gutter="16">
        <el-col :span="12" v-for="d in deliverables" :key="d.deliverableId" class="deliverable-col">
          <el-card class="deliverable-card" :class="d.deliverableType" shadow="hover">
            <template #header>
              <div class="deliverable-header">
                <span>{{ deliverableTitle(d.deliverableType) }}</span>
                <el-tag :type="d.status === 'confirmed' ? 'success' : 'info'" size="small">
                  {{ d.status === 'confirmed' ? '已确认' : '草稿' }}
                </el-tag>
              </div>
            </template>

            <div class="deliverable-content">
              <pre v-if="typeof d.content === 'object'">{{ JSON.stringify(d.content, null, 2) }}</pre>
              <pre v-else>{{ d.content }}</pre>
            </div>

            <div class="deliverable-actions">
              <el-button size="small" type="success" @click="confirmDeliverable(d)" :disabled="d.status === 'confirmed'">
                确认
              </el-button>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <el-empty v-if="!deliverables.length" description="暂无交付物，点击上方按钮生成" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { generateDeliverables, updateDeliverableStatus, type Deliverable } from '@/api/pm'

const deliverables = ref<Deliverable[]>([])
const generating = ref(false)

function deliverableTitle(type: string) {
  const map: Record<string, string> = {
    effort_table: '工作量表',
    resource_cost: '资源成本',
    variance_analysis: '偏差分析',
    wbs: 'WBS 拆分',
  }
  return map[type] || type
}

async function handleGenerate() {
  generating.value = true
  try {
    const items = await generateDeliverables({
      assessmentVersionId: '00000000-0000-0000-0000-000000000000',
    })
    deliverables.value = items
    ElMessage.success('生成成功')
  } catch (e) {
    ElMessage.error('生成失败')
  } finally {
    generating.value = false
  }
}

async function confirmDeliverable(d: Deliverable) {
  try {
    await updateDeliverableStatus(d.deliverableId, 'confirmed')
    d.status = 'confirmed'
    ElMessage.success('已确认')
  } catch (e) {
    ElMessage.error('操作失败')
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
.deliverable-col {
  margin-bottom: 16px;
}
.deliverable-card {
  height: 100%;
}
.deliverable-card :deep(.el-card__header) {
  padding: 12px 16px;
}
.deliverable-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
.deliverable-content {
  background: #f5f7fa;
  border-radius: 4px;
  padding: 12px;
  max-height: 300px;
  overflow: auto;
}
.deliverable-content pre {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.deliverable-actions {
  margin-top: 12px;
  text-align: right;
}
</style>
