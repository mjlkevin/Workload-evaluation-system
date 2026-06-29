# External AI Handoff Template

> 目标：让 Qoder、Kimi、Codex 或其他 AI 的交付结果可被 Codex 快速核验、入池、同步看板，而不是每次从长对话里重新解析。

## 外部 AI 交付回填格式

```markdown
## 目标
<本轮要解决的问题和边界>

## 变更文件
- <path>: <新增/修改/删除内容摘要>

## 验证命令与结果
- `<command>`: pass/fail，关键输出摘要

## 风险
- <权限 / 数据 / 兼容 / 测试缺口 / 人工验收缺口>

## 是否需看板同步
是/否。若是，建议页面：requirements / plan / testing / monitoring / risks / changes / sources。

## 下一步建议
- <继续实现 / 等待人工验收 / 回滚 / 补测试 / 入需求池>
```

## Codex 接收流程

1. 先核对路径是否在 `codex-project-registry.md` 的正确项目入口下。
2. 对照 git status，只审查本次声明文件，不还原无关 dirty changes。
3. 如果是 WES：
   - 涉及反馈/需求：先执行 `docs/codex-workflows/wes-feedback-intake.md`。
   - 涉及项目过程事实：按 `skills/maintain-wes-command-board/SKILL.md` 同步看板。
4. 如果交付报告缺验证结果，Codex 不声明“已通过”，只能记录“待验证”。
5. 如果交付报告缺文件清单，先要求补齐或自行做只读 diff 盘点。

## 看板结构化事件

```text
type=<requirement_intake|implementation|verification|risk|source_asset|loop_cleanup>
date=YYYY-MM-DD
scope=<一句话范围>
evidence=<文件路径或命令>
pages=<requirements,plan,testing,monitoring,risks,changes,sources>
status=<已分析|已交付|待验证|已清理>
next=<下一步>
```

## 不接受的回填

- 只写“已完成”，没有文件和验证。
- 只贴长日志，没有结论。
- 把 API Key、token、cookie、私钥贴入正文。

