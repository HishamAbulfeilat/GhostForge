# Deploying the GhostForge web UI

See **[docs/HOSTING.md](../docs/HOSTING.md)**: hosted ("friends") mode, the
hosting comparison (self-host + Cloudflare Tunnel/Access, Tailscale, Render,
Codespaces, and why Vercel and GitHub Pages don't fit), and how to add friends.

Never put your own AI keys (`OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`…)
or `ACCESS_PIN` into a hosting provider's settings. In hosted mode each user
brings their own key, and the server's keys are ignored.
