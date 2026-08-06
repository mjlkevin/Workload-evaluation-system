---
name: wes-code-review
description: >-
  Use when reviewing code changes in the WorkEvolutionSys repository before merge,
  after feature implementation, when evaluating another agent's handoff, or when
  refactoring existing code. Triggers: "code review", "审查代码", "review PR",
  "检查质量", "代码质量", "review this change", "handoff review", "peer audit".
---

# WES Code Review & Quality

## Overview

Multi-dimensional code review with quality gates for the WorkEvolutionSys repository. Every change gets reviewed before merge — no exceptions.

The approval standard: **Approve a change when it definitely improves overall code health, even if it isn't perfect.** Perfect code doesn't exist — the goal is continuous improvement.

## Required Context

Before reviewing, read from the project root:

1. `AGENTS.md` — architecture boundaries and conventions
2. `codex-project-registry.md` — project entry and verification commands
3. The change diff (from handoff, PR, or `git diff`)
4. Related tests and build output

## WES-Specific Conventions

### Architecture Boundaries

| Layer | Rules |
|-------|-------|
| Frontend | `ui/V2_PROTOTYPE` only; Vite + React; no Tailwind/Radix/MUI unless explicitly approved |
| Backend | `apps/api` only; Express + modules pattern; new routes in `routes/*` aggregated in `routes/index.ts` |
| Storage | JSON config files for legacy modules; PostgreSQL for Harness only; no new DB migrations without trigger |
| Auth | JWT `Authorization: Bearer` only; no `X-Role` fallback; roles: `admin` \| `user` |

### Module Pattern (21 domains migrated)

```
modules/<domain>/
  <domain>.module.ts      # Barrel export
  <domain>.controller.ts  # Route handlers
  <domain>.usecase.ts     # Business logic
  <domain>.repository.ts  # Data access
  <domain>.types.ts       # Domain types
```

Review checks:
- [ ] Controller thin — only HTTP concern
- [ ] Usecase contains business logic
- [ ] Repository handles data access (JSON or DB)
- [ ] No cross-domain imports except via module barrel

### Response Envelope

```typescript
// Required structure
{ code: number, message: string, data: T }
```

Review checks:
- [ ] All API responses follow this envelope
- [ ] `code === 0` for success
- [ ] Consistent error codes across domains

## The Five-Axis Review

### 1. Correctness

Does the code do what it claims to do?

- [ ] Matches the spec or task requirements (check RP/Work Order)
- [ ] Edge cases handled (null, empty, boundary values)
- [ ] Error paths handled (not just the happy path)
- [ ] Tests exist and cover the change
- [ ] No off-by-one errors, race conditions, or state inconsistencies

WES-specific:
- [ ] Version state transitions correct (`checked_in` → `checked_out` → `checked_in`)
- [ ] JWT expiry handled gracefully (401 → re-login)
- [ ] Excel parsing handles malformed files
- [ ] AI API fallback works when Kimi is unavailable

### 2. Readability & Simplicity

Can another engineer understand this without the author explaining?

- [ ] Names are descriptive and consistent with project conventions
- [ ] Control flow is straightforward (avoid nested ternaries, deep callbacks)
- [ ] Code is organized logically (related code grouped, clear module boundaries)
- [ ] No "clever" tricks that should be simplified
- [ ] Abstractions earn their complexity (don't generalize until the third use case)
- [ ] Comments clarify non-obvious intent (but don't comment obvious code)
- [ ] No dead code artifacts: no-op variables, backwards-compat shims, or `// removed` comments

WES-specific naming:
- [ ] Module files follow `<domain>.<layer>.ts` pattern
- [ ] API routes use kebab-case (`/api/v1/rule-sets`)
- [ ] CSS tokens use `sys-*` prefix for system management pages

### 3. Architecture

Does the change fit the system's design?

- [ ] Follows existing patterns or introduces a new one with justification
- [ ] Maintains clean module boundaries (no circular dependencies)
- [ ] No code duplication that should be shared
- [ ] Dependencies flow in the right direction
- [ ] Abstraction level appropriate (not over-engineered, not too coupled)
- [ ] Refactor reduces complexity rather than relocates it

WES-specific:
- [ ] New domain follows `modules/<domain>/` structure
- [ ] Repository uses correct storage (JSON vs PostgreSQL)
- [ ] No direct JSON file structure dependency from business layer
- [ ] AI module (`modules/ai/`) is facade only — implementation in `services/ai/`

### 4. Security

Does the change introduce vulnerabilities?

- [ ] User input validated and sanitized at boundaries
- [ ] Secrets kept out of code, logs, and version control
- [ ] Authentication/authorization checked where needed
- [ ] No SQL injection (Drizzle ORM used correctly, no raw interpolation)
- [ ] No XSS (outputs encoded, no `dangerouslySetInnerHTML` with user data)
- [ ] Dependencies from trusted sources with no known vulnerabilities

See `skills/wes-security-review/SKILL.md` for detailed security review.

### 5. Performance

Does the change introduce performance problems?

- [ ] No N+1 query patterns (check Drizzle query builder usage)
- [ ] No unbounded loops or unconstrained data fetching
- [ ] No synchronous operations that should be async
- [ ] No unnecessary re-renders in React components
- [ ] Pagination on list endpoints
- [ ] No large objects created in hot paths

WES-specific:
- [ ] JSON file reads are cached where appropriate
- [ ] Excel parsing streams large files (not loads entirely into memory)
- [ ] AI API calls have timeout and retry logic

## Change Sizing

Target these sizes for WES:

| Size | Assessment | Action |
|------|-----------|--------|
| ~100 lines changed | Good. Reviewable in one sitting. | Proceed with review |
| ~300 lines changed | Acceptable if single logical change. | Review carefully |
| ~1000 lines changed | Too large. Split it. | Request decomposition |

WES-specific decomposition strategies:

| Strategy | Use When |
|----------|----------|
| By domain | Changes span multiple `modules/*` domains |
| By layer | Frontend and backend changes mixed |
| Vertical slice | One feature across frontend → API → storage |
| Horizontal | Shared utility changes first, then consumers |

## Review Process

### Step 1: Understand the Context

Before looking at code:

- What is this change trying to accomplish? (Check RP/Work Order/Handoff)
- What spec or task does it implement?
- What is the expected behavior change?

### Step 2: Review the Tests First

Tests reveal intent and coverage:

- [ ] Do tests exist for the change?
- [ ] Do they test behavior (not implementation details)?
- [ ] Are edge cases covered?
- [ ] Do tests have descriptive names?
- [ ] Would the tests catch a regression?

WES test commands:
```bash
npm run test:modules    # Module unit tests
npm run test:integration # Integration tests
npm run test:ai         # AI service tests
npm run test:rules      # Rules/estimate logic tests
npm run build:api       # API build verification
npm run build:web       # Web build verification
```

### Step 3: Review the Implementation

Walk through the code with the five axes in mind.

For each file changed:
1. Correctness: Does this code do what the test says it should?
2. Readability: Can I understand this without help?
3. Architecture: Does this fit the system?
4. Security: Any vulnerabilities?
5. Performance: Any bottlenecks?

### Step 4: Categorize Findings

Label every comment with severity:

| Prefix | Meaning | Author Action |
|--------|---------|---------------|
| (no prefix) | Required change | Must address before merge |
| Critical: | Blocks merge | Security vulnerability, data loss, broken functionality |
| Nit: | Minor, optional | Author may ignore — formatting, style preferences |
| Optional: / Consider: | Suggestion | Worth considering but not required |
| FYI | Informational only | No action needed — context for future reference |

Order findings by leverage: correctness and security first, then structural regressions, then everything else.

### Step 5: Verify the Verification

Check the author's verification story:

- [ ] What tests were run? (commands and results)
- [ ] Did the build pass? (`npm run build:api`, `npm run build:web`)
- [ ] Was the change tested manually?
- [ ] Are there screenshots for UI changes?
- [ ] Is there a before/after comparison?

## Structural Remedies

When flagging a structural problem, propose the move — not just the problem:

- Replace a chain of conditionals with a typed model or explicit dispatcher
- Collapse duplicate branches into a single clearer flow
- Separate orchestration from business logic
- Move feature-specific logic out of shared modules
- Reuse the canonical helper instead of a bespoke near-duplicate
- Make a type boundary explicit so downstream branching disappears
- Delete a pass-through wrapper that adds indirection without clarifying the API
- Extract a helper, or split a large file into focused modules

Prefer the remedy that removes moving pieces over one that spreads the same complexity around.

## Dead Code Hygiene

After any refactoring, check for orphaned code:

1. Identify code that is now unreachable or unused
2. List it explicitly
3. Ask before deleting: "Should I remove these now-unused elements: [list]?"

Example:
```
DEAD CODE IDENTIFIED:
- formatLegacyDate() in src/utils/date.ts — replaced by formatDate()
- OldTaskCard component in src/components/ — replaced by TaskCard
- LEGACY_API_URL constant in src/config.ts — no remaining references
→ Safe to remove these?
```

## Dependency Discipline

Before adding any dependency:

1. Does the existing stack solve this? (Often it does.)
2. How large is the dependency? (Check bundle impact.)
3. Is it actively maintained? (Check last commit, open issues.)
4. Does it have known vulnerabilities? (`npm audit`)
5. What's the license? (Must be compatible with the project.)

Rule: Prefer standard library and existing utilities over new dependencies. Every dependency is a liability.

Upgrading existing dependencies:
1. Read the changelog, not just the version number
2. One dependency per change
3. Let the tests decide
4. Mind the transitive graph (review lockfile diff)
5. Keep the lockfile honest (commit it, review its diff)

## Review Checklist

```markdown
## Review: [Change title]

### Context
- [ ] I understand what this change does and why

### Correctness
- [ ] Change matches spec/task requirements
- [ ] Edge cases handled
- [ ] Error paths handled
- [ ] Tests cover the change adequately

### Readability
- [ ] Names are clear and consistent
- [ ] Logic is straightforward
- [ ] No unnecessary complexity

### Architecture
- [ ] Follows existing patterns
- [ ] No unnecessary coupling or dependencies
- [ ] Appropriate abstraction level
- [ ] Refactors reduce complexity rather than relocate it

### Security
- [ ] No secrets in code
- [ ] Input validated at boundaries
- [ ] No injection vulnerabilities
- [ ] Auth checks in place

### Performance
- [ ] No N+1 patterns
- [ ] No unbounded operations
- [ ] Pagination on list endpoints

### Verification
- [ ] Tests pass
- [ ] Build succeeds
- [ ] Manual verification done (if applicable)

### Verdict
- [ ] **Approve** — Ready to merge
- [ ] **Request changes** — Issues must be addressed
```

## Board Sync

After code review, update:

- `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html` — record review event and verdict
- `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html` — record test verification status
- If Critical findings: update `risks.html` with security/quality risks

## Handling Disagreements

When resolving review disputes:

1. Technical facts and data override opinions and preferences
2. `AGENTS.md` and project conventions are the authority
3. Software design must be evaluated on engineering principles, not personal preference
4. Codebase consistency is acceptable if it doesn't degrade overall health

Don't accept "I'll clean it up later." Require cleanup before submission unless it's a genuine emergency.

## Common Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "It works, that's good enough" | Working code that's unreadable or architecturally wrong creates debt that compounds. |
| "I wrote it, so I know it's correct" | Authors are blind to their own assumptions. Every change benefits from another set of eyes. |
| "We'll clean it up later" | Later never comes. The review is the quality gate — use it. |
| "AI-generated code is probably fine" | AI code needs more scrutiny, not less. It's confident and plausible, even when wrong. |
| "The tests pass, so it's good" | Tests are necessary but not sufficient. They don't catch architecture problems or security issues. |
| "The refactor makes it cleaner" | Relocating complexity isn't reducing it. If the reader still holds the same number of concepts, the structure didn't improve. |

---

*本 Skill 版本：v1.0.0*
*对应系统版本：WorkEvolutionSys / WES Code Review*
*最后更新：2026-08-06*
