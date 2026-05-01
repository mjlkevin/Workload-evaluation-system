<template>
  <el-tag class="role-badge" :style="styleVars" effect="light" round>{{ meta.label }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export type WorkloadRole = 'sales' | 'presales' | 'implementation' | 'pm' | 'dev' | 'pmo' | 'hq'

const props = defineProps<{ role: WorkloadRole | string }>()

const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  sales: { label: '销售', color: 'var(--wes-role-sales)', bg: 'var(--wes-role-sales-bg)' },
  presales: { label: '售前', color: 'var(--wes-role-presales)', bg: 'var(--wes-role-presales-bg)' },
  implementation: { label: '实施', color: 'var(--wes-role-implementation)', bg: 'var(--wes-role-implementation-bg)' },
  pm: { label: 'PM', color: 'var(--wes-role-pm)', bg: 'var(--wes-role-pm-bg)' },
  dev: { label: '开发', color: 'var(--wes-role-dev)', bg: 'var(--wes-role-dev-bg)' },
  pmo: { label: 'PMO', color: 'var(--wes-role-pmo)', bg: 'var(--wes-role-pmo-bg)' },
  hq: { label: '总部', color: 'var(--wes-role-hq)', bg: 'var(--wes-role-hq-bg)' },
}

const meta = computed(() => ROLE_META[props.role] ?? { label: props.role, color: 'var(--wes-color-text-secondary)', bg: 'var(--wes-color-surface-muted)' })
const styleVars = computed(() => ({ color: meta.value.color, backgroundColor: meta.value.bg, borderColor: meta.value.bg }))
</script>

<style scoped>
.role-badge {
  font-weight: 600;
}
</style>
