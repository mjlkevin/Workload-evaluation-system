# WES Secret Detection Patterns

## Regex Patterns

### API Keys & Tokens

```regex
# Generic API key patterns
[Aa][Pp][Ii][_-]?[Kk][Ee][Yy][\s]*[=:]+[\s]*['"][a-zA-Z0-9_\-]{16,}['"]
[Tt][Oo][Kk][Ee][Nn][\s]*[=:]+[\s]*['"][a-zA-Z0-9_\-]{16,}['"]
[Ss][Ee][Cc][Rr][Ee][Tt][\s]*[=:]+[\s]*['"][a-zA-Z0-9_\-]{16,}['"]

# JWT-specific
jwt[_-]?[Ss][Ee][Cc][Rr][Ee][Tt][\s]*[=:]+[\s]*['"][^'"]{8,}['"]
[Jj][Ww][Tt][_-]?[Kk][Ee][Yy][\s]*[=:]+[\s]*['"][^'"]{8,}['"]

# Service-specific
[Kk][Ii][Mm][Ii][_-]?[Kk][Ee][Yy][\s]*[=:]+[\s]*['"][^'"]{16,}['"]
[Nn][Aa][Pp][Kk][Ii][Nn][_-]?[Kk][Ee][Yy][\s]*[=:]+[\s]*['"][^'"]{16,}['"]
```

### Database Connection Strings

```regex
# PostgreSQL
postgres(ql)?://[^:]+:[^@]+@[^/]+/
mongodb(\+srv)?://[^:]+:[^@]+@[^/]+/

# Generic connection strings with passwords
[Dd][Aa][Tt][Aa][Bb][Aa][Ss][Ee][_-]?[Uu][Rr][Ll][\s]*[=:]+[\s]*['"][^'"]*:[^'"]*@[^'"]*['"]
```

### Private Keys

```regex
# PEM private keys
-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----

# Base64-encoded key material
[A-Za-z0-9+/]{100,}={0,2}
```

## Entropy Heuristics

Flag strings with high Shannon entropy (>4.5 bits/char) and length >20:

```javascript
function shannonEntropy(str) {
  const len = str.length;
  const freq = {};
  for (const char of str) {
    freq[char] = (freq[char] || 0) + 1;
  }
  let entropy = 0;
  for (const char in freq) {
    const p = freq[char] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Flag if entropy > 4.5 and length > 20
const isHighEntropy = (str) => shannonEntropy(str) > 4.5 && str.length > 20;
```

## WES-Specific Secret Locations

### Files to Scan

| File Pattern | Risk Level | Notes |
|--------------|-----------|-------|
| `.env*` | CRITICAL | Should be in `.gitignore` |
| `config/**/*.json` | HIGH | Check for embedded credentials |
| `docker-compose*.yml` | HIGH | DB passwords, API keys |
| `apps/api/src/**/*.ts` | MEDIUM | Hardcoded secrets in source |
| `scripts/**/*.js` | MEDIUM | CI/CD tokens, API keys |
| `.github/workflows/*.yml` | MEDIUM | GitHub tokens, deployment keys |
| `logs/**/*.log` | HIGH | Logged tokens, session data |

### WES-Specific Patterns

```regex
# WES invite codes (should not be hardcoded)
[Ii][Nn][Vv][Ii][Tt][Ee][_-]?[Cc][Oo][Dd][Ee][\s]*[=:]+[\s]*['"][A-Z0-9]{6,}['"]

# WES config file paths with potential secrets
config/(auth|system|rag)/.*\.json

# Excel export paths with potential PII
exports/.*\.xlsx
```

## CI/CD Secret Risks

### GitHub Actions

```yaml
# DANGER: Hardcoded secrets in workflow
env:
  API_KEY: "sk-abc123..."  # FLAG

# SAFE: Use GitHub Secrets
env:
  API_KEY: ${{ secrets.API_KEY }}
```

### Docker

```dockerfile
# DANGER: Secrets in Dockerfile
ENV JWT_SECRET="hardcoded-secret"

# SAFE: Use build secrets or runtime env
RUN --mount=type=secret,id=jwt_secret
```

## Verification Commands

```bash
# Check for committed .env files
git ls-files | grep -E '^\.env'

# Search for high-entropy strings in source
rg -o '[A-Za-z0-9+/]{40,}={0,2}' apps/api/src/ | head -20

# Check for console.log of sensitive data
rg 'console\.(log|warn|error)\(.*(token|password|secret|key)' apps/api/src/

# Verify .gitignore includes .env*
cat .gitignore | grep -E '^\.env'
```
