---
name: wes-qoder-worktree-protocol
description: Use when Qoder works on WES demand-pool, Loop, implementation, verification, or handoff tasks in the WorkEvolutionSys repository, especially when creating or using git worktrees, reporting results to Codex, or touching WES command-board facts.
---

# WES Qoder Worktree Protocol

## Overview

Use this skill to keep Qoder execution isolated, reviewable, and recoverable in WES. Qoder is the execution agent; Codex/user own planning, review, board finalization, and acceptance.

## Mandatory Start

Before editing files, read from the WES project root:

1. `AGENTS.md`
2. `codex-project-registry.md`
3. `QODER.md`
4. `skills/wes-qoder-worktree-protocol/references/protocol.md`
5. `skills/speak-plainly/SKILL.md`（任何面向用户的汇报、提问与交接前先执行）

Then print `Worktree Contract ACK`. If ACK cannot be completed, stop and ask for direction.

## Worktree Initialization

After ACK and before any file edits, install dependencies in the worktree:

1. At the repository root, run `npm install`.
2. If the task's verification commands involve the frontend (e.g., `test:web`, `build:web`), also run `npm install` inside `ui/V2_PROTOTYPE/`.
3. Both steps must exit with code `0` before proceeding. If either fails, stop and report the failure.

> Why: git worktree shares the repository code but not `node_modules` (it is not tracked by git). A fresh worktree has no installed dependencies. Running build or test commands without them produces false failures that pollute the handoff evidence. Codex/user must then reinstall and rerun to determine whether the failure is real.

## Non-Negotiables

- One scoped task, one isolated worktree.
- Do not edit the main checkout directly unless the user explicitly orders it.
- Do not run `git reset --hard`, `git clean -fd`, broad `git restore`, broad formatting, force push, or unrelated merge/rebase.
- Do not revive `apps/web`; `ui/V0_SAAS` was deleted on 2026-08-06 and must not be restored.
- The only active project entry is `/Users/kevin/AI/Workload-evaluation-system`; never use the retired `-agent` worktree path.
- Do not expand from UI to backend, backend to DB, or implementation to board finalization without explicit scope.
- Do not write API keys, tokens, cookies, or private keys into chat, docs, board pages, commits, logs, or examples.
- Qoder may report `已回填 / 待 Codex 复核`; Qoder must not declare WES requirements `已交付`.

## Required Output

Every Qoder run must end with the handoff format in `references/protocol.md`:

- target and scope
- worktree path, branch, base commit
- changed files
- verification commands and results
- risk and unverified items
- suggested board sync
- next step

Codex/user can reject a handoff that lacks worktree identity, changed-file list, or verification evidence.

## Quick Check

| Moment | Required behavior |
|---|---|
| Before work | Read required docs and print ACK |
| During work | Stay inside allowed paths and protect unrelated dirty changes |
| Verification | Run task-matched checks or mark explicitly not run |
| Handoff | Provide structured evidence, not "done" prose |
| Status | Stop at `待 Codex 复核` unless user accepts |

## Pre-Handoff Self-Check

Before submitting the handoff, confirm:

- [ ] All verification commands were executed in an environment where dependencies are already installed.
- [ ] If a command failed, the failure reason is stated and distinguished from "missing dependencies" false failures.

## Common Failure Modes

| Failure | Correct response |
|---|---|
| Existing dirty changes in main checkout | Create/use an isolated worktree; do not clean unrelated files |
| Need more files than allowed | Stop and request scope expansion |
| Test cannot run | Report command, failure reason, and residual risk |
| Board update seems needed | Suggest pages; let Codex/user finalize unless assigned |
| Conflict with AGENTS.md | Follow `AGENTS.md` and report the conflict |

---

*本 Skill 版本：v1.1.0*
*变更记录见 `CHANGELOG.md`*
*最后更新：2026-08-09*
