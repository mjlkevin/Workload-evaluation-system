# WorkEvolutionSys (WES) — Claude Compatibility Entry

> 本文件仅作为 Claude/旧工具入口兼容层。当前项目事实源以 `AGENTS.md` 为准；如本文件与 `AGENTS.md` 冲突，必须按 `AGENTS.md` 执行。

## 必读顺序

1. `AGENTS.md` — WES 架构边界、权限、版本机制、总看板规则和禁止事项。
2. `codex-project-registry.md` — 正确工作区、禁止路径、默认验证命令、子代理分工。
3. `03_技术设计/系统演进/实现与文档对齐说明.md` — 当前实现与文档对齐口径。
4. `README.md` — 项目全景、端口、脚本和目录。
5. `skills/maintain-wes-command-board/SKILL.md` — 总看板过程数据沉淀规则。
6. `skills/recording-wes-requirements/SKILL.md` — 需求反馈入池与去重规则。

## 当前主线摘要

- Web 主线：`ui/V2_PROTOTYPE`（Vite + React）。
- 后端主线：`apps/api`（Express + modules）。
- `ui/V0_SAAS` 为【历史说明，下线中】资产，仅用于迁移核对与历史追溯。
- `/Users/kevin/AI/Workload-evaluation-system-agent` 是当前 WES 活动交付 worktree。
- `/Users/kevin/AI/Workload-evaluation-system` 是同一 Git 仓库的另一 linked checkout，用于分支集成与历史差异核对，不是第二套项目。

## Codex / AI 协作规则

- WES 原始反馈先按 `docs/codex-workflows/wes-feedback-intake.md` 进入问题池并去重，再由 Codex Intake/Triage Loop 决定补证据、派生需求、派生缺陷或立即修复。
- Qoder 执行 WES 需求池、Loop、实现、验证或回填任务时，先读 `QODER.md`，并使用 `skills/wes-qoder-worktree-protocol/SKILL.md` 完成 worktree contract、验证与结构化回填。
- 外部 AI 交付使用 `docs/codex-workflows/external-ai-handoff-template.md` 回填。
- 外部 API 验证使用 `docs/codex-workflows/api-secret-handling.md`，密钥不得进入对话、文档、看板或提交。
- Codex 不再创建或执行 WES Loop 自动化；持续 Loop 由 Qoder 创建和执行。
