# WES UI Quality Checklist

Use this checklist for the single business surface declared in the parent Skill. Classify every observation before acting:

| State | Meaning |
|---|---|
| Candidate | Static code, screenshot, or heuristic suggests a possible issue, but current user impact is not proved |
| Confirmed | Current rendered/runtime evidence demonstrates the issue on the target surface |
| Fixed | The deterministic owner was changed and focused automated checks pass |
| Verified | Current rendered/browser evidence and required regression checks confirm the result |

Do not skip directly from Candidate to Fixed. At most three Confirmed root issues belong in one run.

## Hierarchy and information density

- The page has one clear primary heading and one visually dominant next action.
- Section headings, body text, metadata, status, and actions use existing typography and spacing tokens consistently.
- Dense tables and forms preserve scanning order; repeated labels, decorative chrome, and explanatory paragraphs do not compete with operational data.
- Related symptoms are traced to one shared owner before adding a new one-off style or component.
- Empty space communicates grouping rather than hiding important controls below the fold.
- Destructive, primary, and secondary actions retain consistent visual priority.

## Responsive reachability

Verify the same workflow at both target widths:

- **1440px desktop:** primary content, row actions, dialog title/body/actions, horizontal table reachability, and sticky/fixed regions do not obscure one another.
- **760px narrow viewport:** no required action is clipped; content can scroll; tables retain an intentional overflow strategy; dialog body and footer remain reachable within the viewport.
- Do not infer responsive correctness from CSS breakpoints alone. Save current rendered evidence.
- Check browser zoom and long localized content when the confirmed issue involves clipping or overflow.

## Semantics and keyboard access

- Interactive elements have native semantics or the complete equivalent keyboard contract.
- Controls have visible labels or accurate accessible names; icon-only buttons use `aria-label` or equivalent visible text.
- Dialogs expose a programmatic name and optional description, set modal semantics, and have a visible close action.
- Focus order follows the visible task order and has a visible focus indicator.
- Opening a dialog moves focus to an intentional control; Tab and Shift+Tab remain within the modal.
- Escape follows the declared dismissal policy and never silently discards a protected destructive/dirty form.
- Closing a dialog restores focus to the opener when it is still connected.
- Error summaries and field errors are associated with the affected inputs.
- Text, controls, focus indicators, and state colors meet the applicable contrast target; verify computed colors or an accessibility tool instead of judging token names.

## Interaction and feedback

Check each relevant state, without inventing new business behavior:

- **Loading:** the action being processed is disabled or clearly busy; unrelated actions remain usable when safe.
- **Success:** the updated state is visible and announced where appropriate.
- **Failure:** the user sees an actionable error near the owner; inputs needed for retry are retained.
- **Disabled:** the reason is discoverable without relying on color alone.
- **Destructive:** consequence and target are clear, accidental activation is guarded according to the existing WES pattern, and progress/result feedback is visible.
- Backdrop dismissal, Cancel, close button, Escape, and successful submit use the same reset/preservation contract.

## Motion and performance

- Prefer no motion when state change is already obvious.
- Reuse CSS transitions and existing timing/easing tokens; do not add Motion or another runtime animation dependency without an approved architecture decision.
- Animate transform/opacity where possible; avoid layout-thrashing properties in frequent interactions.
- Respect `prefers-reduced-motion: reduce` for non-essential movement.
- Dragging stays pointer-driven, bounded to the viewport, keyboard-neutral, and resets predictably when its surface closes.
- Confirm performance problems with runtime evidence; source complexity alone is not a frame-rate finding.

## Shared ownership and tokens

- Reuse `tokens.css`, `components.css`, `layout.css`, and an existing shared component before creating a page-owned variant.
- Do not add raw color literals outside the token source, arbitrary numeric z-index values, or one-off shadows/radii when a semantic token exists.
- Keep one deterministic owner for a reusable interaction such as Dialog.
- Do not add or migrate UI dependencies as part of visual polish.
- A new shared component must have focused behavior tests and one demonstrated consumer; do not launch a speculative component library.

## Verification record

For each confirmed root issue, capture:

1. target route, viewport, user role, and reproduction path;
2. contract evidence and runtime reachability;
3. deterministic owner and changed files;
4. failing focused test before implementation, when behavior changes;
5. focused and full regression results;
6. 1440px and/or 760px browser evidence relevant to the claim;
7. command-board Issue/Requirement/test/source links;
8. any unverified manual item stated as pending, never as passed.
