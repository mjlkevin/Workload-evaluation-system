# WES Qoder Entry

> Qoder 在 WorkEvolutionSys 中执行需求池、Loop、实现、验证或回填任务时，必须先读本文件。

## Required Skills

Use these skills before editing files:

- `skills/speak-plainly/SKILL.md`（面向用户汇报、提问和交接时使用）
- `skills/wes-qoder-worktree-protocol/SKILL.md`
- `skills/wes-multi-agent-collaboration/SKILL.md`

If Qoder supports installing project skills, install or register:

```text
skills/speak-plainly
skills/wes-qoder-worktree-protocol
skills/wes-multi-agent-collaboration
```

If Qoder does not support skill installation, read and follow the same files manually:

- `skills/wes-qoder-worktree-protocol/SKILL.md`
- `skills/wes-qoder-worktree-protocol/references/protocol.md`
- `skills/wes-multi-agent-collaboration/SKILL.md`（多 Agent 协作协议，v0.3.0-draft）
- `docs/agent-loop/nightops-templates.md`（仅 NightOps / 无人值守任务需要）

## Mandatory Reading Order

1. `AGENTS.md`
2. `codex-project-registry.md`
3. `QODER.md`
4. `skills/speak-plainly/SKILL.md`
5. `skills/wes-qoder-worktree-protocol/SKILL.md`
6. `skills/wes-qoder-worktree-protocol/references/protocol.md`
7. `skills/wes-multi-agent-collaboration/SKILL.md`（多 Agent 协作协议）
8. NightOps 任务必须读取当前 `docs/agent-loop/nightly/YYYY-MM-DD-mission.md`
9. NightOps 任务必须读取最新 `docs/agent-loop/audits/YYYY-MM-DD-codex-<taskId>-gate.md`（若存在）

## Execution Contract

- One scoped task, one isolated worktree.
- Do not edit the main checkout directly unless the user explicitly orders it.
- Do not clean, reset, restore, format, merge, or rebase unrelated work.
- Do not revive `apps/web` or treat `ui/V0_SAAS` as current mainline.
- Do not expose API keys, tokens, cookies, or private keys.
- Print `Worktree Contract ACK` before the first file edit.
- Finish with the structured handoff template from `references/protocol.md`.

Qoder may report `已回填 / 待 Codex 复核`; Codex/user decide whether a WES requirement is `已交付`.

## NightOps Execution Contract

When the task is part of the Beijing-time 00:00-09:30 NightOps window:

- The user owner has explicitly authorized a Qoder platform-local NightOps executor Loop. This loop may only act on the latest Night Mission Packet and latest Codex Gate.
- Read the Night Mission Packet before creating or editing a worktree.
- Read the latest Codex Gate result before starting. If `mustReworkFirst=true`, repair that task first.
- Do not claim a new RP unless the latest Codex Gate explicitly sets `allowNextTask=true`.
- Use one worktree/branch for the assigned task only; do not carry unrelated dirty changes.
- Write the handoff to the mission's `qoderHandoffPath` when requested, using `docs/agent-loop/nightops-templates.md`.
- Stop when the task needs user acceptance, real API secrets, architecture changes, DB migration, auth/owner-model changes, mainline merge, or delivery status closure.
- NightOps output status is still limited to `已回填 / 待 Codex 复核`; Codex Gate and user acceptance decide the rest.
