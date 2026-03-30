# 项目现状总结（2026-03-30）

本文档用于快速同步当前项目状态、已完成能力、已知风险与下一步计划，便于团队协作与交接。

## 1. 当前整体状态

- 项目处于 **新前端迁移与能力补齐阶段**，核心链路已可用。
- `ui/V0_SAAS` 已承接主要业务页面，并持续对齐历史实现能力。
- 后端 `apps/api` 的版本、模板、规则、估算、导出链路可用。
- 本地联调端口：
  - API：`3000`
  - 新前端：`3001`（`stagewise` 代理到 `5174`）

## 2. 已完成核心能力（本轮重点）

### 2.1 实施评估页（`/dashboard/assessment`）

- 参数与版本
  - 总方案版本、评估版本回读、模板、规则集等已接入。
  - 保存前强制后端校验，避免脏数据入库。
  - 提示统一为全局顶部 toast。
- 模块评估工作台
  - 工作表切换、云产品筛选、SKU/条目勾选、全选/全不选。
  - 自定义人天模式可用。
- 计算与导出
  - 接入后端计算：`/api/v1/estimates/calculate`
  - 接入导出：`/api/v1/estimates/calculate-and-export`（Excel/PDF）
  - 导出历史：`/api/v1/exports/history`，支持过滤与复制下载链接。
- 多组织推广估算
  - 行编辑、估算汇总、草稿按模板+工作表自动保存/回读。
- 交互与体验
  - 参数卡滚动渐变、收起摘要、右上悬浮态。
  - 卡片双击收起/展开能力全局可复用，并支持自定义收起摘要。
  - 修复页面与侧栏滚动条问题（禁止不必要横向滚动）。

### 2.2 需求导入 / 资源成本 / 开发评估

- 三模块已接入统一全局提示体系（顶部 toast，默认 3 秒）。
- 需求导入页已完成 Kimi-help、弹窗交互、行业标签化等关键改造。

## 3. 技术实现要点

- 前端：
  - `ui/V0_SAAS/app/dashboard/assessment/page.tsx`
  - `ui/V0_SAAS/components/ui/card.tsx`
  - `ui/V0_SAAS/lib/workload-service.ts`
  - `ui/V0_SAAS/components/ui/sidebar.tsx`
  - `ui/V0_SAAS/app/globals.css`
- 后端接口（已接入前端）：
  - `GET /api/v1/templates`
  - `GET /api/v1/templates/:templateId`
  - `GET /api/v1/rule-sets/active`
  - `POST /api/v1/estimates/calculate`
  - `POST /api/v1/estimates/calculate-and-export`
  - `GET /api/v1/exports/history`

## 4. 已知风险 / 注意事项

- 仓库当前是脏工作区，含大量历史变更与临时文件；后续提交需按主题分批。
- 存在一批名称带 ` 2` 的重复文件，建议专项清理，避免误用。
- 导出/估算依赖登录态与 token，联调时需先确认鉴权有效。

## 5. 下一步建议（按优先级）

1. 实施评估页最终收口：
   - 云产品卡片折叠态视觉与历史页继续对齐。
   - 规则校验失败详情做字段级可视化。
2. 三个模块联动回归：
   - 需求导入 -> 实施评估 -> 资源成本 -> 开发评估 全链路验收。
3. 仓库治理：
   - 清理重复文件与无效产物。
   - 统一提交策略（按模块拆分 commit）。

## 6. 验证结论（本轮）

- 关键变更均已通过：
  - `ReadLints` 无新增问题
  - `npm run build` 构建通过

