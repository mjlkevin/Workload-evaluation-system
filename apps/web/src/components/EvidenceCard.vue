<template>
  <el-card class="evidence-card" shadow="never">
    <template #header>
      <div class="evidence-card__header">
        <span class="evidence-card__path">{{ fieldPath }}</span>
        <ConfidenceBar :value="confidence" />
      </div>
    </template>
    <p class="evidence-card__value">{{ value || '未识别' }}</p>
    <div v-if="source" class="evidence-card__source">来源：{{ source }}</div>
  </el-card>
</template>

<script setup lang="ts">
import ConfidenceBar from './ConfidenceBar.vue'

defineProps<{
  fieldPath: string
  value?: string | number
  confidence: number
  source?: string
}>()
</script>

<style scoped>
.evidence-card {
  border-radius: var(--wes-radius-lg);
}

.evidence-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wes-space-4);
}

.evidence-card__path {
  color: var(--wes-color-text);
  font-weight: 700;
}

.evidence-card__value {
  margin: 0;
  color: var(--wes-color-text);
  line-height: var(--wes-line-height-base);
}

.evidence-card__source {
  margin-top: var(--wes-space-3);
  color: var(--wes-color-text-muted);
  font-size: var(--wes-font-size-xs);
}
</style>
