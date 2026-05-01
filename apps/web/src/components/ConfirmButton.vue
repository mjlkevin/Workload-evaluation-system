<template>
  <el-popconfirm
    :title="confirmText"
    :confirm-button-text="confirmButtonText"
    :cancel-button-text="cancelButtonText"
    @confirm="handleConfirm"
  >
    <template #reference>
      <el-button :type="type" :size="size" :loading="loading" :disabled="disabled">
        <slot>{{ text }}</slot>
      </el-button>
    </template>
  </el-popconfirm>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  text?: string
  confirmText?: string
  confirmButtonText?: string
  cancelButtonText?: string
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'default'
  size?: 'large' | 'default' | 'small'
  loading?: boolean
  disabled?: boolean
}>(), {
  text: '',
  confirmText: '确定执行此操作吗？',
  confirmButtonText: '确定',
  cancelButtonText: '取消',
  type: 'primary',
  size: 'default',
  loading: false,
  disabled: false,
})

const emit = defineEmits<{
  (e: 'confirm'): void
}>()

function handleConfirm() {
  emit('confirm')
}
</script>
