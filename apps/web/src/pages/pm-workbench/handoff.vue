<template>
  <div class="pm-page">
    <PageHeader title="接力视图" subtitle="IMPL → PM → PMO 的评估接力与交接">
      <template #actions>
        <el-button type="primary" @click="showCreate = true">新建接力</el-button>
      </template>
    </PageHeader>

    <el-card>
      <el-form inline>
        <el-form-item label="目标角色">
          <el-select v-model="filter.toRole" placeholder="选择角色" clearable>
            <el-option label="PM" value="PM" />
            <el-option label="PMO" value="PMO" />
            <el-option label="IMPL" value="IMPL" />
            <el-option label="SALES" value="SALES" />
            <el-option label="PRE_SALES" value="PRE_SALES" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filter.status" placeholder="选择状态" clearable>
            <el-option label="待处理" value="pending" />
            <el-option label="已接受" value="accepted" />
            <el-option label="已拒绝" value="rejected" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="fetchList">查询</el-button>
        </el-form-item>
      </el-form>

      <DataTable :data="handoffs" :columns="columns" :loading="loading">
        <template #cell-status="{ row }">
          <StatusBadge :status="row.status" :options="statusOptions" size="small" />
        </template>
        <template #cell-createdAt="{ row }">
          {{ formatDate(row.createdAt) }}
        </template>
        <template #actions="{ row }">
          <el-button link type="primary" @click="handleAccept(row)" :disabled="row.status !== 'pending'">接受</el-button>
          <el-button link type="danger" @click="handleReject(row)" :disabled="row.status !== 'pending'">拒绝</el-button>
        </template>
      </DataTable>
    </el-card>

    <!-- 创建接力弹窗 -->
    <el-dialog v-model="showCreate" title="新建接力" width="500px">
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="来源角色">
          <el-select v-model="createForm.fromRole" placeholder="选择来源角色">
            <el-option label="SALES" value="SALES" />
            <el-option label="PRE_SALES" value="PRE_SALES" />
            <el-option label="IMPL" value="IMPL" />
            <el-option label="PM" value="PM" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标角色">
          <el-select v-model="createForm.toRole" placeholder="选择目标角色">
            <el-option label="PM" value="PM" />
            <el-option label="PMO" value="PMO" />
            <el-option label="IMPL" value="IMPL" />
          </el-select>
        </el-form-item>
        <el-form-item label="版本 ID">
          <el-input v-model="createForm.assessmentVersionId" placeholder="评估版本 ID（可选）" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createForm.notes" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { PageHeader, DataTable, StatusBadge } from '@/components'
import type { DataTableColumn } from '@/components'
import { listHandoffs, createHandoff, updateHandoff, type Handoff } from '@/api/pm'

const handoffs = ref<Handoff[]>([])
const loading = ref(false)
const showCreate = ref(false)
const creating = ref(false)

const statusOptions = [
  { value: 'pending', label: '待处理', type: 'warning' as const },
  { value: 'accepted', label: '已接受', type: 'success' as const },
  { value: 'rejected', label: '已拒绝', type: 'danger' as const },
]

const columns: DataTableColumn<Handoff>[] = [
  { prop: 'fromRole', label: '来源角色', width: 120 },
  { prop: 'toRole', label: '目标角色', width: 120 },
  { prop: 'status', label: '状态', width: 100 },
  { prop: 'notes', label: '备注', minWidth: 200, tooltip: true },
  { prop: 'createdAt', label: '创建时间', width: 170 },
]

const filter = reactive({ toRole: 'PM', status: '' })
const createForm = reactive({
  fromRole: 'PRE_SALES',
  toRole: 'PM',
  assessmentVersionId: '',
  notes: '',
})

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN')
}

async function fetchList() {
  loading.value = true
  try {
    handoffs.value = await listHandoffs(filter.toRole, filter.status || undefined)
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  creating.value = true
  try {
    await createHandoff({
      fromRole: createForm.fromRole,
      toRole: createForm.toRole,
      assessmentVersionId: createForm.assessmentVersionId || undefined,
      notes: createForm.notes || undefined,
    })
    ElMessage.success('创建成功')
    showCreate.value = false
    fetchList()
  } catch (e) {
    ElMessage.error('创建失败')
  } finally {
    creating.value = false
  }
}

async function handleAccept(row: Handoff) {
  try {
    await updateHandoff(row.handoffId, { status: 'accepted' })
    ElMessage.success('已接受')
    fetchList()
  } catch (e) {
    ElMessage.error('操作失败')
  }
}

async function handleReject(row: Handoff) {
  try {
    await updateHandoff(row.handoffId, { status: 'rejected' })
    ElMessage.success('已拒绝')
    fetchList()
  } catch (e) {
    ElMessage.error('操作失败')
  }
}

onMounted(fetchList)
</script>

<style scoped>
.pm-page {
  max-width: 1200px;
  margin: 0 auto;
}
</style>
