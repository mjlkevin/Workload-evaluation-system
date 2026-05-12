# PB-R3 Smoke Test Batch B — Mock Data Quality + Component Consistency + Accessibility/UX Audit

**Date:** 2026-05-10  
**Tester:** ChatGPT (Smoke Batch B)  
**Scope:** ui/V2_PROTOTYPE — all 18 pages, mock data, component patterns, a11y/UX  
**Build:** ✓ PASS (Vite v5.4.21, ~345k JS / 17.5k CSS)

---

## Executive Summary

| Category | Items Checked | Severe | Mild | Notes |
|----------|--------------|--------|------|-------|
| Mock Data Quality | 5 data sets + derived totals | 0 | 1 | HomePage KPI static vs dynamic |
| Component Consistency | PageShell, VCS toolbar, Dialogs, bdg | 0 | 3 | VCS inconsistency, Dialog ×, bdg modifiers |
| Accessibility / UX | buttons, labels, aria, color-only info | 0 | 3 | Missing type/button, no aria-labels, color-only status |
| **Total** | — | **0** | **7** | All functional; mild debt only |

**Verdict: PASS** — No blockers. 7 mild consistency/a11y items noted for Phase B cleanup.

---

## 1. Mock Data Quality

### 1.1 listData.js Row Counts

| Array | Rows | Consumer Pages |
|-------|------|----------------|
| `assessments` | 6 | AssessmentList, AssessmentDetail |
| `requirements` | 3 | RequirementList, RequirementDetail |
| `devAssessments` | 2 | DevAssessmentList, DevAssessmentDetail |
| `resourceCosts` | 2 | ResourceCostList, ResourceCostDetail |
| `reviews` | 3 | ReviewList, ReviewDetail |
| `wbsItems` | 3 | WbsList |
| `historyItems` | 8 | HistoryList, HistoryDetail |

**Result:** ✓ All arrays non-empty. Minimum 2 rows per detail page — sufficient for smoke testing.

### 1.2 Derived Total Consistency

| Page | Derived Value | Source | Match |
|------|--------------|--------|-------|
| RequirementDetail | `summary.mandays = 230` | `solutionRows` sum: 45+60+40+55+30 = 230 | ✓ |
| ResourceCostDetail | `totalDays = 186` | `monthTotals` sum: 51+58+45+26+6 = 186 | ✓ |
| ResourceCostDetail | `monthTotals[]` | Per-column `reduce()` over `groups[].rows[].months[]` | ✓ |

**Result:** ✓ All derived totals match source data.

### 1.3 Static vs Dynamic KPI

| Location | Issue | Severity |
|----------|-------|----------|
| HomePage `KPI_DATA` | "方案数 12" is hardcoded; `PLANS` array has only 6 items | Mild |

**Note:** KPI cards are intentionally static mock summaries (not bound to `PLANS`). Acceptable for Phase A prototype, but noted as tech debt for Phase B when KPI should derive from real API.

---

## 2. Component Consistency

### 2.1 PageShell / ListPage Wrapping

| Pattern | Pages | Count |
|---------|-------|-------|
| Direct `PageShell` import | HomePage, AssessmentDetail, RequirementDetail, DevAssessmentDetail, ResourceCostDetail, ReviewDetail, HistoryDetail, SystemManagement, UserManagement, ApiKeys | 10 |
| Via `ListPage` (wraps `PageShell` internally) | AssessmentList, DevAssessmentList, RequirementList, ResourceCostList, ReviewList, WbsList, HistoryList | 7 |
| **Not wrapped** | Login (standalone centered layout) | 1 |

**Result:** ✓ 17/18 pages wrapped in `PageShell` or `ListPage`. Login is intentionally standalone.

### 2.2 VCS Toolbar Consistency

Pages with VCS/action bars in `PageShell actions={...}`:

| Page | Buttons Present | Notes |
|------|-----------------|-------|
| **HomePage** | 历史, 检出, 检入, 撤销, 升版, 解锁, 删除 | Standard 7-button VCS spec |
| **RequirementDetail** | Kimi-help, 历史, 升版, 检入, 撤销, 检出, 解锁, 导出, 保存 | 9 buttons; Kimi dropdown + full VCS |
| **ResourceCostDetail** | 历史, 升版, 检入, 撤销, 检出(disabled), 解锁, 导出, 保存版本 | 8 buttons; order differs from standard |
| **AssessmentDetail** | 历史, 导出, 签入 | 3 buttons; no VCS checkout/undo/promote |
| **DevAssessmentDetail** | role select, AI生成, 导出 CSV, 合并到实施评估, 保存 | 5 buttons; custom dev workflow |
| **ReviewDetail** | 跳转方案, 驳回, 通过 | 3 buttons; review-specific |
| **HistoryDetail** | 克隆此方案为新评估 | 1 button |
| **SystemManagement** | 提示词, 测试, 保存 | 3 buttons; admin config |
| **UserManagement** | *(empty `actions={[]}`)* | Batch actions inline in page body |
| **ApiKeys** | *(empty `actions={[]}`)* | Actions inline in page body |

**Finding (Mild):** ResourceCostDetail VCS toolbar order/presence differs from RequirementDetail (e.g., "保存版本" vs "保存", emoji vs text-only). Not functional, but inconsistency in mock button labels should be aligned in Phase B.

### 2.3 Dialog Pattern Consistency

| Page | Dialog Helper | Has backdrop click close | Has × button in header |
|------|--------------|--------------------------|------------------------|
| HomePage | `DialogShell` | ✓ | ✓ |
| ApiKeys | `DialogBackdrop` + `DialogCard` | ✓ | ✗ |
| RequirementDetail | `DlgBack` + `DlgCard` | ✓ | ✗ |
| ReviewDetail | `DialogBackdrop` + `DialogCard` | ✓ | ✗ |
| SystemManagement | `DialogBackdrop` + `DialogCard` | ✓ | ✗ |
| UserManagement | `DialogBackdrop` + `DialogCard` | ✓ | ✗ |

**Finding (Mild):** Only HomePage's `DialogShell` includes a visual × close button in the header. All other dialogs rely solely on backdrop click or "取消" button. Recommend adding consistent × close to `DialogCard` header for UX parity.

### 2.4 Badge (`bdg`) Modifier Legitimacy

Per `components.css`, valid `bdg` modifiers: `.draft`, `.rev`, `.ci`, `.co`, `.lock`

| Modifier | Found In | Valid? |
|----------|----------|--------|
| `ok` | ApiKeys, AssessmentDetail, DevAssessmentDetail, HistoryDetail, HomePage, RequirementDetail, ResourceCostDetail, ReviewDetail, UserManagement | ✓ (implicit — base `.bdg` + no modifier yields default ink style; used with inline `style` override) |
| `ci` | DevAssessmentDetail, HistoryDetail, HomePage, RequirementDetail, ResourceCostDetail, ReviewDetail | ✓ |
| `co` | AssessmentDetail, HomePage, RequirementDetail, ResourceCostDetail | ✓ |
| `draft` | ApiKeys, HomePage, RequirementDetail, SystemManagement, UserManagement | ✓ |
| `rev` | DevAssessmentDetail, HomePage | ✓ |
| `lock` | *(not used)* | — |
| **`muted`** | **AssessmentDetail.jsx:145,161** | **✗ INVALID** — not defined in `components.css` |
| **`brd`** | **UserManagement.jsx:139** | **✗ INVALID** — `tag.brd` exists, but `bdg.brd` does not |

**Finding (Mild):** Two invalid modifiers:
- `bdg muted` in AssessmentDetail (×2) — silently falls back to base `.bdg` style; works because inline `style` overrides provide the intended muted look.
- `bdg brd` in UserManagement (`sub_admin` role chip) — `brd` is a `tag` modifier, not `bdg`. Falls back to base style; inline `style` not present for this branch, so dot color may be wrong.

**Fix:** Add `.bdg.muted` and `.bdg.brd` to `components.css`, or switch to inline-only styling.

---

## 3. Accessibility / UX Audit

### 3.1 Buttons Missing `type="button"`

| Page | `<button>` count | `type="button"` count | Missing |
|------|-----------------|----------------------|---------|
| ApiKeys | 7 | 0 | 7 |
| AssessmentDetail | 7 | 0 | 7 |
| AssessmentList | 2 | 0 | 2 |
| DevAssessmentDetail | 7 | 0 | 7 |
| DevAssessmentList | 2 | 0 | 2 |
| HistoryDetail | 2 | 0 | 2 |
| HistoryList | 2 | 0 | 2 |
| HomePage | 7 | 0 | 7 |
| Login | 2 | 0 | 2 (has `type="submit"` ✓) |
| RequirementDetail | 18 | 0 | 18 |
| RequirementList | 2 | 0 | 2 |
| ResourceCostDetail | 18 | 4 | 14 |
| ResourceCostList | 2 | 0 | 2 |
| ReviewDetail | 13 | 0 | 13 |
| ReviewList | 2 | 0 | 2 |
| SystemManagement | 15 | 0 | 15 |
| UserManagement | 9 | 0 | 9 |
| WbsList | 2 | 0 | 2 |
| **Total** | **119** | **4** | **115** |

**Finding (Mild):** 115/119 buttons lack explicit `type="button"`. In React this is technically fine (default is `submit`, but most are outside `<form>`), yet explicit typing is required by our a11y guidelines. ResourceCostDetail has 4 correct ones (tab switches).

**Fix:** Bulk add `type="button"` to all non-submit buttons.

### 3.2 Labels & ARIA

| Check | Count | Result |
|-------|-------|--------|
| `aria-label` on inputs/buttons | 0 | ✗ Missing |
| `aria-labelledby` | 0 | ✗ Missing |
| `<label htmlFor="...">` | 0 | ✗ Missing |
| Search inputs with placeholder-only label | 6 pages | ⚠ Placeholder is not a replacement for `<label>` |

**Affected pages:** ApiKeys (search), DevAssessmentDetail (search), HomePage (filter tags), Login (username/password), SystemManagement (search), UserManagement (search).

**Finding (Mild):** No formal labels or ARIA attributes. Search boxes rely on placeholder text. Not a functional blocker for Phase A, but must be addressed for WCAG compliance in Phase B.

### 3.3 Color-Only Information

| Page | Element | Color Signal | Text Alternative | OK? |
|------|---------|-------------|------------------|-----|
| AssessmentDetail diff | before/after values | `var(--err)` / `var(--ok)` | "上调" / "下调" label | ✓ |
| AssessmentDetail DSL | rule type | `var(--err-soft)` / `var(--warn-soft)` | "阻断" / "警告" text | ✓ |
| ApiKeys | status | `var(--err)` (revoke) / `var(--ink-3)` | "active"/"revoked" text + bdg | ✓ |
| ReviewDetail | checklist status | `var(--ok)` / `var(--ink-3)` | "通过" / "待审" text | ✓ |
| SystemManagement | model status | `var(--ok)` / `var(--err)` | "online" / "offline" text | ✓ |
| SystemManagement | DSL type | `var(--err)` / `var(--warn-ink)` | "阻断" / "警告" text | ✓ |
| UserManagement | batch delete btn | `var(--err)` | Button text "删除" | ✓ |

**Result:** ✓ All color-coded states have adjacent text labels. No color-only information issues found.

---

## 4. Legacy Color Debt (Noted, No Action)

| File | Hardcoded Color | Context |
|------|-----------------|---------|
| `ProjectIdentityCard.jsx` | legacy hex | Phase A component |
| `KpiCards.jsx` | legacy hex | Phase A component |
| `PathBreadcrumb.jsx` | legacy hex | Phase A component |

**Note:** Already documented in Smoke Batch A. These are Phase A shared components outside the PB-R3 scope. Marked for Phase B token migration.

---

## 5. Route Registration Sanity Check

| Route | Page | Wrapped in PageShell/ListPage? |
|-------|------|-------------------------------|
| `/` | HomePage | ✓ |
| `/login` | Login | ✗ (standalone) |
| `/assessments` | AssessmentList | ✓ (via ListPage) |
| `/assessments/:id` | AssessmentDetail | ✓ |
| `/requirements` | RequirementList | ✓ (via ListPage) |
| `/requirements/:id` | RequirementDetail | ✓ |
| `/dev-assessments` | DevAssessmentList | ✓ (via ListPage) |
| `/dev-assessments/:id` | DevAssessmentDetail | ✓ |
| `/resource-costs` | ResourceCostList | ✓ (via ListPage) |
| `/resource-costs/:id` | ResourceCostDetail | ✓ |
| `/reviews` | ReviewList | ✓ (via ListPage) |
| `/reviews/:id` | ReviewDetail | ✓ |
| `/wbs` | WbsList | ✓ (via ListPage) |
| `/history` | HistoryList | ✓ (via ListPage) |
| `/history/:id` | HistoryDetail | ✓ |
| `/system` | SystemManagement | ✓ |
| `/users` | UserManagement | ✓ |
| `/api-keys` | ApiKeys | ✓ |

**Result:** ✓ All 18 routes registered. 17 wrapped in shell; Login intentionally free-standing.

---

## 6. Recommendations (Phase B)

| # | Item | Priority | Effort |
|---|------|----------|--------|
| 1 | Add `type="button"` to all 115 non-submit buttons | Low | 5 min sed |
| 2 | Add `<label>` or `aria-label` to all search inputs | Medium | 15 min |
| 3 | Unify VCS toolbar button order/labels across detail pages | Low | 10 min |
| 4 | Add × close button to all `DialogCard` headers | Low | 10 min |
| 5 | Add `.bdg.muted` and `.bdg.brd` to `components.css` | Low | 5 min |
| 6 | Make HomePage KPI derive from `PLANS` length | Low | 5 min |

---

## Sign-off

**Batch B Result: PASS**  
No severe issues. 7 mild items — all cosmetic or a11y debt, no functional impact. Ready for Phase B polish.
