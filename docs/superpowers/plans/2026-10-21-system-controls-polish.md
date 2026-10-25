# 系统管理导航与状态机控件改版计划

**Goal:** 修复截图中的原生立体边框与信息拥挤，让分类、筛选、规则阅读层级清晰。
**Architecture:** 单一系统管理表面；导航由页面内独立组件拥有，状态机控件由 StateMachinesSection 拥有。既有 Tailwind v4 + tokens；preflight 继续关闭，控件显式 reset；不扩增冻结 CSS，不改 API/权限/状态规则。
**Tech Stack:** React 18 / Vite / Tailwind v4 / Vitest。
**来源:** ISS-2026-10-21-001，扩展 RP-065；用户已直接要求设计并实现。

## 设计与证据

1. 分组按钮/搜索框：本地页面实测 appearance:auto、outset 2px / inset；契约为 AGENTS.md §7。用显式边框、背景、字号、行高和焦点样式，保持 preflight 关闭。
2. 导航层级：截图与本地渲染显示分组胶囊叠子页胶囊，PageShell 内再套两层水平内边距。统一为灰底分段一级导航 + 下划线二级页签；内容与导航对齐，窄屏横向滚动。
3. 规则阅读：本地折叠按钮把源码长路径与标题挤在同一行。改为白色卡片：名称/标识、状态数/流转数/未实现数、展开图标；源码移入展开详情。状态枚举用标签展示，不把枚举顺序画成真实流转；真实流转以转换表为准。

## 方案取舍

- 只加 reset：能消除原生边框，但层级与源码拥挤仍在。
- **采用局部控件重设计**：覆盖三个根因，复用既有栈，保留现有信息与路由。
- 全站导航/组件库重做：超出本次截图表面，不进入本轮。

## 执行

- [x] RED：导航方向键/单一 Tab 焦点入口、卡片 aria-controls、无结果一键重置测试失败。
- [x] GREEN：新增 system/SystemManagementNav.jsx，替换页面对应导航；改版 StateMachinesSection。
- [x] 复跑聚焦测试、test:web、build:web、UI scope；按 WES 规范跑 modules 并区分既有失败。
- [x] 浏览器在 1440/760 验证导航、筛选、折叠、长表格、键盘焦点；保存截图与几何实取。
- [x] 回填问题/需求/计划/测试/变更；用户最终目视确认保持待验收。

## 文件边界

- ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx：只替换导航与内容外层间距。
- ui/V2_PROTOTYPE/src/pages/system/SystemManagementNav.jsx：两级分类、路由切换与键盘交互。
- ui/V2_PROTOTYPE/src/pages/system/StateMachinesSection.jsx：筛选、折叠、规则与来源详情。
- 两个对应现有测试文件：行为验证。
- 总看板对应页面与事件：过程沉淀。

原有未提交文件已备份于 .tmp/ui-system-controls/baseline，不清理、不回滚、不提交无关工作。

## 执行结果（2026-10-21）

- 聚焦 13/13；Web 76 文件 / 618 项通过（净增 3 项行为测试）；build:web exit 0，2.54s；UI scope 无新增发现。
- modules 587/588，已登记 resolveKek 本地 env 隔离失败保持原状，不修改凭据域。
- IAB 1440/760 实测：导航分组与组内页签、ArrowRight/End 焦点跟随、搜索/域筛选/重置、折叠、源码阅读通过；规则表 760px 时键盘横滚 scrollLeft=40，页面无额外横溢。
- 独立复核（ui_review）未发现阻断问题，并独立复跑聚焦 13 项通过。
- 截图、日志与改动前文件快照在 .tmp/ui-system-controls/；用户目视验收仍待确认。本轮未提交、未推送。
- 来源台账补充在 RP-065 现有设计资产条目中；未重算存量文档统计。README、OpenAPI、实现对齐说明未改，因为本轮无启动方式、业务契约或架构边界变化。
