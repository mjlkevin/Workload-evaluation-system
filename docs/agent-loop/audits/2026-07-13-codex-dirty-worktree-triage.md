# Codex Dirty Worktree Triage

date: 2026-07-13
projectRoot: `/Users/kevin/AI/Workload-evaluation-system-agent`
worktreePath: `/Users/kevin/AI/Workload-evaluation-system-agent`
branch: `codex/wes-dirty-triage-20260629`
head: `84611da`
baseRefs: `main=2764fcf`, `origin/main=14cc86a`

## Summary

Current checkout is an existing linked worktree. It is not a clean release branch:

- `HEAD` is 9 commits ahead of local `main`.
- `HEAD` is 15 commits ahead of `origin/main`.
- Working tree contains 149 paths: 105 modified and 44 untracked.
- Largest changed areas by path prefix: `apps` 45, `ui` 29, WES command board 23, `docs` 17, `scripts` 12, `skills` 10.

This report is a triage artifact only. It does not accept, reject, stage, merge, or discard any file.

## Proposed Work Packages

| Package | Scope | Representative files | Recommended owner / gate |
|---|---|---|---|
| WP-1 PG runtime store baseline | PostgreSQL hydration, JSON runtime replacement tables, migration policy, env requirement, test seed support | `apps/api/src/db/runtime-stores.ts`, `apps/api/src/db/schema/json_runtime.ts`, `apps/api/src/main.ts`, `apps/api/src/config/env.ts`, `apps/api/src/migration/*`, `scripts/api-integration-check.js`, `AGENTS.md`, `README.md` | Codex architecture gate, then API regression |
| WP-2 API auth / users / version runtime | PG-backed auth, invite/password reset, user email, version records, templates/rules/system/team/trace repositories | `apps/api/src/middleware/auth.ts`, `apps/api/src/modules/auth/*`, `apps/api/src/modules/versions/*`, `apps/api/src/modules/templates/*`, `apps/api/src/modules/rules/*`, `apps/api/src/modules/team/*`, `apps/api/src/modules/trace/*` | API module review; require `test:modules`, `test:integration`, `build:api` |
| WP-3 AI workbench and V2 UX | AI session UI, streaming, suggested actions, login guard, user management direct-create, system management subnav | `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`, `src/api/ai.js`, `src/pages/Login.jsx`, `src/pages/UserManagement.jsx`, `src/pages/SystemManagement.jsx`, `src/App.jsx`, related tests | V2 frontend review; require `test:web`, `build:web`, manual UI spot check |
| WP-4 Command board governance | Issue-first registry, defects/issues pages, board events, code audit, ops health, roadmap, command board scripts | `03_技术设计/系统架构/WES-Agent-升级总看板/*`, `scripts/board-*`, `skills/maintain-wes-command-board/*`, `skills/recording-wes-requirements/*` | Board steward gate; require `board:check`, `test:board-work-items` |
| WP-5 NightOps / multi-agent protocol | Qoder/Codex Gate artifacts, NightOps templates, collaboration protocol, external handoff template | `QODER.md`, `KIMICODE.md`, `docs/agent-loop/*`, `docs/codex-workflows/external-ai-handoff-template.md`, `skills/wes-multi-agent-collaboration/*`, `skills/wes-qoder-worktree-protocol/*` | Collaboration gate; reject if handoff metadata or same-day audit is missing |
| WP-6 Security audit fixes | Path traversal guard, auth rate limit, metrics token guard, health test guard, login storage and xlsx risk follow-up | `apps/api/src/modules/exports/exports.usecase.ts`, `apps/api/src/routes/auth.routes.ts`, `apps/api/src/routes/metrics.routes.ts`, `apps/api/src/routes/health.routes.ts`, `ui/V2_PROTOTYPE/src/pages/Login.jsx`, `apps/api/package.json` | Security review; P0/P1 items cannot be auto-accepted |
| WP-7 Runtime/local data hazards | Local config and runtime files that may be generated, empty, or migration residue | `config/auth/users.json`, `config/versions/records.json`, `config/system/requirement-settings.json`, `$CODEX_HOME/` | Treat as data migration evidence; do not stage until owner decides |

## Current Red/Green Evidence

Before the 2026-07-13 Codex triage patch:

- `npm run build:api`: pass.
- `npm run build:web`: pass with Vite chunk-size warning.
- `npm run test:web`: pass, 115 tests.
- `npm run test:harness -w apps/api`: pass, 70 tests.
- `npm run test:rules`: pass, 8 tests.
- `npm run test:board-work-items`: pass, 6 tests.
- `npm run test:modules`: failed, 103 pass / 45 fail, rooted in missing active user/admin fixtures after PG runtime migration and empty `config/auth/users.json`.
- `npm run test:integration`: failed at `templates_status_not_200`, rooted in empty PG `templates` table.

Codex triage patch then added:

- handler-test user seeding scoped to `modules.handlers.test.ts`, with file snapshot restoration after tests.
- integration-script PG seed for empty `templates` and `rule_sets` using the existing example JSON fixtures.
- documentation alignment for PG runtime store as the current implementation.

After that patch:

- `npm run test:modules`: pass, 148 tests.
- `npm run test:integration`: pass, 1 test.

## Recommended Integration Order

1. Seal WP-1 first. It determines current storage truth and removes the biggest source of test/document drift.
2. Review WP-2 after WP-1, because repository behavior depends on the accepted PG hydration model.
3. Review WP-6 before allowing any unattended AutoFix continuation. Security findings need explicit Codex/user acceptance.
4. Review WP-3 independently from PG storage once API tests stay green.
5. Review WP-4/WP-5 as process artifacts; they should not be mixed into API/frontend implementation commits unless the change itself creates process facts.
6. Keep WP-7 out of ordinary commits until the user owner decides which files are migration evidence and which are local runtime residue.

## Blocking Risks

- `config/auth/users.json` is currently a 0-byte modified file. That is compatible with PG runtime migration as a local residue, but it is unsafe to stage without a migration/data decision.
- Qoder NightOps Gate dated 2026-07-09 is `REWORK_REQUIRED` because same-day Qoder audit and handoff artifacts were missing. No new unattended task should start from that chain until rework lands.
- The command board contains many useful process updates, but they should be applied as board/process package changes, not hidden inside code fix commits.
