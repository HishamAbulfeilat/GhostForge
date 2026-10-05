# Hosting GhostForge for friends

How to put the GhostForge web UI (`web-ui/`) online so **only your friends**
can use it, with **no API keys or personal data** in it, and **without
connecting to your own accounts or AI subscriptions**.

- Short version: run the Docker image in **hosted mode** on a machine that is
  always on, and put it behind **Cloudflare Tunnel + Cloudflare Access** with
  an email allow-list. If you have no domain, use **Tailscale** instead.
- Facts about third-party plans were checked in October 2026 and change
  often. Lines marked *(unverified)* are from memory or secondary sources, so
  check the provider's pricing page before relying on them.

## 1. What "hosted mode" is

GhostForge was built to run on its owner's own computer. It opens terminals,
moves the mouse, reads files, talks to the Python bridge on `:8765`, and uses
the owner's AI keys. None of that is safe to hand to other people, so the web
UI has a second mode for hosting:

```
GHOSTFORGE_MODE=hosted
```

| Area | Hosted mode |
|---|---|
| Terminal / PTY (`/ws`, `/api/pty-token`), shell (`/api/execute`), files browser | **Off**: 403, page hidden |
| Mac control, remote desktop and pairing, device controls, screen capture, nut.js desktop automation, biometrics | **Off** |
| Mark-LV / OpenJarvis bridge (`:8765`), workflows, orchestrate, local voice pipeline (STT/TTS) | **Off** |
| Maintenance page, doctor, dashboard and metrics (they run shell commands; there is no separate self-update route), test-run, code-health, tickets, projects, security-scan, agents / CLI sessions, Agent Town/Office servers | **Off** |
| Email, calendar, contacts, iMessage/Slack/Teams/WhatsApp, GitHub token and Copilot, webhooks, push | **Off** |
| Model install, local models (Ollama, llama.cpp, LLMfit), OmniRoute gateway | **Off** (they would use the host's resources and the owner's gateway keys) |
| Marketplace | Browse **on**; install/remove **off** (shared state). Install commands are only copied, never run |
| JARVIS history, vault and audit log, morning/proactive briefings (stored server-wide, so one friend would see another's), model recommendations (they inspect the host) | **Off** |
| Any API route not on the allowlist, **including routes added later** | **Off** until someone adds it to `allowedApi` |
| Job Hunter | Search and tailoring **on**; add-by-link **fetch-only** (LinkedIn links refused, no browser fallback); auto-apply, autopilot and LinkedIn sign-in **off** (they drive a browser on the host); the server's JSearch/Adzuna/USAJobs/Reed keys are ignored |
| JARVIS chat | **On**, with web-only tools: time, weather and web search. Every other tool answers "Not available on the hosted version" |
| Chat, Settings → AI Models, Users, Setup, Jobs, Snippets, Media, Marketplace browse, Agent World page | **On** |

How it is enforced (server-side, not only in the UI):

1. **An allowlist, not a denylist.** Only the API routes listed in
   `allowedApi` (`web-ui/lib/hosted-policy.json`) answer when hosted. Any other
   `/api` path, including one added next month, gets 403 from `server.js`
   and from middleware. A new route stays off until someone decides it is
   safe for friends.
2. **`server.js`** answers 403 for non-allowlisted API routes before Next sees them,
   refuses terminal WebSocket upgrades, skips OmniRoute/voice autostart and
   mkcert, and listens on plain HTTP. TLS is the tunnel's or platform's job.
3. **Every blocked route handler** calls `hostedGuard()` first
   (`web-ui/lib/hosted.ts`). That keeps the routes safe under `next start` or
   any host without `server.js`.
4. **`hasPermission()`** denies host permissions (terminal, files, mac_control,
   remote, email, github…) to everyone, **admins included**.
5. **Middleware** answers 403 for non-allowlisted API routes (covering `next
   start` without `server.js`), redirects the blocked pages to `/jarvis`, and
   the navbar hides them.
6. **JARVIS `executeTool()`** refuses any tool outside the web-only allow-list.

The lists live in one file, `web-ui/lib/hosted-policy.json`.
`web-ui/test/hosted-mode.test.js` walks `app/api` and fails unless every route
is either allowlisted or calls the guard first.

### No keys, no owner accounts

- **AI keys:** the server's environment keys (`OPENROUTER_API_KEY`,
  `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`…) are **never used**.
  At startup, hosted mode also **deletes** anything that looks like a secret
  from the process environment (`*_API_KEY`, `*_TOKEN`, `*_SECRET`,
  `ACCESS_PIN`, webhook URLs…), keeping only `AUTH_SECRET` and
  `ADMIN_PASSWORD`.
- **Each friend brings their own key** in Settings → AI Models. Keys are stored
  per user on the server (`<data>/.ghostforge/hosted-ai/<userId>.json`, mode
  600) and are never sent back to the browser. A friend's key, model choice
  and custom models are invisible to everyone else.
- **No key?** JARVIS and Chat fall back to keyless free models (Pollinations).
  Free keys are worth adding: OpenRouter `:free` models, Gemini (AI Studio),
  Groq and Cerebras all have free tiers.
- **Custom models** must use a public `https://` URL, so nobody can reach
  Ollama, the bridge or cloud metadata through them. Loopback, private,
  link-local and Tailscale addresses are refused, both as literals and when a
  DNS name resolves to them. Every call re-checks DNS at connect time, so DNS
  rebinding fails too, and redirects are never followed. Upstream error
  bodies are not passed back to the user.
- **No host services:** semantic memory skips the host's Ollama embeddings
  (keyword matching instead), and JARVIS research search uses the public
  search instead of the local Vane server.
- **Data isolation:** `server.js` points `HOME` at `GHOSTFORGE_DATA_DIR`
  (default `web-ui/.hosted-data`, `/data` in Docker). The real
  `~/.ghostforge` of the machine (your memory, CV, jobs, keys) is never read.
  Still, run it in Docker or as a separate OS user on your own machine. See §4.
- **Client bundle:** there are no `NEXT_PUBLIC_*` variables, so no env value is
  inlined into browser JS. A grep of `.next/static` after `npm run build`
  finds no keys or emails. What it does find: env var *names* on the
  dashboard's setup checklist, the author credit "Developed by Hisham
  Abulfeilat" on the login page, "Riyadh" as the JARVIS default city, and the
  public Fish Audio voice-model id. Remove the credit or default city if you'd
  rather not show them.

### Friends-only access

- There is **no sign-up page**. Only the admin creates accounts.
- Hosted mode **fails closed**. The server will not start without
  `AUTH_SECRET` (32+ chars) and `ADMIN_PASSWORD` (12+ chars), and there are no
  dev fallbacks.
- The legacy shared **PIN login is disabled**, and `ACCESS_PIN` is ignored.
- The admin account defaults to username `admin` and name `Admin`, not the
  owner's name (`ADMIN_USERNAME` / `ADMIN_NAME` override this).
- Failed logins are limited **per IP** (5 in 10 minutes) and **per username**
  (10 in 10 minutes, whatever the IP). They **never lock the host PC**, which
  the local build does.
- The client IP used for those limits is the TCP peer, stamped by `server.js`.
  Headers sent by the client (`X-Forwarded-For`, `X-Real-IP`) are ignored.
  Behind a tunnel on the same machine every request comes from `127.0.0.1`,
  so tell the server which proxy header to trust:
  `GHOSTFORGE_TRUST_PROXY=cloudflare` (cloudflared, uses `CF-Connecting-IP`)
  or `GHOSTFORGE_TRUST_PROXY=xff` (rightmost `X-Forwarded-For`). The header is
  trusted only when the connection comes from the proxy: loopback, or an
  address listed in `GHOSTFORGE_TRUSTED_PROXIES`.
- Add a second gate in front of the app (Cloudflare Access, Tailscale,
  Codespaces org visibility). App passwords alone are fine, but two locks are
  better than one.

## 2. Where it can run

| Option | Cost | What works | Persistence | Friends-only gate | Verdict |
|---|---|---|---|---|---|
| **Self-host (always-on PC, mini-PC, Raspberry Pi 5, or Oracle Cloud Always Free VM) + Cloudflare Tunnel + Access** | Free (a domain is about $10/yr) | Everything hosted mode allows | Yes (Docker volume) | Access email allow-list (free up to 50 users) **plus** app accounts | **Recommended** |
| **Self-host + Tailscale** (invite friends or share the node) | Free | Same | Yes | Only devices in your tailnet / shared to friends | Recommended if you have no domain; friends install Tailscale |
| **Render free web service** (Docker) | Free | Same, but cold starts | **No**: disk wiped on every restart, deploy and spin-down | App accounts only (public URL) | Cheapest "most features" option; use `GHOSTFORGE_FRIENDS` |
| **Koyeb free instance** | Free | Same; 512 MB RAM, 0.1 vCPU *(tight)* | No (ephemeral) | App accounts only | Possible; may be too small |
| **Hugging Face Spaces (Docker)** | Free CPU basic *(the free compute rules have changed; check)* | Same | No (persistent storage is paid) | Private Space plus app accounts *(friends need HF access; unverified)* | Possible |
| **Railway** | $5 one-time trial, then $1/month credit | Same | Volumes (paid usage) | App accounts only | Not really free |
| **Fly.io** | No free allowance for new orgs (trial only) | Same | Volumes | App accounts only | Not free |
| **GitHub Codespaces** | Free monthly quota (personal accounts: about 120 core-hours and 15 GB *(unverified)*) | Same, while the codespace runs | Yes, until the codespace is deleted | Port visibility: see below | Fine for a demo evening, not as a host |
| **Vercel Hobby** | Free, non-commercial only | **Login breaks**: read-only filesystem | None | Vercel auth for your team only | **Not suitable** without a database rewrite |
| **GitHub Pages** | Free | **Nothing useful**: static files only | n/a | Public (private Pages needs Enterprise Cloud) | **Not suitable** |

### Why not Vercel

- Serverless functions get a **read-only filesystem** apart from a per-instance
  `/tmp`. Everything GhostForge stores under `~/.ghostforge` (users.json, the
  per-user AI keys, memory, jobs, the remote-access store) either fails to
  write or vanishes on the next cold start. Seeding the admin fails, so **you
  cannot even log in**.
- `server.js` doesn't run there: no custom server, **no WebSockets/PTY**.
- **No Playwright browser** for Job Hunter's form filling.
- **Function time limits** of 10–60 s by default on Hobby (longer with Fluid
  compute *(unverified)*). The Job Hunter search (`maxDuration = 300`) and slow
  free models would time out.
- **The Hobby plan is for personal, non-commercial use.**
- Making it work would mean moving all state to a hosted database or KV store,
  which is a separate project. `web-ui/vercel.json` and `web-ui/DEPLOY.md` are
  left over from the single-user PIN days. Don't follow DEPLOY.md's advice to
  put your own AI keys in Vercel's env.

### Why not GitHub Pages

Pages serves static files only. GhostForge needs API routes, middleware
(auth), server-side sessions and a Node server, and `next export` cannot
produce any of those. Every page except `/login` is behind auth and calls
`/api/*`. Even the Agent Town frame needs `/api/worlds`. **No page is useful
as a static export.** Static Pages sites are also public unless you are on
GitHub Enterprise Cloud.

### GitHub Codespaces: who can open the forwarded port

Codespaces forwards port 3001 with one of three visibilities:

- **Private** (default): only **you**, the codespace creator, after GitHub
  login. Friends cannot open it.
- **Private to organization**: anyone in the org that owns the codespace. This
  needs an **organization-owned** codespace on **GitHub Team or Enterprise
  Cloud**, so friends would join that org.
- **Public**: anyone with the URL, with no GitHub login. The app's own
  accounts are then the only gate.

There is **no "share with these specific GitHub users"** setting for a
personal codespace. The codespace also **stops when idle** (30 min default,
up to 4 h), uses your free monthly quota, and its URL is only reachable while
it runs. Codespaces is for development. Treat it as a way to show friends
GhostForge for an evening, not as a permanent host (check GitHub's terms if in
doubt).

### Free container hosts and their ephemeral disks

On Render, Koyeb and HF Spaces (free tiers), the container's disk is wiped on
restart, redeploy and (Render) after 15 minutes idle. In hosted mode that
means:

- the **admin** comes back on every boot (re-seeded from `ADMIN_PASSWORD`);
- **friends' accounts** come back if you list them in `GHOSTFORGE_FRIENDS`
  (password hashes, see §5);
- each friend's **saved AI key, model choice, memory and jobs are lost**, so
  they paste their key again after a restart.

Render free web services spin down after 15 minutes without traffic (first
request then takes about a minute) and get 750 free instance-hours a month.

## 3. Recommended: Docker + Cloudflare Tunnel + Access

Needs: an always-on machine with Docker (your PC, a mini-PC, a Pi 5 with 8 GB,
or an Oracle Cloud Always Free ARM VM), a free Cloudflare account, and a
domain whose DNS is on Cloudflare.

1. **Build and run** (from the repo root):

   ```bash
   docker build -t ghostforge-hosted .
   docker volume create ghostforge-data
   docker run -d --name ghostforge --restart unless-stopped \
     -p 127.0.0.1:3001:3001 \
     -e AUTH_SECRET="$(openssl rand -hex 32)" \
     -e ADMIN_PASSWORD='a-long-admin-password' \
     -v ghostforge-data:/data \
     ghostforge-hosted
   ```

   Keep `AUTH_SECRET` stable: put it in a root-only env file and use
   `--env-file`, otherwise every restart logs everyone out. The port is bound
   to `127.0.0.1`, so only the tunnel can reach it.

2. **Tunnel**: Cloudflare dashboard → Zero Trust → Networks → Tunnels →
   *Create a tunnel* → run the `cloudflared` command it shows on the same
   machine. Add a public hostname such as `ghostforge.example.com` →
   `http://localhost:3001`. So that login rate limits see real client IPs,
   add `-e GHOSTFORGE_TRUST_PROXY=cloudflare -e GHOSTFORGE_TRUSTED_PROXIES=172.17.0.1`
   to the `docker run` in step 1. Inside the container, cloudflared's
   connections arrive from the Docker bridge gateway, usually `172.17.0.1`
   (check with `docker network inspect bridge`). If you skip this, every
   friend shares one per-IP bucket, but per-username limits still apply.

3. **Access (friends-only)**: Zero Trust → Access → Applications → *Add
   application* → *Self-hosted* → domain `ghostforge.example.com`. Add a policy
   with Action **Allow** and Include **Emails** listing your friends'
   addresses. Login method: **One-time PIN** (email code), or GitHub/Google.
   The free plan covers up to 50 users.

4. **Sign in** at `https://ghostforge.example.com` as `admin` with
   `ADMIN_PASSWORD`, then add friends (§5).

5. **Updates:** `git pull && docker build -t ghostforge-hosted . && docker rm -f ghostforge`,
   then run step 1 again. The volume keeps the data.

**Without a domain, use Tailscale instead of Cloudflare.** Install Tailscale on
the host, then either invite friends to your tailnet or *share* just this
machine with them (admin console → Machines → Share). Friends install
Tailscale and open `http://<machine-name>:3001`. To keep the port off your LAN,
run with `-p <tailscale-ip>:3001:3001`. **Tailscale Funnel** is the
opposite: it makes the app public to the whole internet, so app accounts
become the only gate. Avoid it.

**On your everyday laptop:** this works, but the friends' instance runs while
your laptop is awake. Run it **in Docker**, not with `npm run start:hosted`
under your own user. Hosted mode never reads your real `~/.ghostforge`, but
a container (or a separate OS user) means a bug in the app still can't reach
your files. Keep your personal GhostForge in normal mode on `localhost:3001`
and give the friends' container another host port.

## 4. Other options, step by step

### Without Docker (always-on Linux box)

```bash
git clone <your repo> ghostforge && cd ghostforge/web-ui
npm ci && npm run build
export AUTH_SECRET=$(openssl rand -hex 32) ADMIN_PASSWORD='a-long-admin-password'
export HOST=127.0.0.1 GHOSTFORGE_DATA_DIR=/srv/ghostforge-data
npm run start:hosted
```

Run it as a dedicated user (`useradd -r ghostforge`) from systemd with an
`EnvironmentFile=` (template: `web-ui/.env.hosted.example`), and don't put
your personal `.env.local` in this checkout. Then follow §3 steps 2–4.

### Render (free, ephemeral)

1. New → Web Service → connect the repo → **Runtime: Docker** (it uses the root `Dockerfile`).
2. Instance type **Free**. Environment: `AUTH_SECRET`, `ADMIN_PASSWORD`, and
   `GHOSTFORGE_FRIENDS` (§5). Leave out any AI keys.
3. Deploy, then open `https://<name>.onrender.com`.

The URL is public, so app accounts are the gate. Data is lost on every
restart (§2). Koyeb works the same way (Docker, one free instance), with less
RAM.

### Hugging Face Spaces (Docker)

Create a Space → SDK **Docker** → keep it **Private** → push this repo (or add
a Space `Dockerfile` that is a copy of the root one) and set `app_port: 3001`
in the Space README front-matter. Add `AUTH_SECRET`, `ADMIN_PASSWORD` and
`GHOSTFORGE_FRIENDS` as **Secrets** in the Space settings. Data is ephemeral.
Check the current rules for free compute and whether private Spaces fit your
friends (they would need access to the Space).

### GitHub Codespaces (temporary)

1. Repo → Settings → Secrets and variables → **Codespaces** → add
   `AUTH_SECRET` and `ADMIN_PASSWORD` (or add them as personal Codespaces
   secrets for this repo).
2. Code → Codespaces → *Create codespace*. `.devcontainer/devcontainer.json`
   installs, builds and starts the server in hosted mode on port 3001
   (log: `/tmp/ghostforge-hosted.log`). If it isn't running, start it with
   `cd web-ui && npm run start:hosted`.
3. Ports tab → port 3001 → *Port visibility*. Choose **Public** (anyone with
   the URL reaches the login page) or **Organization** (org-owned codespaces
   only). Send friends the `https://<codespace>-3001.app.github.dev` URL.
4. Stop or delete the codespace afterwards: it uses your quota while it runs.

## 5. Adding friends

**Persistent hosts (Docker volume, VM, laptop):** sign in as admin → **Users**
→ *Add user*. Set a username and a temporary password, and send them to your
friend privately. On first login each friend runs the setup wizard (name, job
title). Host permissions stay off whatever title they pick. Disable or delete
accounts on the same page.

**Ephemeral hosts (Render, Koyeb, Spaces):** accounts created in the UI vanish
on restart. List friends in `GHOSTFORGE_FRIENDS` instead. Only password
*hashes* go into the host's settings:

```bash
cd web-ui
node scripts/hosted-user.mjs alice --generate   # prints alice's password (send it privately) and the entry
node scripts/hosted-user.mjs bob                # or type a password yourself
# GHOSTFORGE_FRIENDS=alice:<salt>:<hash>,bob:<salt>:<hash>
```

Missing accounts are created at startup with the default (non-admin)
permissions. Accounts that already exist are left alone.

**Revoking a friend:**
- On a persistent host, delete them on the Users page. GhostForge remembers
  which `GHOSTFORGE_FRIENDS` accounts it has created, so a deleted friend is
  not re-created at the next restart, even if they are still listed.
- On a host that wipes its disk (Render, Koyeb, Spaces), that memory is
  wiped too. **There, removing someone from `GHOSTFORGE_FRIENDS` (and
  redeploying) is how you revoke them.**
- Deleting an account also deletes its saved AI keys. A new account with the
  same username gets a fresh random id and inherits nothing.

**Also add each friend's email to the Cloudflare Access policy** (or share the
Tailscale node with them) if you use the recommended setup.

**Each friend's AI:** Settings → AI Models → paste their own key (OpenRouter,
Gemini, Groq…). Without one, JARVIS and Chat use the free keyless models.

## 6. Environment reference (hosted mode)

| Variable | Required | Meaning |
|---|---|---|
| `GHOSTFORGE_MODE=hosted` | yes | Turns hosted mode on (the Dockerfile and devcontainer set it) |
| `AUTH_SECRET` | yes | Session signing key, 32+ random chars, stable across restarts |
| `ADMIN_PASSWORD` | yes | Admin password, 12+ chars; seeds the admin on first start |
| `ADMIN_USERNAME` / `ADMIN_NAME` | no | Default `admin` / `Admin` |
| `GHOSTFORGE_FRIENDS` | no | `user:salt:hash,…` friend accounts (§5) |
| `GHOSTFORGE_DATA_DIR` | no | State directory (default `web-ui/.hosted-data`; `/data` in Docker) |
| `GHOSTFORGE_TRUST_PROXY` | no | `cloudflare` or `xff`: trust that proxy header for the client IP (§1) |
| `GHOSTFORGE_TRUSTED_PROXIES` | no | Extra proxy addresses besides loopback, e.g. `172.17.0.1` for Docker |
| `HOST` / `PORT` | no | Listen address/port (default `0.0.0.0:3001`; use `127.0.0.1` behind a local tunnel) |

Template: `web-ui/.env.hosted.example`. **Do not** set AI or integration keys:
hosted mode ignores them and removes them from the environment at startup.

## 7. Checking a build for leaks

```bash
cd web-ui && npm run build
grep -rIl 'NEXT_PUBLIC_' .next/static                 # expect nothing
grep -rIoE 'sk-or-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,}|sk-ant-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}' .next/static   # expect nothing
grep -rIoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' .next/static | sort -u                                       # only example.com addresses
```

Server-only environment variables are never inlined into browser JS. Only
`NEXT_PUBLIC_*` would be, and GhostForge defines none.
