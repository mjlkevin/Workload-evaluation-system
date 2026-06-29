---
name: recording-wes-requirements
description: >-
  Use in the WorkEvolutionSys repository when the user reports a test issue,
  requirement, feedback, defect, UX adjustment, feature change, or larger product
  thought that should be analyzed and recorded into the project-level demand pool
  before implementation planning.
---

# WES 需求池记录 Skill

## Overview

This Skill turns user feedback into a governed backlog entry in the WES Agent command board. It is used for non-blocking test findings, requirement ideas, defects, UX adjustments, functional changes, and strategic product thoughts that should be collected first, analyzed, and planned later.

Core rule: **不要遇到一个问题就立刻开发；先判断是否阻塞，再完成事实确认、需求分析和需求池记录。**

## Trigger Words

Use this Skill when the user message contains or clearly implies any of these signals:

- `测试问题`
- `需求`
- `反馈`
- `缺陷`
- `bug`
- `体验调整`
- `功能调整`
- `大方向思考`
- `需求池`
- UI 截图中的可用性问题

## Decision Policy

1. **Blocking issue**: if the issue prevents continued testing, blocks the main user flow, risks data loss, or breaks login/API/runtime, report it as blocking and ask whether to switch from backlog recording to immediate fix.
2. **Non-blocking and enough information**: analyze and write it directly into the demand pool. Do not ask follow-up questions first.
3. **Information insufficient**: ask the minimum necessary follow-up before writing. Typical missing fields are affected page, expected behavior, actual behavior, reproduction condition, or priority signal.
4. **Implementation request explicitly included**: if the user asks to fix it now, record the requirement first, then proceed with normal implementation workflow.

## Deduplication Gate

Before adding a new RP, search existing demand-pool and change-log entries for the same page, module, symptom, screenshot wording, action, or error phrase. Use `docs/codex-workflows/wes-feedback-intake.md` as the executable template.

If a match exists:

1. **Same fact and same scope**: do not create a new RP. Add evidence/comment/status detail to the existing RP and record the intake in `changes.html` only when the new evidence is material.
2. **Same RP but broader scope**: update the existing RP's scope, impact, acceptance口径, priority, and next step as needed.
3. **Related but independent behavior**: create a new RP and cross-reference the related RP in the focused analysis section.

The final response must state the dedup result: `命中 RP-XXX` or `未命中，新增 RP-XXX`.

## Required Analysis Fields

Every recorded item should include:

| Field | Requirement |
|---|---|
| Problem source | User, test session, screenshot, page, environment, or related artifact. |
| Requirement source | Original user statement and whether it is test feedback, feature idea, UX adjustment, or strategic thought. |
| Current fact | What is observed now. Separate direct evidence from inference. |
| User impact | Who is affected and how work efficiency, accuracy, governance, or delivery is affected. |
| Initial solution | A feasible first方案, including frontend/backend/data/test/document impact. |
| Priority | `P0` only for blocking/data-loss/security; `P1` for high-frequency or core-flow issues; `P2` for follow-up optimization. |
| Status | `已分析 / 待规划` when enough information exists; `待分析` when follow-up is required. |
| Acceptance口径 | Concrete observable result for future implementation verification. |
| Next step | Planning, design, implementation, or follow-up question. |

## Board Update Mapping

This Skill composes `maintain-wes-command-board`. Before writing, read `skills/maintain-wes-command-board/SKILL.md` and follow its board ownership rules.

Minimum board updates:

1. `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
   - Add the requirement to the status board, ledger, breakdown matrix, planning view, and a focused analysis section when the item needs context for later planning.
2. `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
   - Add to the follow-up task pool when it affects phase planning or iteration grouping.
3. `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
   - Record the intake event and status.
4. `risks.html` or `testing.html`
   - Update only when the item creates a material risk, test case, or validation result. Do not invent test results.

`requirements-editor.html` was removed on 2026-06-26. Future agents update `requirements.html` directly and record status changes in `changes.html`.

## ID And Status Rules

- Use the next available `RP-###` ID. If existing board data has duplicate IDs, do not rewrite history during intake; pick a new unused ID and mention the pre-existing inconsistency in the final response when relevant.
- Non-blocking items with adequate evidence default to status `已分析 / 待规划`.
- Missing-information items default to status `待分析`.
- Do not mark an item `实施中` unless the user explicitly asks to implement it or an existing plan already scheduled it.

## Analysis Template

Use this compact structure when adding a focused analysis section:

```text
问题：当前观察到什么。
影响：对用户、流程、效率或质量的影响。
边界：本次需求涉及什么，不涉及什么。
初步方案：推荐方案与备选方案。
验收口径：未来实现后怎么证明完成。
待规划输入：后续排期、设计或风险评审需要关注什么。
```

## Final Response Pattern

After recording, respond with:

```text
已按需求记录 Skill 处理：<RP-ID>《<title>》已进入需求池，状态为<status>。总看板同步：已更新 <files>；本次未做代码修复。
```

If more information is needed:

```text
这条反馈暂时不能直接入池，因为缺少 <missing field>。请补充 <question>，我再按需求记录 Skill 写入需求池。
```

---

*本 Skill 版本：v1.0.0*
*对应系统版本：WorkEvolutionSys / WES Agent command board*
*最后更新：2026-06-23*
