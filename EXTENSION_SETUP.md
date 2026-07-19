# @ghostforge GitHub Copilot Extension Setup

This guide sets up the GhostForge Developer Toolkit as a GitHub Copilot Extension so you can use `@ghostforge /command` in Copilot Chat on VS Code, GitHub.com, and GitHub Mobile.

## What you get

- A hosted Copilot Extension server in `extension/`
- Free deployment on Vercel
- Private or public GitHub App options
- Full compatibility with the existing local toolkit (`ghostforge`, scripts, copied project files)

---

## Step 1: Push `ghostforge` to GitHub

```bash
cd ~/ghostforge
git init
git add .
git commit -m "feat: initial ghostforge v2.0.0"
gh repo create YOUR_USERNAME/ghostforge --private --source=. --push
```

> If this repository already exists on GitHub, just push your latest branch.

---

## Step 2: Deploy to Vercel (free)

1. Open [vercel.com](https://vercel.com) and sign in.
2. Click **Add New Project**.
3. Import your `ghostforge` GitHub repository.
4. Set **Root Directory** to `extension`.
5. Keep the default Node.js runtime.
6. Deploy.
7. Copy the generated URL, for example:

```text
https://ghostforge-xxx.vercel.app
```

You will use this URL as the GitHub App homepage and webhook URL.

---

## Step 3: Create a GitHub App

Open [github.com/settings/apps/new](https://github.com/settings/apps/new) and configure:

- **GitHub App name**: `GhostForge AI Toolkit`
- **Homepage URL**: your Vercel URL
- **Webhook URL**: `https://ghostforge-xxx.vercel.app/`
- **Webhook secret**: generate a long random string

### Repository permissions

- **Issues**: Read-only
- **Pull requests**: Read & write
- **Contents**: Read-only

### Account permissions

- **Email addresses**: Read-only

### Additional settings

- Enable **Copilot Extensions**
- Save the app
- Generate a **private key** and download it
- Copy the **App ID**, **Client ID**, and **Client Secret**

> Keep the app **private** if only the GhostForge team should use it. Make it public later only if you want broader distribution or GitHub Marketplace listing.

---

## Step 4: Configure Vercel environment variables

In the Vercel project dashboard, add the values from `extension/.env.example`:

- `GITHUB_APP_ID`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `WEBHOOK_SECRET`
- `GITHUB_PRIVATE_KEY`
- `PORT` (optional)
- `NODE_ENV`
- `ALLOWED_ORG` (optional, for GhostForge-only installs)

For `GITHUB_PRIVATE_KEY`, paste the full multi-line key exactly as downloaded.

After saving the variables, redeploy the Vercel project.

---

## Step 5: Register as a Copilot Extension

1. Open your GitHub App settings.
2. Go to the **Copilot** tab.
3. Set the type to **Agent**.
4. Save the configuration.

This enables the `@ghostforge` mention flow in Copilot Chat.

---

## Step 6: Install the GitHub App

Choose the install scope that matches your rollout:

- **Personal use**: install on your own GitHub account
- **GhostForge team use**: install on the GhostForge organization only
- **Public rollout**: make the app public, then list or share it more broadly

If you want to keep the extension private, leave the app private and restrict installation to GhostForge.

---

## Step 7: Test it

After installation, open GitHub Copilot Chat and run:

```text
@ghostforge /help
```

Recommended smoke tests:

```text
@ghostforge /health
@ghostforge /tickets
@ghostforge /security
@ghostforge /review
@ghostforge /deploy
@ghostforge /optimize
```

---

## Optional: automatic deploys from GitHub Actions

This repository includes `.github/workflows/deploy-extension.yml`.

Add these repository secrets before using it:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The workflow deploys automatically on pushes to `main` when files inside `extension/` change, and it also supports manual `workflow_dispatch`.

---

## Private vs public rollout

### Private (GhostForge team only)

- Keep the GitHub App private
- Set `ALLOWED_ORG=ghostforge` in Vercel
- Install only on the GhostForge organization
- Share internally

### Public / Marketplace-ready

- Make the GitHub App public
- Remove or relax `ALLOWED_ORG`
- Review branding, permissions, and support docs
- Submit/publish according to GitHub Marketplace requirements if needed

---

## Troubleshooting

### `Missing X-GitHub-Token header`
The extension request did not include the GitHub auth token. Re-check the Copilot Extension / GitHub App setup and reinstall the app if needed.

### `Repository context is required`
Open Copilot Chat from a repository, issue, or pull request so `@ghostforge` can resolve owner/repo context.

### GitHub App created but `@ghostforge` does not appear
- Confirm **Copilot Extensions** is enabled on the app
- Confirm the Copilot tab is set to **Agent**
- Confirm the app is installed on the account/org you are using
- Re-open Copilot Chat after installation

### Vercel deploy succeeds but commands fail
- Re-check environment variables
- Confirm the webhook/homepage URL matches the deployed Vercel URL
- Ensure the private key was pasted correctly with line breaks preserved
- Review Vercel function logs for runtime errors

### `This extension is restricted to the ghostforge organization`
Either install the app in the allowed org or clear/change `ALLOWED_ORG` in Vercel for broader usage.

### Assigned tickets are empty
- Confirm the installed account has open assigned GitHub issues
- Confirm the repository has Issues enabled
- Confirm you are testing inside the correct repository context

---

## Local toolkit still works

The Copilot Extension is additive. The existing local flows remain unchanged:

- `~/ghostforge/ghostforge`
- `bash scripts/create-project.sh`
- `bash scripts/copy-to-project.sh /path/to/project`

You can use the hosted `@ghostforge` experience and the local toolkit independently.
