# workload-api-external-agent 变更日志

> 本文件记录该 Skill 的所有迭代变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 简化版。

---

## [v1.0.0] - 2026-05-07

### 初始发布

- ✅ 完整的外部 Agent 接入 WES API 配置与演示 Skill
- ✅ 包含两条主路径：
  - **路径 A**：智能问询（无 Excel）→ 组装需求快照 → Kimi 评估预览 → 可选导出 Markdown
  - **路径 B**：上传 Excel → Kimi 解析 → Kimi 评估 → Markdown / 转 PDF
- ✅ 覆盖接口：`/ai/chat`、`/ai/company-profile-summary`、`/ai/parse-basic-info`、`/ai/kimi-assessment/preview`、`/ai/kimi-assessment/export-markdown`
- ✅ 含完整 curl 示例、最小 JSON 骨架、交付物说明（文字/Markdown/PDF）
- ✅ 包含首次配置清单、账号前提、常用接口速查表
- ✅ 提供 Agent 系统提示摘要句

### 来源

- 初始内容从 `.cursor/skills/workload-api-external-agent/SKILL.md` 迁移至独立 `skills/` 目录管理。

---

## 迭代规范

### 版本号规则

采用 SemVer 简化版：`主版本.次版本.修订号`

- **Major**：API 契约 Breaking Change、核心流程重构
- **Minor**：新增接口/路径、功能增强、向后兼容
- **Patch**：文案修正、curl 示例修复、补充说明

### 记录格式

```markdown
## [vX.Y.Z] - YYYY-MM-DD

### Added / Changed / Fixed / Deprecated

- <变更项 1>
- <变更项 2>
```
