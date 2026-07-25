# WES External Skills Adapter

> Purpose: allow external agent skills, such as `mattpocock/skills`, to inform WES engineering practice without taking over WES governance, facts, or delivery authority.

## Scope

This adapter applies when Codex, Qoder, KIMICODE, Claude Code, or another candidate agent wants to use an external skill pack, prompt workflow, issue workflow, review workflow, or methodology inside WES.

The external skill may be used as a method reference. It must not become a new source of truth, task tracker, automation loop, or commit authority.

## Source Mapping

| External skill concept | WES mapping |
|---|---|
| Issue tracker | WES Issue pool in `issues.html`, triaged to `defects.html` or `requirements.html` |
| Issue / ticket / PRD | RP entry, plan item, or governed workflow document |
| Triage labels | WES RP priority, status, scope, acceptance, and next-step fields |
| Agent brief | WES task packet, Qoder handoff, Codex Gate, or plan prompt |
| ADR / context glossary | Existing WES design docs, command board pages, and workflow docs |
| Review result | Codex Gate finding, `changes.html` record, or rework prompt |
| Research note | Workflow/design source recorded in `sources.html` when durable |

## Absorbed Practices

The following external-skill practices are approved for WES after translation into WES rules:

| Practice | WES use |
|---|---|
| Grilling before implementation | For ambiguous RP or architecture work, ask focused questions until decision branches are resolved before implementation begins. |
| Red-capable bug loop | For bugs, first establish a command, test, script, curl, or browser repro that can fail on the exact symptom. Fixes should prove the original symptom no longer reproduces. |
| Vertical slice planning | Split RP work by independently verifiable user outcomes rather than frontend/backend/document horizontal layers. |
| Two-axis review | Codex Gate may separate `Spec` findings from `Standards` findings so requirement mismatch does not hide code-quality risk, and vice versa. |
| Deep module design vocabulary | Use module/interface/seam/adapter/depth/locality/leverage/deletion-test language when reviewing WES module boundaries. |
| Throwaway prototype | Use only when a state model, interaction model, or UI option cannot be decided safely on paper. Prototype artifacts must be deleted, absorbed, or explicitly marked as non-production. |
| Primary-source research | Use official docs, source code, specs, or first-party APIs for external API and library facts. Follow `api-secret-handling.md` for any secret-backed validation. |

## Hard Prohibitions

External skills must not:

1. Install themselves or modify WES project files unless the user explicitly authorizes that installation or edit.
2. Modify `AGENTS.md`, `QODER.md`, `KIMICODE.md`, or `codex-project-registry.md` automatically.
3. Create root `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/adr/`, `.scratch/`, or GitHub/GitLab issues as WES primary facts.
4. Commit, push, merge, rebase, reset, restore, clean, or mark a task delivered unless WES rules and user authorization explicitly allow it.
5. Replace the WES Issue/Defect/Requirement governance, command board, Qoder worktree protocol, Codex Gate, NightOps packet, or external handoff template.
6. Start or recreate a Codex-side Issue/Defect/Requirement implementation loop.
7. Bypass JWT, owner isolation, dispatch boundaries, human confirmation, repository boundaries, or secrets policy.
8. Treat `apps/web`, `ui/V0_SAAS`, or the legacy WES repository as current implementation paths.

## Required WES Flow

When an external method produces durable work:

1. Classify the work as requirement, design, implementation, review, verification, risk, collaboration, or source-asset change.
2. If it is a requirement or user feedback, run the WES feedback intake and dedup flow before creating or changing an RP.
3. If it is implementation work for Qoder, require Worktree Contract ACK, one task per worktree, structured handoff, and Codex Gate.
4. If it is a one-off Codex implementation, preserve unrelated dirty changes and produce scoped verification evidence.
5. If it changes durable project facts, update the owning command-board pages.
6. If it only informs analysis and creates no durable fact, say no board update was needed and why.

## Installation Policy

Default stance: do not install external skill packs into the WES main environment.

Allowed alternatives:

- Read an external skill in a temporary checkout and translate the useful method into WES language.
- Run an external skill in a sandbox or candidate-agent trial where it cannot write WES governance files.
- Install only after user approval, with a whitelist of allowed skills and explicit disabled actions.

## External Skill Review Checklist

Before adopting any external skill method, verify:

- Does it write files, issues, commits, branches, or automation by default?
- Does it assume GitHub/GitLab issue tracker ownership?
- Does it create new context, ADR, or scratch paths that conflict with WES facts?
- Does it contain automatic commit, push, merge, or close/deliver behavior?
- Can its useful practice be expressed as a WES checklist instead of installed behavior?
- Which command-board pages must record the durable result?

## Current Decision

As of 2026-07-03, `mattpocock/skills` is treated as a methodology reference for WES, not an installed WES runtime dependency. WES may absorb its engineering practices listed above, but WES authority remains with the Issue/Defect/Requirement governance, command board, Qoder worktree protocol, Codex Gate, and user acceptance.
