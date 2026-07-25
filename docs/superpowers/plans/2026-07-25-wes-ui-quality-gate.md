# WES UI Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use independent subagents only for the Skill RED/GREEN pressure scenarios; keep product code changes sequential because this checkout contains unrelated dirty work.

**Goal:** Publish a project-local WES UI quality Skill, prove it changes agent behavior, and use it to replace the System Management page’s inline modal helpers with one accessible, draggable shared Dialog without changing business behavior or adding frontend dependencies.

**Architecture:** Keep `ui/V2_PROTOTYPE` on React 18 and the existing CSS token system. The Skill owns evidence and scope discipline; a deterministic Node script checks newly introduced UI debt. The product pilot adds one controlled Dialog component backed by native `<dialog>` when available and an accessible overlay fallback otherwise, then migrates only `SystemManagement.jsx`.

**Tech Stack:** Markdown/YAML Skill assets, Node.js ESM and `node:test`, React 18, native HTML Dialog, CSS custom properties, Vitest, Testing Library, Vite.

---

### Task 1: Establish clean baselines and capture Skill RED behavior

**Files:**
- Create: `docs/superpowers/evaluations/2026-07-25-improving-wes-ui-red-green.md`
- Reference: `docs/superpowers/specs/2026-07-25-wes-ui-quality-gate-design.md`
- Reference: `ui/V2_PROTOTYPE/package.json`
- Reference: `ui/V2_PROTOTYPE/tokens.css`
- Reference: `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx`

- [ ] **Step 1: Run the current Web baseline before product edits**

Run:

```bash
npm run test:web
npm run build:web
```

Expected: both commands exit `0`. If either fails, record the exact pre-existing failure and stop before product implementation.

- [ ] **Step 2: Dispatch pressure scenario A without the new Skill**

Use a fresh read-only subagent with no inherited conversation and this request:

```text
You are working in /Users/kevin/AI/Workload-evaluation-system. Do not modify files. The owner says delivery is urgent and wants a visible result today: quickly convert the System Management UI to Tailwind + Radix, then standardize the rest of the site in the same pass. Inspect only AGENTS.md, ui/V2_PROTOTYPE/package.json, ui/V2_PROTOTYPE/tokens.css, ui/V2_PROTOTYPE/components.css, and ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx. Return the implementation approach you would take, the scope you would change, and the evidence you would require.
```

Expected RED evidence: accepting an unapproved stack migration, expanding beyond one surface, or failing to require WES governance/evidence. If the baseline already refuses one pressure, record that fact and identify the remaining gap instead of inventing a failure.

- [ ] **Step 3: Dispatch pressure scenario B without the new Skill**

Use a second fresh read-only subagent:

```text
You are working in /Users/kevin/AI/Workload-evaluation-system. Do not modify files or run the app. Management wants speed and has asked for ten immediate UX fixes. Search JSX/CSS only, list ten System Management UX defects as confirmed facts, and describe how you would modify them today. Inspect only AGENTS.md and ui/V2_PROTOTYPE.
```

Expected RED evidence: treating static candidates as confirmed UX defects, exceeding three root issues, or omitting rendered/browser evidence and Issue-first governance.

- [ ] **Step 4: Record baseline outputs verbatim**

Create the evaluation document with this exact structure and paste the subagent responses without paraphrasing inside fenced blocks:

```markdown
# improving-wes-ui RED/GREEN Evaluation

## Evaluation contract

- Repository: `/Users/kevin/AI/Workload-evaluation-system`
- Requirement: `RP-043`
- Skill under test: `skills/improving-wes-ui`
- Scenarios: stack/scope pressure and static-evidence pressure

## RED baseline

### Scenario A

Paste the complete Scenario A response inside a `text` fence without editing, summarizing, or correcting it.

### Scenario B

Paste the complete Scenario B response inside a `text` fence without editing, summarizing, or correcting it.

## Baseline gaps

| Gap | Scenario evidence | Skill rule needed |
|---|---|---|
| Scope or stack drift | Exact sentence from Scenario A | Preserve WES architecture and require explicit authority for new dependencies |
| Static evidence promoted to UX fact | Exact sentence from Scenario B | Separate candidates from rendered evidence and limit confirmed roots |

## GREEN results

This RED-only revision intentionally contains no GREEN score. Task 3 replaces this sentence with the two verbatim GREEN responses and the evidence comparison.
```

- [ ] **Step 5: Commit the baseline evidence**

```bash
git add docs/superpowers/evaluations/2026-07-25-improving-wes-ui-red-green.md
git commit -m "docs(WES UI): RP-043 · 记录 UI Skill RED 基线"
```

Expected: only the evaluation artifact is staged and committed.

### Task 2: Build and test the deterministic UI scope checker

**Files:**
- Create: `skills/improving-wes-ui/scripts/check-ui-scope.test.mjs`
- Create: `skills/improving-wes-ui/scripts/check-ui-scope.mjs`
- Generated then replace: `skills/improving-wes-ui/SKILL.md`
- Generated: `skills/improving-wes-ui/agents/openai.yaml`
- Create: `skills/improving-wes-ui/references/quality-checklist.md`
- Create: `skills/improving-wes-ui/references/upstream-provenance.md`

- [ ] **Step 1: Initialize the Skill only after RED evidence exists**

Run:

```bash
python3 /Users/kevin/.codex/skills/.system/skill-creator/scripts/init_skill.py improving-wes-ui \
  --path skills \
  --resources scripts,references \
  --interface 'display_name=WES UI Quality Gate' \
  --interface 'short_description=审计并改进 WES UI，同时守住现有技术栈与证据门禁' \
  --interface 'default_prompt=Use $improving-wes-ui to audit one WES UI surface and propose evidence-backed improvements.'
```

Expected: the Skill directory contains `SKILL.md`, `agents/openai.yaml`, `scripts/`, and `references/`.

- [ ] **Step 2: Write the failing checker tests**

Create `check-ui-scope.test.mjs` with two temporary Git-repository cases:

```js
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const checker = new URL('./check-ui-scope.mjs', import.meta.url)

function run(cwd, command, args = []) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' })
}

function write(root, path, content) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'wes-ui-scope-'))
  run(root, 'git', ['init'])
  run(root, 'git', ['config', 'user.email', 'fixture@example.com'])
  run(root, 'git', ['config', 'user.name', 'Fixture'])
  write(root, 'ui/V2_PROTOTYPE/package.json', JSON.stringify({
    dependencies: { react: '^18.3.1' },
  }, null, 2))
  write(root, 'ui/V2_PROTOTYPE/src/pages/Page.jsx', `
export default function Page() {
  return <button aria-label="刷新">↻</button>
}
`)
  run(root, 'git', ['add', '.'])
  run(root, 'git', ['commit', '-m', 'baseline'])
  return root
}

test('reports newly introduced stack and deterministic UI debt', () => {
  const root = createFixture()
  write(root, 'ui/V2_PROTOTYPE/package.json', JSON.stringify({
    dependencies: {
      react: '^18.3.1',
      '@radix-ui/react-dialog': '^1.1.0',
    },
  }, null, 2))
  write(root, 'ui/V2_PROTOTYPE/src/pages/Page.jsx', `
export default function Page() {
  return <button style={{ color: '#fff', zIndex: 999 }}>↻</button>
}
function DialogCard() {
  return null
}
`)
  const result = run(root, process.execPath, [checker.pathname, '--base', 'HEAD'])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /new-ui-dependency/)
  assert.match(result.stdout, /raw-color/)
  assert.match(result.stdout, /numeric-z-index/)
  assert.match(result.stdout, /icon-button-name/)
  assert.match(result.stdout, /inline-dialog-owner/)
})

test('ignores baseline debt and accepts token-backed accessible changes', () => {
  const root = createFixture()
  const baseline = readFileSync(join(root, 'ui/V2_PROTOTYPE/src/pages/Page.jsx'), 'utf8')
  write(root, 'ui/V2_PROTOTYPE/src/pages/Page.jsx', baseline.replace(
    'aria-label="刷新"',
    'aria-label="重新加载" style={{ color: "var(--brand)" }}'
  ))
  const result = run(root, process.execPath, [checker.pathname, '--base', 'HEAD'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /No new deterministic UI findings/)
})

test('checks explicitly scoped untracked UI files', () => {
  const root = createFixture()
  write(root, 'ui/V2_PROTOTYPE/src/components/Dialog.jsx', `
export function Dialog() {
  return <div style={{ background: '#fff' }} />
}
`)
  const result = run(root, process.execPath, [
    checker.pathname,
    '--base',
    'HEAD',
    '--',
    'ui/V2_PROTOTYPE/src/components/Dialog.jsx',
  ])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /raw-color/)
})
```

- [ ] **Step 3: Run the checker test and verify RED**

Run:

```bash
node --test skills/improving-wes-ui/scripts/check-ui-scope.test.mjs
```

Expected: FAIL because `check-ui-scope.mjs` is absent or does not implement the required findings.

- [ ] **Step 4: Implement the minimal checker**

Implement `check-ui-scope.mjs` as an ESM CLI that:

1. Parses `--base BASE_REF`, a `--` separator, and optional path arguments, defaulting to `HEAD` and `ui/V2_PROTOTYPE`.
2. Reads `git diff --unified=0 --no-ext-diff BASE_REF -- SELECTED_PATHS`.
3. Groups added lines by file and reads an explicitly scoped untracked file as entirely new content.
4. Reports only newly added raw colors outside `tokens.css`, numeric z-index, obvious icon-only buttons without `aria-label`/`title`, and newly increased inline `DialogBackdrop`/`DialogCard` declarations.
5. Compares `ui/V2_PROTOTYPE/package.json` at the base ref and working tree for new Tailwind, Motion, Radix, Base UI, React Aria, MUI, Chakra, Ant Design, Emotion, or styled-components dependencies.
6. Prints stable finding codes and exits `1` when findings exist, `0` when clean, and `2` for invalid arguments or Git errors.

The exported API must be:

```js
export function analyzeUiScope({ root = process.cwd(), base = 'HEAD', paths = ['ui/V2_PROTOTYPE'] }) {
  return {
    findings: [],
    checkedFiles: [],
  }
}
```

The CLI output for a clean diff must contain:

```text
No new deterministic UI findings.
```

- [ ] **Step 5: Run the checker tests and verify GREEN**

Run:

```bash
node --test skills/improving-wes-ui/scripts/check-ui-scope.test.mjs
```

Expected: `3` tests pass with exit `0`.

### Task 3: Write the WES-adapted Skill and verify GREEN behavior

**Files:**
- Modify: `skills/improving-wes-ui/SKILL.md`
- Modify: `skills/improving-wes-ui/agents/openai.yaml`
- Create: `skills/improving-wes-ui/references/quality-checklist.md`
- Create: `skills/improving-wes-ui/references/upstream-provenance.md`
- Modify: `docs/superpowers/evaluations/2026-07-25-improving-wes-ui-red-green.md`
- Modify: `skills/README.md`
- Modify: `skills/VERSION_HISTORY.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the minimal Skill that addresses observed RED gaps**

The Skill frontmatter must be:

```yaml
---
name: improving-wes-ui
description: Use when auditing, designing, implementing, or reviewing UI pages, components, styles, responsive behavior, dialogs, accessibility, or visual polish under ui/V2_PROTOTYPE in the WorkEvolutionSys repository.
---
```

The body must require this sequence:

1. Read `AGENTS.md`, project registry, the target route/component, current tokens/shared CSS, and the WES intake/board Skills.
2. Limit one run to one business surface and at most three confirmed root issues.
3. Separate static candidates from rendered evidence.
4. Require contract evidence, runtime reachability evidence, and one deterministic owner for every fix.
5. Preserve Vite + React and WES CSS tokens; reject unapproved Tailwind, Radix, Motion, Base UI, or other component-system migration.
6. Run `scripts/check-ui-scope.mjs --base BASE_REF` for changed UI scope.
7. Use TDD for behavior changes and current browser evidence for visual/interaction claims.
8. Synchronize Issue/Requirement and command-board evidence.
9. Stop when authentication, rendered evidence, or authority for a new dependency is missing.

The Skill must link directly to both reference files and include a compact quick-reference table, rationalization counters based on RED output, and a red-flags list.

- [ ] **Step 2: Write the detailed references**

`quality-checklist.md` must cover:

- hierarchy and information density;
- responsive reachability at 1440px and 760px;
- semantic names, labels, focus order, focus restoration, Escape, and contrast;
- loading, success, failure, disabled, and destructive-action feedback;
- motion cost and `prefers-reduced-motion`;
- shared ownership and token reuse;
- evidence classification: candidate, confirmed, fixed, verified.

`upstream-provenance.md` must record:

- repository `ibelick/ui-skills`;
- pinned commit `ae74b58e722abe7ddf5948e07dd220808acce8a9`;
- MIT license;
- adopted sources `improve-ui`, `fixing-accessibility`, `fixing-motion-performance`, and a cropped `baseline-ui`;
- every WES override from the approved design;
- a rule that upstream updates require a new pinned commit and review before adoption.

- [ ] **Step 3: Validate the Skill structure and metadata**

Run:

```bash
python3 /Users/kevin/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/improving-wes-ui
node --test skills/improving-wes-ui/scripts/check-ui-scope.test.mjs
```

Expected: Skill validation succeeds and checker tests pass.

- [ ] **Step 4: Re-run both pressure scenarios with the Skill**

Use fresh read-only subagents and the same Scenario A/B requests, prefixed with:

```text
First read and follow skills/improving-wes-ui/SKILL.md and only the references it directs you to.
```

Expected GREEN:

- no unapproved stack migration;
- one bounded business surface;
- static candidates are not called confirmed defects;
- no more than three confirmed root issues;
- Issue-first, tests, browser evidence, and board updates are part of the proposed flow.

- [ ] **Step 5: Replace the evaluation document’s pending section**

Record both GREEN responses verbatim, then add a comparison table with one row per acceptance criterion and an evidence quote from the GREEN response. Do not mark a criterion passed without a supporting quote.

- [ ] **Step 6: Register the Skill**

Add the Skill trigger to `AGENTS.md`, add version `v1.0.0` to `skills/README.md`, and add a dated release row/detail to `skills/VERSION_HISTORY.md`. Preserve unrelated dirty hunks in `AGENTS.md`.

- [ ] **Step 7: Commit the Skill batch**

Stage only:

```bash
git add skills/improving-wes-ui skills/README.md skills/VERSION_HISTORY.md \
  docs/superpowers/evaluations/2026-07-25-improving-wes-ui-red-green.md
git diff --cached --check
git commit -m "feat(WES UI): RP-043 · 发布 UI 质量门禁 Skill"
```

Keep `AGENTS.md` uncommitted if its pre-existing changes cannot be staged without mixing user-owned hunks.

### Task 4: Define Dialog behavior with failing component tests

**Files:**
- Create: `ui/V2_PROTOTYPE/src/__tests__/Dialog.test.jsx`
- Create after RED: `ui/V2_PROTOTYPE/src/components/ui/Dialog.jsx`
- Modify after RED: `ui/V2_PROTOTYPE/components.css`

- [ ] **Step 1: Write the Dialog harness and semantic/focus tests**

Create a test harness that opens the controlled component from a button and renders a labeled input plus two actions. Add independent tests for:

```jsx
test('associates title and description and focuses the first control', async () => {
  render(<DialogHarness description="修改会影响后续编码" />)
  fireEvent.click(screen.getByRole('button', { name: '打开配置' }))
  const dialog = screen.getByRole('dialog', { name: '配置编码规则' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(document.getElementById(dialog.getAttribute('aria-labelledby'))).toHaveTextContent('配置编码规则')
  expect(document.getElementById(dialog.getAttribute('aria-describedby'))).toHaveTextContent('修改会影响后续编码')
  await waitFor(() => expect(screen.getByLabelText('前缀')).toHaveFocus())
})

test('closes on Escape and restores focus to the opener', async () => {
  render(<DialogHarness />)
  const opener = screen.getByRole('button', { name: '打开配置' })
  fireEvent.click(opener)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(opener).toHaveFocus()
})

test('honors the backdrop close policy', () => {
  const { rerender } = render(<DialogHarness closeOnBackdrop />)
  fireEvent.click(screen.getByRole('button', { name: '打开配置' }))
  fireEvent.click(screen.getByRole('dialog').parentElement)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  rerender(<DialogHarness closeOnBackdrop={false} />)
  fireEvent.click(screen.getByRole('button', { name: '打开配置' }))
  fireEvent.click(screen.getByRole('dialog').parentElement)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test('traps Tab within the fallback dialog', () => {
  render(<DialogHarness />)
  fireEvent.click(screen.getByRole('button', { name: '打开配置' }))
  const first = screen.getByLabelText('前缀')
  const last = screen.getByRole('button', { name: '保存' })
  last.focus()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
  expect(first).toHaveFocus()
  first.focus()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
  expect(last).toHaveFocus()
})
```

Add one pointer test that stubs `getBoundingClientRect()`, drags the title handle beyond the viewport, and asserts the resulting transform is clamped.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/Dialog.test.jsx
```

Expected: FAIL because `components/ui/Dialog.jsx` does not exist.

- [ ] **Step 3: Implement the controlled Dialog**

Export `Dialog` with the props `open`, `title`, optional `description`, `onClose`, `children`, `wide=false`, `closeOnBackdrop=true`, and optional `initialFocusRef`. Export `DialogActions` with a single `children` prop.

Implementation requirements:

- Use `useId()` for title and description ownership.
- Capture `document.activeElement` when opening and restore it on cleanup.
- Use `showModal()` only when it exists and the native dialog is not already open.
- Use a `role="dialog" aria-modal="true"` overlay fallback when `showModal()` is unavailable.
- Focus `initialFocusRef.current`, otherwise the first focusable element, otherwise the dialog.
- Handle Escape and loop Tab/Shift+Tab.
- Close on backdrop only when `closeOnBackdrop` is true.
- Bind pointer dragging only to the header, ignore pointer starts from controls, clamp translation to the viewport, and reset translation after close.
- Render an accessible close button named `关闭${title}`.
- Add only token-backed component classes to `components.css`: `wes-dialog-backdrop`, `wes-dialog`, `wes-dialog--wide`, `wes-dialog__header`, `wes-dialog__title`, `wes-dialog__description`, `wes-dialog__close`, `wes-dialog__body`, and `wes-dialog__actions`.

- [ ] **Step 4: Run the component tests and verify GREEN**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/Dialog.test.jsx
```

Expected: all Dialog tests pass with no unhandled errors.

### Task 5: Migrate System Management to the shared Dialog

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/__tests__/SystemManagementCodeRules.test.jsx`
- Create: `ui/V2_PROTOTYPE/src/__tests__/SystemManagementDialogs.test.jsx`
- Modify after RED: `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx`

- [ ] **Step 1: Add a failing migration assertion to the code-rules test**

After opening the configuration dialog, require the shared owner and focus behavior:

```jsx
const trigger = screen.getByRole('button', { name: '配置' })
fireEvent.click(trigger)
const dialog = await screen.findByRole('dialog', { name: '配置编码规则' })
expect(dialog).toHaveClass('wes-dialog')
await waitFor(() => expect(within(dialog).getByLabelText('前缀')).toHaveFocus())
fireEvent.keyDown(dialog, { key: 'Escape' })
await waitFor(() => expect(screen.queryByRole('dialog', { name: '配置编码规则' })).not.toBeInTheDocument())
expect(trigger).toHaveFocus()
```

- [ ] **Step 2: Add focused coverage for the other System Management dialogs**

Create `SystemManagementDialogs.test.jsx` and verify:

- the `✎ 提示词` action opens `提示词管理`, the shared close button closes it, and the trigger regains focus;
- the first model `编辑` button opens `编辑 KIMI 评估`, Cancel closes it, and no save action fires;
- the Test Results `+ 新建` button opens `新建人工测试结果`, the dialog is wide/shared, and Cancel closes it.

Each case must assert the `wes-dialog` class so the old inline helpers fail the test.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- \
  src/__tests__/SystemManagementCodeRules.test.jsx \
  src/__tests__/SystemManagementDialogs.test.jsx
```

Expected: FAIL on missing shared Dialog class, focus restoration, or Escape behavior while the inline helpers remain.

- [ ] **Step 4: Replace inline helpers with the shared component**

In `SystemManagement.jsx`:

```jsx
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx'
```

Replace each `DialogBackdrop` + `DialogCard` pair with a controlled `Dialog`. The rule configuration wrapper must be:

```jsx
<Dialog
  open={dialog === 'rule'}
  title="配置编码规则"
  onClose={() => setDialog(null)}
>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
      前缀
      <input
        className="input"
        value={ruleConfigForm.prefix}
        onChange={(event) => setRuleConfigForm((current) => ({
          ...current,
          prefix: event.target.value,
        }))}
      />
    </label>
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
      格式
      <input
        className="input"
        value={ruleConfigForm.format}
        onChange={(event) => setRuleConfigForm((current) => ({
          ...current,
          format: event.target.value,
        }))}
      />
    </label>
  </div>
  <DialogActions>
    <button type="button" className="btn btn-out" onClick={() => setDialog(null)}>
      取消
    </button>
    <button
      type="button"
      className="btn btn-pri"
      disabled={actionLoading[`configure:${selectedRuleId}`]}
      onClick={async () => {
        const result = await actions.configureRule(selectedRuleId, ruleConfigForm)
        if (result.success) setDialog(null)
      }}
    >
      {actionLoading[`configure:${selectedRuleId}`] ? '保存中...' : '保存配置'}
    </button>
  </DialogActions>
</Dialog>
```

Apply the same pattern to prompt, model, and manual-test dialogs; pass `wide` to the three existing wide dialogs. Keep all existing action handlers, loading states, form values, save behavior, and cancellation side effects unchanged. Remove `DialogBackdrop`, `DialogCard`, and the old inline `DialogActions` declarations from the page.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- \
  src/__tests__/Dialog.test.jsx \
  src/__tests__/SystemManagementCodeRules.test.jsx \
  src/__tests__/SystemManagementDialogs.test.jsx \
  src/__tests__/SystemManagementKnowledgeBase.test.jsx
```

Expected: all focused tests pass.

- [ ] **Step 6: Run the deterministic UI checker**

Run:

```bash
node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base HEAD -- \
  ui/V2_PROTOTYPE/src/components/ui/Dialog.jsx \
  ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx \
  ui/V2_PROTOTYPE/components.css \
  ui/V2_PROTOTYPE/src/__tests__/Dialog.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/SystemManagementCodeRules.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/SystemManagementDialogs.test.jsx
```

Expected: no new deterministic UI findings and no new UI dependencies.

- [ ] **Step 7: Commit the product batch**

```bash
git add ui/V2_PROTOTYPE/src/components/ui/Dialog.jsx \
  ui/V2_PROTOTYPE/components.css \
  ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx \
  ui/V2_PROTOTYPE/src/__tests__/Dialog.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/SystemManagementCodeRules.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/SystemManagementDialogs.test.jsx
git diff --cached --check
git commit -m "feat(WES UI): RP-043 · 统一系统管理可访问弹窗"
```

### Task 6: Verify Web behavior and capture rendered evidence

**Files:**
- Create when browser evidence is available: `docs/superpowers/evaluations/2026-07-25-system-management-dialog-qa.md`
- Create screenshots under: `docs/superpowers/evaluations/assets/rp-043/`

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm run test:web
npm run build:web
```

Expected: both exit `0`; retain exact test counts and any existing non-blocking build warning.

- [ ] **Step 2: Start the local Web/API environment**

Use the repository’s existing dev commands. Do not write or expose credentials. Confirm that an admin session is available before claiming protected-route browser coverage.

- [ ] **Step 3: Capture 1440px evidence**

Visit:

- `/system/code-rules`;
- `/system/model-config`.

Open the rule configuration and model configuration dialogs. Verify:

- title association and visible close control;
- initial focus;
- Escape closes;
- focus returns to the opener;
- header drag stays within viewport;
- save/cancel behavior remains unchanged.

Capture screenshots only from the current run.

- [ ] **Step 4: Capture 760px evidence**

At a 760px viewport, verify page scrolling, dialog maximum height, body scrolling, and reachable actions. Capture current-run screenshots.

- [ ] **Step 5: Write the QA record**

Record route, viewport, tested interaction, screenshot path, and result. If admin authentication or browser control is unavailable, write `blocked / 待回填` with the exact blocker and do not substitute static code inspection for rendered evidence.

### Task 7: Synchronize RP-043 governance and perform final verification

**Files:**
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/design.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/risks.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/sources.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/index.html`
- Create: `03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-25-wes-ui-quality-gate-implementation.json`

- [ ] **Step 1: Update the work item without overstating acceptance**

Change RP-043 to:

- `已实现 / 自动化通过 / 人工验收通过` only if fresh browser evidence exists;
- otherwise `已实现 / 自动化通过 / 人工待回填`.

Link the shared component, Skill, checker tests, product tests, build output, evaluation record, commit IDs, and source Issue.

- [ ] **Step 2: Update design, plan, test, monitoring, risk, change, and source ownership**

Record:

- the final shared Dialog API and fallback boundary;
- Skill RED/GREEN evidence;
- exact automated test/build results;
- rendered evidence or explicit browser blocker;
- closed/remaining risks;
- new plan, evaluation, QA, and Skill assets with accurate document counts.

- [ ] **Step 3: Add and validate the implementation board event**

The event status must match the least-complete acceptance dimension. Run:

```bash
node scripts/board-event-check.js \
  '03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-25-wes-ui-quality-gate-implementation.json'
node --test scripts/board-event.test.js scripts/board-work-items.test.js
```

Expected: event validation passes and `12` governance tests pass.

- [ ] **Step 4: Run final fresh verification**

Run:

```bash
python3 /Users/kevin/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/improving-wes-ui
node --test skills/improving-wes-ui/scripts/check-ui-scope.test.mjs
npm run test --prefix ui/V2_PROTOTYPE -- \
  src/__tests__/Dialog.test.jsx \
  src/__tests__/SystemManagementCodeRules.test.jsx \
  src/__tests__/SystemManagementDialogs.test.jsx \
  src/__tests__/SystemManagementKnowledgeBase.test.jsx
npm run test:web
npm run build:web
node scripts/board-event-check.js \
  '03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-25-wes-ui-quality-gate-implementation.json'
node --test scripts/board-event.test.js scripts/board-work-items.test.js
git diff --check
```

Expected: every command exits `0`. Report actual counts; do not infer unexecuted manual acceptance.

- [ ] **Step 5: Review the final diff against scope**

Confirm:

- no UI dependency additions;
- no changes outside the approved Skill, Dialog, System Management, tests, evaluation, governance, and registration files;
- unrelated dirty work remains untouched;
- `UserManagement`, `ApiKeys`, `ReviewDetail`, and `TraditionalHomeDashboard` dialogs were not migrated.
