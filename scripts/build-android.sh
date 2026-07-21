#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════╗
# ║  GhostForge — Build Android APK via Capacitor        ║
# ╚══════════════════════════════════════════════════════╝
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT/web-ui"

echo ""
echo "  ██████╗ ███████╗  GhostForge Android Builder"
echo "  ██╔════╝ ██╔════╝  Capacitor → Android APK"
echo ""

# Check prerequisites
check() { command -v "$1" &>/dev/null && echo "  ✓ $1" || { echo "  ✗ $1 not found — $2"; exit 1; }; }
check node   "Install from nodejs.org"
check npm    "Install from nodejs.org"
check java   "brew install openjdk@17 && export JAVA_HOME=\$(brew --prefix openjdk@17)"

if [ ! -d "$ANDROID_HOME" ] 2>/dev/null && [ ! -d "$HOME/Library/Android/sdk" ]; then
  echo ""
  echo "  ⚠  Android SDK not found."
  echo "  Install Android Studio: https://developer.android.com/studio"
  echo "  Then set: export ANDROID_HOME=~/Library/Android/sdk"
  echo ""
fi

echo ""
echo "  Step 1/5 — Building Next.js app..."
cd "$WEB_DIR"
npm run build 2>&1 | tail -5

# Export static files (Next.js needs output: 'export' in next.config)
echo "  Step 2/5 — Exporting static build..."
if ! grep -q "output.*export" next.config.* 2>/dev/null; then
  echo "  Adding static export config to next.config.mjs..."
  sed -i '' "s/const nextConfig = {/const nextConfig = {\n  output: 'export',/" next.config.mjs 2>/dev/null || true
fi
npm run build 2>&1 | tail -3

echo "  Step 3/5 — Installing Capacitor..."
npm install @capacitor/core @capacitor/cli @capacitor/android --legacy-peer-deps 2>&1 | tail -3

echo "  Step 4/5 — Initializing Capacitor..."
if [ ! -f capacitor.config.ts ] && [ ! -f capacitor.config.json ]; then
  cat > capacitor.config.ts << 'CAPEOF'
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ghostforge.app',
  appName: 'GhostForge AI',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    url: 'http://192.168.1.100:3001',
    cleartext: true,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 1500, backgroundColor: '#0a0a0a', splashImmersive: true },
  },
};

export default config;
CAPEOF
  echo "  ✓ Created capacitor.config.ts"
fi

npx cap add android 2>&1 | tail -5 || echo "  (android platform may already exist)"
npx cap sync android 2>&1 | tail -5

echo "  Step 5/5 — Done!"
echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  Next steps:                                    │"
echo "  │  1. npx cap open android   → Android Studio     │"
echo "  │  2. Build → Generate Signed Bundle/APK          │"
echo "  │  3. Or: ./gradlew assembleDebug (debug APK)     │"
echo "  └─────────────────────────────────────────────────┘"
echo ""

# Try to open Android Studio
if command -v npx &>/dev/null; then
  read -r -p "  Open in Android Studio now? [y/N] " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    npx cap open android
  fi
fi
