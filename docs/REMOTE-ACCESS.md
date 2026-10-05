# Remote access

Use GhostForge on your laptop from your phone, a tablet or another computer.
Everything lives on the **Remote** page (`/remote`) of the web UI.

## 1. Pair a device

1. On the laptop, open **Remote → Pair a phone or tablet → Show pairing code**.
2. Scan the QR code with the phone's camera, or copy one of the links to it.
3. The phone is signed in as you and opens JARVIS.

The code works **once** and expires after **10 minutes**. Only its SHA-256
hash is stored (`~/.ghostforge/remote.json`). Failed attempts are rate-limited
per IP. Each paired device gets its own id inside its session token, so
**Revoke** under *Paired devices* ends that device's session at once. The
laptop's own session is not affected.

## 2. Reach the laptop

| Where the phone is | How | Notes |
|---|---|---|
| Same Wi-Fi | The LAN link the pairing card lists | Allow port 3001 through the laptop's firewall. The phone may warn about the local HTTPS certificate the first time. |
| Anywhere, privately | [Tailscale](https://tailscale.com) on both devices | Recommended. The `100.x` / MagicDNS address shows up automatically. |
| Anywhere, public link | **Start tunnel** (Cloudflare quick tunnel) | Needs `cloudflared` (`winget install Cloudflare.cloudflared` / `brew install cloudflared`). Gives a temporary `https://*.trycloudflare.com` link that anyone could open, so GhostForge sign-in is the only protection. Stop it when you're done. Owner only. |

## 3. Control this computer (remote desktop)

Admins can see the laptop's screen on the phone and click, type, scroll and
press keys:

- **Off by default.** Turning it on asks for your **password again**, so a lost
  phone or a stolen session can't take over the computer silently.
- Tap = click, double-tap = double-click, long-press = right-click. There's a
  text box for typing and buttons for common keys. Only allow-listed keys and
  combos (e.g. `ctrl+c`) are accepted.
- Enabling, disabling and use are written to the audit log.
- Needs two packages on the laptop:
  - `screenshot-desktop`, which is installed with the web UI;
  - nut.js for mouse and keyboard. Install it once with
    `cd web-ui && npm i @nut-tree-fork/nut-js`. It's left out of the default
    install because it's native and its image dependency carries audit
    findings.

  The page tells you when either one is missing.

The Job Hunter uses this too. LinkedIn sign-in and "stuck" applications open a
visible browser on the laptop, and you can finish them from your phone through
this screen.

## Security summary

- Every request still goes through GhostForge sign-in. Pairing only issues a
  normal, revocable session.
- `GET /api/remote/pair` is the one unauthenticated remote endpoint: the
  one-time code is the credential. It is listed in `test/api-route-auth.test.js`.
- Tunnel and remote-desktop controls are admin/owner only.
