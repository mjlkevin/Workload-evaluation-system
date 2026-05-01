<template>
  <el-tag :type="badgeType" :size="size" :effect="effect">
    {{ badgeLabel }}
  </el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface StatusOption {
  value: string
  label: string
  type: 'success' | 'warning' | 'danger' | 'info' | 'primary'
}

const props = withDefaults(defineProps<{
  status: string
  options: StatusOption[]
  size?: 'large' | 'default' | 'small'
  effect?: 'dark' | 'light' | 'plain'
}>(), {
  size: 'default',
  effect: 'light',
})

const badgeType = computed(() => {
  const opt = props.options.find((o) => o.value === props.status)
  return opt?.type || 'info'
})

const badgeLabel = computed(() => {
  const opt = props.options.find((o) => o.value === props.status)
  return opt?.label || props.status
})
</script>
