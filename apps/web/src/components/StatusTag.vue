<template>
  <el-tag :type="meta.type" :effect="meta.effect" round>{{ meta.label }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export type WorkloadStatus = 'draft' | 'confirmed' | 'sealed' | 'pending' | 'reviewing' | 'rejected' | 'approved' | 'changed'

const props = defineProps<{ status: WorkloadStatus | string }>()

const STATUS_META: Record<string, { label: string; type: 'primary' | 'success' | 'warning' | 'danger' | 'info'; effect: 'light' | 'plain' }> = {
  draft: { label: '草稿', type: 'info', effect: 'plain' },
  confirmed: { label: '已确认', type: 'success', effect: 'light' },
  sealed: { label: '已封版', type: 'primary', effect: 'light' },
  pending: { label: '待处理', type: 'warning', effect: 'light' },
  reviewing: { label: '评审中', type: 'primary', effect: 'plain' },
  rejected: { label: '已驳回', type: 'danger', effect: 'light' },
  approved: { label: '已通过', type: 'success', effect: 'light' },
  changed: { label: '有变更', type: 'warning', effect: 'plain' },
}

const meta = computed(() => STATUS_META[props.status] ?? { label: props.status, type: 'info', effect: 'plain' })
</script>
