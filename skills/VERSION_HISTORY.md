# WorkEvolutionSys Skill 全局版本历史

> 本文件记录所有 Skill 的发布、迭代与废弃事件，便于追溯系统各版本对应的 Skill 能力。

---

## 概览

| 日期 | Skill 名称 | 版本 | 类型 | 说明 |
|------|-----------|------|------|------|
| 2026-06-23 | `recording-wes-requirements` | v1.0.0 | 🚀 发布 | 新增项目级需求记录 Skill，规范测试问题、需求、反馈、缺陷、体验调整等输入进入需求池的分析与看板同步流程 |
| 2026-06-23 | `maintain-wes-command-board` | v1.0.0 | 🚀 发布 | 新增 WES Agent 总看板维护 Skill，规范需求、设计、开发、测试、变更、监控和风险过程数据沉淀 |
| 2026-05-07 | `workload-api-external-agent` | v1.0.0 | 🚀 发布 | 从 `.cursor/skills/` 迁移至独立 `skills/` 目录，初始发布 |

---

## 详细记录

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
