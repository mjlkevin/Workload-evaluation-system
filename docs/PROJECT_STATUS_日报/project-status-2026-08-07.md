# WES 项目状态日报 — 2026-08-07

> 由每日定时扫描任务自动生成。基线：本地 `main` @ `1bd8477`（领先 `origin/main` 11 个提交）。
> 本次为扫描任务首次运行（无历史快照），变更分析基线取 `origin/main`（`b7bbae6`）。

## 1. 项目总体结构概览

全仓源码/文档文件（.ts/.tsx/.js/.jsx/.json/.md/.yaml/.yml/.css/.html，排除 node_modules/.git/dist/exports/logs/.codegraph/.tmp）：**3304 个文件，904021 行**。

| 模块 | 文件数 | 行数 | 说明 |
|---|---:|---:|---|
| apps/api | 368 | 103,185 | 后端主线（Express + modules 21 域） |
| ui/V2_PROTOTYPE | 196 | 40,944 | Web 前端主线（Vite + React） |
| docs | 208 | 62,215 | 过程文档 / 工单 / 计划 |
| 03_技术设计 | 107 | 29,749 | 含升级总看板静态站 |
| skills | 85 | 12,861 | Agent Skill 资产 |
| scripts | 34 | 6,893 | 看板构建 / 校验 / 回归脚本 |
| config | 13 | 14,482 | JSON 文件持久化数据 |
| 00_项目治理 | 8 | 2,306 | 里程碑与计划 |
| 01_需求管理 | 8 | 963 | 需求基线 |

## 2. 最近变更统计（origin/main..HEAD）

- **提交数**：11（含 RP-047 Batch B、O1/O2/O4/O10 批次、V0_SAAS 下线清理）
- **文件变更**：308 个文件，+17,402 / −36,943 行（净减约 1.95 万行，主因 `ui/V0_SAAS` 153 个文件整体清理下线）
- **目录级分布**：ui/V0_SAAS 153（删除）、apps/api 52、ui/V2_PROTOTYPE 39、03_技术设计/系统架构（总看板）25、skills 8、scripts 9、docs/agent-loop 2

关键提交：

| 提交 | 内容 |
|---|---|
| `1bd8477` | RP-047-B：Worker/恢复协调器/Session 投影仪 + dispatch 取消信号，Gate B 审计通过合入 |
| `4dbfc2d` | 工程治理：清理下线 ui/V0_SAAS 旧前端及相关引用 |
| `251b73d` | O4：chat/dispatch 服务 handler 化，7 个意图 handler 独立落位（18 条快照锁定零行为变更） |
| `e20e2c6` | O10 Batch A：兜底分类采纳收窄为仅超范围拦截，阈值提至 0.85 |
| `c8b1acb`/`80af6de` | O1：AI 工作台 2602 行单文件目录化拆分并合入主线 |
| `1757065` | O2：Agent 工具注册表 1→8 扩展 |

## 3. 配置与依赖状态

- **依赖版本**：`package.json` / `apps/api/package.json` / `ui/V2_PROTOTYPE/package.json` 均无依赖版本增删，仅 `apps/api` 测试脚本扩容（test:modules / test:agent / test:harness / test:ai 新纳入 Batch B Worker/恢复/投影仪、Agent 工具、handler 快照等测试文件）。
- **关键配置指纹**（sha256 前 12 位）：package.json `e5f1191b9450`、package-lock.json `cab67cac6c20`、apps/api/package.json `828544a354b0`、docker-compose.yml `e48caf7fe8de`、.env.example `d489e672d83d`、apps/api/tsconfig.json `e772da9b5064`。

## 4. 工作区未提交改动（20 项）

- 已修改 12 项：总看板 11 个 HTML 源页面（changes/design/index/issues/monitoring/plan/requirements/risks/runtime/sources/testing）+ `09_复盘与沉淀/GitHub开源项目雷达/已分析项目清单.md`。
- 未跟踪 8 项：总看板 `skill.html`（新页面）、`2026-08-07-GitHub开源项目分析报告.md`、`docs/agent-loop/work-orders/2026-08-07-qoder-RP-047-C.md`、RP-047 Batch C 计划与 checkpoint 观测 UI 设计文档、`skills/fireworks-tech-graph/`、根目录 `skill集成.html/.svg`。
- 性质判断：均为看板/文档/Skill 过程资产，无业务代码脏改动；属于进行中工作（RP-047 Batch C 筹备、GitHub 雷达当日产出、skill.html 新页面）待各自任务收口后提交。

## 5. 项目健康度评估

| 检查项 | 结果 |
|---|---|
| `npm run build:api`（tsc） | ✅ 通过（exit 0） |
| `npm run build:web`（vite build） | ✅ 通过（571ms；仅 chunk 体积提示，非错误） |
| 未提交改动堆积 | ⚠️ 20 项未提交（全部为看板/文档资产，无业务代码；建议随所属任务收口提交） |
| 文档与实现一致性 | ⚠️ 总看板新增 `skill.html` 尚未纳入 `board-build.js` 导航配置（NAV_GROUPS 中无该页），需在该页面任务收口时同步；其余板块与 AGENTS.md 口径一致（V0_SAAS 已下线、21/21 模块迁移完成） |
| 分支状态 | 本地 main 领先 origin/main 11 提交，未推送（符合"不自动 push"约束，由用户决定推送时机） |

## 6. 结论

项目处于 RP-047 Batch B 已合入、Batch C 筹备中的活跃开发期；双端构建健康，无依赖漂移；主要待办是未提交的看板/文档资产随任务收口，以及新页面 skill.html 的导航接入。
