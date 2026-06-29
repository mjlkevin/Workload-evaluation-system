# Long Document And Skill Upgrade Review Template

> 目标：把长文档、Skill 升版和配置变更的交叉检查标准化，减少手写超长提示词。

## 输入

```text
任务：对以下文件做交叉检查，不修改文件。
版本目标：<例如 v1.1.0 -> v1.2.0>
重点风险：<编号连续性 / 引用一致性 / 表数量 / YAML / JSON / CLI 参数 / 业务语义>
文件：
- <path 1>
- <path 2>
- <path 3>
输出：Critical / Medium / Minor + 检查项通过率。
```

## 子代理拆分

| 子代理 | 检查范围 | 典型命令 |
|---|---|---|
| 结构一致性 | 标题编号、流程引用、章节完整性、代码块闭合、Markdown 表格列数 | `rg -n "^#|流程|```|\\|" <files>` |
| 版本与配置一致性 | version、表数量、token、table_id、配置 key、脚本参数 | `rg -n "version|token|table_id|--app-token|--base-token|project_report" <files>` |
| 格式合法性 | YAML front matter、JSON 格式、缩进、路径可读性 | `python3 -m json.tool <file>`；必要时用解析器 |
| 业务语义 | 流程是否闭环、错误处理是否覆盖新增能力、数据来源是否可追溯 | 人工审读并列证据行号 |

## 报告格式

```markdown
## 总体：通过/不通过 | Critical X | Medium X | Minor X

## Critical（必须修复）
- [文件:行号] 问题描述；影响；建议修复。

## Medium（建议修复）
- [文件:行号] 问题描述；影响；建议修复。

## Minor（可选）
- [文件:行号] 问题描述；影响；建议修复。

## 检查项通过率
- A 引用一致性: X/Y
- B 内容完整性: X/Y
- C 数据正确性: X/Y
- D 业务闭环: X/Y
```

## 规则

- 长文档检查默认只读；除非用户明确说“修复”，否则不改文件。
- Critical 必须有可复查证据，不能只写主观判断。
- 如果发现目录名、版本号、元信息不一致，必须单独列为 Medium 或 Critical，视影响决定。

