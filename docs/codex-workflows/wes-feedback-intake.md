# WES Feedback Intake And Triage Template

> 目标：处理 WES 测试反馈、缺陷、体验调整和新需求时，先保留原始 issue，再由 Codex Intake/Triage Loop 去重、分类并决定“补证据 / 派生需求 / 派生缺陷 / 立即修复”，避免来源丢失和重复建项。

## 触发句式

用户反馈 WES 问题时，可直接加这一句：

```text
先查问题池、需求池和缺陷池是否已有同类记录；已有则只补充证据或范围，不重复建项；本轮目标是：只诊断 / 分诊 / 立即修复。
```

## 执行流程

1. 读取 `AGENTS.md`、`codex-project-registry.md`、`skills/recording-wes-requirements/SKILL.md` 和 `skills/maintain-wes-command-board/SKILL.md`。
2. 提取反馈关键词：页面、模块、用户动作、实际表现、期望表现、截图文字、错误信息。
3. 在问题池、需求池、缺陷池和变更记录中去重检索：

```bash
rg -n "<页面|模块|关键词|错误短语>" \
  "03_技术设计/系统架构/WES-Agent-升级总看板/issues.html" \
  "03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html" \
  "03_技术设计/系统架构/WES-Agent-升级总看板/defects.html" \
  "03_技术设计/系统架构/WES-Agent-升级总看板/changes.html"
```

4. 原始反馈统一先进入问题池：命中同类 issue 时更新原记录，未命中时才分配新的 `ISS-###` 来源记录。
5. 执行 **Codex Intake/Triage Loop**：
   - 已有同类 issue：补充 evidence/comment/scope，不新增 issue。
   - 分诊为 `requirement`：创建或更新关联 `RP-###`。
   - 分诊为 `defect`：创建或更新关联 defect，并保留受影响 RP。
   - 分诊为 `question / duplicate / out-of-scope`：只记录处置，不派生需求或缺陷。
   - 用户明确要求立即修复：先完成 issue 记录和分诊，再进入对应派生项的实现。
6. 按看板职责同步页面：至少 `issues.html`、`changes.html`；派生 requirement / defect 时同步 `requirements.html` / `defects.html`；涉及排期或风险时同步 `plan.html` / `risks.html`。`requirements-editor.html` 已于 2026-06-26 移除，后续由 AI 直接维护 `requirements.html`。

## 输出格式

```text
去重结果：命中 ISS-XXX / 未命中，新增 ISS-XXX。
分诊结果：requirement / defect / question / duplicate / out-of-scope。
关联项：RP-XXX / DEF-XXX / 无。
处理方式：补充证据 / 建立派生项 / 立即修复 / 仅记录处置。
理由：<一句话说明>
看板同步：已更新 <files>；未更新 <files> 的原因是 <reason>。
```

## 不做的事

- 不因为用户只说“看看问题”就直接改代码。
- 不把原始反馈越级登记为需求或缺陷。
- 不把同一截图反馈重复登记为新 issue 或新 RP。
- 不把人工未验证的结果写成“已通过”。
