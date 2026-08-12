# Codex Project Registry

> 用途：Codex 新会话或子代理启动前先读本表，确认正确工作区、禁止路径、验证命令和协作分工。事实已于 2026-08-12 复核；每次执行前仍需运行对应预检命令确认分支和 dirty 状态。

## 使用规则

1. 先确认用户要操作哪个项目，再进入对应路径。
2. 对标记为“禁止作为主线”的路径，只能做历史追溯或迁移核对，不能交付新主线能力。
3. 写代码前先运行项目预检命令；发现大量既有 dirty changes 时，只能精确修改本次文件，不得清理或还原无关变更。
4. 子代理只读巡检时优先按“入口一致性 / 验证命令 / 知识资产复用”拆分；写代码子代理必须有明确文件边界。

## 项目入口表

| 项目 | 正确路径 | 禁止/谨慎路径 | 当前主线与状态 | 默认预检 | 推荐验证 | 可写性 | 子代理分工 |
|---|---|---|---|---|---|---|---|
| WorkEvolutionSys / WES 唯一活动交付目录 | `/Users/kevin/AI/Workload-evaluation-system` | 原 `-agent` linked worktree 已注销，不得再将历史路径作为入口；`/Users/kevin/AI/wes-worktrees/merge-main` 仅为当前主线集成与验收 worktree；不得覆盖任一目录的既有未提交改动 | Web 主线 `ui/V2_PROTOTYPE`；后端主线 `apps/api`；交付分支 `main`，2026-08-12 已整合 RP-055~058 与 DEF-2026-08-11-003 | `pwd && git status --short --branch && git worktree list --porcelain` | `npm run build:web`; `npm run build:api`; `npm run test:modules`; `npm run test:web`; `npm run test:ai`; `npm run test:agent -w apps/api`; `npm run test:harness -w apps/api` | 可写，但必须精确保护无关 dirty changes | 入口/边界审计、issue-first 分诊、代码实现、总看板同步、验证复核 |
| MiniCRM-Sys | `/Users/kevin/AI/MiniCRM-Sys` | 不要套用 WES 架构边界；MiniCRM 是独立产品 | 当前观察为 `main` 且有既有 dirty changes | `pwd && git status --short --branch` | `pnpm build`; `pnpm lint`; `pnpm db:migrate` 按任务选择 | 可写，先确认业务目标 | 前端实现、数据/迁移审计、验证命令审计 |
| 项目交付 Skill 套件 | `/Users/kevin/Library/Mobile Documents/com~apple~CloudDocs/AI-project/Resource/Skill Hub/项目交付skill套件/项目交付skill套件(V10.0.0）` | 上级 `项目交付skill套件` 不是 git worktree；目录名 V10.0.0 与 `SKILL.md` 元信息 `version: 11.0.0` 并存，需显式说明 | 金蝶实施方法论 Skill 套件；当前以文件资产为主 | `ls && sed -n '1,80p' SKILL.md` | 使用 `docs/codex-workflows/long-doc-skill-review-template.md` 做交叉检查；如有脚本再按本地说明执行 | 谨慎写；先确认版本目标 | 结构一致性、版本/配置一致性、Markdown/YAML 格式、业务语义检查 |
| 行业深度分析报告 Skill | `/Users/kevin/Library/Mobile Documents/com~apple~CloudDocs/AI-project/Resource/Skill Hub/研究分析/行业深度分析报告技能/kingdee-industry-report` | 上级目录不是 git worktree | 金蝶行业研究报告 Skill；含 `scripts/regression-check.mjs` | `find . -maxdepth 2 -type f | sort | sed -n '1,80p'` | `node scripts/regression-check.mjs`（如依赖可用） | 谨慎写；优先模板化输出 | 事实源采集、报告结构审查、回归脚本审计 |
| Obsidian 知识库 | `/Users/kevin/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/Obsidian` | 不要在未限定范围时全库搜索；git 根在父目录且 iCloud 同步会制造噪声 | 当前观察为 `main...origin/main [ahead 1, behind 4]`，存在 Obsidian 配置与笔记改动 | `git status --short --branch`；先限定目录/关键词 | 无统一构建；以只读检索和笔记整理为主 | 默认只读，除非用户指定笔记文件 | 知识检索、主题聚类、资料去重 |

## 固定子代理模式

| 模式 | 适用场景 | 输出 |
|---|---|---|
| 入口一致性审计 | 新项目、新会话、路径不确定、多个历史工作区并存 | 正确路径、禁止路径、当前分支、dirty 风险、入口文档冲突 |
| 验证命令审计 | 交付前、脚本不清、依赖状态不明 | 推荐 quick/full 验证命令、预期输出、无法运行的原因 |
| 需求池去重 | WES 反馈、缺陷、体验调整、需求池任务 | 已有 RP 命中、是否补证据或新增、建议状态 |
| 总看板同步 | WES 需求、设计、实现、测试、风险、文档资产变化 | 需要更新的看板页面、结构化事件、验证证据 |
| 长文档交叉检查 | Skill 升版、长 Markdown、配置文件、版本一致性检查 | Critical / Medium / Minor 报告和检查项通过率 |

## 禁止事项

- WES 当前只保留 `/Users/kevin/AI/Workload-evaluation-system` 一个活动目录；历史文档中的 `-agent` 路径不得直接用于执行命令。
- 如未来重新创建 linked worktree 或搬迁目录，必须先核对 `git worktree list --porcelain`，再按实际路径执行 `git worktree repair <path>`。
- 不在 WES 中恢复 `apps/web`，不把 `ui/V0_SAAS` 当作主线交付。
- 不在对话或文档中保存 API Key、token、cookie、私钥。
- 不启动 Codex 侧 WES Loop 自动化；WES Loop 后续由 Qoder 创建和执行，Codex 只做一次性分析、实现或看板同步。
- 不对存在大量 dirty changes 的项目执行大范围格式化、清理或 git 还原。
