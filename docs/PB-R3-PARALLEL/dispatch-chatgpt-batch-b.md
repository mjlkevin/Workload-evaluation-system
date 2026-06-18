# PB-R3 Smoke Test · Batch B — ChatGPT Mock 数据 + 组件一致性 + UX 审计

复制以下内容发给 ChatGPT（或任意支持代码阅读的 AI）执行。

---

**任务：PB-R3 Smoke Test · Batch B — Mock 数据质量 + 组件契约一致性 + 无障碍/UX 纸面审计**

请依次阅读以下文件并产出静态审计报告。每项标注 PASS/FAIL + 文件:行号证据。

## 1. Mock 数据自洽性（6 项）

逐页检查以下自洽关系：

| # | 文件 | 检查内容 |
|---|------|---------|
| 1 | `src/pages/HomePage.jsx` | 4 KPI 卡片数据与列表行数据是否自洽（总方案数 ≥ 列表行数、总人天 = Σ行） |
| 2 | `src/pages/AssessmentList.jsx` | 列表 mock 行数 ≥ 5，每行必填字段（项目名、版本、状态）无空值 |
| 3 | `src/pages/RequirementList.jsx` | 列表 mock 行数 ≥ 5，状态 chip 值合法（仅"已检入""已检出"等） |
| 4 | `src/pages/AssessmentDetail.jsx` | KPI 值（总人天/复杂度/风险）与 SKU 表行数据是否自洽（总人天 ≈ ΣSKU人天 × 难度系数） |
| 5 | `src/pages/RequirementDetail.jsx` | 方案要点表的 Σdays 与右侧评估总览的人天数是否一致 |
| 6 | `src/pages/ResourceCostDetail.jsx` | 月份表合计行 = Σ各月 |

## 2. 组件契约一致性（4 项）

| # | 检查内容 |
|---|---------|
| 1 | PageShell 包裹：grep `<PageShell` 在所有 `src/pages/*.jsx` 中的出现次数。Detail 页和 HomePage 应有，Login 不应有。List 页可无。标出异常。 |
| 2 | List 页 toolbar 统一性：检查 `src/pages/*List.jsx` 是否使用统一的 toolbar 结构（已选 N + 批量操作 + filter chips + 搜索）。标出各自手写的差异。 |
| 3 | Detail 页 VCS toolbar 按钮排列顺序：检查 `*Detail.jsx` 页面中 VCS 按钮顺序是否一致（历史→升版→检入→撤销→检出→解锁→导出→保存）。标出不一致的页面。 |
| 4 | Import 风格一致性：所有页面 import 是否使用统一风格（相对路径 `./` 或 `../`）。标出使用绝对路径或 `@/` 别名的。 |

## 3. 无障碍/UX 纸面审计（5 项）

| # | 检查内容 |
|---|---------|
| 1 | 所有 `<button>` 无文字时是否有 `aria-label` |
| 2 | 所有 `<input>` 是否有关联 `<label>` 或 `aria-label` |
| 3 | 所有 `<table>` 是否有 `<thead>` + `<tbody>` 配对 |
| 4 | Dialog/Modal 检查：是否有关闭按钮 + 背景遮罩点击关闭 + ESC 处理 |
| 5 | 颜色传达：状态 chip 是否仅靠颜色区分（无文字或图标辅助）。标出纯色依赖项。 |

## 输出格式
```
## [类别] · [检查项] — [PASS/FAIL]
### 证据
- [文件:行号] — [具体情况]
### 偏差说明
- [对 FAIL 项的影响评估]
```

## 验收标准
- 三项大类 15 个子项全部 PASS 或 FAIL 项附修复建议
- 报告写入 `docs/PB-R3-PARALLEL/smoke-batch-b-chatgpt.md`
