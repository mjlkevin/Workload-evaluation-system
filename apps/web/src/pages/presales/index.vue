<template>
  <div class="presales-page">
    <el-card>
      <template #header>
        <div class="page-header">
          <span>需求包列表</span>
          <el-button type="primary" @click="$router.push('/presales/new')">
            <el-icon><Plus /></el-icon> 新建需求包
          </el-button>
        </div>
      </template>

      <el-table :data="packs" v-loading="loading" stripe>
        <el-table-column prop="industry" label="行业" min-width="140">
          <template #default="{ row }">
            {{ row.industry || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="scale" label="规模" min-width="140">
          <template #default="{ row }">
            {{ row.scale || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="170">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="viewDetail(row)">详情</el-button>
            <el-button link type="primary" @click="handleReview(row)">审阅</el-button>
            <el-popconfirm title="确定删除吗？" @confirm="handleDelete(row)">
              <template #reference>
                <el-button link type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { listPacks, deletePack, type RequirementPack } from '@/api/presales'

const router = useRouter()
const packs = ref<RequirementPack[]>([])
const loading = ref(false)

function statusType(status: string) {
  const map: Record<string, string> = {
    draft: 'info',
    confirmed: 'success',
    deprecated: 'danger',
  }
  return map[status] || 'info'
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    draft: '草稿',
    confirmed: '已确认',
    deprecated: '已废弃',
  }
  return map[status] || status
}

function formatDate(d: string) {
  if (!d) return '-'
  const date = new Date(d)
  return date.toLocaleString('zh-CN')
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
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
</style>
