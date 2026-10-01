# Android companion smoke test

This is a manual, device-level smoke test for the Android debug APK. Record
each check as **PASS**, **FAIL**, or **BLOCKED**; a packaging build or a
placeholder UI state is not evidence that a server-backed feature works.

## Current coverage limits

The APK packages `electron-app/android-web` as Capacitor assets. That page
does not currently provide account sign-in or a configurable GhostForge server
or bridge URL. Capacitor does not provide the Electron preload API that the
page uses for its native JARVIS connection, so the APK cannot verify an
end-to-end bridge connection. Its connection badge can show **Online** after
startup without checking a server.

The page's **Notifications** setting is a visual toggle only; the Android app
does not currently request notification permission or deliver a test
notification. Mark sign-in, app-to-bridge, and notification delivery as
**BLOCKED** for the APK until those integrations exist. Do not count a separate
mobile-browser test as proof that the APK passed them.

## Prerequisites

- An Android device or emulator running Android 7.0 (API 24) or later, with
  enough free storage to install the debug APK.
- A debug APK from the `Electron Android validation` workflow, or a local
  build. To build locally, use Node.js 22, JDK 21+, and an installed Android
  SDK; from `electron-app`, run:

  ```sh
  npm ci
  npx cap sync android
  bash scripts/build-android.sh debug
  ```

  The output is
  `electron-app/android/app/build/outputs/apk/debug/app-debug.apk`.
- For the separate mobile-browser sign-in and backend checks below, a reachable
  GhostForge web server, a test account, and (for the Mark-L health check) the
  bridge token. Keep credentials and tokens out of screenshots, logs, source
  files, and the APK. Use the server's LAN hostname or IP from the device;
  `localhost` on Android refers to the device itself.
- A network route from the test device to the server/bridge when checking
  online behavior. Voice permission checks also require a device/WebView that
  exposes speech recognition.

## CI packaging is not device verification

`.github/workflows/electron-android-validation.yml` runs `npx cap sync android`
and `bash scripts/build-android.sh debug`, then uploads the
`ghostforge-android-debug-apk` artifact. It does **not** install or launch the
APK on a device, sign in, contact the bridge, exercise permissions, simulate
offline behavior, or deliver a notification. Download the APK from that
workflow run's Artifacts section before starting the checks below.

## Device checks

1. **Install and launch**
   - Install the workflow APK using Android's package installer. For an
     artifact sideload, allow installation from the downloader app when
     Android prompts; alternatively, with USB debugging enabled, run
     `adb install -r app-debug.apk`.
   - Launch **GhostForge JARVIS** from the launcher.
   - **Pass:** installation completes and the JARVIS interface opens without
     crashing. Record the Android version, device model, APK source/run, and
     app version. This only verifies installation and launch.

2. **Sign in (separate mobile-browser check; not an APK capability)**
   - On the same device, open the deployed GhostForge web UI in Chrome at
     `https://<web-host>/login`. Sign in with a dedicated test account using
     its username and password, or the configured PIN option.
   - **Pass:** valid credentials reach the requested page (normally
     `/dashboard`); invalid credentials remain on the sign-in screen with an
     error. Record this as a web-UI-on-Android result, not an APK result: the
     packaged APK has no sign-in screen or account session flow.

3. **Bridge health and connection**
   - From a machine or Android shell that can reach the bridge, request
     `http://<bridge-host>:8765/api/mark-l/health` with the configured bridge
     token in either `X-Bridge-Token: <token>` or
     `Authorization: Bearer <token>`. The `/api/mark-l/health` route is
     token-protected; do not use `/health` as its substitute or omit the
     authorization header.
   - **Pass for the bridge service:** the authorized request returns HTTP 200
     with JSON containing `"ok": true` and `"service": "mark-l-bridge"`.
     An invalid token is unauthorized; an unconfigured bridge token returns
     service unavailable. Keep the token private.
   - This checks bridge reachability only. The APK has no bridge URL/token
     configuration and does not call this health route, so it cannot currently
     pass an app-to-bridge connection check. Do not infer a connection from
     the APK's **Online** badge.

4. **Assistant interaction**
   - In the APK, enter a harmless prompt such as `What time is it?` and tap
     Send once. Observe the first response and connection badge.
   - **Pass for an assistant interaction:** a server-backed assistant reply
     appears. Record a local canned answer separately; it is not evidence
     that remote AI or the bridge works. The current APK cannot meet this
     pass condition, so mark the server-backed interaction **BLOCKED** and
     record any visible reply/error only as a UI responsiveness observation.
   - The packaged page has no configured server origin and sends its fallback
     request to `/api/chat` relative to the local WebView. If a request throws,
     the first failure displays an error and switches to OmniRoute; it does
     **not** return a canned answer for that same prompt. A later prompt may
     receive a local canned response. If the request instead returns a
     non-success HTTP status, the page displays its server-error message.
     Record either path as a backend-integration gap, not a successful
     server-backed interaction.
   - For a separate backend interaction check, use the signed-in mobile
     browser session, send the same harmless prompt, and verify that a real
     assistant reply appears. Report that result separately from the APK.

5. **Microphone permission denial and recovery**
   - If speech recognition is available, open Android **Settings → Apps →
     GhostForge JARVIS → Permissions → Microphone** and deny microphone
     access. Return to the app and tap the Voice button.
   - **Pass for denial:** the app does not record or submit a transcript and
     does not crash. Confirm the permission remains denied in Android Settings.
   - Allow microphone access from the same Android permission page, return to
     the app, tap Voice, speak a short harmless phrase, and verify a transcript
     is captured (and submitted when recognition ends).
   - If the WebView reports that speech recognition is unavailable, record
     this check as **BLOCKED / unsupported on this device** rather than
     claiming permission denial or recovery passed.

6. **Offline indication**
   - With the app open, enable Airplane mode (or disable Wi-Fi and mobile data)
     and send a harmless prompt. Observe both the message and status badge.
   - **Pass:** the status badge visibly changes to **Offline** and the app
     remains usable. Restore connectivity and record whether the indication
     recovers; an error message alone is not an offline indication.
   - Current limitation: the packaged page initially labels itself **Online**
     without a network check. A thrown chat request changes the badge to
     **Offline** and switches to OmniRoute, but a non-success HTTP response
     only shows a server-error message. Treat a stale **Online** badge or no
     visible offline indication as a failure, not a pass.

7. **Notifications**
   - Check Android **Settings → Apps → GhostForge JARVIS → Notifications** for
     the app's system notification controls. In the app, open Settings and
     toggle **Notifications** off and on.
   - **Current expected result:** the in-app control only changes its visual
     state; there is no implemented notification trigger or delivery to
     verify. Mark notification delivery **BLOCKED** (not PASS) until the app
     integrates a notification API/plugin and provides a repeatable test
     notification. Once implemented, repeat with OS notifications denied,
     then allowed, and verify the test notification is suppressed and
     delivered respectively.

## Result record

For each run, record the date, tester, device/Android version, APK workflow
run or local build, and a PASS/FAIL/BLOCKED result plus observed message for
each numbered check. Keep credentials and bridge tokens out of the record.
