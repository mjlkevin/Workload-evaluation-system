<template>
  <div class="presales-sow-page">
    <el-card v-loading="loading">
      <template #header>
        <div class="page-header">
          <span>SOW 列表</span>
          <el-button type="primary" :loading="generating" @click="handleGenerate">生成 SOW</el-button>
        </div>
      </template>

      <el-table :data="sowList" stripe border v-loading="loading">
        <el-table-column prop="module" label="模块" min-width="140" />
        <el-table-column prop="category" label="分类" width="120">
          <template #default="{ row }">
            <el-tag :type="row.category === '定制开发' ? 'warning' : 'success'">{{ row.category || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="cloudProduct" label="云产品" width="140" />
        <el-table-column prop="description" label="范围描述" min-width="240" show-overflow-tooltip />
        <el-table-column prop="customizationScope" label="定制范围" min-width="200" show-overflow-tooltip />
        <el-table-column prop="version" label="版本" width="80" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!sowList.length" description="暂无 SOW，点击上方按钮生成" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { listSowByPack, generateSow, type SowDocument } from '@/api/presales'

const route = useRoute()
const packId = computed(() => route.params.id as string)

const sowList = ref<SowDocument[]>([])
const loading = ref(false)
const generating = ref(false)

function statusType(status?: string) {
  const map: Record<string, string> = { draft: 'info', confirmed: 'success', changed: 'warning' }
  return map[status || ''] || 'info'
}

function statusLabel(status?: string) {
  const map: Record<string, string> = { draft: '草稿', confirmed: '已确认', changed: '已变更' }
  return map[status || ''] || status || '-'
}

async function fetchSow() {
  loading.value = true
  try {
    sowList.value = await listSowByPack(packId.value)
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

async function handleGenerate() {
  generating.value = true
  try {
    sowList.value = await generateSow(packId.value)
    ElMessage.success('SOW 生成成功')
  } catch (e) {
    ElMessage.error('生成失败')
  } finally {
    generating.value = false
  }
}

onMounted(fetchSow)
</script>

<style scoped>
.presales-sow-page {
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
</style>
