---
name: improving-wes-ui
description: Use when auditing, designing, implementing, or reviewing UI pages, components, styles, responsive behavior, dialogs, accessibility, or visual polish under ui/V2_PROTOTYPE in the WorkEvolutionSys repository.
---

# Improving WES UI

Improve one WES business surface with traceable evidence while preserving the Vite + React mainline, the existing CSS token system, business behavior, and project governance.

Read [references/quality-checklist.md](references/quality-checklist.md) for the detailed audit and verification criteria. Read [references/upstream-provenance.md](references/upstream-provenance.md) before applying a rule derived from `ibelick/ui-skills` or proposing an upstream refresh.

## Required workflow

1. Read the repository `AGENTS.md`, `codex-project-registry.md`, the target route and component, `ui/V2_PROTOTYPE/tokens.css`, the relevant shared CSS, `skills/recording-wes-requirements/SKILL.md`, and `skills/maintain-wes-command-board/SKILL.md`.
2. Declare one business surface for the run. Do not expand into another page family, design-system migration, or opportunistic business fix.
3. Inspect static code and label its observations **candidates**. Confirm hierarchy, density, reachability, responsiveness, focus, and interaction findings only with current rendered or browser evidence.
4. Limit the result to at most three confirmed root issues. Merge related symptoms under their common owner instead of producing a long defect list.
5. For every proposed fix, record all three evidence types:
   - **Contract evidence:** user decision, WES document, token, shared component contract, test, or directly conflicting requirement.
   - **Runtime reachability:** route, import, props/state path, CSS cascade, or current browser capture proving the implementation reaches the surface.
   - **Deterministic owner:** the existing component, hook, stylesheet, or API layer that owns the correction; justify a new shared owner when none exists.
6. Preserve Vite + React and WES `tokens.css` / shared CSS. Reject Tailwind, Radix, Motion, Base UI, React Aria, MUI, Chakra, Ant Design, CSS-in-JS, or another component-system migration unless the user approved a separate architecture decision.
7. Route new UI feedback through Issue-first governance. Reuse an existing Issue/Requirement when it already covers the root cause; otherwise create or update intake evidence before implementation.
8. For behavior changes, write the focused test first and observe it fail for the expected reason. Implement the smallest fix, then run focused tests.
9. For visual or interaction claims, run the current app and collect browser evidence at the target sizes. A source inspection or build cannot substitute for rendered evidence.
10. Run the deterministic scope check against the changed UI scope:

   ```bash
   node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base BASE_REF -- ui/V2_PROTOTYPE/path/to/changed-file
   ```

   Resolve each finding or record the explicit, approved exception. The checker reports new deterministic debt; it does not certify visual quality.
11. Run the applicable Web test/build commands, synchronize Issue/Requirement and command-board evidence, and state which manual checks remain unverified.

## Quick reference

| Question | Required answer |
|---|---|
| How broad is one run? | One business surface; at most three confirmed root issues |
| Is a JSX/CSS observation a defect? | No. It is a candidate until current rendered evidence confirms the user impact |
| May the run add a UI dependency? | Only after an explicit architecture decision and user authority |
| What proves a fix belongs here? | Contract evidence + runtime reachability + one deterministic owner |
| What validates behavior? | A focused failing test followed by a passing test |
| What validates visual/interaction claims? | Current browser evidence at the agreed viewport and input path |
| What must be synchronized? | Existing/new Issue, derived Requirement when applicable, tests, source evidence, and command-board records |

## Rationalization counters

Use these counters when urgency or a broad prompt pressures the run beyond its evidence:

| Rationalization | Counter |
|---|---|
| “It is only a small pilot, so Tailwind or Radix is harmless.” | A new styling or primitive system is an architecture change even on one page. Use the existing tokens and shared components. |
| “Management asked for ten fixes, so ten static findings are confirmed.” | Quantity does not create runtime evidence. Report at most three root issues and keep unrendered observations as candidates. |
| “While this file is open, split the page and standardize every control.” | Refactoring and standardization are separate scopes. Change only the approved owner needed by the confirmed issue. |
| “The build passed, so the UI is visually verified.” | A build proves compilation, not reachability, focus, responsive layout, contrast, or interaction. Capture current browser evidence. |
| “The code clearly looks wrong, so intake can wait.” | WES uses Issue-first traceability. Record or reuse the source issue before expanding the implementation. |
| “A browser session is unavailable, so static inspection is good enough.” | Stop visual conclusions. Report the evidence gap and leave those items unverified. |

## Red flags

Stop and narrow the work if any of these occur:

- a second page family or more than three root issues enter the run;
- Tailwind, Radix, Motion, Base UI, React Aria, or another UI dependency appears without explicit authority;
- a static candidate is described as a confirmed UX defect;
- the changed code has no proven route/import/CSS path to the target surface;
- a fix has multiple competing owners or silently changes business/API behavior;
- visual success is claimed without a current rendered check;
- authentication prevents reaching the target route;
- the Issue/Requirement or total-board source of truth cannot be updated safely;
- unrelated dirty work would be overwritten or mixed into the delivery.

When blocked by authentication, missing rendered evidence, dependency authority, or unsafe dirty-file overlap, preserve completed evidence, state the precise blocker, and do not substitute assumptions for verification.
