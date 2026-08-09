# WES 总看板信息密度与可读性规范 v1

适用范围：`03_技术设计/系统架构/WES-Agent-升级总看板/` 下全部 HTML 页面与资产。
落地批次：2026-08-09 看板治理 B2/B5（index、requirements、changes、special-projects 试点后全板生效）。

## 1. 内容分层（先结论，后细节）

- 任何卡片/区块先给**一行结论**：`.kpi .sub` 文本 ≤ 120 字，只写结论与关键数字。
- 细节进折叠层：KPI 卡用 `<details class="kpi-detail"><summary>明细与依据</summary>…</details>`；技术段落沿用 `data-tech-collapse`（默认收起）。
- **禁止**用 `title` 属性复制长文本（title 不是可靠无障碍通道，且造成双份积压）。短提示（≤ 20 字，如「点击展开/收起」）除外。

## 2. 表格单元格上限

- 新写内容：单元格文本 ≤ 120 字；超出部分进详情折叠层或证据链接（`<code>`/`<a>` 指向 handoff、工单、日报）。
- 存量长文本：由 `assets/board-ui.js` 的 `initCellClamp()` 通用增强——超 120 字单元格默认收起 3 行，点击/回车展开（含 `aria-expanded`、focus-visible）。
- 表格统一 `data-board-table`：分页（board-table.js）、sticky 表头（top: 64px）、斑马行由 `components.css` 提供。

## 3. 数字单一来源

- 需求池数量 → 以 `requirements.html` 主台账（`#tbl-requirements` 行数）为准；状态分布以 plan.html 口径行同步。
- 测试数字 → 以当次实跑命令输出为准（test:modules / test:web / test:ai），禁止沿用旧快照。
- 专项数量 → 以 `special-projects.html` KPI 元数据为准。
- 更新任一数字时，必须全板 `rg` 旧值，同步所有副本（index pill/sub、trust strip、hero console、plan meta、changes lead）。

## 4. 阶段标签同步

- 格式：`RP-xxx Batch X · 状态 / 1H-x 规划中`（状态 ∈ 进行中 / 返工进行中 / 已交付 / 待决策）。
- topnav pill、hero pill、各页 meta「当前阶段」、index KPI「当前阶段」卡必须同批更新；页面内容范围标签（如「1H-C 阶段验收计划」）不在此列。

## 5. 历史归档

- `changes.html` 中超 1 个月的记录由 `scripts/board-archive-changes.js` 自动归档为 `archive-md/changes-YYYY-MM.md`，不开独立 HTML 页。
- `events/` JSON 为审计留痕，不归档、不删除。

## 6. 验收门禁

- 每次看板改动后必跑：`node scripts/board-build.js` + `node scripts/board-consistency-check.js`（0 错 0 警）。
- 视觉类声明需浏览器证据：截图或 `evaluate_script` 断言（截图超时时以脚本断言为准并如实声明）。
- 新增长文本（>120 字单元格、>120 字 sub、长 title）视为规范违反，review 不通过。
