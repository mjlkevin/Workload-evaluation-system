# WES Agent 总看板模块映射

路径基准：项目根目录。

## 页面职责

| 页面 | 职责 | 必须更新的典型字段 |
|---|---|---|
| `index.html` | 总览入口，展示当前阶段、KPI、文档资产和关键状态。 | phase label、hero pill、trust strip、KPI、文档数量、下一步入口、页脚日期。 |
| `requirements.html` | 升级需求池与治理台账，不是业务系统正式需求模块；2026-06-26 起作为唯一需求池页面。 | 需求 ID、标题、来源、类型、优先级、phase、状态、范围、验收证据、下一步。 |
| `design.html` | 产品/技术方案、边界、工作台形态、权限和数据追溯口径。 | 新设计决策、实现事实、暂不进入范围、相关文档链接。 |
| `design-architecture.html` | 架构专题，承接更细的模块、运行、数据、接口边界。 | 模块边界、路由/数据流、存储策略、权限边界、依赖。 |
| `runtime.html` | Harness/Agent 任务运行时专题。 | source、execution、artifact、delivery、knowledge boundary、后续 runtime 优化项。 |
| `plan.html` | 路线图、任务拆解、验收门禁、后续任务池。 | Roadmap、任务表、完成定义、人工测试计划摘要、后续池。 |
| `testing.html` | 自动化和人工测试管理页。 | 测试 ID、优先级、步骤、期望结果、执行状态、缺陷、关闭标准。 |
| `monitoring.html` | 监控、审计、验证快照和 trace 留存。 | 命令/CI 结果、Harness audit、ToolEvent、modelRun、artifact、草稿追溯。 |
| `risks.html` | 风险、控制方式、关键决策与触发器。 | 风险等级、影响、控制方式、状态、决策、架构触发器。 |
| `changes.html` | 时间顺序的过程变更与验证记录。 | 目标、基线、代码/文档内容、验证命令、git/PR、后续事项。 |
| `sources.html` | 文档事实源地图和 Phase × 文档矩阵。 | 新文档、迁移文档、历史标记、事实源层级、资产总数。 |

## 生命周期到页面矩阵

| 生命周期事件 | 主页面 | 辅助页面 |
|---|---|---|
| 新需求录入 | `requirements.html` | `plan.html`, `changes.html` |
| 需求优先级/范围变化 | `requirements.html` | `plan.html`, `risks.html`, `changes.html` |
| 设计方案创建/修订 | `design.html` | `design-architecture.html`, `sources.html`, `risks.html`, `changes.html` |
| 架构边界变化 | `design-architecture.html` | `risks.html`, `monitoring.html`, `changes.html` |
| Harness/Agent runtime 变化 | `runtime.html` | `monitoring.html`, `plan.html`, `risks.html`, `changes.html` |
| 实施任务完成 | `plan.html` | `index.html`, `testing.html`, `monitoring.html`, `changes.html` |
| 自动化测试结果变化 | `monitoring.html` | `testing.html`, `changes.html`, `index.html` |
| 人工测试计划/结果变化 | `testing.html` | `monitoring.html`, `risks.html`, `plan.html` |
| CI/构建状态变化 | `monitoring.html` | `index.html`, `changes.html` |
| 风险/阻断/延期 | `risks.html` | `plan.html`, `changes.html`, `requirements.html` |
| 发布/合并/回滚 | `changes.html` | `index.html`, `plan.html`, `monitoring.html`, `risks.html` |
| 新增文档或提示词资产 | `sources.html` | `index.html`, `plan.html`, `changes.html` |

## 字段质量口径

- `status=Done/已交付` 需要至少一条实现证据和一条验证证据。
- `status=待执行/待回填` 必须保留在人工测试未执行的项上。
- `phase` 必须和计划页路线图、首页状态、变更页基线一致。
- `date` 使用实际更新日期；不要只改首页而遗漏页脚或专题页 header。
- `evidence` 优先使用可复查引用：文件路径、测试命令、PR/commit、Harness Run ID、ToolEvent ID、artifact ID。
- 文档新增时，同步 `sources.html` 列表、矩阵和 `index.html` 文档资产 KPI。

## 搜索建议

更新前后用 `rg` 查这些容易漂移的字段：

```bash
rg -n "Phase 1F|Phase 1G|Phase 1H|delivered|待执行|待回填|2026-|pass|document|文档资产" \
  "03_技术设计/系统架构/WES-Agent-升级总看板"
```

按具体阶段替换搜索词。发现旧值时，不要机械替换；先判断它是历史记录、阶段日期，还是需要同步的当前状态。
