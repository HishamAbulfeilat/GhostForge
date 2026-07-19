# /tunnel Command

## Purpose
Expose a local service with a temporary **Cloudflare Tunnel** so GhostForge tools can be reached remotely without manual port forwarding.

## Usage
```bash
/tunnel
/tunnel start 3000
/tunnel stop
/tunnel status
```

## Local script
```bash
bash ~/ghostforge/scripts/tunnel.sh start 3000
bash ~/ghostforge/scripts/tunnel.sh status
bash ~/ghostforge/scripts/tunnel.sh stop
```

## Common use cases
- Expose the GhostForge Mac Bridge on port `4747`
- Share a local Next.js app running on port `3000`
- Temporarily inspect a dev server from a phone or tablet

## Notes
- Requires `cloudflared`
- If Homebrew is available, the helper attempts `brew install cloudflared`
- Tunnel URLs are temporary `https://*.trycloudflare.com` addresses
