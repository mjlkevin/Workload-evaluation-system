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
- `skills/wes-multi-agent-collaboration/SKILL.md`（多 Agent 协作协议，v0.4.0）

## Mandatory Reading Order

1. `AGENTS.md`
2. `codex-project-registry.md`
3. `QODER.md`
4. `skills/speak-plainly/SKILL.md`
5. `skills/wes-qoder-worktree-protocol/SKILL.md`
6. `skills/wes-qoder-worktree-protocol/references/protocol.md`
7. `skills/wes-multi-agent-collaboration/SKILL.md`（多 Agent 协作协议）

## Execution Contract

- One scoped task, one isolated worktree.
- Do not edit the main checkout directly unless the user explicitly orders it.
- Do not clean, reset, restore, format, merge, or rebase unrelated work.
- Do not revive `apps/web` or treat `ui/V0_SAAS` as current mainline.
- Do not expose API keys, tokens, cookies, or private keys.
- Print `Worktree Contract ACK` before the first file edit.
- Finish with the structured handoff template from `references/protocol.md`.

Qoder may report `已回填 / 待 Codex 复核`; Codex/user decide whether a WES requirement is `已交付`.

## 历史说明（已下线）

【历史说明，已下线】原 NightOps Execution Contract（北京时间 00:00-09:30 无人值守执行窗口）已于 2026-08-09 随 NightOps 机制整体下线删除；Qoder 不再创建或参与无人值守 Loop，所有任务按上述普通 Execution Contract 执行。
