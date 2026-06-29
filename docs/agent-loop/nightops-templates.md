# WES NightOps Templates

> Shared local protocol for the 00:00-09:30 Beijing-time unattended collaboration window. These templates are used by Codex, Qoder, KIMICODE, and future agents without requiring a platform-level A2A runtime.

## Directory Contract

Use these paths for durable loop artifacts:

- `docs/agent-loop/nightly/YYYY-MM-DD-mission.md`
- `docs/agent-loop/handoffs/YYYY-MM-DD-qoder-<taskId>.md`
- `docs/agent-loop/audits/YYYY-MM-DD-kimicode-<taskId>-audit.md`
- `docs/agent-loop/audits/YYYY-MM-DD-codex-<taskId>-gate.md`
- `docs/agent-loop/briefs/YYYY-MM-DD-morning-brief.md`

Create missing subdirectories before writing the first artifact.

Do not store API keys, tokens, cookies, private keys, raw production logs, or temporary command output in these files.

The user owner has explicitly authorized platform-local NightOps loops for Qoder execution, KIMICODE peer audit, and Codex Gate. These loops are schedulers around this file protocol only; they do not grant permission to self-select RPs, mark delivery, merge main, touch secrets, or edit outside mission-specified artifact paths.

## Night Mission Packet

Created by Codex before the unattended window.

```markdown
# Night Mission Packet

missionId:
date:
timezone: Asia/Shanghai
window: 00:00-09:30
commander: codex
executor: qoder1
peerAuditor: kimicode

## Task

taskId:
title:
objective:
sourceOfTruth:
priority:

## Scope

allowedPaths:
forbiddenPaths:
stopConditions:

## Required Reading

- AGENTS.md
- QODER.md
- KIMICODE.md
- skills/wes-multi-agent-collaboration/SKILL.md
- docs/agent-loop/nightops-templates.md
- <task-specific files>

## Execution Rules

allowNextTask: false
mustReworkFirst: false
kimicodeCanPatch: false
maxTasks: 1
mainMergeAllowed: false
deliveryStatusAllowed: 已回填 / 待 Codex 复核

## Verification

requiredCommands:
manualAcceptanceNeeded:
knownRisks:

## Output Paths

qoderHandoffPath:
kimicodeAuditPath:
codexGatePath:
morningBriefPath:
```

## Qoder Handoff

Created by Qoder after execution or rework.

```markdown
# Qoder NightOps Handoff

missionId:
taskId:
projectRoot:
worktreePath:
branch:
baseCommit:
commit:
status: 已回填 / 待 Codex 复核

## ACK

readFiles:
allowedPaths:
forbiddenActions:
previousCodexGate:

## Changes

changedFiles:
implementationSummary:
unimplementedScope:

## Verification

commands:
results:
notRun:

## Risk

knownRisks:
manualAcceptanceNeeded:
boardSyncRecommendation:
nextOwner: kimicode
```

## KIMICODE Peer Audit

Created by KIMICODE after reviewing Qoder's handoff.

```markdown
# KIMICODE Peer Audit

missionId:
taskId:
handoffPath:
auditedWorktree:
auditedBranch:
verdict: PASS_TO_CODEX_GATE | REWORK_REQUIRED | REJECTED | USER_DECISION_REQUIRED

## ACK

readFiles:
allowedAuditScope:
kimicodeCanPatch:
forbiddenActions:

## Findings

scopeFindings:
permissionFindings:
architectureFindings:
testFindings:
handoffCompleteness:

## Verification

commandsReproduced:
diffInspected:
notRun:

## Required Rework

blockingFinding:
requiredCorrection:
forbiddenChanges:
requiredVerification:

## Residual Risk

risks:
nextOwner: qoder1 | codex | user-owner
```

## Codex Gate Result

Created by Codex after reading Qoder and KIMICODE evidence.

```markdown
# Codex NightOps Gate

missionId:
taskId:
qoderHandoffPath:
kimicodeAuditPath:
verdict: ACCEPTED_PENDING_USER | REWORK_REQUIRED | REJECTED | USER_DECISION_REQUIRED | ALLOW_NEXT

## Gate Checks

metadataComplete:
scopeClean:
verificationCurrent:
securityBoundaryClean:
boardSyncReady:

## Decision

allowNextTask: false
mustReworkFirst:
nextOwner:
requiredReworkPrompt:
manualAcceptanceNeeded:
```

## Morning Brief

Created by Codex for user review.

```markdown
# NightOps Morning Brief

date:
window:
missionId:
taskId:

## Outcome

gateVerdict:
currentStatus:
summary:

## Evidence

qoderHandoff:
kimicodeAudit:
codexGate:
verification:

## Next Action

userDecisionNeeded:
qoderNextInstruction:
kimicodeNextInstruction:
codexNextInstruction:
```

## Hard Stops

NightOps must stop and request user/Codex decision when the task involves:

- Mainline merge, release tagging, or marking a requirement as `已交付`.
- Real API key validation or secret handling beyond the approved secret workflow.
- Architecture changes, DB migration, auth/owner model changes, or repository-boundary changes.
- Deleting user work, resetting history, cleaning unrelated files, or broad formatting.
- Any need for product direction or acceptance judgment.
