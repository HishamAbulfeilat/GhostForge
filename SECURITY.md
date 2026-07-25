# Security Policy

The GhostForge team takes security seriously. We appreciate your efforts to responsibly disclose vulnerabilities.

---

## Supported Versions

| Component | Supported | Version |
|-----------|-----------|---------|
| GhostForge Web UI | Yes | Latest release |
| GhostForge Electron App | Yes | Latest release |
| Mark-L Bridge | Yes | Latest release |
| VS Code Extension | Yes | Latest release |

We provide security fixes for the **latest release only**. Please update to the most recent version before reporting.

---

## Reporting a Vulnerability

**Do not** open a public GitHub issue for security vulnerabilities.

### Option 1: GitHub Security Advisories (Preferred)

1. Go to the [Security tab](https://github.com/HishamAbulfeilat/GhostForge/security) of the repository
2. Click **"Report a vulnerability"**
3. Fill in the advisory form with details

### Option 2: Email

Send a report to **security@ghostforge.dev** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

### What to Include

- **Type** of vulnerability (e.g., XSS, RCE, path traversal, API key exposure)
- **Component** affected (Web UI, Electron app, Mark-L bridge, API endpoint)
- **Attack vector** — how it could be exploited
- **Severity** — your assessment of the impact
- **Proof of concept** — if possible, include a minimal reproduction

---

## Response Timeline

| Stage | Timeline |
|-------|----------|
| Acknowledgment | Within **24 hours** |
| Initial assessment | Within **72 hours** |
| Fix development | Depends on severity — critical fixes prioritized |
| Public disclosure | After fix is released and users have time to update |

---

## Scope

### In Scope

- **Electron App** — IPC vulnerabilities, privilege escalation, remote code execution, screen capture bypass
- **Web UI** — XSS, CSRF, authentication bypass, path traversal, API key exposure in client bundles
- **Mark-L Bridge** — command injection, unauthorized model access, file system access beyond working directory
- **API Endpoints** — injection attacks, broken authentication, data exposure, SSRF
- **WebSocket connections** — unauthorized access, message injection
- **Voice/Biometrics** — bypass of voice authentication, spoofing attacks
- **Dependencies** — known vulnerabilities in third-party packages

### Out of Scope

- Social engineering attacks against GhostForge users or maintainers
- Vulnerabilities in third-party services (Ollama, Gemini, Grok, etc.) — report these to the respective providers
- Issues requiring physical access to the user's machine (beyond what Electron already permits)
- Denial of service against the application itself
- Issues in deprecated or unsupported versions

---

## Responsible Disclosure Process

1. **Report** the vulnerability privately (see above)
2. **Confirm** receipt — we acknowledge within 24 hours
3. **Investigate** — we assess severity and scope within 72 hours
4. **Develop fix** — timeline depends on severity (critical: days, moderate: weeks)
5. **Release fix** — patched version published with security advisory
6. **Disclose** — public disclosure after a reasonable window for users to update
7. **Credit** — we will credit you in the release notes unless you prefer anonymity

### What We Ask

- Give us reasonable time to investigate and fix before public disclosure
- Do not exploit the vulnerability beyond what's necessary to demonstrate it
- Do not access or modify other users' data
- Act in good faith — we will do the same

---

## CVE Assignment

For vulnerabilities that qualify, we will:

1. Request a CVE ID through [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/about-github-security-advisories)
2. Assign the CVE ID and publish the advisory
3. Reference the CVE in the release notes of the fix

We aim to publish CVEs for all confirmed vulnerabilities with a CVSS score of 4.0 or higher.

---

## Scope Clarification

GhostForge is an **open-source developer toolkit**. It runs locally and has access to the developer's machine by design (screen capture, voice control, file access, terminal). Security concerns specific to the *trust model* of local AI assistants are still valid and welcome, but the baseline assumption is that the software has legitimate access to the local environment.

The key security boundary is: **unauthorized or unintended access** — code execution triggered without user consent, data exfiltration, privilege escalation beyond what the user granted, or vulnerabilities exploitable by a malicious web page visited while GhostForge is running.
