# WES Workbench

> Category: Productivity & SaaS
> Dense, calm blue-gray workbench for data-heavy business operations —
> extracted from the WES (WorkEvolutionSys) workload-evaluation frontend
> (ui/V2_PROTOTYPE). Use for admin consoles, assessment dashboards, tables,
> and multi-tab business workbenches.

## Visual Theme & Atmosphere

Calm, precise, data-first. A blue-gray OKLCH canvas with white cards, a
single restrained indigo brand color, and one amber highlight tier reserved
for emphasis. Chrome is quiet: 1px hairline borders, whisper shadows, and
whitespace doing the separating. The app shell pairs a dark-navy sidebar
with a light content canvas — the dark rail frames the work, never competes
with it. Density is intentional: 36px controls and table rows, mono-font
micro-labels, and tabular numerals throughout. No gradients on content
surfaces (the one sanctioned exception is the brand-fill KPI tile).

## Color Palette & Roles

- **Canvas:** `--bg` oklch(0.985 0.004 250); sub-canvas `--bg-2`; soft fill `--bg-soft`
- **Surface:** `--surface` #FFFFFF — cards, dialogs, tables
- **Ink ramp:** `--fg` oklch(0.21) primary · `--fg-2` oklch(0.42) secondary · `--muted` oklch(0.62) captions
- **Brand / accent:** `--accent` = oklch(0.42 0.14 262) indigo — primary CTAs, links, active tabs, focus. Hover is `--brand-ink`, never a filter trick.
- **Highlight tier:** `--highlight` amber oklch(0.69 0.18 45) — at most one visible amber moment per screen (a checked-out state, a key metric), paired with `--highlight-ink` text and `--highlight-soft` fill
- **Borders:** `--border` hairline; `--line-2` is the stronger control border (inputs, outline buttons) — do not soften it
- **Semantic:** `--success` / `--warn` / `--danger` for state only, each with a `*-soft` fill for tags and rows; `--info` + `--info-soft` for neutral notices
- **Charts:** `--chart-1…5` — indigo, amber, cyan, green, violet; keep this order

Status colors ride soft-fill + saturated-ink pairs (e.g. `--success-soft`
background, `--success` text/dot) rather than solid color blocks. Keep total
semantic pixels under ~5% of any screen.

## Typography Rules

- **Body & display:** `'Inter', 'Noto Sans SC', system-ui, -apple-system, sans-serif` — Noto Sans SC is required for CJK copy; never drop it
- **Mono:** `'JetBrains Mono', ui-monospace, monospace` — all numbers, codes, version tags, table headers, and eyebrow labels
- **Scale (px):** 11.5 · 12.5 · 14 · 16 · 18 · 20 · 28 · 32 (dense workbench fit; 14px is the body baseline, not 16px)
- **Line-height:** 1.6 body, 1.3 headings; KPI numbers may drop to ~1.05
- **Letter-spacing:** -0.01em on display sizes ≥20px; +0.06–0.08em with uppercase transform for mono micro-labels (field labels, table headers, KPI captions)
- **Numbers:** always `font-variant-numeric: tabular-nums` in tables and KPIs

## Data & Table Conventions

Tables are the product's center of gravity:

- Container: white, 1px `--border`, `--radius-lg` corners, overflow hidden; sticky header
- Header row: `--bg-soft` fill, 11px mono uppercase, tracking +0.06em, `--muted` color
- Rows: 36px tall, 12.5px text, bottom hairline; hover tints `--bg-soft`
- Numeric cells right-aligned mono with tabular nums; computed values `--accent` + weight 600
- Group rows: uppercase mono on `--bg`; totals row: soft brand gradient fill
- Selected row: `--brand-soft` fill + inset 2px `--brand` bar on the first cell
- Error/locked rows tint with `--danger-soft`
- Status everywhere uses pill badges: 22px tall, `--radius-pill`, mono 11.5px, soft-fill + ink pairs with a 6px status dot

## Component Stylings

- **Buttons:** height `--control-height` (36px), `--radius-md`, 13px/600 label. Primary = indigo fill, white label, soft brand shadow; hover lifts 1px and darkens to `--brand-ink`. Secondary = white fill, `--line-2` border; hover swaps border+text to brand. Ghost = transparent; danger = white/red-outline flipping to solid on hover. Small sizes: 28px/24px with tighter radius.
- **Inputs:** 36px height, 1px `--line-2`, `--radius-md`; focus = brand border + `--focus-ring`; readonly fills `--bg-soft`
- **Tags / badges:** pill, mono, soft-fill + ink pairs (see status palette); badges carry a status dot
- **KPI tiles:** white, 1px hairline, `--radius-lg`, 16px padding, `--elev-raised`; caption is 11px uppercase mono, number 28px/800 tabular; the featured tile uses the brand gradient fill with white text
- **Cards & sections:** `--surface` + hairline + `--radius-shell` (18px) for page sections, `--radius-lg` for inner cards; header/body/footer separated by hairlines, footer fills `--bg-soft`
- **Dialogs & drawers:** `--radius-shell`, `--elev-floating`, 32% ink backdrop; header is a drag handle (cursor: grab); sticky footer action bar on `--bg-soft`; drawers are 440px right-anchored, full-width on phone
- **Tabs:** workspace tabs 28px with brand-soft active fill + inset 2px bottom bar; detail-page tabs use 2px underline in brand color

## Layout Principles

- **App shell:** 208px dark-navy sidebar (`#0A1124 → #10182F` gradient) + fluid content column; sidebar collapses to 64px icon rail at ≤1180px
- **Workspace tab strip:** sticky, translucent white with blur, below the shell top
- **Page header:** mono breadcrumb, then 20px H1, actions pushed right
- **Content cap:** `--container-max` 1320px; gutters 28/20/16px
- **Grids:** 2/3/4-column equal grids at 16px gaps; collapse to 2 at ≤1180px, 1 at ≤760px; card walls use `auto-fill minmax(290px, 1fr)`
- Separators: hairlines and whitespace; never heavy rules between related content

## Depth, Elevation & Layering

Three shadows + one ring, no more:

- `--elev-flat` default · `--elev-ring` hairline-as-shadow · `--elev-raised` cards & tiles
- `--elev-hover` (extension) card hover lift · `--elev-floating` (extension) dialogs, drawers, menus
- Stacking: tabs 30 · `--layer-float` 40 (toasts, indicators) · `--layer-drawer` 50 · `--layer-modal` 60
- No glassmorphism, no neumorphism; the only blur is the workspace tab strip backdrop

## Motion & Interaction

- Durations: `--motion-fast` 120ms (micro states), `--motion-base` 150ms (default); nothing slower without a reason
- Easing: `--ease-standard` cubic-bezier(0.4, 0, 0.2, 1); nav collapse may stretch to 250ms with the same curve
- Hover language: buttons lift `translateY(-1px)`; cards deepen border + shadow; rows tint
- Dialog/drawer entrance: opacity + short translate; never `scale(0)`
- Honor `prefers-reduced-motion`: drop transforms and transitions, keep state changes instant

## Accessibility

- Every interactive control gets a visible `:focus-visible` using `--focus-ring` (box-shadow form, no layout shift)
- Ink levels are chosen for contrast: body text `--fg` on `--bg`/`--surface` exceeds 12:1; secondary `--fg-2` exceeds 7:1; `--muted` is reserved for ≥11.5px non-essential labels
- Status meaning never rides on color alone: badges pair a dot + text label; table errors pair tint + message
- Dialogs are real `<dialog>` semantics with title/description, ESC close, and a drag handle that never traps keyboard focus
- Semantic status colors are never used as decoration

## Do's and Don'ts

- ✅ Let hairlines and whitespace separate; shadows only for lift
- ✅ One brand-indigo focus per screen; amber appears at most once
- ✅ Mono + uppercase + tracking for every micro-label; tabular nums for every number
- ✅ Status = soft fill + saturated ink + dot, always as a pill
- ❌ No raw colors outside the `:root` token block — if a value is missing, surface a warning and use the nearest token
- ❌ No gradient fills on content surfaces (single exception: featured KPI tile)
- ❌ No border-radius mixing beyond the six radius tokens
- ❌ No body text under 12.5px; no table cells under 11px mono
- ❌ Do not darken brand with a brightness filter for hover — use `--brand-ink`

## Agent Prompt Guide

- Default to density over airiness: 36px rows, 12.5–14px text, hairline cards.
- Paste `tokens.css` `:root` verbatim into the first `<style>`; then only `var(--…)` references.
- Reach for the extensions (`--brand-*`, `--highlight-*`, `--*-soft`, `--chart-*`, `--layer-*`, `--control-height`) when building WES-faithful workbench UI; stay on the shared schema names when the artifact must stay brand-portable.
- Structure pages as: dark sidebar → workspace tabs → page header (crumb + H1 + actions) → KPI/section cards → tables.
- When a request implies marketing/hero layouts, keep the palette but relax density; do not invent new hues.
