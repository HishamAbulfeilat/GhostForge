---
name: security-scan
description: Run a defensive security audit of the current project — secret scanning, dependency CVEs, static analysis, SBOM, and container/image vulnerabilities — using the open-source scanners in the GhostForge marketplace. Use when the user asks to security-scan, audit, check for secrets/vulnerabilities/CVEs, or harden their own codebase. For authorized use on code you own only.
argument-hint: "[secrets | deps | sast | sbom | image <ref> | all]"
---

# Security Scan

A defensive audit pipeline for the **user's own** repository. It wraps the
marketplace security tools (Gitleaks, OSV-Scanner, Semgrep, Trivy, Syft,
Grype, TruffleHog). Only scan code and images the user owns or is authorized
to assess.

## When to run each stage

| Stage    | Tool          | Finds                                             |
|----------|---------------|---------------------------------------------------|
| `secrets`| Gitleaks / TruffleHog | Hardcoded keys, tokens, passwords in tree + git history |
| `deps`   | OSV-Scanner   | Known CVEs in lockfile dependencies               |
| `sast`   | Semgrep       | Insecure code patterns (injection, XSS, authz)    |
| `sbom`   | Syft          | Software Bill of Materials                         |
| `image`  | Trivy / Grype | CVEs + misconfig in a container image / filesystem |

`all` runs secrets → deps → sast in sequence (the fast, no-argument stages).

## How to drive it

Prefer the marketplace-installed CLIs. Install any that are missing via the
marketplace (`/marketplace` → Install) or the commands below, then run from
the repo root.

```bash
# secrets (no network, scans working tree + history)
gitleaks detect --source . --redact --no-banner || true

# dependency CVEs
osv-scanner scan --recursive . || true

# static analysis with the community ruleset
semgrep scan --config auto --error || true

# SBOM for the repo
syft dir:. -o cyclonedx-json=sbom.cdx.json

# image / filesystem vuln scan (pass a ref for image stage)
trivy fs --scanners vuln,secret,misconfig . || true
```

## Reporting

1. Group findings by severity (Critical → High → Medium → Low).
2. For each finding: file/dependency, what it is, and the concrete fix
   (bump to a fixed version, move the secret to `.env` + rotate it, patch the
   code pattern).
3. Never print full secret values — Gitleaks `--redact` keeps them masked;
   keep them masked in your summary too.
4. Flag anything that needs the user's decision (a breaking dependency bump,
   a secret that must be rotated at the provider) rather than acting silently.

## Guardrails

- This is a **defensive** skill: it scans, reports, and suggests fixes. It
  does not exploit, exfiltrate, or attack anything.
- Confirm the target is the user's own project before scanning history or
  images from elsewhere.
- A leaked secret that is real must be **rotated at the source** — deleting it
  from git history is not enough; say so.
