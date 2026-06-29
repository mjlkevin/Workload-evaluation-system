# WorkEvolutionSys Skill 全局版本历史

> 本文件记录所有 Skill 的发布、迭代与废弃事件，便于追溯系统各版本对应的 Skill 能力。

---

## 概览

| 日期 | Skill 名称 | 版本 | 类型 | 说明 |
|------|-----------|------|------|------|
| 2026-06-26 | `wes-qoder-worktree-protocol` | v1.0.0 | 🚀 发布 | 新增 Qoder 在 WES 中使用隔离 worktree 执行需求池/Loop 任务的协议 Skill，要求 Worktree Contract ACK、验证证据和结构化 handoff |
| 2026-06-24 | `wes-loop` | v1.0.1 | 🧹 退役 | 按用户决策清理 Codex 侧 WES Loop：删除 heartbeat 自动化与仓库内 `skills/wes-loop` 文件，持续 Loop 改由 Qoder 创建和执行 |
| 2026-06-24 | `wes-loop` | v1.0.0 | 🚀 发布 | 新增 WES Loop Skill，通过 Schedule MCP 每 30 分钟自动唤醒，从需求池选取最高优先级未完成需求，完成分析→设计→实现→测试→看板更新全流程 |
| 2026-06-23 | `recording-wes-requirements` | v1.0.0 | 🚀 发布 | 新增项目级需求记录 Skill，规范测试问题、需求、反馈、缺陷、体验调整等输入进入需求池的分析与看板同步流程 |
| 2026-06-23 | `maintain-wes-command-board` | v1.0.0 | 🚀 发布 | 新增 WES Agent 总看板维护 Skill，规范需求、设计、开发、测试、变更、监控和风险过程数据沉淀 |
| 2026-05-07 | `workload-api-external-agent` | v1.0.0 | 🚀 发布 | 从 `.cursor/skills/` 迁移至独立 `skills/` 目录，初始发布 |

---

## 详细记录

### 2026-06-26

#### wes-qoder-worktree-protocol v1.0.0 🚀

- **操作类型**：初始发布
- **来源**：用户确认 Qoder 负责需求池 Loop 实现，Codex 负责规划、设计、复核与看板治理，需要稳定的 worktree 协作协议。
- **变更内容**：
  - 新增 `skills/wes-qoder-worktree-protocol/SKILL.md`
  - 新增 `skills/wes-qoder-worktree-protocol/references/protocol.md`
  - 新增 `QODER.md` 作为 Qoder 进入 WES 项目的固定入口
  - 在 `AGENTS.md` 与 `CLAUDE.md` 追加 Qoder worktree contract 与 handoff 规则
- **对应系统版本**：WorkEvolutionSys / WES Agent 升级总看板
- **发布者**：Codex

### 2026-06-24

#### wes-loop v1.0.1 🧹

- **操作类型**：退役 / 清理
- **来源**：用户确认 Codex 侧 Loop 消耗过大，后续 WES Loop 交给 Qoder 创建和执行。
- **变更内容**：
  - 删除 Codex app heartbeat 自动化 `wes-loop`
  - 删除仓库内 `skills/wes-loop/SKILL.md`
  - 删除仓库内 `skills/wes-loop/CHANGELOG.md`
  - 在 `AGENTS.md` 中明确 Codex 不再创建或执行 WES Loop 自动化
  - 新增 `codex-project-registry.md` 与 `docs/codex-workflows/`，将单次需求处理、外部 AI 回填和安全验证流程结构化
- **对应系统版本**：WorkEvolutionSys / WES Agent 升级总看板
- **执行者**：Codex

#### wes-loop v1.0.0 🚀

- **操作类型**：初始发布
- **来源**：用户希望建立自动化 Loop 机制，每 30 分钟唤醒一次，持续推进需求池中未完成需求的分析、实现与交付。
- **变更内容**：
  - 新增 `skills/wes-loop/SKILL.md`
  - 新增 `skills/wes-loop/CHANGELOG.md`
  - 定义需求池解析策略、选取算法（priority × status 接近度 × id）、5 阶段工作流、阻塞处理、熔断机制
  - 通过 Schedule MCP one-shot 定时实现循环调度，每轮结束时创建 30 分钟后的下一轮任务
  - 在 `AGENTS.md` Section 9 追加 Loop 触发规则
- **对应系统版本**：WorkEvolutionSys / WES Agent 升级总看板
- **发布者**：AI Agent

### 2026-06-23

#### recording-wes-requirements v1.0.0 🚀

- **操作类型**：初始发布
- **来源**：用户提出希望把测试问题、需求反馈、体验调整和大方向思考先交给 AI 分析，再规范记录到项目级需求池，后续统一规划。
- **变更内容**：
  - 新增 `skills/recording-wes-requirements/SKILL.md`
  - 新增 `skills/recording-wes-requirements/CHANGELOG.md`
  - 明确触发词、阻塞判断、直接入池/追问策略、需求分析字段、看板同步位置和最终回复口径
- **对应系统版本**：WorkEvolutionSys / WES Agent 升级总看板
- **发布者**：AI Agent

#### maintain-wes-command-board v1.0.0 🚀

- **操作类型**：初始发布
- **来源**：本次 WES 项目管理体系与总看板治理需求
- **变更内容**：
  - 新增 `skills/maintain-wes-command-board/SKILL.md`
  - 新增 `references/board-module-map.md`，定义总看板页面职责与生命周期映射
  - 新增 CHANGELOG 与 `agents/openai.yaml`
  - 将 Skill 登记到项目 Skill 管理中心
- **对应系统版本**：WorkEvolutionSys / WES Agent 升级总看板
- **发布者**：AI Agent

### 2026-05-07

#### workload-api-external-agent v1.0.0 🚀

- **操作类型**：初始发布（迁移）
- **来源**：`.cursor/skills/workload-api-external-agent/SKILL.md`
- **变更内容**：
  - 创建独立 `skills/` 目录管理体系
  - 将现有 Skill 纳入规范化管理，新增 CHANGELOG.md
  - 无内容 Breaking Change，原 Cursor Skill 功能完整保留
- **对应系统版本**：WorkEvolutionSys（当前主干）
- **迁移者**：AI Agent

---

## 废弃记录

| 日期 | Skill 名称 | 原版本 | 废弃原因 | 替代方案 |
|------|-----------|--------|---------|---------|
| （无） | — | — | — | — |

---

## 归档索引

| Skill 名称 | 归档版本 | 归档路径 | 归档日期 |
|-----------|---------|---------|---------|
| （无） | — | — | — |

---

*维护提示：每次 Skill 发布、迭代或废弃时，请在「概览」追加一行，在「详细记录」追加完整说明。*
