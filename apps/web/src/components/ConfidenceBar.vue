<template>
  <div class="confidence-bar" :aria-label="`置信度 ${percent}%`">
    <div class="confidence-bar__track">
      <div class="confidence-bar__fill" :style="fillStyle" />
    </div>
    <span class="confidence-bar__value">{{ percent }}%</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ value: number }>()
const normalized = computed(() => Math.max(0, Math.min(1, props.value || 0)))
const percent = computed(() => Math.round(normalized.value * 100))
const color = computed(() => normalized.value < 0.5 ? 'var(--wes-color-error)' : normalized.value < 0.8 ? 'var(--wes-color-warning)' : 'var(--wes-color-success)')
const fillStyle = computed(() => ({ width: `${percent.value}%`, background: color.value }))
</script>

<style scoped>
.confidence-bar {
  display: inline-flex;
  align-items: center;
  gap: var(--wes-space-2);
  min-width: 128px;
}

.confidence-bar__track {
  width: 88px;
  height: 8px;
  overflow: hidden;
  background: var(--wes-color-surface-muted);
  border-radius: var(--wes-radius-pill);
}

.confidence-bar__fill {
  height: 100%;
  border-radius: inherit;
  transition: width 180ms ease, background 180ms ease;
}

.confidence-bar__value {
  color: var(--wes-color-text-secondary);
  font-size: var(--wes-font-size-xs);
  font-weight: 600;
}
</style>
