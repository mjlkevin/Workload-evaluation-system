# V2 前端优化沙箱 · 任务书

> 执行人：KIMI + cursor·Opus  
> 监督人：Kevin  
> 起点日期：2026-05-08  
> 沙箱根目录：`ui/V2_PROTOTYPE/`  
> 验收方式：浏览器直接打开 HTML，逐页 review，OK 后再切真实后端

---

## 0. 设计稿来源（不要再创造新方向）

| 用途 | 来源 |
|---|---|
| Design tokens 真源 | `ui/WES 优化方案 · 工程落地版.html` § 01 DESIGN TOKENS |
| 控件 spec | `ui/WES 优化方案 · 工程落地版.html` § 02 COMPONENT SPEC |
| 实施评估页（列表 + 详情）像素稿 | `ui/实施评估页 · 深度打磨方案 v2.html` 全部 7 节 |
| Landing Page 视觉参考 | `ui/WES Landing Page.html`（暂不重做） |
| 诊断 / Roadmap 背景 | `ui/WES 前端优化方案.html`（仅作参考，不直接抄 CSS） |

冲突原则：**工程落地版** > v2 > 前端优化方案 > Landing。

---

## 1. 目录结构（请严格遵守）

```
ui/V2_PROTOTYPE/
├── README.md                # 沙箱说明 + 如何打开
├── tokens.css               # 唯一真源：颜色 / 字号 / 阴影 / 圆角 / 间距
├── components.css           # 通用控件：btn / input / table / tag / kpi / dialog
├── layout.css               # 顶栏 / 侧栏 / 网格
├── pages/
│   ├── assessment-list.html       # 实施评估 · 列表（v2 § 01）
│   ├── assessment-detail.html     # 实施评估 · 详情上下区（v2 § 02–06）
│   └── _shared/
│       └── topbar.html              # 内嵌片段，可 copy 复用
└── mock/
    └── data.js              # 列表 / 详情 / SKU mock 数据，纯前端读取
```

不要新增依赖。不要建 package.json。不要 npm install。

---

## 2. 阶段与里程碑

### Phase 1 — Tokens & 通用控件（≤ 1 天）
- [ ] 把"工程落地版" `:root` 全部 token 抽到 `tokens.css`
- [ ] 抽出 `.btn` / `.tag` / `.input` / `.table` / `.kpi` / `.dialog` 到 `components.css`
- [ ] 写一个 `pages/_kitchen-sink.html`，把所有控件展示一遍（验收 token + spec 一致性的入口）

**验收**：Kevin 浏览器打开 kitchen-sink，确认与"工程落地版" § 02 视觉一致。

### Phase 2 — 实施评估列表页（≤ 1.5 天）
按 v2 § 01 实施：
- [ ] 顶部 4 KPI（含 spark）
- [ ] 筛选器：状态 / 阶段 / 负责人 / 时间
- [ ] 单据表：版本徽章、检出锁状态、行 hover
- [ ] 空状态、加载骨架（≥ 3 行）
- [ ] mock 数据 ≥ 12 行，含至少 1 个"被锁定"、1 个"驳回"、1 个"封版"

**验收**：v2 § 01 的 8 个 pain 全部得到回应。

### Phase 3 — 实施评估详情页（≤ 2 天）
按 v2 § 02–06 实施：
- [ ] 上区三段式（基本信息 / 阶段进度 / 关键判定）
- [ ] 下区 KPI 四卡（v2 § 03.1 的重做版）
- [ ] 三层选择器折叠（报价模式 → 预置 → 云产品）
- [ ] SKU 表：标准人天颜色梯度、自定义 stepper、行级勾选
- [ ] DSL 红色 banner + 一键修复（mock 行为：点按钮替换文本即可）
- [ ] 多组织 tab（第二象限）

**验收**：v2 § 02–06 的视觉 + 主交互全部能跑通（无后端，纯 mock）。

### Phase 4 — 走查 + 截图（≤ 0.5 天）
- [ ] 1280 / 1440 / 1920 三档浏览器宽度走查
- [ ] 输出 `screenshots/` 目录（每页 ≥ 2 张：默认态 + 一个交互态）
- [ ] 在 README.md 列出已知偏差与解释

---

## 3. 验收清单（Kevin 用）

打开沙箱，逐项确认：
1. tokens.css 是否与"工程落地版"配色完全一致
2. kitchen-sink 控件密度（圆角、阴影、间距）是否克制
3. 列表页 8 pain 是否回应（详见 v2 § 01.1）
4. 详情页上区是否三段式、信息密度是否优于现 `V0_SAAS/app/assessment/`
5. SKU 表的颜色梯度是否帮助快速识别"标准 vs 自定义"
6. DSL 红色 banner 是否避免行级噪声轰炸
7. 没有引入新依赖（无 package.json / node_modules）

---

## 4. 切后端（沙箱通过后才执行，本任务书不展开）

- 把 `tokens.css` / `components.css` / `layout.css` 移植成 `ui/V0_SAAS/styles/` 下的等价文件，shadcn 主题对齐
- `pages/*.html` 的 DOM 结构改写成 React 组件，落到 `ui/V0_SAAS/app/assessment/`
- mock 数据替换为现有 API hooks
- 这一步会单独下发一份 TASKS-CUTOVER.md

---

## 5. 行为约束（给 Opus）

- 一次只做一个 Phase，每个 Phase 结束停下来等 Kevin 验收
- 任何与本文档冲突的"我觉得更好"想法，先在 README.md 末尾的 "Open Questions" 写下来再问，不要先改
- 不创造新颜色 / 新圆角 / 新字号；token 不在 tokens.css 里就不要用
- 不写 README 之外的 markdown 文档（设计反思、变更日志这些都不要）
- 注释克制：组件只在 spec 与代码不一致时写一行注释解释为什么
- 不引入 npm 依赖、不跑 build、不动 `ui/V0_SAAS/`

---

## 6. 第一步

创建 `ui/V2_PROTOTYPE/README.md`（一页纸：如何打开 + 当前 Phase + Open Questions），然后开始 Phase 1。
