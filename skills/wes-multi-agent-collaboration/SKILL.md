---
name: wes-multi-agent-collaboration
description: Use when coordinating WES tasks across Codex, Qoder, or future agents; assigning requirements, reviewing external AI handoffs, onboarding agents, resolving collaboration conflicts, or syncing collaboration facts to the WES command board.
---

# WES 多 Agent 协作

## Overview

Use this skill to organize WES work across multiple AI coding agents without relying on a platform-level A2A runtime.

Core principle: **local protocol beats platform magic**. Git worktree/branch/commit carries state, structured handoff carries delivery evidence, the WES command board carries shared facts, and replayable verification commands carry acceptance.

Treat the current agent registry as a snapshot, not a fixed roster. Add, pause, or retire agents by updating their registry entry and board facts.

## Required Project Context

Before assigning or reviewing WES work, read these files from the project root:

- `AGENTS.md`
- `codex-project-registry.md`
- `skills/maintain-wes-command-board/SKILL.md`
- `docs/codex-workflows/external-ai-handoff-template.md`
- `03_技术设计/系统架构/WES-Agent-升级总看板/collaboration-protocol.html`

When the work is a Qoder worktree task, also read:

- `QODER.md`
- `skills/wes-qoder-worktree-protocol/SKILL.md`
- `skills/wes-qoder-worktree-protocol/references/protocol.md`

【历史说明，已下线】NightOps 无人值守机制（nightops-templates.md、mission/gate/brief 产物）与 KIMICODE（KIMICODE.md）已于 2026-08-09 整体下线/退出，不再作为本 Skill 的必读上下文。

## Agent Registry

Represent every collaborator as a registry entry. Do not infer authority from the tool brand alone.

| Field | Meaning |
|------|---------|
| `agentId` | Stable local identifier, for example `codex`, `qoder1`, `kimicode`, `claude-code`. |
| `platform` | Tool or platform name. |
| `status` | `active`, `candidate`, `paused`, or `retired`. Candidate agents cannot receive production tasks. |
| `roleSlots` | Capabilities such as `owner`, `planner`, `executor`, `reviewer`, `integrator`, `board-steward`. |
| `allowedScopes` | Paths or task classes the agent may touch. |
| `forbiddenScopes` | Paths, actions, or decisions the agent may not touch. |
| `branchPrefix` | Default branch namespace, for example `qoder/` or `codex/`. |
| `handoffProfile` | Required delivery envelope and evidence fields. |
| `verificationProfile` | Commands or test class required before review. |
| `boardSync` | Which command board pages must be updated or recommended for update. |
| `onboardingAck` | Whether the agent has acknowledged project rules and current protocol. |

### Current Snapshot

| Agent | Status | Default role slots | Current use |
|------|--------|--------------------|-------------|
| `user-owner` | active | `owner`, `acceptor`, `priority-setter` | Defines goals, priorities, user intervention flags, and final acceptance. |
| `codex` | active | `planner`, `commander`, `reviewer`, `fixer`, `integrator`, `audit-gate`, `board-steward` | Reviews handoffs, runs verification, makes scoped repairs, and updates the command board. Codex does not create or run WES demand-pool implementation Loop automations. |
| `qoder1` | active | `executor`, `loop-runner` | Executes WES demand-pool Loop tasks in isolated worktrees and returns structured handoffs for Codex review. |
| `kimicode` | retired（2026-08-09） | 原 `peer-auditor`, `controlled-fixer` | 已整体退出本项目开发；历史 NightOps peer audit pilot 记录仅供追溯，不得再分派任务。 |

【历史说明，已下线】Claude Code 候选槽位已于 2026-08-09 移除：该 Agent 不再参与本项目开发，后续如需接入须重新走 onboarding 流程。

Add future agents by adding rows; do not rewrite the protocol around a fixed two-agent team.

## Task Classification

Classify the work before assigning it.

| Task class | Default owner | Required evidence |
|------------|---------------|-------------------|
| Demand-pool Loop execution | `qoder1` | One RP per worktree, ACK, handoff, targeted tests, board-sync recommendation. |
| One-off implementation requested for Codex | `codex` | Scoped diff, relevant tests/builds, board update or no-update reason. |
| External handoff review | `codex` or active `reviewer` | Diff scope inspection, reproduced commands where practical, accept/rework decision. |
| Minimal repair after review | `codex` or assigned `fixer` | Failing evidence, minimal patch, focused regression test. |
| Integration queue | `codex` or active `integrator` | One verified patch at a time, no unrelated dirty changes, post-integration verification. |
| Board-only governance | `codex` or `board-steward` | Updated board pages and source map, no code-delivery claims. |
| Candidate-agent onboarding | `codex` + `user-owner` | Registry entry, ACK, non-critical trial, Codex review, board/source sync. |

If a task fits multiple classes, choose the class with the strictest verification and scope controls.

## Collaboration Workflow

1. **Intake**: Identify RP/task, source of truth, priority, scope, forbidden paths, and acceptance evidence.
2. **Assign**: Match the work to an active agent with compatible `roleSlots`, `allowedScopes`, and `verificationProfile`.
3. **ACK**: Require the assignee to report project root, worktree path, branch, base commit, task id, allowed paths, and read rules before editing.
4. **Execute**: Keep one task per branch/worktree. Do not clean, reset, restore, or merge unrelated dirty work.
5. **Handoff**: Return a structured handoff with goal, changed files, validation commands/results, risk, board-sync recommendation, and next step.
6. **Review**: Codex or the assigned reviewer inspects diff scope, reruns relevant commands, checks security/ownership/API boundaries, and records gaps.
7. **Integrate**: Integrate only the minimum verified patch. Reject broad branch merges when the diff contains unrelated files.
8. **Synchronize**: Update `requirements.html`, `plan.html`, `testing.html`, `monitoring.html`, `risks.html`, `changes.html`, and `sources.html` as required by the change.

## Assignment Gate

Pass every gate before work begins:

| Gate | Pass condition |
|------|----------------|
| Authority | Assignee status is `active`, or the task is explicitly an onboarding trial for a `candidate`. |
| Scope | `allowedScopes` cover the files/task class; `forbiddenScopes` are not touched. |
| Isolation | One task per branch/worktree; shared-file work has an explicit sequencing plan. |
| ACK | Assignee reports project root, worktree path, branch, base commit, task id, allowed paths, forbidden actions, and read rules. |
| Verification | Required commands are known before editing; `not run` must be justified in handoff. |
| Board | The owning board pages are identified before delivery. |

Rules:

- Assign demand-pool Loop execution to Qoder unless the user explicitly directs a one-off Codex task.
- Assign review, minimal repair, integration advice, and board synchronization to Codex unless another active reviewer is registered.
- Do not assign production work to candidate agents except explicitly bounded onboarding trials.
- Do not let an execution agent mark a task as `已交付`; only Codex/user acceptance can close it.
- Do not allow any agent to bypass JWT, owner isolation, human confirmation, secrets policy, dispatch boundaries, or repository boundaries.

## Collaboration Modes

| Mode | Use when | Required control |
|------|----------|------------------|
| Sequential handoff | One agent finishes before another reviews or integrates. | Complete handoff before review starts. |
| Parallel worktrees | Multiple independent RPs can proceed safely. | One worktree/branch per task, no shared files unless explicitly coordinated. |
| Review escalation | Handoff has risk, missing tests, or scope ambiguity. | Reviewer records blocker and returns a rework prompt. |
| Integration queue | Several verified patches are waiting for mainline. | Integrate one scoped patch at a time and rerun matching verification. |
| Board-only governance | The task changes process facts but not code. | Update board/sources/skills without pretending code was delivered. |

## NightOps（已下线）

【历史说明，已下线】NightOps 无人值守三 AI 协作机制（Codex mission packet + Qoder 执行 + KIMICODE peer audit + Codex Gate，北京时间 00:00-09:30 窗口）已于 2026-08-09 整体下线。相关模板 `docs/agent-loop/nightops-templates.md`、mission/brief/TRIAL 产物与 KIMICODE peer audit Loop 脚本均已删除。禁止重新创建无人值守实现或审计 Loop；如未来需恢复夜间自动化，须经用户重新授权并重建协议。

## Parallel Work Rules

Run agents in parallel only when all conditions are true:

- Distinct RP/task ids.
- Disjoint write scopes, or one agent is read-only.
- Separate worktree/branch per execution task.
- Independent verification commands.
- A named integrator owns final ordering.

If two agents need the same file, switch to sequential handoff. If a conflict appears after work starts, freeze the newer patch, inspect both diffs, and ask the integrator to choose one minimum patch or create a new rework prompt.

## Handoff Envelope

Every non-user agent handoff must include:

- Goal and task id.
- `projectRoot`, `worktreePath`, `branch`, `baseCommit`, and commit id when available.
- Changed file list with intent per file.
- Verification commands and result: `pass`, `fail`, or `not run`.
- Known risks, unimplemented scope, and manual acceptance needs.
- Board synchronization recommendation.
- Next recommended owner: same agent, reviewer, integrator, or user.
- Reporting rule: handoff 与所有面向 user-owner 的任务汇报禁止只出任务代号（O1、Sprint 3B、RP-048、Batch E、SP-… 等），代号首次出现必须附带主题括号注释，例：「Sprint 3B（AI 回答质量考卷：固定考题 + 自动判卷）」；执行方不遵守时，复审方应在返工提示中要求补注释。

Note: Qoder 的 handoff 格式是 `external-ai-handoff-template.md` 的扩展（增加 worktree 元数据与 `not run` 验证状态），见 `skills/wes-qoder-worktree-protocol/references/protocol.md`；复核时以扩展格式为准。

## Acceptance, Rework, And Reject Rules

Accept only when the handoff has correct metadata, scoped diff, relevant verification, visible risks, and board-sync guidance.

Return for rework when the change is directionally valid but has a bounded gap: missing focused test, incomplete edge case, stale board status, narrow scope drift, or manual acceptance not called out.

Reject when any hard boundary is broken:

- Missing worktree/branch/base commit/task id.
- Unrelated dirty changes, runtime data, generated clutter, or deleted user work.
- Verification evidence absent while claiming completion.
- Production task assigned to a candidate agent.
- Bypasses JWT, owner isolation, human confirmation, secrets policy, dispatch boundary, or repository boundary.
- Introduces banned architecture paths such as a second frontend/backend mainline.
- Leaks API keys, tokens, cookies, private keys, or raw sensitive logs.

Rework prompts must include: task id, blocking finding, evidence path/command, required correction, forbidden changes, required verification, and board-sync expectation.

## Verification Profiles

Use the narrowest command set that proves the touched boundary.

| Boundary | Typical verification |
|----------|----------------------|
| V2 frontend | Focused component/page test, `npm run test:web`, `npm run build:web` when build surface changes. |
| API module/routes | Focused module test, `npm run build:api`, `npm run test:modules` when shared contracts change. |
| AI/provider/dispatch | Focused AI tests plus `npm run test:ai`; include stream/trace tests when touching SSE or dispatch. |
| Harness | Focused Harness tests plus `npm run test:harness -w apps/api` when Harness state/audit changes. |
| Board/docs/skills | Targeted `rg` for stale facts, skill validation for Skill changes, and source-map updates when artifacts change. |
| External API behavior | Local mocked tests first; real API acceptance only with secret-handling workflow and no secret disclosure. |

Do not mark CI or manual acceptance as passed unless there is current evidence. Use `not run` or `待回填` explicitly.

## Conflict And Authority Rules

- Newer user instruction overrides older plans.
- `user-owner` owns priorities, user-level intervention flags, and final acceptance.
- Current runtime code and routes beat stale historical documents for implementation facts.
- The WES command board is the shared process ledger; stale board facts must be corrected, not silently ignored.
- Codex owns review/integration judgment unless another active reviewer/integrator is registered.
- Execution agents own their branch/worktree only; they do not clean, reset, restore, or merge unrelated work.
- If project rules conflict with an agent handoff, project rules win.

## Onboarding Checklist For New Agents

Before enabling any future agent:

1. Add a registry entry with `agentId`, status `candidate`, role slots, allowed scopes, forbidden scopes, branch prefix, and handoff profile.
2. Provide the agent with `AGENTS.md`, `codex-project-registry.md`, this skill, and any platform-specific entry file.
3. Require an ACK containing read files, project root, allowed branch prefix, forbidden actions, and handoff format.
4. Run one non-critical trial task or review task.
5. Have Codex review the trial output and update `collaboration-protocol.html` plus `sources.html`.
6. Change status from `candidate` to `active` only after the ACK and trial pass.

### Candidate Trial Rules

- Use non-critical tasks first: read-only review, documentation consistency check, small test audit, or isolated refactor.
- Require a structured handoff even for trial tasks.
- Keep status as `candidate` if the agent misses ACK fields, broadens scope, omits verification, or updates formal status without acceptance.

## Board Sync Rules

- Use `collaboration-protocol.html` for team status, role slots, workflow rules, and collaboration state.
- Use `changes.html` for collaboration process changes and handoff review events.
- Use `sources.html` when adding or changing workflow docs, skills, entry files, or protocol pages.
- Use `requirements.html` and `plan.html` only when the collaboration change affects a concrete RP or phase.
- 看板事件行与汇报文案中的任务代号（O×、Sprint ×、RP-×、Batch ×、SP-×等）必须伴随主题括号注释，面向 user-owner 的输出禁止只出编号（见 `skills/speak-plainly/SKILL.md`）。
- Do not store API keys, tokens, cookies, private keys, raw production logs, or temporary command output in the board.

## System Prompt Summary

Use `wes-multi-agent-collaboration` to coordinate WES tasks across active and future coding agents: classify the task, choose an active role slot, pass the assignment gate, require isolated worktrees and structured handoffs, review against acceptance/rework/reject rules, integrate only verified minimal patches, resolve conflicts by authority rules, and synchronize durable facts to the WES command board.

---

*本 Skill 版本：v0.5.0*
*对应系统版本：WES Agent 升级总看板 · 本地 A2A 协作协议*
*最后更新：2026-08-09*

变更摘要（v0.5.0）：新增汇报表达约定——handoff、看板事件行与所有面向 user-owner 的任务汇报中，任务代号（O×/Sprint×/RP-×/Batch×/SP-×等）必须附带主题括号注释，禁止只出编号（与 speak-plainly Skill 同步）。v0.4.0：删除已下线的 NightOps 三 AI 循环章节与相关必读/分级/门禁条目；KIMICODE 标记 retired，Claude Code 候选槽位移除；验证命令统一 `npm run test:web`；明确 Qoder handoff 与外部回填模板的扩展关系。
