# WorkEvolutionSys — Skill 管理中心

> 本目录独立管理 WorkEvolutionSys（工作量评估系统）配套的 Cursor / Kimi / 通用 Agent Skill，与 `.cursor/skills/` 解耦，便于跨 IDE/Agent 复用与版本迭代。

---

## 📁 目录结构

```
skills/
├── README.md                          # 本文件：管理规范与使用说明
├── SKILL_TEMPLATE.md                  # 新建 Skill 的标准模板
├── VERSION_HISTORY.md                 # 全局版本迭代记录
│
├── maintain-wes-command-board/        # 【已发布】WES Agent 总看板过程数据沉淀
│   ├── SKILL.md                       #   Skill 正文
│   └── CHANGELOG.md                   #   该 Skill 的独立变更日志
│
├── recording-wes-requirements/        # 【已发布】测试反馈与需求入池治理
│   ├── SKILL.md                       #   Skill 正文
│   └── CHANGELOG.md                   #   该 Skill 的独立变更日志
│
├── wes-qoder-worktree-protocol/       # 【已发布】Qoder worktree 执行与回填协议
│   ├── SKILL.md                       #   Skill 正文
│   ├── CHANGELOG.md                   #   该 Skill 的独立变更日志
│   ├── agents/openai.yaml             #   Skill UI 元信息
│   └── references/protocol.md         #   Worktree Contract 与 handoff 模板
│
├── workload-api-external-agent/       # 【已发布】外部 Agent 接入 API 的完整配置
│   ├── SKILL.md                       #   Skill 正文
│   └── CHANGELOG.md                   #   该 Skill 的独立变更日志
│
├── drafts/                            # 【草稿】正在编写中的 Skill
│   └── wes-multi-agent-collaboration/ # 【草稿】WES 多 Agent 团队协作协议
│
└── archive/                           # 【归档】已废弃或合并的历史版本
    └── (按 Skill 名分子目录，含版本号归档)
```

---

## 🚀 快速开始

### 对于 Cursor 用户
Cursor 会自动读取项目根目录下 `.cursor/skills/` 的 Skill。为使本目录生效，请确保：

```bash
# 方式一：符号链接（推荐，保持单点维护）
ln -sf ../../skills/workload-api-external-agent .cursor/skills/workload-api-external-agent

# 方式二：直接复制（如需独立版本控制）
cp -r skills/workload-api-external-agent .cursor/skills/
```

### 对于 Kimi Code CLI 用户
Kimi Code CLI 支持 `.kimi/skills/` 目录自动识别：

```bash
mkdir -p .kimi/skills
ln -sf ../../skills/workload-api-external-agent .kimi/skills/workload-api-external-agent
```

### 对于其他 Agent / 手动引用
直接引用 `skills/<skill-name>/SKILL.md` 路径即可。

---

## 📝 新建 Skill 流程

1. **复制模板**：将 `SKILL_TEMPLATE.md` 复制到 `drafts/<skill-name>/SKILL.md`
2. **草稿迭代**：在 `drafts/` 中编写、测试、评审
3. **正式发布**：移至根目录 `skills/<skill-name>/`，并创建 `CHANGELOG.md`
4. **登记版本**：在 `VERSION_HISTORY.md` 中记录发布信息
5. **链接到 IDE**：按需创建到 `.cursor/skills/` 或 `.kimi/skills/` 的符号链接

---

## 🔄 迭代管理规范

| 场景 | 操作 |
|------|------|
| **新增 Skill** | 走「新建 Skill 流程」，从 `drafts/` 开始 |
| **Skill 小迭代**（patch）| 修改 `skills/<name>/SKILL.md`，在 `CHANGELOG.md` 追加 patch 记录 |
| **Skill 大迭代**（minor/major）| 修改前先将旧版完整复制到 `archive/<name>-v<旧版本>/`，再更新当前版，登记 `VERSION_HISTORY.md` |
| **废弃 Skill** | 移至 `archive/<name>-DEPRECATED/`，在 `VERSION_HISTORY.md` 标注废弃原因与替代方案 |
| **同步到 `.cursor/skills/`** | 执行 `scripts/sync-skills.sh`（见下方脚本说明）或手动复制/链接 |

---

## 📜 版本号规则

采用 **SemVer 简化版**：`主版本.次版本.修订号`

- **主版本（Major）**：API 契约 Breaking Change、核心流程重构
- **次版本（Minor）**：新增接口/路径、功能增强、向后兼容
- **修订号（Patch）**：文案修正、curl 示例修复、补充说明

示例：`v1.2.3`

---

## 🔧 配套脚本

### `scripts/sync-skills.sh`（建议后续创建）

```bash
#!/bin/bash
# 将 skills/ 下所有已发布 Skill 同步到 .cursor/skills/ 和 .kimi/skills/
# 用法：./scripts/sync-skills.sh
```

> 如需此脚本，请通知维护者创建。

---

## 📋 Skill 清单

| Skill 名称 | 状态 | 当前版本 | 说明 | 最后更新 |
|-----------|------|---------|------|---------|
| `maintain-wes-command-board` | ✅ 已发布 | v1.0.0 | 约束后续模型把需求、设计、开发、测试、变更、监控和风险过程数据同步沉淀到 WES Agent 升级总看板 | 2026-06-23 |
| `recording-wes-requirements` | ✅ 已发布 | v1.0.0 | 将测试问题、需求、反馈、缺陷和体验调整先分析并规范记录到项目级需求池，支持非阻塞问题直接入池、信息不足先追问 | 2026-06-23 |
| `wes-qoder-worktree-protocol` | ✅ 已发布 | v1.0.0 | 约束 Qoder 在 WES 中使用隔离 worktree 执行需求池/Loop 任务，并按 Worktree Contract ACK 与 handoff 模板回填 | 2026-06-26 |
| `workload-api-external-agent` | ✅ 已发布 | v1.0.0 | 外部 Agent（Kimiclaw 等）接入 WES API 的完整配置与演示 | 2026-05-07 |
| `wes-multi-agent-collaboration` | 📝 草稿 | v0.1.0-draft | 定义 WES 多 Agent 团队注册表、启用状态、分工槽位、handoff、复核门禁与看板同步机制 | 2026-06-29 |

---

## ❓ 常见问题

**Q：`.cursor/skills/` 和 `skills/` 有什么区别？**  
A：`.cursor/skills/` 是 Cursor IDE 的自动识别目录，由 Cursor 消费；`skills/` 是本项目的**独立管理源**，支持多 IDE/Agent 复用、版本归档、迭代评审。

**Q：修改了 `skills/` 下的文件，Cursor 会自动生效吗？**  
A：如果使用的是**符号链接**，会立即生效；如果使用的是**复制**，需要重新同步。

**Q：能否在 Skill 中引用项目内的其他文档？**  
A：可以，但请使用**相对路径**（如 `../../docs/openapi.yaml`），并在 Skill 中注明路径基准为「项目根目录」。

---

*维护者：请确保每次 Skill 变更都同步更新本 README 的「Skill 清单」和对应的 CHANGELOG。*
