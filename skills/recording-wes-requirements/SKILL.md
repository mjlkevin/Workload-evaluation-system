---
name: recording-wes-requirements
description: >-
  Use in the WorkEvolutionSys repository when the user reports a test issue,
  requirement, feedback, defect, UX adjustment, feature change, or larger product
  thought that needs governed intake before diagnosis, planning, or implementation.
---

# WES 反馈分诊记录 Skill

## Overview

This Skill turns user feedback into a governed issue record in the WES Agent command board. The issue is the source record; requirement and defect records are triage outcomes that must retain traceability to it.

Core rule: **原始反馈统一先进入问题池，再由 Codex Intake/Triage Loop 完成去重、分类和处置；不得把原始反馈越级登记为需求或缺陷。**

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

1. **Blocking issue**: if the issue prevents continued testing, blocks the main user flow, risks data loss, or breaks login/API/runtime, create or update the issue record, mark it blocking, and ask whether to switch to an immediate fix.
2. **Non-blocking and enough information**: create or update the issue record without asking unnecessary follow-up questions, then run the Codex Intake/Triage Loop.
3. **Information insufficient**: preserve the raw feedback as an issue in `待补充` status and ask the minimum necessary follow-up. Typical missing fields are affected page, expected behavior, actual behavior, reproduction condition, or priority signal.
4. **Implementation request explicitly included**: record and triage the issue first, then proceed with the normal implementation workflow for the resulting requirement or defect.

## Deduplication Gate

Before creating a new `ISS-###`, search issue, defect, requirement, and change records for the same page, module, symptom, screenshot wording, action, or error phrase. Use `docs/codex-workflows/wes-feedback-intake.md` as the executable template.

If a match exists:

1. **Same fact and same scope**: do not create a duplicate issue. Add evidence, comment, or status detail to the existing issue and update its linked requirement/defect only when the new evidence changes that object.
2. **Same issue but broader scope**: update the existing issue's scope, impact, acceptance口径, priority signal, and next step; preserve its existing links.
3. **Related but independent behavior**: create a new issue and cross-reference the related issue, requirement, or defect.

The final response must state the dedup result: `命中 ISS-XXX` or `未命中，新增 ISS-XXX`.

## Codex Intake/Triage Loop

1. Capture the original wording and evidence as an `ISS-###` source record.
2. Deduplicate against existing issues, requirements, and defects.
3. Classify the issue as `requirement`, `defect`, `question`, `duplicate`, or `out-of-scope`.
4. For `requirement`, create or update an `RP-###` record linked to the issue.
5. For `defect`, create or update a defect record linked to the issue and any affected RP.
6. For all other dispositions, keep the issue and record the decision; do not create a requirement or defect record.
7. Record implementation, verification, and closure status on the derived work item while retaining the source issue link.

## Required Analysis Fields

Every recorded item should include:

| Field | Requirement |
|---|---|
| Issue ID | New or matched `ISS-###` source record. |
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

1. `03_技术设计/系统架构/WES-Agent-升级总看板/issues.html`
   - Create or update the source issue, evidence, classification, disposition, and linked work items.
2. `requirements.html` or `defects.html`
   - Update only after triage selects the corresponding disposition; every derived item must link back to its issue.
3. `plan.html`
   - Add a derived requirement or defect to the follow-up task pool only when it affects phase planning or iteration grouping.
4. `changes.html`
   - Record the intake event and status.
5. `risks.html` or `testing.html`
   - Update only when the item creates a material risk, test case, or validation result. Do not invent test results.

`requirements-editor.html` was removed on 2026-06-26. Future agents update `requirements.html` directly and record status changes in `changes.html`.

## ID And Status Rules

- Use the next available `ISS-###` ID for a new source issue. Allocate an `RP-###` or defect ID only after triage selects that disposition.
- Non-blocking issues with adequate evidence default to `待分诊`; missing-information issues default to `待补充`.
- Duplicate IDs in historical board data are not rewritten during intake. Pick a new unused ID and surface the inconsistency when relevant.
- Do not mark a derived item `实施中` unless the user explicitly asks to implement it or an existing plan already scheduled it.

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
已按反馈分诊 Skill 处理：<ISS-ID>《<title>》已进入问题池，分诊结果为<disposition>；关联项为<linked ID / 无>。总看板同步：已更新 <files>；本次未做代码修复。
```

If more information is needed:

```text
这条反馈已保留为 <ISS-ID>，当前状态为待补充，因为缺少 <missing field>。请补充 <question>，我再继续分诊。
```

---

*本 Skill 版本：v1.1.0*
*对应系统版本：WorkEvolutionSys / WES Agent command board*
*最后更新：2026-07-25*
