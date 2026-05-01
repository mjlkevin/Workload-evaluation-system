<template>
  <div class="data-table-wrapper">
    <el-table :data="data" v-loading="loading" stripe border style="width: 100%">
      <el-table-column
        v-for="col in columns"
        :key="col.prop"
        :prop="col.prop"
        :label="col.label"
        :width="col.width"
        :min-width="col.minWidth"
        :fixed="col.fixed"
        :show-overflow-tooltip="col.tooltip"
      >
        <template #default="scope" v-if="col.formatter || $slots[`cell-${col.prop}`]">
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
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @change="onPageChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
export interface DataTableColumn<T = any> {
  prop: string
  label: string
  width?: number | string
  minWidth?: number | string
  fixed?: 'left' | 'right'
  tooltip?: boolean
  formatter?: (value: any, row: T) => string
}

interface Pagination {
  page: number
  pageSize: number
  total: number
}

withDefaults(defineProps<{
  data: any[]
  columns: DataTableColumn[]
  loading?: boolean
  pagination?: Pagination
  actionWidth?: number | string
}>(), {
  loading: false,
  actionWidth: 180,
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
}
.table-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
