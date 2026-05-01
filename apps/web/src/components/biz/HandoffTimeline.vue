<template>
  <el-timeline class="handoff-timeline">
    <el-timeline-item
      v-for="event in events"
      :key="event.id || event.time + event.title"
      :timestamp="event.time"
      :type="eventType(event.status)"
      placement="top"
    >
      <el-card shadow="never" class="handoff-timeline__card">
        <div class="handoff-timeline__header">
          <h4>{{ event.title }}</h4>
          <RoleBadge v-if="event.role" :role="event.role" />
        </div>
        <p v-if="event.description">{{ event.description }}</p>
        <StatusTag v-if="event.status" :status="event.status" />
      </el-card>
    </el-timeline-item>
  </el-timeline>
</template>

<script setup lang="ts">
import RoleBadge from '../RoleBadge.vue'
import StatusTag from '../StatusTag.vue'

export interface HandoffEvent {
  id?: string
  title: string
  time: string
  role?: string
  status?: string
  description?: string
}

withDefaults(defineProps<{ events?: HandoffEvent[] }>(), {
  events: () => [],
})

function eventType(status?: string) {
  if (status === 'confirmed' || status === 'approved' || status === 'sealed') return 'success'
  if (status === 'rejected') return 'danger'
  if (status === 'pending' || status === 'changed') return 'warning'
  return 'primary'
}
</script>

<style scoped>
.handoff-timeline {
  padding: var(--wes-space-4);
  background: var(--wes-color-surface);
  border: 1px solid var(--wes-color-border);
  border-radius: var(--wes-radius-lg);
}

.handoff-timeline__card {
  border-radius: var(--wes-radius-md);
}

.handoff-timeline__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wes-space-4);
}

.handoff-timeline__header h4 {
  margin: 0;
  color: var(--wes-color-text);
}

.handoff-timeline__card p {
  margin: var(--wes-space-2) 0 var(--wes-space-3);
  color: var(--wes-color-text-secondary);
  line-height: var(--wes-line-height-base);
}
</style>
