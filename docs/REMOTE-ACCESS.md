# Remote access

Use GhostForge on your laptop from your phone, a tablet or another computer.
Everything lives on the **Remote** page (`/remote`) of the web UI.

## 1. Pair a device

1. On the laptop, open **Remote → Pair a phone or tablet → Show pairing code**.
2. Scan the QR code with the phone's camera, or **Copy** / **Share** one of
   the links to the device (chat, mail, AirDrop…).
3. Tap **Sign in this device**. The device is signed in as you and opens JARVIS.

Opening the link only shows that button. Chat apps and mail scanners fetch
links to build previews, and if opening the link signed in, the preview would
use up the one-time code. The button posts the code from the pairing page
itself, and posts from other sites are refused. If a scanner or chat app opens
the link inside its own built-in browser, use *Open in browser* first so the
sign-in lands in your real browser.

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

- Works the same in any modern browser on any device:
  - **Phones and tablets** (iOS Safari, Android Chrome/Samsung Internet,
    iPadOS): tap = click, double-tap = double-click, press and hold =
    right-click, and pinch zooms the screen image. Page scrolling still works,
    and a finger that moves never clicks.
  - **Computers** (Chrome, Edge, Firefox, Safari): click, double-click,
    right-click and the mouse wheel work directly on the screen image. Click
    the screen, then type: letters go through as text in any keyboard layout,
    and shortcuts such as ctrl+c or arrows go through as keys.
  - There is also a text box and key buttons for phones.
- **Off by default.** Turning it on asks for your **password again**, so a lost
  phone or a stolen session can't take over the computer silently.
- Only allow-listed keys and combos (e.g. `ctrl+c`) are accepted.
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
- Two remote endpoints are public, and both are listed in
  `test/api-route-auth.test.js`:
  - `GET /api/remote/pair` only shows the confirm page;
  - `POST /api/remote/pair/redeem` uses the one-time code, which is the
    credential. It accepts same-origin requests only and limits failed
    attempts per IP.
- Copy works on plain-http LAN addresses too. Browsers only offer the
  clipboard API on https pages, so GhostForge falls back to a manual copy.
- Tunnel and remote-desktop controls are admin/owner only.
