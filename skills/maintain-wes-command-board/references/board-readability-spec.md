# WES 总看板信息密度与可读性规范 v1

适用范围：`03_技术设计/系统架构/WES-Agent-升级总看板/` 下全部 HTML 页面与资产。
落地批次：2026-08-09 看板治理 B2/B5（index、requirements、changes、special-projects 试点后全板生效）；2026-08-10 表格列宽实测自适应（§2A）。

## 1. 内容分层（先结论，后细节）

- 任何卡片/区块先给**一行结论**：`.kpi .sub` 文本 ≤ 120 字，只写结论与关键数字。
- 细节进折叠层：KPI 卡用 `<details class="kpi-detail"><summary>明细与依据</summary>…</details>`；技术段落沿用 `data-tech-collapse`（默认收起）。
- **禁止**用 `title` 属性复制长文本（title 不是可靠无障碍通道，且造成双份积压）。短提示（≤ 20 字，如「点击展开/收起」）除外。

## 2. 表格单元格上限

- 新写内容：单元格文本 ≤ 120 字；超出部分进详情折叠层或证据链接（`<code>`/`<a>` 指向 handoff、工单、日报）。
- 存量长文本：由 `assets/board-ui.js` 的 `initCellClamp()` 通用增强——超 120 字单元格默认收起 3 行，点击/回车展开（含 `aria-expanded`、focus-visible）。
- 表格统一 `data-board-table`：分页（board-table.js）、斑马行由 `components.css` 提供；sticky 表头于 2026-08-09 因与表格圆角裁切冲突回退（表头被下压 64px 沉入数据行，见 changes.html BE-2026-08-09-board-table-thead-sticky-rollback），表头当前默认定位。

## 2A. 表格列宽实测自适应（2026-08-10 落地）

目标：列宽跟着内容走 —— 短内容列（编号、日期、估时、P0/P1 标签、短状态）收缩单行，长文本列弹性分配剩余宽度并正常换行。新建表格**零额外样式**即生效。

机制（两层，均已全板生效）：

1. **CSS 层（`components.css`）**：全局 `table-layout: auto` 按内容分配列宽；`.table-scroll table { min-width: 100% }` 贴合容器，内容确实超宽时由 `.table-scroll` 横向滚动兜底；`td.mono` 不带 `nowrap`，长 mono 文本靠 `overflow-wrap/word-break` 断行。
2. **JS 层（`board-ui.js` 的 `initColumnFit()`）**：临时强制单行实测每列最大内容宽度，≤ 180px（约 15 个汉字）的短列加 `.col-fit`（`width:1% + nowrap`）收缩贴合；折叠块（`details.tech-detail`）展开时自动重测。

编写新表格的规则：

- **不要**手写 `width:1%`、内联列宽或给单元格加 `nowrap` 来"帮忙"——百分比宽度提示会扭曲 Chromium 的剩余宽度分配（长列吞掉全部余量、正文列被压成竖排），统一 `nowrap` 会把长文本列顶出容器。两条均为 2026-08-10 实测翻车结论，详见 `components.css` 表格区注释。
- 短标识列沿用既有类即可被自动识别：`td.mono`（编号 / commit 哈希 / 日期 / 估时）、单 `.pill` / `.status` 单元格（优先级 / 类型 / 状态）。
- 少数内容比例悬殊的表（如 changes.html 时间线表、github-radar 12 列台账、issues.html 9 列台账），允许加 `<colgroup>` 显式声明列宽意图；含 `colgroup` 的表 `initColumnFit` 自动跳过，不重复干预。
- 含 `colspan` / `rowspan` 的表（如 sources.html）不参与实测加注，保持纯 auto 布局。
- 恢复等宽布局的逃生口：给该表格加 `style="table-layout:fixed"`。

### 2A.1 两套列宽机制并存与真凶定位（2026-09-02 issues.html 列挤压实测结论）

- **两套机制互斥**：看板表格列宽有两条路径 —— 显式 `<colgroup>` 与自动量 `measureColumnFit()`。`board-ui.js:293-294` 对**已有 `colgroup`** 或**含 `colspan`/`rowspan`** 的表直接 `return`，即表现正常的页未必在用自动量，可能用的是显式列宽。实扫全板：17 页含表，仅 4 处 `colgroup`（changes 1 / github-radar 1 / requirements 2），其余全走自动量。
- **新增看板页优先用显式 `colgroup`**（2026-09-02 架构侧裁决）：显式列宽可预测，不会被单条长内容拉塌；代价是失去短列自动贴合。
- **列挤压的真凶往往是 `nowrap` 胶囊，不是缺 `colgroup`**。`.status` / `.pill` 带 `white-space: nowrap`（`components.css:610`），一条超长状态胶囊的 min-content 直接决定该列宽度下限并吞掉全表余量；**此时 `colgroup` 提示无效**。实测：issues.html 只补 colgroup 不动内容，「分析状态」列仍 609px；把胶囊只留短状态、将 sha / CI run 移到可换行的普通文本与 `code.inline` 后降至 171px。**修顺序：先瘦身胶囊，再调列宽。**
- **口径澄清**（不与 §2A 第 1 条矛盾）：第 29 行禁令针对的是在自动量表里给**单个单元格**加宽度提示 / `nowrap`（扭曲剩余宽度分配）；对**整表**声明 `colgroup` 属第 31 行允许范围。但带 `colgroup` 后每列百分比需调到 **≥ 该列单行需求宽度**，否则 `td.mono` 编号会断行——用同表 A/B 度量（rendered vs 强制单行 demand）逐列验证。
- **改进自动量算法属共享资产改动**（影响全板 21 页），不得在单页批次顺手做；如认为自动量本身该修，单独立项报架构侧。

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
- 新增或改动表格后需截图回归：短列不被断行（如 "O10"、"50–65h" 应保持单行）、长列正常换行、无内容顶破容器；发现手写 `width:1%` / 单元格 `nowrap` 提示一律退回（§2A）。
