#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════╗
# ║  GhostForge — Build iOS IPA via Capacitor + Xcode    ║
# ╚══════════════════════════════════════════════════════╝
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT/web-ui"

echo ""
echo "  ██████╗ ███████╗  GhostForge iOS Builder"
echo "  ██╔════╝ ██╔════╝  Capacitor → iOS IPA"
echo ""

# Check prerequisites
check() { command -v "$1" &>/dev/null && echo "  ✓ $1" || { echo "  ✗ $1 — $2"; exit 1; }; }
check node  "Install from nodejs.org"
check pod   "sudo gem install cocoapods"
if ! xcode-select -p &>/dev/null; then
  echo "  ✗ Xcode not found — Install from App Store"; exit 1
fi
echo "  ✓ Xcode: $(xcodebuild -version 2>/dev/null | head -1)"

echo ""
echo "  Step 1/5 — Building Next.js app..."
cd "$WEB_DIR"
npm run build 2>&1 | tail -5

echo "  Step 2/5 — Installing Capacitor iOS..."
npm install @capacitor/core @capacitor/cli @capacitor/ios --legacy-peer-deps 2>&1 | tail -3

echo "  Step 3/5 — Initializing Capacitor..."
if [ ! -f capacitor.config.ts ] && [ ! -f capacitor.config.json ]; then
  cat > capacitor.config.ts << 'CAPEOF'
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ghostforge.app',
  appName: 'GhostForge AI',
  webDir: 'out',
  server: {
    url: 'http://192.168.1.100:3001',
    cleartext: true,
  },
};

export default config;
CAPEOF
fi

npx cap add ios 2>&1 | tail -5 || echo "  (ios platform may already exist)"
npx cap sync ios 2>&1 | tail -5

echo "  Step 4/5 — Installing CocoaPods..."
cd ios/App && pod install 2>&1 | tail -5
cd "$WEB_DIR"

echo "  Step 5/5 — Done!"
echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  Next steps:                                    │"
echo "  │  1. npx cap open ios     → opens Xcode          │"
echo "  │  2. Select team (free Apple ID works for test)  │"
echo "  │  3. Product → Archive → Distribute App          │"
echo "  │  4. Or: Product → Run (install to connected phone)│"
echo "  └─────────────────────────────────────────────────┘"
echo ""

read -r -p "  Open in Xcode now? [y/N] " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
  npx cap open ios
fi
