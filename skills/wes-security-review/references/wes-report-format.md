# WES Security Report Format

## Report Header

```markdown
# WES Security Audit Report

| Field | Value |
|-------|-------|
| Date | YYYY-MM-DD |
| Scope | <paths scanned> |
| Auditor | <agent-id> |
| Commit | <git-sha> |
| Trigger | <user request / NightOps / pre-release> |
```

## Executive Summary

```markdown
## Summary

- **Overall Risk:** LOW / MEDIUM / HIGH / CRITICAL
- **Findings:** N total (X CRITICAL, Y HIGH, Z MEDIUM, W LOW)
- **Recommendation:** Proceed / Address HIGH+ before merge / Address all before release
```

## Dependency Audit

```markdown
## Dependency Audit

### npm audit
```
npm audit --audit-level=moderate
```
Result: <pass / fail with N vulnerabilities>

### Flagged Packages
| Package | Current | Patched | Severity | CVE | Action |
|---------|---------|---------|----------|-----|--------|
| <name>  | <ver>   | <ver>   | <sev>    | <id>| <action> |
```

## Findings Detail

### Finding Template

```markdown
### [SEVERITY] <Title>

| Field | Value |
|-------|-------|
| ID | SEC-NNN |
| Category | Auth / Injection / Data Handling / AI / Config |
| Location | `file:line` |
| Confidence | High / Medium / Low |

#### Issue
<What is wrong>

#### Attack Scenario
<How an attacker exploits this>

#### Evidence
```typescript
// Vulnerable code
const vulnerable = code_here;
```

#### Fix
```typescript
// Fixed code
const fixed = safe_code_here;
```

#### Verification
- [ ] Patch reviewed
- [ ] Tests pass
- [ ] Manual verification completed
```

## Category-Specific Sections

### Authentication & Access Control

```markdown
## Authentication & Access Control

### JWT Verification
- [ ] `alg:none` rejected
- [ ] Secret entropy >= 256 bits
- [ ] Expiry validated
- [ ] Token revocation mechanism exists

### Route Protection
- [ ] All sensitive routes have auth middleware
- [ ] Admin routes have `requireRole('admin')`
- [ ] No `X-Role` header fallback

### Object-Level Authorization
- [ ] Version records check ownership
- [ ] Harness data scoped to user/team
- [ ] No IDOR on sequential IDs
```

### Injection Flaws

```markdown
## Injection Flaws

### SQL Injection
- [ ] No raw SQL with interpolation
- [ ] Drizzle ORM used correctly
- [ ] Migrations reviewed

### XSS
- [ ] API responses escape user input
- [ ] No `dangerouslySetInnerHTML` with user data
- [ ] React components sanitize props

### Path Traversal
- [ ] File uploads use UUID filenames
- [ ] Export paths sanitized
- [ ] No user-controlled `fs` operations
```

### AI-Specific Risks

```markdown
## AI-Specific Risks

### Prompt Injection
- [ ] User messages validated before AI call
- [ ] System prompt not leaked in errors
- [ ] Excel content sanitized before AI processing

### Output Handling
- [ ] AI responses escaped before rendering
- [ ] No model enumeration via errors
- [ ] Rate limiting enforced on AI endpoints
```

### Data Handling

```markdown
## Data Handling

### Secrets
- [ ] No hardcoded secrets in source
- [ ] `.env` files in `.gitignore`
- [ ] Logs redact sensitive fields
- [ ] Error messages generic in production

### File Upload
- [ ] Size limits enforced
- [ ] MIME type validated
- [ ] Extension whitelist applied
```

## Risk Acceptance

```markdown
## Risk Acceptance

| Finding | Risk | Justification | Accepted By | Date |
|---------|------|---------------|-------------|------|
| SEC-NNN | LOW  | <why accepted> | <user>      | YYYY-MM-DD |
```

## Remediation Tracking

```markdown
## Remediation Tracking

| Finding | Status | Owner | Due Date | Verification |
|---------|--------|-------|----------|--------------|
| SEC-NNN | Open   | <agent> | YYYY-MM-DD | <command> |
| SEC-NNN | Fixed  | <agent> | YYYY-MM-DD | <command> |
```

## Verification Commands

```markdown
## Verification Commands

```bash
# Run these to verify fixes
npm audit --audit-level=moderate
npm run test:modules
npm run test:integration
npm run build:api
npm run build:web
```
```
