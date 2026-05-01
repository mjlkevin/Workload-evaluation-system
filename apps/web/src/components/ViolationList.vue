<template>
  <div class="violation-list">
    <EmptyState v-if="!violations.length" title="暂无违规项" hint="当前规则校验未发现需要处理的问题。" />
    <el-collapse v-else v-model="activeNames">
      <el-collapse-item v-for="group in groups" :key="group.severity" :name="group.severity">
        <template #title>
          <div class="violation-list__title">
            <el-tag :type="severityType(group.severity)" round>{{ severityLabel(group.severity) }}</el-tag>
            <span>{{ group.items.length }} 项</span>
          </div>
        </template>
        <div class="violation-list__items">
          <div v-for="item in group.items" :key="item.id || item.message" class="violation-list__item">
            <div class="violation-list__message">{{ item.message }}</div>
            <div v-if="item.fieldPath || item.suggestion" class="violation-list__meta">
              <span v-if="item.fieldPath">字段：{{ item.fieldPath }}</span>
              <span v-if="item.suggestion">建议：{{ item.suggestion }}</span>
            </div>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import EmptyState from './EmptyState.vue'

export interface ViolationItem {
  id?: string
  severity: 'critical' | 'high' | 'medium' | 'low' | string
  message: string
  fieldPath?: string
  suggestion?: string
}

const props = withDefaults(defineProps<{ violations?: ViolationItem[] }>(), { violations: () => [] })
const order = ['critical', 'high', 'medium', 'low']
const groups = computed(() => order
  .map((severity) => ({ severity, items: props.violations.filter((item) => item.severity === severity) }))
  .filter((group) => group.items.length > 0))
const activeNames = ref(order)

function severityLabel(severity: string) {
  return ({ critical: '严重', high: '高', medium: '中', low: '低' } as Record<string, string>)[severity] ?? severity
}

function severityType(severity: string) {
  return severity === 'critical' || severity === 'high' ? 'danger' : severity === 'medium' ? 'warning' : 'info'
}
</script>

<style scoped>
.violation-list__title {
  display: inline-flex;
  align-items: center;
  gap: var(--wes-space-2);
  font-weight: 700;
}

.violation-list__items {
  display: grid;
  gap: var(--wes-space-3);
}

.violation-list__item {
  padding: var(--wes-space-4);
  background: var(--wes-color-surface-muted);
  border: 1px solid var(--wes-color-border);
  border-radius: var(--wes-radius-md);
}

.violation-list__message {
  color: var(--wes-color-text);
  font-weight: 600;
}

.violation-list__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wes-space-4);
  margin-top: var(--wes-space-2);
  color: var(--wes-color-text-secondary);
  font-size: var(--wes-font-size-xs);
}
</style>
