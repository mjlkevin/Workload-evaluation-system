# WES Workbench Usage

Design System package guide for Open Design agents and reviewers.
Source: extracted from the WES workload-evaluation frontend
(`ui/V2_PROTOTYPE`: tokens.css, tailwind.css, components.css, layout.css).

## Read Order

1. Read this file first for the package contract and the schema↔WES name mapping.
2. Read `DESIGN.md` for visual intent, table conventions, and anti-patterns.
3. Paste `tokens.css` `:root` into the first artifact `<style>` block before writing component CSS.
4. Use `components.manifest.json` for the compact component inventory; open `components.html` when exact selectors or states matter.
5. Inspect `preview/` pages (colors, typography, spacing, components) for a visual sanity check.
6. Consult `source/tokens.source.json` when you need to trace a binding back to the original WES token.

Key mapping to remember: shared `--accent` = WES **brand indigo**; WES's native
amber accent tier lives under `--highlight*`; WES `--ink/ink-2/ink-3` = `--fg/--fg-2/--muted`;
WES `--line` = `--border` (the stronger `--line-2` stays an extension).

## Design Highlights

- Canvas `oklch(0.985 0.004 250)` · Surface `#FFFFFF` · Ink `oklch(0.21 0.03 260)`
- Brand indigo `oklch(0.42 0.14 262)` — primary CTAs, links, focus, active tabs
- Amber highlight `oklch(0.69 0.18 45)` — at most one visible use per screen
- Status = soft-fill + saturated-ink pill pairs (`--success-soft`/`--success`, etc.)
- 36px controls & table rows · 14px body baseline · mono uppercase micro-labels · tabular nums everywhere
- Dark-navy app-shell sidebar (208px → 64px icon rail)

## Do

- Preserve the shared schema token names exactly so cross-brand switching stays reliable.
- Use the WES extension tokens (`--brand-*`, `--highlight-*`, `--*-soft`, `--chart-*`, `--layer-*`, `--control-height`, `--table-row-height`, `--radius-shell`) for WES-faithful workbench UI.
- Bind hover states to `--brand-ink` / `--highlight-ink` values, never brightness filters.
- Keep numbers in `--font-mono` with `tabular-nums`; labels uppercase mono with tracking.
- Reuse component groups from `components.manifest.json` before inventing new controls.

## Avoid

- Avoid raw hex/oklch values outside the copied `:root` token block.
- Avoid redefining Tailwind or design-token values independently of `tokens.css` (`tailwind-v4.css` is derived, never hand-edited).
- Avoid using `--highlight` (amber) for semantic warning states — warnings use `--warn`.
- Avoid claiming upstream/official brand assets; this package is an extraction from the WES codebase (see `source/evidence.md`).
- Avoid marketing-style looseness in workbench contexts: no body text under 12.5px, no rows taller than needed.
