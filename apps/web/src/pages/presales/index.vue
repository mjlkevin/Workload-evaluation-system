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

interface RequirementPack {
  requirementPackId: string
  industry: string | null
  scale: string | null
  status: 'draft' | 'confirmed' | 'deprecated'
  createdAt: string
}

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
  return new Date(d).toLocaleString('zh-CN')
}

function viewDetail(row: RequirementPack) {
  router.push(`/presales/${row.requirementPackId}`)
}

async function handleDelete(row: RequirementPack) {
  // Mock delete; real API would be called here
  packs.value = packs.value.filter((p) => p.requirementPackId !== row.requirementPackId)
  ElMessage.success('已删除')
}

onMounted(() => {
  // Mock data for demo; real implementation would call API
  loading.value = true
  setTimeout(() => {
    packs.value = [
      {
        requirementPackId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        industry: '制造业 / 食品',
        scale: '集团型 / 500人',
        status: 'draft',
        createdAt: new Date().toISOString(),
      },
      {
        requirementPackId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
        industry: '金融 / 银行',
        scale: '中型 / 200人',
        status: 'confirmed',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ]
    loading.value = false
  }, 300)
})
</script>

<style scoped>
.presales-page {
  max-width: 1200px;
  margin: 0 auto;
}
</style>
