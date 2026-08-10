---
name: maintain-wes-command-board
description: Use when working in the WorkEvolutionSys repository on requirements, design, development, testing, releases, changes, monitoring, risks, documentation, or any task that creates or changes project process evidence that belongs in the WES Agent command board.
---

# WES 总看板过程数据沉淀

## Overview

Keep `03_技术设计/系统架构/WES-Agent-升级总看板/` as the visual process ledger for WES Agent work. Any material project fact created during requirements, design, development, testing, change, monitoring, or risk work must be written to the matching board module before the task is treated as complete.

Core rule: **关键过程变更不能只留在对话、commit、测试输出或临时文档里；必须进入总看板，或明确记录为什么本次无需更新。**

## Required Context

Before updating the board, read the relevant current facts from the repository. Use this priority:

1. `AGENTS.md`
2. `03_技术设计/系统演进/实现与文档对齐说明.md`
3. Runtime code and routes, especially `apps/api/src/app.ts`, `apps/api/src/routes/index.ts`, and `ui/V2_PROTOTYPE`
4. Current command-board pages under `03_技术设计/系统架构/WES-Agent-升级总看板/`
5. `README.md`, `00_项目治理/里程碑与计划/项目进展总结与后续规划.md`, `ui/V2_PROTOTYPE/README.md`, and `apps/api/src/modules/README.md`

When a historical page or old plan conflicts with code/current docs, use current facts and mark old paths with `【历史说明，已下线】` or `【历史说明，下线中】` as required by `AGENTS.md`.

For detailed page ownership and fields, read `references/board-module-map.md`.

For information density and readability rules (one-line conclusion first, 120-char cell cap, no long `title` duplication, single-source numbers, phase-label sync, monthly archive), read `references/board-readability-spec.md`. Every board edit must pass its acceptance gate.

## Trigger Decision

Use the board update workflow when any of these are true:

| Work type | Board impact |
|---|---|
| New requirement, scope change, backlog item, user feedback | Update `requirements.html`; update `plan.html`, `risks.html`, or `changes.html` if priority, scope, or decision changes. |
| Product design, architecture, API, data model, permission boundary | Update `design.html` or `design-architecture.html`; update `risks.html` for boundary decisions; update `sources.html` if a new design artifact exists. |
| Implementation, refactor, release, merge, CI fix | Update `plan.html`, `changes.html`, and the `index.html` summary if status/KPI changes. |
| Tests, validation, manual acceptance, build output | Update `testing.html` and `monitoring.html`; update `changes.html` with verification evidence. |
| Monitoring, audit, Harness trace, model run, ToolEvent, data retention | Update `monitoring.html`; update `risks.html` if control boundaries change. |
| Risk, incident, blocker, architecture trigger, scope exclusion | Update `risks.html`; update `changes.html` if it affects current delivery. |
| New or moved document/process artifact | Update `sources.html`; adjust document counts on `index.html` when counts change. |
| Pure question or read-only analysis with no new durable project fact | Usually no board file edit; final answer must say no board update was needed and why. |

## Workflow

1. **Classify the task.** Identify lifecycle stage: requirement, design, plan, development, test, change, monitor, risk, source-map, or release.
2. **Collect evidence.** Inspect changed files, current board state, related docs, route/code facts, tests/builds run, commit/PR IDs if available, and user decisions.
3. **Map modules.** Use the trigger table and `references/board-module-map.md` to list every board page that needs an update. Do not update only `changes.html` when another page owns the underlying fact.
4. **Patch narrowly.** Preserve the static HTML style, existing visual language, navigation, dates, and table/card patterns. Do not rewrite whole pages unless the user asked for a redesign.
5. **Synchronize cross-page facts.** If phase, test count, document count, status, date, branch, or delivery label changes, scan all board pages for stale copies before finishing.
6. **Record the change.** Add or update a `changes.html` entry for material work, including goal, changed areas, verification, and remaining manual follow-up.
7. **Verify.** Run relevant product checks from `AGENTS.md` for code changes. For board-only edits, at minimum run targeted `rg` checks for stale phase/date/status/count strings and validate no unfinished template text was introduced.
8. **Report board status.** In the final response, state which board modules were updated, which evidence was used, and any board item intentionally left pending.

## Minimum Board Update Checklist

For every material task, check these fields:

- `index.html`: current phase, KPI values, trust strip, document count, main status.
- `requirements.html`: backlog status, priority, phase, next step, acceptance evidence.
- `design.html` / `design-architecture.html`: design decisions, boundaries, current implementation facts.
- `runtime.html`: Harness/Agent runtime source, execution, artifact, delivery, and knowledge boundaries.
- `plan.html`: roadmap, task breakdown, completion definitions, follow-up pool.
- `testing.html`: automated/manual test cases, execution status, defects, close criteria.
- `monitoring.html`: verification snapshot, CI, Harness audit, ToolEvent/modelRun/artifact trace.
- `risks.html`: risks, controls, decisions, architecture triggers, scope exclusions.
- `changes.html`: chronological work record, git/PR references, verification evidence.
- `sources.html`: document asset list, fact-source layer, phase/document matrix.

If a page is not updated, be able to explain why its owned fact did not change.

## Data Quality Rules

- Do not mark a phase as delivered until implementation evidence and verification evidence are both present.
- Do not mark manual testing as passed unless the user or an actual test record provides the result. Use `待执行` or `待回填` when not executed.
- Do not claim CI is green unless current CI evidence or a cited local equivalent exists.
- Do not inflate document/test counts without adding or removing the corresponding rows/cards.
- Numbers have a single source: requirement counts from `requirements.html` main ledger, test counts from the current command run, special-project counts from `special-projects.html`. After updating any number, grep the whole board for the stale value and sync every copy.
- `changes.html` rows older than one month are archived by `scripts/board-archive-changes.js` into `archive-md/changes-YYYY-MM.md`; never hand-delete rows.
- Do not hide risks by moving them only to prose; risk/control/status belongs in `risks.html`.
- Do not introduce a second frontend/backend path. The Web mainline remains `ui/V2_PROTOTYPE`; backend entry remains `apps/api`.
- Do not overwrite unrelated dirty worktree changes. Read the target page and patch only the intended section.

## Review Gate

Before finishing, perform a short self-review:

| Check | Pass condition |
|---|---|
| Completeness | Every changed project fact has a matching board location or a written no-update reason. |
| Consistency | Phase, status, dates, counts, and links agree across updated pages. |
| Traceability | Requirement/design/development/test/change records link to evidence such as file path, doc path, command, commit, PR, Harness Run, ToolEvent, or artifact. |
| Governance | Risks, scope exclusions, and architecture triggers are visible before implementation proceeds. |
| User safety | No unrelated user edits were reverted or normalized. |

## Common Failures

| Failure | Correct behavior |
|---|---|
| "I updated only the implementation doc." | Also update the board pages that own status, plan, monitoring, risk, or source-map facts. |
| "The change is small, so no board entry." | Small code changes may still affect process data. At least update `changes.html` or explain no durable fact changed. |
| "Tests passed, so Phase is complete." | Completion also needs scope, documentation, and manual acceptance status where applicable. |
| "The board already has similar text." | Update stale phase labels, counts, dates, and links; similar but stale content is misleading. |
| "Historical docs say a different architecture." | Use current code/current docs, and mark historical paths with the required historical label. |

## Final Response Pattern

End WES work with one concise board statement:

```text
总看板同步：已更新 index.html、plan.html、monitoring.html、changes.html；testing.html 保持待执行，因为本次未产生人工测试结果。
```

or:

```text
总看板同步：本次是只读问题分析，没有新增或变更可沉淀的项目过程事实，因此未改看板。
```

---

*本 Skill 版本：v2.1.0*  
*对应系统版本：WorkEvolutionSys / WES Agent command board*  
*最后更新：2026-08-10（v2.1：可读性规范新增 §2A 表格列宽实测自适应规则与验收门禁）*
