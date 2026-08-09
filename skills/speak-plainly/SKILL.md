---
name: speak-plainly
description: Use when giving task updates, findings, recommendations, risk or decision explanations, handoffs, or final answers to product managers, business users, stakeholders, or mixed technical and nontechnical audiences, especially when jargon, internal process language, or robotic phrasing could make the response hard to understand.
---

# Speak Plainly

## Overview

Help the reader understand the outcome and act without translating implementation details: facts exact, practical meaning first, next action obvious and doable now.

## Core Pattern

| Reader needs | Provide |
|---|---|
| Outcome | What changed or needs a decision |
| Impact | Meaning for users, risk, delivery |
| Status | Completion level (defined below) |
| Evidence | Exact paths, commands, metrics, errors, after meaning is clear |
| Next move | Next action or decision |

A thinking order, not a template.

## Write for the Reader

1. Lead with the answer, result, impact, or decision; commands, paths, or snippets go first.
2. Describe visible behavior before internal architecture.
3. Replace avoidable jargon; keep exact terms with their purpose in parentheses.
4. Remove tool diaries, ceremonial updates, acronym clusters, and disclaimers.
5. Match depth to the request; one plain-language conclusion before technical evidence.
6. Never report bare task codes: every code carries its theme in parentheses on first appearance.

## Shape for Action

1. Number multi-step work; one bounded action per step, minimum steps.
2. End with one concrete next action doable now.
3. Restate current state each turn (step 3 of 5, what remains).
4. Suppress tangents; finish one topic before offering the next.
5. Give concrete estimates (15 minutes, never some work).
6. Show completed wins concretely; never bury them in recaps.
7. Cap lists at five items; split larger ones into now versus later.
8. No preamble, recap, or closing pleasantries; state errors matter-of-factly.

When a rule fights the task or a safety confirmation, the constraint wins and the shape stays.

## State Progress Precisely

Do not collapse completion levels:

- **Planned:** agreed or scheduled, not started.
- **In progress:** started, outcome not established.
- **Implemented:** change exists, verification may remain.
- **Automated checks passed:** named checks succeeded; human acceptance is separate.
- **Human acceptance completed:** user or reviewer confirmed the result.
- **Blocked:** needs a decision, missing input, or external change.

Never turn implemented into delivered, or checks passed into users accepted it.

## Preserve Protected Content

Never paraphrase code, commands, API names, paths, identifiers, quotes, logs, or raw errors; explain them outside protected content. This skill changes task communication, not source artifacts.

## Example

**Before:** "The schema migration passed, rollback was not triggered, and the API smoke test is green."

**After:** "Data is now in the new storage structure and the connection check passed; user acceptance remains. Next: run the acceptance checklist."

## Common Mistakes

| Temptation | Correction |
|---|---|
| "Evidence speaks for itself." | Explain why it matters, then show it. |
| "Exact term cannot be removed." | Keep it and add its plain meaning. |
| "Fixed format is consistent." | Prefer natural prose unless structure helps. |
| "Tests passed, so done." | Name the verified layer and what remains. |

## Before Sending

- Can a nontechnical reader explain the outcome from the opening?
- Are unavoidable terms explained without hiding exact evidence?
- Are planned, implemented, verified, accepted, and blocked states accurate?
- Reading only the first and last lines, does the reader know what to do next and what happened?

Red flags: tool-first openings, unexplained acronyms, bare task codes, vague claims, vague estimates, buried wins.
