# Signing release builds

The **Build Apps** workflow (`.github/workflows/build-apps.yml`) builds every
platform on each push to `main`, and publishes a GitHub Release for `v*` tags.
Builds are **unsigned** until you add the secrets below under
*Settings → Secrets and variables → Actions*. Each platform is independent —
add only the ones you need.

## Windows (Authenticode)

| Secret | Value |
|---|---|
| `WIN_CSC_LINK` | Base64 of your `.pfx` code-signing certificate (`base64 -w0 cert.pfx`) |
| `WIN_CSC_KEY_PASSWORD` | The `.pfx` password |

Without them Windows shows a SmartScreen warning on first run.

## macOS (Developer ID + notarization)

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | Base64 of the *Developer ID Application* `.p12` |
| `MAC_CSC_KEY_PASSWORD` | The `.p12` password |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Your 10-character team ID |

`electron-app/scripts/notarize.js` notarizes automatically when `APPLE_ID` and
`APPLE_APP_SPECIFIC_PASSWORD` are set.

## Android (APK + AAB)

Create a keystore once and keep it safe — Google Play requires every update to
be signed with the same key:

```bash
keytool -genkeypair -v -keystore release.keystore -alias ghostforge \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 release.keystore   # → ANDROID_KEYSTORE_BASE64
```

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64 of `release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `ghostforge` (or the alias you chose) |
| `ANDROID_KEY_PASSWORD` | Key password |

Locally, export the same variables with `ANDROID_KEYSTORE_PATH` pointing at the
keystore file and run `./gradlew assembleRelease bundleRelease` in
`electron-app/android`.

## iOS (App Store / TestFlight .ipa)

Signing uses an App Store Connect API key, so Xcode manages certificates and
profiles automatically:

| Secret | Value |
|---|---|
| `ASC_KEY_ID` | API key ID (App Store Connect → Users and Access → Integrations) |
| `ASC_ISSUER_ID` | Issuer ID shown on the same page |
| `ASC_KEY_P8` | Contents of the downloaded `AuthKey_XXXX.p8` |
| `APPLE_TEAM_ID` | Your team ID |

Register the bundle ID `com.ghostforge.jarvis` in your Apple Developer account
first. Without these secrets the workflow still produces an unsigned simulator
build.
