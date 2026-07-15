# /security Command

## Description
Runs a comprehensive security audit on the codebase.

## Usage
```
/security [optional: specific area]
```

## Examples
```
/security
/security review the authentication module
/security check API calls for exposed tokens
/security audit dependencies
```

## Audit Checklist

### Secrets & Credentials
- [ ] No API keys in source code
- [ ] No passwords in source code
- [ ] .env files are in .gitignore
- [ ] No secrets in git history
- [ ] Environment variables are documented in .env.example (without values)

### Authentication
- [ ] Tokens expire (short-lived access + refresh tokens)
- [ ] Tokens stored securely (SecureStore for mobile, httpOnly cookies for web)
- [ ] No sensitive data in localStorage
- [ ] Logout clears all tokens
- [ ] Protected routes require authentication

### API Security
- [ ] Authorization header validated on backend
- [ ] CORS configured correctly
- [ ] Rate limiting implemented
- [ ] Input validation on all endpoints
- [ ] No sensitive data in URL params

### Dependencies
- Run `npm audit` and report findings
- Check for outdated packages with known CVEs
- Suggest `npm audit fix`

## Output Format
```
🔒 Security Audit Report
Date: [date]
Severity: [Critical/High/Medium/Low]

🔴 CRITICAL (must fix before release):
[Finding] → [Recommendation]

🟡 HIGH:
[Finding] → [Recommendation]

🟢 MEDIUM / LOW:
[Finding] → [Recommendation]

📦 Dependency Vulnerabilities:
[npm audit summary]
```
