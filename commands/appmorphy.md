# /appmorphy Command

## Description
Convert any website or web app into a native Android APK using **AppMorphy** — a private cloud build platform. Ideal for wrapping a PWA, web dashboard, or internal tool as a distributable Android app without configuring Capacitor or Android Studio locally.

## Usage
```
/appmorphy
/appmorphy --url https://myapp.com --name "My App"
/appmorphy --url https://dashboard.internal --icon ./assets/icon.png
```

## How It Works
1. **Submit** — Provide your web URL, app name, package ID, and icon via the AppMorphy build form.
2. **Build** — AppMorphy's isolated cloud pipeline compiles an APK using Capacitor/WebView.
3. **Monitor** — A private status page (unique token URL) shows real-time compile logs.
4. **Download** — Once complete, download the signed APK and share it with clients or QA.

## Key Features
- 🔒 **Private builds** — Build list never exposed publicly; each build has a unique token URL
- 🏗️ **Zero local setup** — No Android Studio, Java, or Gradle required on your machine
- 📦 **Instant distribution** — Share the APK download link directly with your team or client
- 📊 **Real-time logs** — Watch the compilation pipeline progress live in the browser

## Build Form Fields
| Field | Description | Example |
|-------|-------------|---------|
| URL | Target website to wrap | `https://app.example.com` |
| App Name | Display name on the device | `My App` |
| Package ID | Android package identifier | `com.example.myapp` |
| Icon | App icon (PNG, 512×512 recommended) | `./assets/icon.png` |

## When to Use AppMorphy vs EAS Build
| Scenario | Use |
|----------|-----|
| Wrap existing web app as APK | **AppMorphy** |
| React Native app → Play Store | EAS Build |
| Quick APK for internal testing | **AppMorphy** |
| Full native mobile app | EAS Build |
| PWA → Android APK (no code changes) | **AppMorphy** |

## GhostForge Integration
```
ghostforge appmorphy open         # Open AppMorphy in browser
ghostforge appmorphy build        # Print build checklist and open form
ghostforge appmorphy status <url> # Open a build status URL
```

## Links
- 🌐 Platform: https://appmorphy.app
- 🏗️ Build form: https://appmorphy.app/build
- 📖 About: https://appmorphy.app/about
