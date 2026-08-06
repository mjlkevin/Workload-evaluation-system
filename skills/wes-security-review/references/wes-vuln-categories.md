# WES Vulnerability Categories

## Authentication & Access Control

### JWT Weaknesses

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| `alg:none` acceptance | `jwt.verify` without `algorithms` option | Explicit `algorithms: ['HS256']` |
| Weak secrets | `JWT_SECRET` length < 32 chars or hardcoded | Environment variable, min 256-bit entropy |
| Missing expiry | No `exp` claim or not checked | Always validate `exp` and `iat` |
| Token replay | No token blacklist or revocation | Short expiry + refresh token rotation |

### Broken Object-Level Authorization (BOLA/IDOR)

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| Missing owner check | Route accesses resource without verifying `req.user.id === resource.ownerId` | Explicit ownership validation in usecase |
| Predictable IDs | Sequential integer IDs exposed in API | UUID or hash-based IDs |
| Mass assignment | `req.body` spread directly into update | Explicit allowlist of updatable fields |

## Injection Flaws

### SQL Injection

WES uses Drizzle ORM which is safe by default. Watch for:

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| Raw SQL with interpolation | `sql\`SELECT * FROM ${table}\`` | `sql\`SELECT * FROM ${sql.identifier(table)}\`` |
| Dynamic table/column names | String concatenation in query builder | Use Drizzle's type-safe query builder |
| Unsafe migrations | Raw SQL in migration files without validation | Review all migrations for injection |

### XSS

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| Unescaped API output | API returns user input without encoding | Encode output in API layer or frontend |
| `dangerouslySetInnerHTML` | React component using this prop | Use text content or DOMPurify |
| Template injection | User input in HTML templates | Escape or sanitize before insertion |

### Path Traversal

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| User-controlled file paths | `fs.readFile(req.query.path)` | Whitelist allowed paths, use basename |
| Upload directory traversal | Filename from upload used directly | Rename with UUID, validate extension |
| Export file path | `projectName` used in filename | Sanitize filename, restrict to safe chars |

## AI-Specific Risks

### Prompt Injection

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| Unfiltered user messages | `messages` array passed directly to AI | Validate and sanitize message content |
| System prompt leakage | Error messages reveal system prompt | Generic error messages |
| Indirect prompt injection | Excel content contains prompt directives | Sanitize parsed content before AI call |

### Output Handling

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| Unsanitized AI output | AI response rendered directly | Validate and escape AI-generated HTML |
| Model enumeration | Error reveals model name/version | Generic error messages |

## Data Handling

### Secrets Exposure

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| Hardcoded secrets | API keys in source code | Environment variables, secret manager |
| Logged tokens | `console.log(req.headers)` | Redact sensitive fields in logs |
| Error detail leakage | Stack traces in production | Generic error messages in prod |

### Insecure Deserialization

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| `JSON.parse` without validation | `JSON.parse(req.body)` | Schema validation with AJV |
| Excel macro execution | `exceljs` reading macro-enabled files | Disable macros, validate file type |

## WES-Specific Risks

### Version Control Abuse

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| Unauthorized checkout | No role check on checkout endpoint | `requireRole` middleware + ownership check |
| Force unlock by non-admin | `forceUnlock` without admin verification | Strict admin-only access |
| Version history exposure | Historical versions accessible without auth | Auth check + role-based access |

### Excel Upload Abuse

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| Oversized files | No file size limit | Max file size validation |
| Malicious file types | Extension check only | MIME type + content validation |
| Zip bomb / decompression | Compressed archives | Limit compression ratio |

### Harness PostgreSQL

| Pattern | Detection Signal | Safe Pattern |
|---------|-----------------|--------------|
| Raw SQL in Harness | `db.execute` with interpolation | Use Drizzle query builder |
| Missing RLS | No Row Level Security | Enable RLS on sensitive tables |
| Overprivileged DB user | DB user has superuser | Least privilege principle |
