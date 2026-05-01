<template>
  <div class="presales-page">
    <PageHeader title="需求包列表" subtitle="售前顾问的需求包管理">
      <template #actions>
        <el-button type="primary" @click="$router.push('/presales/new')">
          <el-icon><Plus /></el-icon> 新建需求包
        </el-button>
      </template>
    </PageHeader>

    <el-card>
      <DataTable :data="packs" :columns="columns" :loading="loading">
        <template #cell-industry="{ row }">
          {{ row.industry || '-' }}
        </template>
        <template #cell-scale="{ row }">
          {{ row.scale || '-' }}
        </template>
        <template #cell-status="{ row }">
          <StatusBadge :status="row.status" :options="statusOptions" size="small" />
        </template>
        <template #cell-createdAt="{ row }">
          {{ formatDate(row.createdAt) }}
        </template>
        <template #actions="{ row }">
          <el-button link type="primary" @click="viewDetail(row)">详情</el-button>
          <el-button link type="primary" @click="handleReview(row)">审阅</el-button>
          <ConfirmButton
            text="删除"
            type="danger"
            size="small"
            confirm-text="确定删除此需求包吗？"
            @confirm="handleDelete(row)"
          />
        </template>
      </DataTable>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { PageHeader, DataTable, StatusBadge, ConfirmButton } from '@/components'
import type { DataTableColumn } from '@/components'
import { listPacks, deletePack, type RequirementPack } from '@/api/presales'

const router = useRouter()
const packs = ref<RequirementPack[]>([])
const loading = ref(false)

const statusOptions = [
  { value: 'draft', label: '草稿', type: 'info' as const },
  { value: 'confirmed', label: '已确认', type: 'success' as const },
  { value: 'deprecated', label: '已废弃', type: 'danger' as const },
]

const columns: DataTableColumn<RequirementPack>[] = [
  { prop: 'industry', label: '行业', minWidth: 140 },
  { prop: 'scale', label: '规模', minWidth: 140 },
  { prop: 'status', label: '状态', width: 100 },
  { prop: 'createdAt', label: '创建时间', width: 170 },
]

function formatDate(d: string) {
  if (!d) return '-'
  return new Date(d).toLocaleString('zh-CN')
}

async function fetchList() {
  loading.value = true
  try {
    packs.value = await listPacks()
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

function viewDetail(row: RequirementPack) {
  router.push(`/presales/${row.requirementPackId}`)
}

function handleReview(row: RequirementPack) {
  router.push(`/presales/${row.requirementPackId}`)
}

async function handleDelete(row: RequirementPack) {
  try {
    await deletePack(row.requirementPackId)
    ElMessage.success('已删除')
    fetchList()
  } catch (e) {
    console.error(e)
  }
}

onMounted(fetchList)
</script>

<style scoped>
.presales-page {
  max-width: 1200px;
  margin: 0 auto;
}
</style>
