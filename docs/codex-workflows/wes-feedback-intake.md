# WES Feedback Intake And Dedup Template

> 目标：处理 WES 测试反馈、缺陷、体验调整和新需求时，先去重再决定“补证据 / 入池 / 立即修复”，避免重复 RP 和重复看板同步。

## 触发句式

用户反馈 WES 问题时，可直接加这一句：

```text
先查需求池是否已有同类 RP；已有则只补充证据，不新增需求；本轮目标是：只诊断 / 入池 / 立即修复。
```

## 执行流程

1. 读取 `AGENTS.md`、`codex-project-registry.md`、`skills/recording-wes-requirements/SKILL.md` 和 `skills/maintain-wes-command-board/SKILL.md`。
2. 提取反馈关键词：页面、模块、用户动作、实际表现、期望表现、截图文字、错误信息。
3. 在需求池和变更记录中去重检索：

```bash
rg -n "<页面|模块|关键词|错误短语>" \
  "03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html" \
  "03_技术设计/系统架构/WES-Agent-升级总看板/changes.html"
```

4. 判定处理方式：
   - 已有 RP 且事实相同：只补充 evidence/comment，不新增 RP。
   - 已有 RP 但范围扩大：更新 scope、impact、acceptance，必要时提高优先级。
   - 无同类 RP：按 `recording-wes-requirements` 新增 RP。
   - 用户明确要求立即修复：先完成入池或补证据，再进入实现。
5. 按看板职责同步页面：至少 `requirements.html`、`changes.html`；涉及排期或风险时同步 `plan.html` / `risks.html`。`requirements-editor.html` 已于 2026-06-26 移除，后续由 AI 直接维护 `requirements.html`。

## 输出格式

```text
去重结果：命中 RP-XXX / 未命中。
处理方式：补充证据 / 新增入池 / 立即修复。
理由：<一句话说明>
看板同步：已更新 <files>；未更新 <files> 的原因是 <reason>。
```

## 不做的事

- 不因为用户只说“看看问题”就直接改代码。
- 不把同一截图反馈重复登记为新 RP。
- 不把人工未验证的结果写成“已通过”。
