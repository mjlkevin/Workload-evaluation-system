# PB-R3 Smoke Test · Batch A — KIMI CODE 静态审计

复制以下内容发给 KIMI CODE 执行。

---

**任务：PB-R3 Smoke Test · Batch A — 构建 + Token + 路由 + CSS 静态审计**

在 `/ui/V2_PROTOTYPE` 目录执行以下 6 项检查，每项完成后标注 PASS/FAIL + 具体证据（文件:行号 或 命令输出摘要）。

## 1. Build 验证
运行 `npm run build`，记录构建时间、JS/CSS 产物大小、有无 warning/error。

## 2. Token 禁用词 grep
在 `src/` 下递归 grep 以下模式，每条命中标出文件:行号：
```
var(--purple-
var(--soft)
var(--card)
var(--muted)
var(--gold)
var(--blue)
var(--warn-bg)
var(--err-bg)
var(--shadow-lg)
var(--shadow-xl)
```

## 3. 硬编码色值 grep
在 `src/` 下 grep `#[0-9a-fA-F]{3,6}` 和 `rgb\(` 和 `hsl\(`，排除 `src/index.css`（token 定义文件），将命中标注为"潜在 token 逃逸"，逐一判断是否为合法使用（如 SVG fill、data URL、注释）。

## 4. 路由完整性
检查 `src/App.jsx` 路由定义，确认以下 18 个路由全部注册，列出缺失项：
- `/login` `/` `/assessments` `/assessments/:id`
- `/requirements` `/requirements/:id`
- `/dev-assessments` `/dev-assessments/:id`
- `/resource-costs` `/resource-costs/:id`
- `/reviews` `/reviews/:id`
- `/wbs` `/history` `/history/:id`
- `/system` `/users` `/api-keys`

## 5. 断点 CSS 一致性
检查 `src/index.css` 中所有媒体查询是否使用 1180px + 760px 双断点（非 1080/1100px）。同时 grep `src/pages/` 和 `src/components/` 中所有内联 `@media` 和 `max-width`，标出仍使用旧断点的文件:行号。

## 6. 依赖完整性与死代码
- 运行 `grep -rn "from ['\"]" src/` 列出所有 import，检查每个导入的模块是否存在
- 检查 `src/pages/` 下是否有 0 引用的导出组件
- 检查是否有 `import ... from` 路径指向不存在的文件

## 输出格式
```
## [检查项名称] — [PASS/FAIL]
### 证据
- [具体输出/文件:行号]
### 严重项（如需修复）
- [修复建议]
```

## 验收标准
- 6/6 全部 PASS，或所有 FAIL 项附明确修复建议
- 报告写入 `docs/PB-R3-PARALLEL/smoke-batch-a-kimi.md`
