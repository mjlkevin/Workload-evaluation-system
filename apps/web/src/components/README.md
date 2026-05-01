# W4-D UI 组件库与设计系统

本目录提供基于 Vue 3 + Element Plus 的项目专用二次封装组件，供 W4-A/B 后续替换原始 Element Plus 组件时使用。统一设计 token 位于 `apps/web/src/styles/tokens.scss`，已在 `styles/main.scss` 中引入。

## Design Tokens

覆盖颜色、角色色、状态色、间距、字号、圆角、阴影，并提供 `html.dark` / `[data-theme='dark']` dark mode 占位。

```vue
<template>
  <section class="panel">使用 var(--wes-color-primary)</section>
</template>

<style scoped>
.panel {
  padding: var(--wes-space-6);
  border-radius: var(--wes-radius-lg);
  box-shadow: var(--wes-shadow-md);
}
</style>
```

## 通用组件

### `PageHeader`

Props：`title: string`、`subtitle?: string`、`eyebrow?: string`、`actions?: PageHeaderAction[]`。也支持 `#actions` 插槽。

```vue
<PageHeader title="需求包管理" subtitle="统一管理售前确认后的需求基线">
  <template #actions>
    <el-button type="primary">新建需求包</el-button>
  </template>
</PageHeader>
```

### `DataTable`

Props：`columns: DataTableColumn[]`、`data: Record<string, unknown>[]`、`loading?: boolean`、`pagination?: DataTablePagination`、`emptyTitle?: string`、`emptyHint?: string`。支持 `cell-{prop}` 与 `actions` 插槽。

```vue
<DataTable :columns="columns" :data="rows" :pagination="pager" @page-change="loadPage">
  <template #cell-status="{ row }">
    <StatusTag :status="row.status" />
  </template>
</DataTable>
```

### `EmptyState`

Props：`icon?: string`、`title?: string`、`hint?: string`、`action?: string`。支持 `#icon`、`#action` 插槽，点击默认按钮触发 `action` 事件。

```vue
<EmptyState title="暂无交付物" hint="完成需求确认后自动生成交付物清单" action="刷新" @action="refresh" />
```

### `RoleBadge`

Props：`role: 'sales' | 'presales' | 'implementation' | 'pm' | 'dev' | 'pmo' | 'hq' | string`。

```vue
<RoleBadge role="presales" />
```

角色色：销售蓝、售前紫、实施青、PM 绿、开发橙、PMO 红、总部黄。

### `StatusTag`

Props：`status: 'draft' | 'confirmed' | 'sealed' | 'pending' | 'reviewing' | 'rejected' | 'approved' | 'changed' | string`。

```vue
<StatusTag status="sealed" />
```

### `ConfidenceBar`

Props：`value: number`，取值 `0-1`，自动映射红 / 黄 / 绿。

```vue
<ConfidenceBar :value="0.86" />
```

### `EvidenceCard`

Props：`fieldPath: string`、`value?: string | number`、`confidence: number`、`source?: string`。

```vue
<EvidenceCard field-path="project.scope" value="实施范围覆盖 12 个模块" :confidence="0.91" source="SOW 第 3 节" />
```

### `ViolationList`

Props：`violations: ViolationItem[]`，按 `critical/high/medium/low` 分组展示。

```vue
<ViolationList :violations="[{ severity: 'high', message: '缺少验收口径', fieldPath: 'acceptance.criteria' }]" />
```

## 业务组件

### `RequirementPackCard`

Props：`pack: RequirementPack`。展示需求包名称、编号、状态、摘要、需求数量、版本、负责人。

```vue
<RequirementPackCard :pack="{ name: '利民集团一期需求包', code: 'RP-001', status: 'confirmed', requirementCount: 36 }" />
```

### `DeliverableTable`

Props：`type: string`、`data?: DeliverableRow[]`、`loading?: boolean`。内置交付物列和状态 / 角色渲染，可由 W4-A/B 接入真实接口数据。

```vue
<DeliverableTable type="requirement" :data="deliverables" />
```

### `HandoffTimeline`

Props：`events: HandoffEvent[]`。用于展示销售、售前、实施、PM 等角色间的接力链路。

```vue
<HandoffTimeline :events="[{ title: '售前确认需求包', time: '2026-05-01 10:00', role: 'presales', status: 'confirmed' }]" />
```

## 统一导入

所有组件与类型均从 `apps/web/src/components/index.ts` 导出。

```ts
import { PageHeader, DataTable, RoleBadge, RequirementPackCard } from '@/components'
import type { DataTableColumn, RequirementPack } from '@/components'
```

## Storybook / Histoire

本轮未引入额外 Storybook/Histoire 依赖，避免扩大构建面。后续如需启用，建议基于当前组件 README 的示例补齐 `npm run storybook`。
