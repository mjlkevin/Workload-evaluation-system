# WES Board Events

Board events are structured process facts for the WES command board.

Use them when Codex, Qoder, or another approved agent finishes a requirement intake, implementation, verification, risk update, source-asset update, or process-governance change.

The event file is not a replacement for the visible board. It is the low-cost input that scripts use to update the visible board pages.

## Workflow

1. Copy `template.board-event.json` to `YYYY-MM-DD-<slug>.json`.
2. Fill in the required fields.
3. Run `node scripts/board-event-check.js <event.json>`.
4. Run `node scripts/board-event-apply.js <event.json>` when Codex/user authority allows board updates.
5. Run `node --test scripts/board-event.test.js scripts/board-work-items.test.js`.

## Required Fields

| Field | Meaning |
|---|---|
| `id` | Stable id, `BE-YYYY-MM-DD-slug`. |
| `date` | Exact event date, `YYYY-MM-DD`. |
| `type` | `requirement_intake`, `implementation`, `verification`, `risk`, `source_asset`, `loop_cleanup`, or `process_change`. |
| `scope` | Short board-facing scope. |
| `summary` | One concise factual summary. |
| `status` | Current WES status. Do not mark manual acceptance or CI as passed without evidence. |
| `pages` | Board modules affected. Current auto-apply supports `changes` and `testing`; other pages stay as explicit sync recommendations until their generators are added. |
| `evidence` | File, command, handoff, gate, or artifact evidence. |
| `next` | Remaining manual acceptance, integration, rework, or follow-up. |

## Boundaries

- Do not store API keys, tokens, cookies, private keys, raw production logs, or passwords in event files.
- Do not use an event to mark delivery if user/Codex acceptance is still pending.
- Qoder may recommend a board event in handoff, but Codex/user authority decides whether to apply it.
- `requirements.html` multi-region generation is intentionally not automated in this MVP; requirement intake still needs Codex review until that generator exists.
