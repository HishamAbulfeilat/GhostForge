# Security Review Prompts

## Full Audit
```
Perform a complete security audit of this codebase:
1. Scan for hardcoded secrets, API keys, passwords
2. Review all authentication and authorization logic
3. Check all API calls (tokens in headers, HTTPS only)
4. Review data storage (SecureStore vs AsyncStorage vs localStorage)
5. Run npm audit and list all vulnerabilities
6. Check for XSS vulnerabilities (unsanitized HTML, eval usage)
7. Check for CSRF protection on mutation endpoints
8. Review CORS configuration
9. Check input validation on all forms and API params
10. Generate report with 🔴 Critical / 🟡 Warning / 🟢 Suggestion
```

## Auth Security
```
Review the authentication implementation for:
- Token storage security (no localStorage for JWTs)
- Token expiry (access: short-lived, refresh: httpOnly cookie or SecureStore)
- Refresh token rotation
- Logout clears all tokens
- Protected routes actually check auth
- No sensitive user data in JWT payload
- Password strength requirements
- Rate limiting on login endpoint
```

## Dependency Audit
```
Run a full dependency security audit:
- npm audit (list all vulnerabilities by severity)
- Check for outdated packages with CVEs
- Identify packages that can be updated safely
- Flag packages that require major version upgrade
- Suggest alternatives for abandoned packages
- Check package integrity (no typosquatting)
```

## API Security
```
Review all API calls in this codebase for:
- Authorization headers on every protected request
- No tokens in URL query parameters
- HTTPS enforced (no http:// API calls)
- Request timeouts configured
- Error responses don't expose stack traces
- Rate limiting headers respected
- Input sanitization before sending
```
