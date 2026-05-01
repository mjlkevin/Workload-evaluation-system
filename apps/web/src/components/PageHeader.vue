<template>
  <header class="page-header">
    <div class="page-header__main">
      <p v-if="eyebrow" class="page-header__eyebrow">{{ eyebrow }}</p>
      <h1 class="page-header__title">{{ title }}</h1>
      <p v-if="subtitle" class="page-header__subtitle">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions || actions?.length" class="page-header__actions">
      <slot name="actions">
        <el-button
          v-for="action in actions"
          :key="action.label"
          :type="action.type || 'primary'"
          :plain="action.plain"
          @click="action.onClick"
        >
          {{ action.label }}
        </el-button>
      </slot>
    </div>
  </header>
</template>

<script setup lang="ts">
export interface PageHeaderAction {
  label: string
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  plain?: boolean
  onClick?: () => void
}

defineProps<{
  title: string
  subtitle?: string
  eyebrow?: string
  actions?: PageHeaderAction[]
}>()
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--wes-space-6);
  margin-bottom: var(--wes-space-6);
  padding: var(--wes-space-6);
  background: var(--wes-color-surface);
  border: 1px solid var(--wes-color-border);
  border-radius: var(--wes-radius-xl);
  box-shadow: var(--wes-shadow-sm);
}

.page-header__main {
  min-width: 0;
}

.page-header__eyebrow {
  margin: 0 0 var(--wes-space-2);
  color: var(--wes-color-primary);
  font-size: var(--wes-font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-header__title {
  margin: 0;
  color: var(--wes-color-text);
  font-size: var(--wes-font-size-2xl);
  line-height: var(--wes-line-height-tight);
}

.page-header__subtitle {
  margin: var(--wes-space-2) 0 0;
  color: var(--wes-color-text-secondary);
  line-height: var(--wes-line-height-base);
}

.page-header__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--wes-space-2);
}
</style>
