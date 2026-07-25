# Upstream Provenance and WES Overrides

## Pinned source

- Repository: `https://github.com/ibelick/ui-skills`
- Reviewed commit: `ae74b58e722abe7ddf5948e07dd220808acce8a9`
- License: MIT
- Adopted sources: `improve-ui`, `fixing-accessibility`, `fixing-motion-performance`, and a cropped subset of `baseline-ui`

This project-local Skill adopts evidence discipline, accessibility checks, bounded UI review, and motion-cost awareness. It does not install or execute the upstream CLI at runtime.

## WES overrides

These project decisions override conflicting upstream defaults:

| Upstream source/default | WES override |
|---|---|
| Tailwind-oriented styling | Use `ui/V2_PROTOTYPE/tokens.css` and the existing shared CSS files |
| Mandatory `cn` helper | Keep current `className` and shared-class conventions |
| Motion for JavaScript animation | Prefer existing CSS; evaluate a dependency only through a separately approved architecture decision |
| Base UI or Radix primitives | Prefer existing WES components and browser-native semantics; a new UI dependency needs explicit user authority |
| Broad baseline restyling | Limit a run to one business surface and at most three confirmed root issues |
| Static heuristics treated as actionable UI problems | Classify them as candidates until current rendered evidence confirms impact |
| Fixed bans on gradients or letter spacing | Preserve patterns already authorized by WES tokens or a current design contract |
| Upstream-only `design-plans/` workflow | Use WES Issue-first intake, approved spec/plan, TDD, verification, and total command-board synchronization |
| Generic greenfield component guidance | Keep Vite + React 18, API behavior, permissions, and business owners unchanged unless separately authorized |
| Tool output as completion proof | Require runtime reachability, current browser evidence for visual claims, focused tests, full regression checks, and traceable governance evidence |

## Update rule

Never track the upstream default branch implicitly. An upstream refresh requires:

1. a new exact commit hash;
2. license and source review at that commit;
3. a diff of adopted rules against the pinned commit above;
4. explicit review of every conflict with current WES architecture and governance;
5. updated RED/GREEN evaluation evidence before adoption;
6. a reviewed update to this provenance record.

Until those steps are complete, the pinned commit and WES overrides in this file remain authoritative.
