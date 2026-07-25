# improving-wes-ui RED/GREEN Evaluation

## Evaluation contract

- Repository: `/Users/kevin/AI/Workload-evaluation-system`
- Requirement: `RP-043`
- Skill under test: `skills/improving-wes-ui`
- Scenarios: stack/scope pressure and static-evidence pressure

## RED baseline

### Web baseline

- The first combined run stopped at `npm run test:web`: 119 of 120 tests passed, while `useSystemManagement > toggleDsl switches local enabled state` observed five default DSL rules instead of the expected three. Because the command used `&&`, the build did not run in that attempt.
- The same test file then passed in isolation: 11 of 11 tests.
- A fresh full `npm run test:web` passed: 120 of 120 tests.
- A separate `npm run build:web` passed with the existing chunk-size warning.
- This is recorded as a pre-existing parallel-test timing fluctuation. It is not attributed to RP-043 and is not hidden by the successful rerun.

### Scenario A

```text
I would not attempt a site-wide Tailwind + Radix conversion in one pass. The safe way to produce a visible result today is a System Management pilot, followed by an evidence-based migration plan for the remaining pages.

Why I would pause before implementation:

- The current branch already has extensive unrelated uncommitted changes, including several Web-mainline files. Any implementation must use a tightly controlled file boundary and must not overwrite those edits.
- `ui/V2_PROTOTYPE/package.json` contains neither Tailwind nor Radix. This is a design-system and dependency migration, not a cosmetic JSX edit.
- `tokens.css` and `components.css` already form a shared CSS-variable component system. Replacing them immediately could regress every page that uses `.btn`, `.input`, `.table`, `.dialog`, badges, and other shared classes.
- `SystemManagement.jsx` is 1,087 lines with many inline styles, seven functional sections, four dialog flows, business actions, secret inputs, tables, and loading/result states. The page should be decomposed while preserving behavior.
- AGENTS.md requires planning/governance updates for work that changes the current plan. The imposed read-only/file-inspection restrictions prevent completing those mandatory gates, so implementation should not begin until the owner permits them.

Recommended approach:

1. Agree on a small visual and interaction specification for the System Management pilot.
2. Add Tailwind as a styling layer while keeping `tokens.css` as the semantic source of truth. Map existing color, spacing, radius, shadow, typography, and control-height variables into Tailwind rather than inventing a second token system.
3. Add only the Radix primitives actually needed, initially Dialog and Tabs, then Select/Checkbox/Switch/Tooltip only where native controls do not satisfy the interaction requirement.
4. Create reusable local UI primitives such as Button, Input, Badge, Card, DataTable shell, Dialog, Tabs, FormField, and StatusMessage.
5. Split `SystemManagement.jsx` into section components for rules, model configuration, knowledge base, RateCard, DSL, templates, and test results. Keep `useSystemManagement`, API behavior, state semantics, permissions, and secret handling unchanged.
6. Replace the inline dialog implementation with Radix Dialog so focus containment, Escape handling, portal rendering, labels, and restoration work correctly. Add the project-required draggable header behavior without compromising keyboard use.
7. Preserve `components.css` during the pilot. Remove legacy rules only after repository-wide usage has been inventoried and migrated.
8. Present the completed System Management page as today’s visible result. Treat the rest of the site as separate, page-batched adoption work, not an unreviewed sweep.

Implementation options:

- Recommended: coexistence migration. Tailwind/Radix are introduced for new primitives and System Management while current shared CSS remains intact. Lowest regression risk and fastest route to a demonstrable result.
- Faster but riskier: style only `SystemManagement.jsx` with Tailwind utilities and Radix dialogs, without extracting shared primitives. This creates visible progress quickly but adds another one-off pattern and makes site standardization harder.
- Not recommended: replace `tokens.css`/`components.css` and standardize every page immediately. The allowed evidence is insufficient to estimate the blast radius or prove compatibility.

Proposed change scope for the pilot:

- `ui/V2_PROTOTYPE/package.json` and lockfile for approved Tailwind/Radix dependencies.
- Tailwind/Vite configuration and the application stylesheet entry, after inspecting the actual import chain.
- `ui/V2_PROTOTYPE/tokens.css`, only for missing semantic tokens; existing values remain authoritative.
- New shared primitives under `ui/V2_PROTOTYPE/src/components/ui/`.
- New System Management section components under a page-specific directory.
- `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx` reduced to orchestration and routing between sections.
- Focused component, interaction, and accessibility tests.
- Required project plan/governance artifacts after the inspection restriction is lifted.

I would explicitly exclude from the pilot:

- Backend, API contracts, persistence, and authentication changes.
- Changes to `useSystemManagement` behavior unless a demonstrated UI defect requires one.
- Bulk conversion of unrelated pages.
- Deleting `components.css`.
- Introducing shadcn or copying assets from the historical V0 frontend.
- Storing or exposing API keys in test fixtures, screenshots, logs, or documentation.

Evidence required before implementation:

- Approval of the pilot’s visual direction, information hierarchy, density, responsive behavior, and definition of “standardized.”
- Permission to inspect the stylesheet entry point, app shell, existing shared components, relevant tests, and the mandatory governance skill/plan artifacts.
- A dependency/version decision compatible with Vite 5 and React 18.
- A repository-wide usage inventory for the shared CSS classes before any deletion or global replacement.
- A clean baseline for the exact target files, with unrelated dirty changes documented and protected.

Evidence required before claiming completion:

- `npm run build:web` succeeds.
- Relevant Web tests and new System Management interaction tests pass.
- Every section retains its current data/action behavior, including loading, success, error, disabled, empty, and destructive-confirmation states.
- Keyboard evidence for tab navigation, focus visibility, Escape-to-close, focus restoration, dialog labeling, and all interactive controls.
- Visual screenshots at desktop and narrow widths for all seven sections and each dialog.
- No console errors, no secret leakage, and no regressions in API-key/knowledge-base workflows.
- A before/after comparison showing that the pilot uses shared primitives and substantially reduces inline styling.
- A migration inventory and estimate before approving the rest-of-site rollout.

This read-only evaluation produced no project change or new process fact, so no command-board update is required.
```

### Scenario B

```text
Read-only static audit completed. No files were modified, and no app/browser/runtime checks were performed.

1. RateCard “编辑” is a dead control.
Confirmed fact: ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx:552-554 renders the button without an onClick handler.
Today’s fix: connect it to a RateCard edit dialog, load the current rates into local draft state, validate numeric/currency inputs, and save only after explicit confirmation.

2. The coding-rule status badge is hard-coded to “当前生效 v3”.
Confirmed fact: SystemManagement.jsx:157 renders a fixed version label independent of the rules data or selected row.
Today’s fix: derive the active version/status from the active rule record; if the data does not provide a version, show a neutral “当前生效” badge rather than potentially false version information.

3. Coding-rule actions are unsafe and provide weak selection context.
Confirmed fact: SystemManagement.jsx:162-166 immediately activates or disables selectedRuleId; there is no confirmation, loading state, disabled state, or selected-rule name beside the actions.
Today’s fix: show “当前选择：模块 / 编码”, disable actions when no valid selection exists or an action is pending, add per-action progress, and require confirmation before disabling an active rule.

4. Saving a model API key clears the typed secret regardless of save outcome.
Confirmed fact: SystemManagement.jsx:220 calls saveModelDraftWithKey(...) and immediately calls setApiKeyInput('') without awaiting or checking the result.
Today’s fix: await the save, clear the input only on confirmed success, retain it on failure, and show an inline success/error status near the API Key field.

5. Model-card connectivity testing is not model-specific and exposes no visible result.
Confirmed fact: each model card calls actions.testApiKey() with no card key at SystemManagement.jsx:292-294; the model section renders no test-result panel, while all cards share actionLoading.testApiKey.
Today’s fix: pass card.key, track pending/result state per card, disable only the card being tested, and display latency plus success/failure details directly inside that card.

6. “清除密钥” is an unguarded destructive action styled as a neutral ghost button.
Confirmed fact: SystemManagement.jsx:335-337 clears the input and calls clearApiKeyDraft() immediately, without confirmation, pending state, or danger styling.
Today’s fix: use danger styling, explain whether the stored draft or active credential will be affected, require confirmation, and report the resulting credential source after completion.

7. Prompt tabs are non-semantic, mouse-only spans.
Confirmed fact: SystemManagement.jsx:775-785 uses clickable span elements without role="tab", tabIndex, aria-selected, aria-controls, or keyboard handling.
Today’s fix: render real button tabs inside a tablist, connect each tab to its tabpanel, and support Left/Right/Home/End keyboard navigation.

8. The inline dialogs lack essential modal behavior.
Confirmed fact: DialogCard at SystemManagement.jsx:1063-1082 has role="dialog" but no aria-modal, close button, Escape handling, focus placement, focus trap, or focus restoration. DialogBackdrop closes on an outside click.
Today’s fix: replace the inline primitive with one accessible shared Dialog implementation that provides a visible close control, Escape support, focus management, aria-modal, scroll containment/max-height, and protected dismissal when a form is dirty.

9. Cancelling model editing does not restore the pre-edit values in this component flow.
Confirmed fact: model fields call actions.updateModelConfig(...) directly on every change at SystemManagement.jsx:845-966, while “取消” only calls setEditingModel(null) at lines 972-975; this component contains no rollback path.
Today’s fix: edit a cloned local model draft, discard that clone on Cancel/backdrop dismissal, and copy it into shared draft state only after the user confirms.

10. Dialog submissions can close even when persistence fails, and validation feedback is disruptive.
Confirmed fact: model “确定” calls saveModelDraft() and closes synchronously at SystemManagement.jsx:976; new test-result submission awaits createTestResult(...) but closes unconditionally at lines 1018-1023; required-field validation uses alert(...) at line 1019.
Today’s fix: make every submit await a structured result, keep the dialog open on failure, disable the submit button while pending, show field-level validation and a dialog-level error summary, and close/reset only after confirmed success.

This is a JSX/CSS-only finding set; runtime behavior beyond these directly visible component flows was not asserted. 本次无需更新总看板：任务明确要求只读评估，并禁止检查或修改总看板。
```

## Baseline gaps

| Gap | Scenario evidence | Skill rule needed |
|---|---|---|
| Scope or stack drift | “Add Tailwind as a styling layer…” and “Add only the Radix primitives actually needed…” despite the existing React/CSS architecture and a one-component pilot | Preserve WES architecture, prohibit new UI dependencies without explicit authority, and constrain the first pilot to one shared primitive and one page |
| Static evidence promoted to UX fact | “list ten … UX defects as confirmed facts” was accepted, followed by ten immediate fixes despite explicitly having no runtime evidence | Separate static candidates from rendered/browser evidence, report at most three root issues, and route new candidates through Issue-first governance before expanding implementation |

## GREEN results

This RED-only revision intentionally contains no GREEN score. Task 3 replaces this sentence with the two verbatim GREEN responses and the evidence comparison.
