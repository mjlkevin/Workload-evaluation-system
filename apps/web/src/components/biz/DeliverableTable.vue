<template>
  <DataTable
    :columns="columns"
    :data="rows"
    :loading="loading"
    empty-title="暂无交付物"
    empty-hint="当前类型下还没有交付物，可由 W4-A/B 接入真实接口后展示。"
  >
    <template #cell-status="{ row }">
      <StatusTag :status="String(row.status || 'draft')" />
    </template>
    <template #cell-ownerRole="{ row }">
      <RoleBadge :role="String(row.ownerRole || 'pm')" />
    </template>
  </DataTable>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DataTable, { type DataTableColumn } from '../DataTable.vue'
import RoleBadge from '../RoleBadge.vue'
import StatusTag from '../StatusTag.vue'

export interface DeliverableRow {
  name: string
  status?: string
  ownerRole?: string
  dueDate?: string
  updatedAt?: string
}

const props = withDefaults(defineProps<{
  type: string
  data?: DeliverableRow[]
  loading?: boolean
}>(), {
  data: () => [],
  loading: false,
})

const columns: DataTableColumn[] = [
  { prop: 'name', label: '交付物', minWidth: 180, tooltip: true },
  { prop: 'status', label: '状态', width: 120, align: 'center' },
  { prop: 'ownerRole', label: '责任角色', width: 120, align: 'center' },
  { prop: 'dueDate', label: '计划日期', width: 140 },
  { prop: 'updatedAt', label: '更新时间', width: 160 },
]

const fallbackRows: Record<string, DeliverableRow[]> = {
  requirement: [
    { name: '需求包确认表', status: 'confirmed', ownerRole: 'presales', dueDate: 'T+2', updatedAt: '待同步' },
    { name: '差异分析清单', status: 'draft', ownerRole: 'pm', dueDate: 'T+3', updatedAt: '待同步' },
  ],
  handoff: [
    { name: '售前转实施交接单', status: 'pending', ownerRole: 'implementation', dueDate: 'T+1', updatedAt: '待同步' },
  ],
}

const rows = computed(() => props.data.length ? props.data : (fallbackRows[props.type] ?? []))
</script>
