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

check_prereqs() {
  local ok=true

  # Android SDK
  if [ -z "${ANDROID_HOME:-}" ] && ! command -v sdkmanager &>/dev/null; then
    echo "Error: Android SDK not found."
    echo "Install Android SDK and set ANDROID_HOME, or install via Android Studio."
    ok=false
  fi

  # Java
  if ! command -v java &>/dev/null; then
    echo "Error: Java not found. Install JDK 21+."
    ok=false
  else
    JAVA_VERSION=$(java -version 2>&1 | head -n 1 | cut -d '"' -f 2 | cut -d '.' -f 1)
    if [ "$JAVA_VERSION" -lt 21 ]; then
      echo "Warning: Java $JAVA_VERSION detected. JDK 21+ recommended."
    fi
  fi

  # Node.js
  if ! command -v node &>/dev/null; then
    echo "Error: Node.js not found."
    ok=false
  fi

  if [ "$ok" = false ]; then
    exit 1
  fi

  echo "Prerequisites OK"
  echo ""
}

check_prereqs

# ── Build TypeScript ──────────────────────────────────────────────────────

echo "Compiling TypeScript..."
npx tsc
echo "TypeScript compiled ✓"
echo ""

# ── Web assets ────────────────────────────────────────────────────────────
# Capacitor serves android-web/ directly (webDir in capacitor.config.json).
# The Next.js web UI is a server app and is reached over the network.

# ── Initialize Capacitor if needed ───────────────────────────────────────

if [ ! -d "android" ] || [ ! -f "android/build.gradle" ]; then
  echo "Initializing Capacitor for Android..."
  npx cap add android
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

# ── Build APK (Release — unsigned) ────────────────────────────────────────

echo "Building Android APK (Release, unsigned)..."
./gradlew assembleRelease
echo "Release APK built ✓"
echo ""

# ── Build AAB (Release) ──────────────────────────────────────────────────

echo "Building Android AAB (Release)..."
./gradlew bundleRelease
echo "Release AAB built ✓"
echo ""

cd "$PROJECT_DIR"

# ── Copy artifacts to release/ ────────────────────────────────────────────

RELEASE_DIR="$PROJECT_DIR/release"
mkdir -p "$RELEASE_DIR"

echo "Copying APK artifacts to release/..."
cp android/app/build/outputs/apk/debug/*.apk "$RELEASE_DIR/" 2>/dev/null || true
cp android/app/build/outputs/apk/release/*.apk "$RELEASE_DIR/" 2>/dev/null || true
cp android/app/build/outputs/bundle/release/*.aab "$RELEASE_DIR/" 2>/dev/null || true
echo "Artifacts copied ✓"
echo ""

echo "══════════════════════════════════════════════"
echo "Android build complete!"
echo ""
echo "APK (Debug):   android/app/build/outputs/apk/debug/"
echo "APK (Release): android/app/build/outputs/apk/release/"
echo "AAB (Release): android/app/build/outputs/bundle/release/"
echo "Artifacts:     release/"
echo "══════════════════════════════════════════════"
