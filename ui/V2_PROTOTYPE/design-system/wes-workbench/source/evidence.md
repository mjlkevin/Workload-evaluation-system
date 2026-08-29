# WES Workbench — Extraction Evidence

**Package:** `wes-workbench` · **Extracted:** 2026-08-28 · **Import mode:** normalized

This package is an **extraction from the WES (WorkEvolutionSys) workload-evaluation
frontend**, not an upstream/official brand kit. All token values are taken verbatim from
the live V2_PROTOTYPE stylesheet set, then bound to the Open Design shared token schema.

## Scanned Source Files

| File | Role in extraction |
|---|---|
| `ui/V2_PROTOTYPE/tokens.css` | Design facts of record: OKLCH palette, ink ramp, brand/highlight tiers, semantic pairs, chart ramp, fonts, radii, shadows, spacing, control metrics, layer indices |
| `ui/V2_PROTOTYPE/src/tailwind.css` | `@theme` bridging (OKLCH → semantic class names); confirms which variables are public API for new components |
| `ui/V2_PROTOTYPE/components.css` | Component conventions: 36px controls, button states, tag/badge pills, table styling, dialog/drawer patterns, transition timings and easing |
| `ui/V2_PROTOTYPE/layout.css` | App shell: sidebar widths, page header rhythm, gutters (28/20/16), container cap 1320px, responsive breakpoints |

## Method

1. Read every custom property in `tokens.css` (65 lines) — values copied without
   modification wherever the schema has a slot.
2. Bind schema slots to WES values (see `tokens.source.json` `bindings`); slots with no
   direct WES counterpart are aliased (`var()`) to the closest WES token rather than
   inventing new values.
3. Preserve WES-native vocabulary that the shared schema cannot express (brand ramp,
   amber highlight tier, soft semantic fills, chart ramp, elevation tiers, layer indices,
   control metrics) as C-extension tokens — 28 extensions registered under the
   `wes-workbench` brand whitelist in `BRAND_EXTENSIONS`.
4. Derive typography scale, motion timings, and gutter values from observed usage in
   `components.css` / `layout.css`; every derived value is flagged `"kind": "derived"`
   in `tokens.source.json`.

## Renames & Remaps

- Schema `--accent` ← WES **`--brand`** (indigo). WES's native amber `--accent` tier
  moves to the `--highlight*` extension names to avoid collision.
- WES `--ink / --ink-2 / --ink-3` ← `--fg / --fg-2 / --muted`; `--line` ← `--border`.
- WES `--space-7` (32px) → schema `--space-8`; WES `--space-8` (48px) → schema `--space-12`.
- WES `--shadow-1/2/3` → `--elev-raised` / `--elev-hover` / `--elev-floating`;
  `--shadow-focus` → `--focus-ring`.
- WES `--page-max-width` → `--container-max`; `--shell-radius` → `--radius-shell`.

## Known Exclusions

- `--ok-ink / --warn-ink / --err-ink`: saturated-ink text variants are guidance-only in
  this package; status badges ride the `*-soft` fill + base-color ink pair.
- `--teal / --teal-soft`: legacy pair with no active component role.
- `--kpi-radius`, `--surface-elevated`: duplicate values folded into existing tokens.

## Fidelity Statement

Every literal value in `tokens.css` of this package is either a verbatim copy from the
source files above or a documented `var()` alias / `color-mix()` derivation of one. No
color was re-imagined; no new hue introduced.
