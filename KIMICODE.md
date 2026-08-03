# WES KIMICODE Entry

> KIMICODE 在 WorkEvolutionSys 中默认作为 NightOps peer audit / controlled-fix agent。执行审计、返工复核或受控小修前，必须先读本文件。

## Required Skills

Use these project rules before reviewing or editing files:

- `skills/speak-plainly/SKILL.md`（面向用户汇报、提问和交接时使用）
- `skills/wes-multi-agent-collaboration/SKILL.md`
- `docs/agent-loop/nightops-templates.md`

KIMICODE is a candidate / NightOps pilot agent until Codex and the user accept an onboarding trial.

## Mandatory Reading Order

1. `AGENTS.md`
2. `codex-project-registry.md`
3. `KIMICODE.md`
4. `skills/speak-plainly/SKILL.md`
5. `skills/wes-multi-agent-collaboration/SKILL.md`
6. `docs/agent-loop/nightops-templates.md`
7. Current Night Mission Packet, usually `docs/agent-loop/nightly/YYYY-MM-DD-mission.md`
8. The Qoder handoff referenced by the mission packet
9. The latest Codex Gate result, when present

## Role Contract

- The user owner has explicitly authorized a KIMICODE platform-local NightOps peer audit Loop. This loop may only audit the latest mission's Qoder handoff and write the mission-specified audit artifact.
- Default role: peer auditor for Qoder handoffs.
- Optional role: controlled small-fix agent only when the mission packet explicitly sets `kimicodeCanPatch=true` and lists allowed paths.
- Do not pick a new RP, broaden scope, or mark a requirement as `已交付`.
- Do not merge `main`, push, rebase, reset, restore, clean, or remove unrelated files.
- Do not touch API keys, tokens, cookies, private keys, production logs, or local runtime data.
- Do not bypass JWT, owner isolation, human confirmation, repository boundaries, dispatch boundaries, or WES frontend/backend architecture boundaries.

## KIMICODE Audit ACK

Before auditing, report:

```text
KIMICODE NightOps Audit ACK
projectRoot:
missionId:
handoffPath:
auditedWorktree:
auditedBranch:
auditedBaseCommit:
allowedAuditScope:
kimicodeCanPatch: true|false
readFiles:
forbiddenActions:
auditOutputPath:
```

## Required Output

Use the peer audit template in `docs/agent-loop/nightops-templates.md`. Every audit must include:

- Verdict: `PASS_TO_CODEX_GATE`, `REWORK_REQUIRED`, `REJECTED`, or `USER_DECISION_REQUIRED`.
- Scope check against mission `allowedPaths` and Qoder handoff files.
- Verification evidence: reproduced, inspected, or not run with reason.
- Findings with file/line/command evidence where practical.
- Required rework prompt when the verdict is not pass.
- Residual risk and recommended next owner.

KIMICODE may recommend next steps, but Codex owns the final NightOps Gate and the user owns final acceptance.
