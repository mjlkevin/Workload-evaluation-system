---
name: wes-security-review
description: >-
  Use when reviewing WES codebase for security vulnerabilities, auditing JWT/auth
  boundaries, checking Excel/AI API input surfaces, or before merging changes that
  touch auth, routes, file upload, or external API integrations. Triggers:
  "security audit", "安全检查", "漏洞扫描", "JWT review", "auth audit",
  "渗透测试", "安全审查", "检查安全", "is this secure?".
---

# WES Security Review

## Overview

Security-focused code review for the WorkEvolutionSys repository. This skill traces data flows across files, validates trust boundaries, and catches vulnerabilities that pattern-matching tools miss.

Core principle: **Only report what is exploitable with a concrete attack scenario.**

## Required Context

Before scanning, read from the project root:

1. `AGENTS.md` — architecture boundaries and auth rules
2. `apps/api/src/app.ts` — route registration and middleware stack
3. `apps/api/src/routes/index.ts` — aggregated routes
4. `docs/openapi.yaml` — external API contract
5. `package.json` and `package-lock.json` — dependency surface

## WES-Specific Attack Surfaces

| Surface | Location | Key Risks |
|---------|----------|-----------|
| JWT Auth | `apps/api/src/modules/auth/` | `alg:none`, weak secrets, missing expiry validation, token replay |
| Excel Upload | `apps/api/src/modules/ai/` `parse-basic-info` | Path traversal, malicious macro, oversized file, SSRF via external links |
| AI API (Kimi) | `apps/api/src/services/ai/` | Prompt injection, output handling, API key exposure in logs |
| File Export (PDF) | `apps/api/src/modules/exports/` | Path traversal, SSRF in resource fetching, information disclosure |
| Version Control | `apps/api/src/modules/versions/` | Broken object-level authorization (BOLA), unauthorized checkout/checkin |
| Harness PostgreSQL | `apps/api/src/modules/harness/` | SQL injection via Drizzle ORM misuse, unauthorized data access |
| Admin Endpoints | routes with `requireRole('admin')` | Privilege escalation, mass assignment |

## Execution Workflow

### Step 1 — Scope Resolution

Determine what to scan:

- If a path was provided, scan only that scope
- If no path given, scan the entire `apps/api/src/` and `ui/V2_PROTOTYPE/src/`
- Identify frameworks: Express 4.x, React 18, Vite 5, Drizzle ORM, jsonwebtoken

### Step 2 — Dependency Audit

Run before source code scan:

```bash
npm audit --audit-level=moderate
```

Flag packages with known CVEs, deprecated crypto libs, or suspiciously old pinned versions. Pay special attention to:

- `jsonwebtoken` — JWT implementation bugs
- `exceljs` — XML parsing vulnerabilities
- `pdfkit` — PDF generation injection
- `pg` — PostgreSQL driver security
- `drizzle-orm` — ORM misuse patterns

### Step 3 — Secrets & Exposure Scan

Scan ALL files (including config, env, CI/CD, Dockerfiles) for:

- Hardcoded API keys, tokens, passwords, private keys
- `.env*` files accidentally committed
- Secrets in comments or debug logs
- `console.log` of sensitive data (passwords, tokens, user info)
- Database connection strings with credentials embedded
- JWT secrets in source code or config files

Use `scripts/check-tracked-secrets.js` if available.

### Step 4 — Vulnerability Deep Scan

#### Authentication & Access Control

- Missing authentication on sensitive endpoints (check `app.ts` middleware order)
- Broken object-level authorization (BOLA/IDOR) on version records
- JWT weaknesses:
  - `alg:none` acceptance
  - Weak secrets (check `JWT_SECRET` entropy)
  - Missing expiry validation
  - No token revocation mechanism
- Session fixation, missing CSRF protection
- Privilege escalation paths (admin → user, user → admin)
- `X-Role` header fallback (AGENTS.md explicitly forbids this)

#### Injection Flaws

- SQL Injection: raw queries with string interpolation, Drizzle ORM misuse
  - Note: Drizzle ORM parameterized queries are safe; raw `sql` template tag with interpolation is not
- XSS: unescaped output in API responses, `dangerouslySetInnerHTML` in React
- Command Injection: `exec`/`spawn` with user input (check Excel parsing)
- Path Traversal: file upload/download paths (Excel, PDF exports)
- Header Injection: user-controlled headers in API proxying

#### Data Handling

- Sensitive data in logs, error messages, or API responses
- Missing encryption at rest for JSON config files
- Insecure deserialization (Excel parsing, JSON config)
- SSRF via AI API calls or file export
- Unvalidated external data flows

#### AI-Specific Risks

- Prompt injection via `ai/chat` messages
- Output handling: AI-generated content rendered without sanitization
- Model enumeration via error messages
- Rate limiting bypass on AI endpoints

### Step 5 — Cross-File Data Flow Analysis

Trace user-controlled input from entry points to sinks:

| Entry Point | Sink | Path to Trace |
|-------------|------|---------------|
| `req.body` (HTTP params) | DB queries | `routes → controller → usecase → repository` |
| `req.file` (Excel upload) | File system / AI parser | `ai routes → parse-basic-info → file storage` |
| `req.headers.authorization` | JWT verification | `auth middleware → jwt.verify → req.user` |
| AI response data | API response / PDF export | `services/ai → routes → response` |
| `req.query` / `req.params` | Version records | `versions routes → repository → JSON file` |

### Step 6 — Self-Verification Pass

For EACH finding:

1. Re-read the relevant code with fresh eyes
2. Ask: "Is this actually exploitable, or is there sanitization I missed?"
3. Check if a framework or middleware already handles this upstream
4. Downgrade or discard findings that aren't genuine vulnerabilities
5. Assign final severity: **CRITICAL / HIGH / MEDIUM / LOW / INFO**

### Step 7 — Generate Security Report

Output format:

```markdown
## WES Security Audit Report

### Scope
<scanned paths>

### Dependency Audit
- `npm audit` result: <pass/fail with count>
- Flagged packages: <list>

### Findings Summary
| Severity | Count |
|----------|-------|
| CRITICAL | N |
| HIGH     | N |
| MEDIUM   | N |
| LOW      | N |
| INFO     | N |

### Detailed Findings

#### [SEVERITY] Title
- **Location:** `file:line`
- **Issue:** <what is wrong>
- **Attack Scenario:** <how an attacker exploits this>
- **Evidence:** <code snippet>
- **Fix:** <concrete patch or recommendation>
- **Confidence:** High / Medium / Low

### Verification Commands Run
- `npm audit`: <result>
- `rg 'jwt_secret|password|token' --hidden`: <result>
- <other commands>

### Risk Acceptance
- <any findings marked as accepted risk with justification>
```

### Step 8 — Propose Patches

For every CRITICAL and HIGH finding, generate a concrete patch:

- Show the vulnerable code (before)
- Show the fixed code (after)
- Explain what changed and why
- Preserve the original code style, variable names, and structure
- Add a comment explaining the fix inline

Explicitly state: **"Review each patch before applying. Nothing has been changed yet."**

## Severity Guide

| Severity | Meaning | Example |
|----------|---------|---------|
| CRITICAL | Immediate exploitation risk, data breach likely | SQLi, RCE, auth bypass, hardcoded admin password |
| HIGH | Serious vulnerability, exploit path exists | XSS, IDOR, hardcoded secrets, JWT `alg:none` |
| MEDIUM | Exploitable with conditions or chaining | CSRF, open redirect, weak crypto, missing rate limit |
| LOW | Best practice violation, low direct risk | Verbose errors, missing security headers |
| INFO | Observation worth noting, not a vulnerability | Outdated dependency (no CVE), defense-in-depth gap |

## Output Rules

- Always produce a findings summary table first (counts by severity)
- Never auto-apply any patch — present patches for human review only
- Always include a confidence rating per finding (High / Medium / Low)
- Group findings by category, not by file
- Be specific — include file path, line number, and the exact vulnerable code snippet
- Explain the risk in plain English — what could an attacker do with this?
- If the codebase is clean, say so clearly: "No vulnerabilities found" with what was scanned

## Board Sync

After security review, update:

- `03_技术设计/系统架构/WES-Agent-升级总看板/risks.html` — add security risks and controls
- `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html` — record security test execution
- `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html` — record audit event

If CRITICAL or HIGH findings exist, also update `monitoring.html` with remediation tracking.

## Reference Files

Read these reference files as needed during the audit:

- `references/wes-vuln-categories.md` — WES-specific vulnerability categories and detection signals
- `references/wes-secret-patterns.md` — Regex patterns and entropy heuristics for secret detection
- `references/wes-report-format.md` — Structured output template for security reports

---

*本 Skill 版本：v1.0.0*
*对应系统版本：WorkEvolutionSys / WES Security Review*
*最后更新：2026-08-06*
