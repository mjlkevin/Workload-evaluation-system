<template>
  <div class="empty-state">
    <div class="empty-state__icon">
      <slot name="icon">
        <el-icon v-if="icon"><component :is="icon" /></el-icon>
        <el-icon v-else><FolderOpened /></el-icon>
      </slot>
    </div>
    <h3 class="empty-state__title">{{ title }}</h3>
    <p v-if="hint" class="empty-state__hint">{{ hint }}</p>
    <div v-if="$slots.action || action" class="empty-state__action">
      <slot name="action">
        <el-button type="primary" @click="emit('action')">{{ action }}</el-button>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FolderOpened } from '@element-plus/icons-vue'

withDefaults(defineProps<{
  icon?: string
  title?: string
  hint?: string
  action?: string
}>(), {
  title: '暂无数据',
})

const emit = defineEmits<{
  (e: 'action'): void
}>()
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  padding: var(--wes-space-8);
  color: var(--wes-color-text-secondary);
  text-align: center;
  background: var(--wes-color-surface);
  border: 1px dashed var(--wes-color-border);
  border-radius: var(--wes-radius-lg);
}

.empty-state__icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--wes-space-4);
  color: var(--wes-color-primary);
  font-size: 28px;
  background: var(--wes-color-primary-light);
  border-radius: var(--wes-radius-xl);
}

.empty-state__title {
  margin: 0;
  color: var(--wes-color-text);
  font-size: var(--wes-font-size-lg);
}

.empty-state__hint {
  max-width: 420px;
  margin: var(--wes-space-2) 0 0;
  line-height: var(--wes-line-height-base);
}

.empty-state__action {
  margin-top: var(--wes-space-5);
}
</style>
