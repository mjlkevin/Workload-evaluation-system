# WES Qoder Worktree Protocol Reference

## Purpose

Qoder executes WES demand-pool and Loop implementation work in isolated worktrees. Codex and the user receive structured handoffs, review scope and verification, then decide final delivery and board status.

## Startup Sequence

Run from the WES project root unless the user provides a different path:

```bash
pwd
git status --short --branch
git rev-parse --short HEAD
git rev-parse --show-toplevel
```

Read:

- `AGENTS.md`
- `codex-project-registry.md`
- `QODER.md`
- `skills/wes-qoder-worktree-protocol/SKILL.md`
- this file

## Worktree Contract ACK

Print this before editing files:

```markdown
## Worktree Contract ACK
projectRoot: /Users/kevin/AI/Workload-evaluation-system-agent
worktreePath: <absolute path>
branch: qoder/<task-id>-<short-topic>
baseCommit: <short sha>
taskId: <RP-ID or work-order id>
sourceOrder: <user prompt / Work Order path>
allowedPaths:
- <path 1>
- <path 2>
forbidden:
- no apps/web revival
- no ui/V0_SAAS as current mainline
- no broad reset/clean/restore/formatting
- no secrets in chat/docs/board/commits
- no unrelated board finalization unless assigned
statusAuthority: Qoder can report "已回填 / 待 Codex 复核"; Codex/user decide "已交付"
```

If any field is unknown, stop and ask for the missing information or propose a conservative default.

## Worktree Rules

- Use one isolated worktree per RP, Work Order, or coherent batch.
- Branch naming: `qoder/rp-030-trace-schema`, `qoder/phase-1h-c-rag-baseline`, or `qoder/fix-<short-topic>`.
- Record the base commit before any edit.
- Do not depend on uncommitted main-checkout changes unless the user explicitly supplies them as scope.
- Keep generated data, logs, cache, and local secrets out of commits and handoff text.

If a worktree cannot be created, stop and report why. Do not silently work in the main checkout.

## Scope Boundaries

Default current WES mainlines:

- Frontend: `ui/V2_PROTOTYPE`
- Backend: `apps/api`
- Demand pool and board: `03_技术设计/系统架构/WES-Agent-升级总看板/`
- Project workflow docs: `docs/codex-workflows/`
- Project skills: `skills/`

Historical or restricted:

- `apps/web` is deleted and must not be restored.
- `ui/V0_SAAS` is historical/downline and not current Web mainline.
- `/Users/kevin/AI/Workload-evaluation-system` is legacy WES worktree for historical comparison only.

Stop and request confirmation before touching:

- PostgreSQL schema/migrations outside assigned Harness work.
- RBAC, owner isolation, JWT behavior, or admin permissions.
- Agent write-action autonomy or human-confirmation boundaries.
- API secret handling.
- Board status transitions to `已交付`.
- Files outside the work order's `allowedPaths`.

## Verification Matrix

Run the smallest relevant set and report exact pass/fail status.

| Change type | Typical verification |
|---|---|
| Frontend React only | `npm run test --prefix ui/V2_PROTOTYPE`; `npm run build:web` |
| API/backend contract | `npm run test:modules`; `npm run build:api` |
| Harness backend | `npm run test:harness -w apps/api` if available; otherwise nearest harness route/module tests |
| AI service behavior | `npm run test:ai` or targeted AI service tests |
| Rules/estimate logic | `npm run test:rules` |
| Integration routes | `npm run test:integration` |
| Docs/Skill/board only | targeted `rg` checks for stale names, unfinished markers, counts, and broken references |

If a command is unavailable or fails due to pre-existing state, include the command, key output, and whether the failure blocks acceptance.

## Completion Handoff

Use this exact structure:

```markdown
## 目标
<本轮要解决的问题和边界>

## Worktree
- projectRoot: <absolute path>
- worktreePath: <absolute path>
- branch: <branch>
- baseCommit: <sha>
- taskId: <RP-ID or work-order id>

## 变更文件
- <path>: <新增/修改/删除内容摘要>

## 验证命令与结果
- `<command>`: pass/fail/not run，关键输出摘要

## 风险
- <权限 / 数据 / 兼容 / 测试缺口 / 人工验收缺口 / scope risk>

## 是否建议看板同步
是/否。若是，建议页面：requirements / plan / testing / monitoring / risks / changes / sources。

## 下一步建议
- <待 Codex 复核 / 等待人工验收 / 需返工 / 需补测试 / 需入需求池>
```

## Rejection Conditions

Codex/user should reject or return the handoff when:

- no worktree path, branch, or base commit is provided
- changed files are not listed
- verification is claimed without command evidence
- unrelated dirty changes are mixed in
- forbidden paths or historical mainlines were modified
- secrets were exposed
- Qoder marked a requirement `已交付` without Codex/user acceptance
