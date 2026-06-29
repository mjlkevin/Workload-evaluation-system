---
name: wes-multi-agent-collaboration
description: Use when coordinating WES tasks across Codex, Qoder, KIMICODE, Claude Code, or future agents; assigning requirements, running NightOps handoffs, onboarding agents, reviewing external AI handoffs, resolving collaboration conflicts, or syncing collaboration facts to the WES command board.
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
- `docs/agent-loop/nightops-templates.md`
- `03_技术设计/系统架构/WES-Agent-升级总看板/collaboration-protocol.html`

When the work is a Qoder worktree task, also read:

- `QODER.md`
- `skills/wes-qoder-worktree-protocol/SKILL.md`
- `skills/wes-qoder-worktree-protocol/references/protocol.md`

When the work involves KIMICODE, also read:

- `KIMICODE.md`

When the work is a NightOps task, also read the current Night Mission Packet and latest Codex Gate result if present.

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
| `codex` | active | `planner`, `commander`, `reviewer`, `fixer`, `integrator`, `audit-gate`, `board-steward` | Reviews handoffs, runs verification, makes scoped repairs, updates the command board, and publishes NightOps mission/gate artifacts. Codex does not create or run WES demand-pool implementation Loop automations. |
| `qoder1` | active | `executor`, `loop-runner`, `nightops-primary-executor` | Executes WES demand-pool Loop tasks in isolated worktrees and returns structured handoffs for Codex review. |
| `kimicode` | candidate / NightOps pilot | `peer-auditor`, `controlled-fixer` | Reviews Qoder handoffs during NightOps and may perform controlled small fixes only when the mission explicitly allows it. Full production assignment still requires onboarding ACK and trial acceptance. |
| `claude-code` | candidate | pending | Not yet onboarded. Reserve as a review/refactor/test-audit slot only after registry entry, ACK, branch policy, and handoff profile are confirmed. |

Add future agents by adding rows; do not rewrite the protocol around a fixed two-agent team.

## Task Classification

Classify the work before assigning it.

| Task class | Default owner | Required evidence |
|------------|---------------|-------------------|
| Demand-pool Loop execution | `qoder1` | One RP per worktree, ACK, handoff, targeted tests, board-sync recommendation. |
| NightOps mission planning | `codex` | Night Mission Packet with task, roles, allowed paths, stop conditions, required verification, and artifact paths. |
| NightOps peer audit | `kimicode` pilot or active reviewer | Audit ACK, verdict, scope/security/test findings, required rework, residual risk. |
| NightOps Codex Gate | `codex` | Gate verdict, `allowNextTask`, `mustReworkFirst`, next owner, user-decision needs. |
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
| NightOps | For unattended tasks, a current mission packet exists and `allowNextTask` defaults to false. |

Rules:

- Assign demand-pool Loop execution to Qoder unless the user explicitly directs a one-off Codex task.
- Assign review, minimal repair, integration advice, and board synchronization to Codex unless another active reviewer is registered.
- Do not assign production work to candidate agents except explicitly bounded onboarding trials or NightOps peer audit pilot tasks.
- Do not let an execution agent mark a task as `已交付`; only Codex/user acceptance can close it.
- Do not allow any agent to bypass JWT, owner isolation, human confirmation, secrets policy, dispatch boundaries, or repository boundaries.
- In NightOps, Qoder must read the latest Codex Gate before work. If `mustReworkFirst=true`, rework first. If `allowNextTask=true` is absent, do not start a new RP.

## Collaboration Modes

| Mode | Use when | Required control |
|------|----------|------------------|
| Sequential handoff | One agent finishes before another reviews or integrates. | Complete handoff before review starts. |
| Parallel worktrees | Multiple independent RPs can proceed safely. | One worktree/branch per task, no shared files unless explicitly coordinated. |
| Review escalation | Handoff has risk, missing tests, or scope ambiguity. | Reviewer records blocker and returns a rework prompt. |
| Integration queue | Several verified patches are waiting for mainline. | Integrate one scoped patch at a time and rerun matching verification. |
| Board-only governance | The task changes process facts but not code. | Update board/sources/skills without pretending code was delivered. |
| NightOps unattended loop | Beijing 00:00-09:30 needs execution plus peer audit before the user returns. | Codex mission packet, Qoder handoff, KIMICODE peer audit, Codex Gate, no auto delivery. |

## NightOps 3AI Loop

NightOps is a local unattended collaboration protocol, not a Codex implementation automation.

Use one shared skill and local artifacts; each platform can run its own loop entry. The shared state lives in Git, handoff files, audit files, and the command board.

The user owner has explicitly authorized platform-local NightOps loops for Qoder executor, KIMICODE peer audit, and Codex Gate. This authorization does not expand task authority: loops may only act on the latest mission packet, latest gate file, and mission-specified artifact paths. They may not self-select RPs, merge main, mark delivery, touch secrets, or edit outside the mission scope.

### Default Roles

| Role | Default agent | Responsibility |
|------|---------------|----------------|
| Commander / Audit Gate | `codex` | Publish mission packet, set scope and stop conditions, review Qoder + KIMICODE evidence, produce gate verdict and morning brief. |
| Primary executor | `qoder1` | Execute the assigned task in one isolated worktree, run required verification, and write structured handoff. |
| Peer auditor | `kimicode` | Review scope, diff, tests, security boundaries, and handoff completeness; request rework or pass to Codex Gate. |
| Final acceptor | `user-owner` | Decide final acceptance, integration, priority changes, or user-level intervention flags. |

### Artifact Contract

Use `docs/agent-loop/nightops-templates.md` for exact templates and paths:

- `docs/agent-loop/nightly/YYYY-MM-DD-mission.md`
- `docs/agent-loop/handoffs/YYYY-MM-DD-qoder-<taskId>.md`
- `docs/agent-loop/audits/YYYY-MM-DD-kimicode-<taskId>-audit.md`
- `docs/agent-loop/audits/YYYY-MM-DD-codex-<taskId>-gate.md`
- `docs/agent-loop/briefs/YYYY-MM-DD-morning-brief.md`

### Sequence

1. Codex publishes a Night Mission Packet before the window. Set `allowNextTask=false` by default.
2. Qoder reads `QODER.md`, this skill, the mission packet, and the latest Codex Gate before editing.
3. Qoder executes one task, writes a handoff, and stops at `已回填 / 待 Codex 复核`.
4. KIMICODE reads `KIMICODE.md`, this skill, the mission packet, and Qoder's handoff; then writes a peer audit.
5. If KIMICODE returns `REWORK_REQUIRED`, Qoder repairs the same task first and writes a rework handoff.
6. Codex reads all evidence and posts a Gate verdict.
7. Codex writes a morning brief when user attention is needed.

### Gate Verdicts

| Verdict | Meaning |
|---------|---------|
| `ACCEPTED_PENDING_USER` | Evidence is enough for user/integration decision, but not auto-delivery. |
| `REWORK_REQUIRED` | Direction is valid, but Qoder must repair bounded gaps before any new task. |
| `REJECTED` | Scope pollution, authority breach, broken evidence, or invalid architecture boundary. |
| `USER_DECISION_REQUIRED` | Requires product, architecture, secret, DB, auth, or acceptance judgment. |
| `ALLOW_NEXT` | Current task may be sealed and next low-risk task may be assigned in a future mission. |

### NightOps Hard Boundaries

- No unattended `main` merge, release, push, or `已交付` status closure.
- No real API keys, tokens, cookies, private keys, or raw production logs.
- No architecture changes, DB migrations, auth/owner-model changes, or repository-boundary changes.
- No bypass of JWT, owner isolation, human confirmation, dispatch boundaries, or WES frontend/backend mainline rules.
- No broad reset, restore, clean, rebase, or unrelated formatting.
- No new RP after rework unless the latest Codex Gate explicitly sets `allowNextTask=true`.

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
- For NightOps: `missionId`, referenced mission packet, handoff path, audit path, and latest Codex Gate path when available.

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
| V2 frontend | Focused component/page test, `npm run test --prefix ui/V2_PROTOTYPE`, `npm run build:web` when build surface changes. |
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

Before enabling KIMICODE, Claude Code, or any future agent:

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
- Use `docs/agent-loop/nightops-templates.md` for NightOps mission, handoff, peer audit, Codex Gate, and morning brief artifacts.
- Use `requirements.html` and `plan.html` only when the collaboration change affects a concrete RP or phase.
- Do not store API keys, tokens, cookies, private keys, raw production logs, or temporary command output in the board.

## System Prompt Summary

Use `wes-multi-agent-collaboration` to coordinate WES tasks across active and future coding agents: classify the task, choose an active role slot, pass the assignment gate, run NightOps with mission packet + Qoder handoff + KIMICODE peer audit + Codex Gate when needed, require isolated worktrees and structured handoffs, review against acceptance/rework/reject rules, integrate only verified minimal patches, resolve conflicts by authority rules, and synchronize durable facts to the WES command board.

---

*本 Skill 版本：v0.3.0-draft*
*对应系统版本：WES Agent 升级总看板 · 本地 A2A 协作协议 + NightOps 三 AI 协作机制*
*最后更新：2026-06-29*
