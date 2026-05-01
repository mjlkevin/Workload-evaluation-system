<template>
  <el-card class="requirement-pack-card" shadow="hover">
    <template #header>
      <div class="requirement-pack-card__header">
        <div>
          <h3>{{ pack.name || pack.title }}</h3>
          <p v-if="pack.code">{{ pack.code }}</p>
        </div>
        <StatusTag :status="pack.status || 'draft'" />
      </div>
    </template>
    <p class="requirement-pack-card__summary">{{ pack.summary || '暂无需求包摘要' }}</p>
    <div class="requirement-pack-card__meta">
      <span>需求数：{{ pack.requirementCount ?? 0 }}</span>
      <span>版本：{{ pack.version || 'v0.1' }}</span>
      <span v-if="pack.owner">负责人：{{ pack.owner }}</span>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import StatusTag from '../StatusTag.vue'

export interface RequirementPack {
  name?: string
  title?: string
  code?: string
  status?: string
  summary?: string
  requirementCount?: number
  version?: string
  owner?: string
}

defineProps<{ pack: RequirementPack }>()
</script>

<style scoped>
.requirement-pack-card {
  border-radius: var(--wes-radius-lg);
}

.requirement-pack-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--wes-space-4);
}

.requirement-pack-card__header h3 {
  margin: 0;
  color: var(--wes-color-text);
  font-size: var(--wes-font-size-lg);
}

.requirement-pack-card__header p {
  margin: var(--wes-space-1) 0 0;
  color: var(--wes-color-text-muted);
  font-size: var(--wes-font-size-xs);
}

.requirement-pack-card__summary {
  margin: 0;
  color: var(--wes-color-text-secondary);
  line-height: var(--wes-line-height-base);
}

.requirement-pack-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wes-space-4);
  margin-top: var(--wes-space-4);
  color: var(--wes-color-text-muted);
  font-size: var(--wes-font-size-xs);
}
</style>
