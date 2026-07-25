#!/bin/bash
# GhostForge JARVIS — Build Android APK & AAB
# Requires: Android SDK, Java 21+, Capacitor

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║  GhostForge JARVIS — Android Build           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Check prerequisites ───────────────────────────────────────────────────

if [ -z "${ANDROID_HOME:-}" ] && ! command -v sdkmanager &>/dev/null; then
  echo "Error: Android SDK not found."
  echo "Install Android SDK and set ANDROID_HOME, or install via Android Studio."
  exit 1
fi

if ! command -v java &>/dev/null; then
  echo "Error: Java not found. Install JDK 21+."
  exit 1
fi

JAVA_VERSION=$(java -version 2>&1 | head -n 1 | cut -d '"' -f 2 | cut -d '.' -f 1)
if [ "$JAVA_VERSION" -lt 21 ]; then
  echo "Warning: Java $JAVA_VERSION detected. JDK 21+ recommended."
fi

# ── Build TypeScript ──────────────────────────────────────────────────────

echo "Compiling TypeScript..."
npx tsc
echo "TypeScript compiled ✓"
echo ""

# ── Build web assets ──────────────────────────────────────────────────────

WEB_UI_DIR="$PROJECT_DIR/../web-ui"
if [ -d "$WEB_UI_DIR" ]; then
  echo "Building web UI..."
  cd "$WEB_UI_DIR"
  npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
  npm run build
  cd "$PROJECT_DIR"
  echo "Web UI built ✓"
  echo ""
fi

# ── Sync Capacitor ────────────────────────────────────────────────────────

echo "Syncing Capacitor..."
npx cap sync android
echo "Capacitor synced ✓"
echo ""

# ── Build APK (Debug) ─────────────────────────────────────────────────────

echo "Building Android APK (Debug)..."
cd android
chmod +x gradlew 2>/dev/null || true
./gradlew assembleDebug
echo "Debug APK built ✓"
echo ""

# ── Build APK (Release) ──────────────────────────────────────────────────

echo "Building Android APK (Release)..."
./gradlew assembleRelease
echo "Release APK built ✓"
echo ""

# ── Build AAB (Release) ──────────────────────────────────────────────────

echo "Building Android AAB (Release)..."
./gradlew bundleRelease
echo "Release AAB built ✓"
echo ""

cd "$PROJECT_DIR"

echo "══════════════════════════════════════════════"
echo "Android build complete!"
echo ""
echo "APK (Debug):   android/app/build/outputs/apk/debug/"
echo "APK (Release): android/app/build/outputs/apk/release/"
echo "AAB (Release): android/app/build/outputs/bundle/release/"
echo "══════════════════════════════════════════════"
