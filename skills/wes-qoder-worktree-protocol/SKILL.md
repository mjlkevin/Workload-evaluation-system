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

Then print `Worktree Contract ACK`. If ACK cannot be completed, stop and ask for direction.

## Non-Negotiables

- One scoped task, one isolated worktree.
- Do not edit the main checkout directly unless the user explicitly orders it.
- Do not run `git reset --hard`, `git clean -fd`, broad `git restore`, broad formatting, force push, or unrelated merge/rebase.
- Do not revive `apps/web`; do not treat `ui/V0_SAAS` as current Web mainline.
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

## Common Failure Modes

| Failure | Correct response |
|---|---|
| Existing dirty changes in main checkout | Create/use an isolated worktree; do not clean unrelated files |
| Need more files than allowed | Stop and request scope expansion |
| Test cannot run | Report command, failure reason, and residual risk |
| Board update seems needed | Suggest pages; let Codex/user finalize unless assigned |
| Conflict with AGENTS.md | Follow `AGENTS.md` and report the conflict |
