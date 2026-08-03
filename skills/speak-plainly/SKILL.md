---
name: speak-plainly
description: Use when giving task updates, findings, recommendations, risk or decision explanations, handoffs, or final answers to product managers, business users, stakeholders, or mixed technical and nontechnical audiences, especially when jargon, internal process language, or robotic phrasing could make the response hard to understand.
---

# Speak Plainly

## Overview

Help the reader understand the outcome and act without translating implementation details. Keep facts exact while making practical meaning primary.

## Core Pattern

| Reader needs | Response should provide |
|---|---|
| Outcome | What changed, was learned, or needs a decision |
| Impact | What it means for users, risk, or delivery |
| Status | Whether it is planned, in progress, implemented, automatically checked, accepted by a human, or blocked |
| Evidence | Exact names, paths, commands, metrics, and errors after their meaning is clear |
| Next move | The next action, decision, or remaining risk |

Use this as a thinking order, not a mandatory template. Add structure only when it improves a comparison, sequence, or decision.

## Write for the Reader

1. Lead with the answer, result, impact, or decision the reader cares about most.
2. Describe visible behavior and consequences before internal architecture.
3. Replace avoidable jargon. When an exact term matters, explain its purpose and keep the term in parentheses or later evidence.
4. Use clear actors and actions. Remove tool diaries, ceremonial updates, acronym clusters, and irrelevant disclaimers.
5. Match depth to the request. For technical detail, give one plain-language conclusion before precise evidence.

## State Progress Precisely

Do not collapse different levels of completion:

- **Planned:** agreed or scheduled, not started.
- **In progress:** work has started, outcome not yet established.
- **Implemented:** the change exists, but may still need verification.
- **Automated checks passed:** named checks succeeded; human acceptance is separate.
- **Human acceptance completed:** a user or reviewer confirmed the result.
- **Blocked:** progress needs a decision, missing input, or external change.

Never turn “implemented” into “delivered,” or “checks passed” into “users accepted it.”

## Preserve Protected Content

Do not paraphrase code, commands, API names, paths, identifiers, quotes, logs, or raw errors when exactness matters. Explain them outside protected content. This skill changes task communication, not source artifacts unless explicitly requested.

## Example

**Before:** “The schema migration passed, rollback was not triggered, and the API smoke test is green.”

**After:** “Existing data is in the new storage structure, and the connection check passed. Automated verification is complete, but user acceptance remains. Evidence: schema migration passed; rollback was not triggered; API smoke test passed.”

## Common Mistakes

| Temptation | Correction |
|---|---|
| “The evidence speaks for itself.” | Explain why it matters, then show it. |
| “The exact term cannot be removed.” | Keep it and add its plain meaning. |
| “A fixed format is consistent.” | Prefer natural prose unless structure improves comprehension. |
| “Tests passed, so it is done.” | Name the verified layer and what remains. |

## Before Sending

- Does the opening answer the reader’s immediate question?
- Can a nontechnical reader explain the outcome and impact?
- Are unavoidable terms explained without hiding exact evidence?
- Are planned, implemented, verified, accepted, and blocked states accurate?
- Does the response sound natural rather than generated from a rigid template?

Red flags: tool-first openings, unexplained acronyms, vague completion claims, fixed headings, or evidence with no practical meaning.
