# Code scanning (CodeQL): private now, automatic when public

`.github/workflows/codeql.yml` runs CodeQL (`security-extended`, JavaScript/TypeScript
and Python) on every PR and push to `main` / `agent/integration`, every Tuesday,
and on manual dispatch. What it does with the results depends on whether the
repository is **private** or **public**. It checks that itself on every run, so
nothing needs editing when the visibility changes.

| Repository | What happens | Where to see findings | Cost |
|---|---|---|---|
| **Private** (now) | The scan runs and the check passes. Results are **not uploaded**, because GitHub only accepts code-scanning uploads on private repos with paid Code Security. | The run's **Summary** page lists the findings. The full SARIF file is the `codeql-javascript-typescript` / `codeql-python` artifact on the run, kept for 30 days. | Free |
| **Public** | Results upload to **Security → Code scanning**. PRs get inline annotations, and alerts are tracked, deduplicated and can be dismissed. | Security tab, plus the PR's checks and annotations. | Free |

## When you make the repository public

1. **Before going public, scan the whole history for secrets.** Everything
   becomes visible, every old commit included, and that can't really be taken
   back. Run `gitleaks git .` (or the `security-scan` skill), and revoke any real
   key it finds; deleting the file is not enough.
2. **Settings → General → Danger Zone → Change visibility → Public.**
3. That's it for CodeQL. The next run (the next PR or push, the weekly schedule,
   or **Actions → CodeQL → Run workflow**) sees the repo is public and uploads
   results to **Security → Code scanning**.
4. Optional:
   - In **Settings → Code security**, check that *Code scanning* shows the
     `CodeQL` workflow as its tool. Don't also turn on *Default setup*: this
     repo uses the workflow (advanced setup), and running both duplicates
     analyses.
   - Make **Analyze (javascript-typescript)** and **Analyze (python)** required
     checks in branch protection, and set the code-scanning merge-protection
     severity (for example, block on *High* or higher) under **Settings →
     Rules**.

Third-party apps that refuse private repos on free plans start working too,
for example the ECC Tools PR audit.

## If you go private again

Nothing to change either: the next run sees the repository is private and goes
back to artifact-only results. Alerts already uploaded stay in the Security tab
but are no longer updated.

## How the switch works

The first step of the analyze job asks the GitHub API for the repository's
`private` flag (`gh api repos/<owner>/<repo> --jq .private`). It reads the flag
from the API because scheduled runs carry no repository details in their event
payload. The flag then drives:

- `upload: always` in `github/codeql-action/analyze` when the API says
  `private: false`, and `upload: never` otherwise (including when the lookup
  fails, so a private repo never hits the "Code scanning is not enabled" error);
- the *Summarise findings* and *Keep results as an artifact* steps, which run
  only while the repo is private.

To pay for GitHub Code Security on a private repo instead, change the `upload:`
line to `always`, and the private-only steps can be deleted.
