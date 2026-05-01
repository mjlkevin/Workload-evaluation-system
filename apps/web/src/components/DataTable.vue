<template>
  <div class="data-table-wrapper">
    <el-table
      :data="data"
      v-loading="loading"
      stripe
      border
      style="width: 100%"
      :empty-text="emptyTitle"
    >
      <template #empty>
        <EmptyState :title="emptyTitle" :hint="emptyHint" />
      </template>
      <el-table-column
        v-for="col in columns"
        :key="col.prop"
        :prop="col.prop"
        :label="col.label"
        :width="col.width"
        :min-width="col.minWidth"
        :fixed="col.fixed"
        :align="col.align"
        :show-overflow-tooltip="col.tooltip"
      >
        <template v-if="col.formatter || $slots[`cell-${col.prop}`]" #default="scope">
          <slot :name="`cell-${col.prop}`" v-bind="scope">
            {{ col.formatter ? col.formatter(scope.row[col.prop], scope.row) : scope.row[col.prop] }}
          </slot>
        </template>
      </el-table-column>
      <el-table-column v-if="$slots.actions" label="操作" :width="actionWidth" fixed="right">
        <template #default="scope">
          <slot name="actions" v-bind="scope" />
        </template>
      </el-table-column>
    </el-table>

    <div v-if="pagination" class="table-pagination">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        :page-sizes="pagination.pageSizes || [10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @change="onPageChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import EmptyState from './EmptyState.vue'

export interface DataTableColumn<T = any> {
  prop: string
  label: string
  width?: number | string
  minWidth?: number | string
  fixed?: 'left' | 'right'
  align?: 'left' | 'center' | 'right'
  tooltip?: boolean
  formatter?: (value: unknown, row: T) => string | number
}

export interface DataTablePagination {
  page: number
  pageSize: number
  total: number
  pageSizes?: number[]
}

withDefaults(defineProps<{
  data: any[]
  columns: DataTableColumn[]
  loading?: boolean
  pagination?: DataTablePagination
  actionWidth?: number | string
  emptyTitle?: string
  emptyHint?: string
}>(), {
  loading: false,
  actionWidth: 180,
  emptyTitle: '暂无数据',
  emptyHint: '调整筛选条件或新建一条记录后再查看。',
})

const emit = defineEmits<{
  (e: 'page-change', page: number, pageSize: number): void
}>()

function onPageChange(page: number, pageSize: number) {
  emit('page-change', page, pageSize)
}
</script>

<style scoped>
.data-table-wrapper {
  width: 100%;
  padding: var(--wes-space-4);
  background: var(--wes-color-surface);
  border: 1px solid var(--wes-color-border);
  border-radius: var(--wes-radius-lg);
  box-shadow: var(--wes-shadow-sm);
}

.table-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--wes-space-4);
}
</style>
