# WES V2 Prototype Sandbox

## 如何打开

直接用浏览器打开 `ui/V2_PROTOTYPE/pages/index.html`，即可进入导航中心，逐页验收。

建议按以下顺序验收：
1. 先看 `pages/index.html`，确认 16 条导航链接完整。
2. 再看 `pages/_kitchen-sink.html`，确认 tokens / components 的视觉是否和工程落地版一致。
3. 任意点一个 W1+ 页面，检查占位文字 + 返回链 + sidebar 互链。
4. DevTools console 输入 `window.MOCK`，确认 mock 数据全套输出。

## 当前 Phase

- **Phase A · 几乎收尾**（2026-05-09）
- 已完成：W0-1 / W1 / W2 / W3 (6 list) / W4 (requirement-detail) / W5 (assessment-detail) / W6a (resource-cost-detail) / W6b (Track B 系统三联) / Track C (4 文件) / W8a (review-detail v2 增量)
- 仅剩：**W8b · 截图走查**
  - W8b.1 · 代码级响应式走查 ✅ 完成（见下方"W8b 走查报告"）
  - W8b.2 · Phase B 框架二选一 ✅ 已决策 — Vite + React（见下方决策记录）

## W8b 走查报告 · 1280 / 1440 / 1920 三档（2026-05-09）

> 工具不通时改用代码级审计：逐文件读 CSS、检查 media query / grid template / 固定宽度元素，定位会在三档断点折叠或溢出的位置。

### 共享层基线
- `layout.css` 主断点：**1180px**（侧栏折叠到顶 + grid 4/3/2 → 2 列）+ **760px**（→ 1 列）
- `.shell`: 240px sidebar + minmax(0,1fr) content
- 三档实际主区宽度：1280→1040px · 1440→1200px · 1920→1680px
- **所有目标分辨率 > 1180**，不会触发侧栏折叠

### 总体结论

| 分辨率 | 破图风险 | 备注 |
|---|---|---|
| **1280** | 无破图，resource-cost 月份表偏紧 | 可接受 |
| **1440** | 完全 OK | 设计基准分辨率 |
| **1920** | 完全 OK | 留白稍多不影响功能 |

**Phase A 整体通过 W8b 走查**，已知 5 项偏差全部为"低-中"级，不阻断 Phase B 启动。

### 已知偏差清单

| # | 文件 | 等级 | 偏差 | 处理建议 |
|---|---|---|---|---|
| 1 | resource-cost-detail.html | 低-中 | 月份铺开表 11 列在 1280 主区 (~744px) 偏紧，约 67px/列 | Phase B 切组件时给 `.at` 加 `overflow-x:auto` wrapper；1440+ 无问题 |
| 2 | dev-assessment-detail.html | 低 | 仅 `@media (max-width:1080px)` 单一断点（仅折叠 pmstrip）；与主线 1180+760 双断点惯例不齐 | Phase B 统一断点系统 |
| 3 | review-detail.html | 低 | 仅 `@media (max-width:1100px)` 单一断点 | 同上 |
| 4 | history-detail.html | 低 | 仅 `@media (max-width:1100px)` 单一断点 | 同上 |
| 5 | system-management.html | 低 | 0 内联 media query，仅靠 layout.css 1180 基线 | grid 用 `repeat(3,1fr)` 自动收缩；不破图，可不修 |

### 历史遗留（非本次新增）

- `review-detail.html` 的 `.avatar` 仍用 hex 紫色 `#ddd6fe / #c4b5fd / #5b21b6`（Track C 引入，W8a 没触碰）。Phase B 切组件时统一替换为 `var(--brand-soft) / var(--brand)`。

### 没扫到 / 待补

- 视觉走查（截图）暂未做 — 预览工具链在本环境失灵（preview proxy 占端口、Chrome MCP 未连接）；如要补，浏览器手开 `http://localhost:8877/pages/*.html` 即可（Python http.server 已在跑）
- Tab 内复杂内容（assessment-detail 多组织 tab / resource-cost 分配视图 tab 等）未逐个切换看，因为 mock 是占位 dz

## W8b · 手工走查补丁批次（2026-05-09）

代码级走查后又做了一轮浏览器手工走查，发现并修复了 7 项一致性 / 数据 / 交互问题：

| # | 问题 | 影响范围 | 修复 |
|---|---|---|---|
| 3 | `mock/data.js` 用 `const X=[]` 后 `X = X.map()` 重赋值，strict 模式抛错，`window.MOCK` 没生成 | 全部 list 页无数据 | `const → let` 共 6 处（requirements / assessments / devAssessments / resourceCosts / wbs / reviews） |
| 7 | 行选择直接 `classList.toggle('row-selected')`，每点一行就累加多选 | 6 list + home + user-management = 8 文件 | 统一改为：单击单选 / Ctrl+Cmd 切换 / Shift 区间，统一锚点逻辑 |
| 8 | home 评估方案列表用 2 行布局（VCS bar + ltbar）与其他 list 页 `toolbar-row` 单行不齐 | home.html | 改为 `.toolbar-row` 单行（actions 左 + filters 右），CSS 一并补齐 |
| 1 | 侧栏导航缺前置图标 | 17 文件 × ~10 链接 | 全量补 `<span class="ic">●</span>` 等；`layout.css` 加 `.sidebar a .ic` 样式 |
| 2 | home 主区与侧栏间多 24px 白条；其他页面 pg-hd 贴左 | home.html | `.home-body` 去除 `padding-left`（保留右 24/底 24）|
| 5 | `assessment-detail` 的 `.rlab` 用 absolute 凹槽样式，浮在 panel border 中间，白底切线视觉破碎 | assessment-detail.html | 改为常规 inline-block 小标签，置于 panel 内顶部 |
| 6 | SKU 主表缺"实施说明"列、组行缺"模块说明" | assessment-detail.html + mock/data.js | 表加 `<th>实施说明</th>`；group `<tr>` colspan 区写 moduleDesc；mock + fallback 同步补 description / moduleDesc 字段 |

### 推迟到 Phase B 的项

- **#4 侧栏收起按钮** · 需要新交互（icon-only 模式）+ 状态管理 + 17 页同步，自然适合切框架（Next.js/Vite）时一起做
- **`.avatar` 紫色 hex** · review-detail Track C 引入的 `#ddd6fe / #c4b5fd / #5b21b6`，Phase B 切组件时统一替换为 token
- **assessment-detail.html · v3 严格对齐** · W5 当前为基础可用版（477 行），未按 `实施评估页 · 深度打磨方案 v3.html` §2–§5 严格重构。具体缺口见下方「Phase B Schedule」。作为 Phase B 首项，框架选定后以组件化方式一次性补齐。

### 手工走查执行环境

- Python `http.server 8877 --directory ui/V2_PROTOTYPE` 已常驻
- 浏览器直接访问 `http://localhost:8877/pages/{page}.html`

## Phase B Schedule（执行中 · 2026-05-09）

> 以下项目在 Phase A 验收时被标记为 DONE，但实际未达设计稿深度，故显式排入 Phase B。

| 优先级 | 项目 | 来源 | 状态 | 说明 |
|---|---|---|---|---|
| **P0** | `assessment-detail.html` v3 严格对齐 | `实施评估页 · 深度打磨方案 v3.html` §2–§5 | ✅ **组件落地 + 全页面集成** | Vite + React 基座已就绪；§02 上区组件（ProjectIdentityCard / VcsToolbar / ParamMiniBar / AdvancedCollapsible）已落地；§03 下区组件（KpiCards / PathBreadcrumb / SkuTable / DslBanner / AiCopilot / SidePanel）已落地；18 页面全量集成 + api/hooks/utils/viewModels/__tests__ 基础设施完成；构建通过 ✅ |
| P1 | 侧栏收起/展开按钮 | 设计稿全局 | ⏳ 待排 | icon-only 模式 + 状态管理 + 17 页同步 |
| P2 | `.avatar` 紫色 hex → token | review-detail | ⏳ 待排 | 硬编码替换为 token |
| P3 | resource-cost-detail 月份表 overflow-x | 走查偏差 #1 | ⏳ 待排 | 1280px 下加 `overflow-x:auto` wrapper |
| P4 | 断点系统统一 | dev-assessment-detail / review-detail / history-detail | ⏳ 待排 | 统一为 1180+760 双断点 |

### P0 组件清单（已落地）

| 组件 | 对应 v3 章节 | 功能 |
|---|---|---|
| `ProjectIdentityCard` | §2.2 段 1 | 彩色渐变背景项目身份卡：项目名 + 产品线（可添加 chip）+ 需求来源 + 版本号 + 检出状态 |
| `VcsToolbar` | §2.2 VCS | 压缩版工具栏：主操作 4 按钮 + DSL 状态条 + 未保存数 + ⋯ 更多下拉 |
| `ParamMiniBar` | §2.2 段 3 | 评估参数 4 卡：用户数 / 难度系数 / 组织数 / 相似度，含 3px progress bar |
| `AdvancedCollapsible` | §2.2 段 4 | 模板与规则集折叠抽屉，默认收起，点击展开 |
| `KpiCards` | §3.1 | KPI 四卡差异化：主结果卡（深蓝渐变 + waterfall 微图）+ 勾选进度 + 云产品 donut + DSL 状态 |
| `PathBreadcrumb` | §3.2 | 三层选择器折叠为路径面包屑：报价模式 › 预置 › 云产品，点击展开 chip 层 |
| `SkuTable` | §3 + §4 | SKU 主表：组行可折叠 + rowSpan 灰底 SKU 列 + 选中 3px 蓝竖线 + 行单选 |
| `DaysCell` | §4.1 | 标准人天颜色梯度：≤5 默认 / 6–10 暗琥珀 / >10 警示红 + ⚠ |
| `CustomStepper` | §4.2 | 自定义人天 stepper：方向色（上调橙/下调青）+ 差量胶囊 + 原因状态圆点 |
| `DslBanner` | §5 | DSL 校验未通过横幅：展开/收起详情，行级阻断标记 |
| `AiCopilot` | §5 | AI 建议悬浮卡：诊断 + 可执行动作按钮 |
| `SidePanel` | §3 右栏 | 校验摘要 + donut 占比图 |

### 技术栈

- **框架**：Vite 5 + React 18.3 + react-router-dom 6
- **端口**：3002（`npm run dev` 自动启动）
- **代理**：`/api` → `http://localhost:3000`
- **路径别名**：`@/` → `src/`
- **构建输出**：`dist/`，`npm run build` 通过 ✅
| P1 | 侧栏收起/展开按钮 | 设计稿全局 | icon-only 模式 + 状态管理 + 17 页同步 | 是 |
| P2 | `.avatar` 紫色 hex → token | review-detail | `#ddd6fe / #c4b5fd / #5b21b6` 硬编码替换为 `var(--brand-soft) / var(--brand)` | 是 |
| P3 | resource-cost-detail 月份表 overflow-x | 走查偏差 #1 | 1280px 下 11 列偏紧，加 `overflow-x:auto` wrapper | 否 |
| P4 | 断点系统统一 | dev-assessment-detail / review-detail / history-detail | 1080/1100px 单一断点 → 统一为 1180+760 双断点 | 否 |

**决策记录**：Kevin 于 2026-05-09 选择 **B 方案**——接受 W5 为基础版，将 assessment-detail v3 严格对齐作为 Phase B 首项，而非回退 W5 阻塞 Phase A 收官。

**决策记录**：Kevin 选择 **Vite + React** 作为 Phase B 及后续唯一 Web 主线。原因：更轻量，不需要 Next.js 的服务端渲染能力；【历史说明，已下线】`ui/V0_SAAS` 已于 2026-08-06 删除，禁止恢复第二前端主线。

---

## 说明

- 本沙箱已升级为 Vite + React 工程基座，含 `package.json` + 完整依赖链（react、react-router-dom、vitest、msw 等）。
- 所有样式以 `tokens.css` 为唯一真源；其余文件只能消费 token，不再创造新颜色、新圆角、新字号。
- Phase 1 结束后，先停下来给 Kevin 逐页验收，再进入 Phase 2（W1 login.html · Phase A）。
- layout 已锁定为 SaaS 全屏 shell（侧栏贴左 + 内容铺满），后续页面 mock 必须遵循此基线，不可改回居中卡片
