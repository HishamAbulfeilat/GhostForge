#!/bin/bash
# GhostForge JARVIS — Build Script
# Builds for macOS, Windows, Linux, and Android

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║  GhostForge JARVIS — Build Script            ║"
echo "║  v5.2.0                                       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Prerequisites ────────────────────────────────────────────────────────────

check_prerequisites() {
  echo "Checking prerequisites..."

  if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found. Install from https://nodejs.org"
    exit 1
  fi

  if ! command -v npm &> /dev/null; then
    echo "Error: npm not found."
    exit 1
  fi

  echo "Node.js $(node -v) ✓"
  echo "npm $(npm -v) ✓"
  echo ""
}

# ── Install Dependencies ─────────────────────────────────────────────────────

install_deps() {
  echo "Installing dependencies..."
  npm install
  echo ""
}

# ── Build TypeScript ─────────────────────────────────────────────────────────

build_ts() {
  echo "Building TypeScript..."
  npx tsc
  echo "TypeScript build complete ✓"
  echo ""
}

# ── macOS Build ──────────────────────────────────────────────────────────────

build_mac() {
  echo "Building for macOS (x64 + arm64)..."
  npx electron-builder --mac --publish never
  echo "macOS build complete ✓"
  echo "  Output: release/*.dmg, release/*.zip"
  echo ""
}

# ── Windows Build ────────────────────────────────────────────────────────────

build_windows() {
  echo "Building for Windows (x64)..."
  npx electron-builder --win --publish never
  echo "Windows build complete ✓"
  echo "  Output: release/*.exe"
  echo ""
}

# ── Linux Build ──────────────────────────────────────────────────────────────

build_linux() {
  echo "Building for Linux (x64)..."
  npx electron-builder --linux --publish never
  echo "Linux build complete ✓"
  echo "  Output: release/*.AppImage, release/*.deb, release/*.rpm"
  echo ""
}

# ── Android Build ────────────────────────────────────────────────────────────

build_android() {
  echo "Building for Android..."

  # Check if Capacitor is initialized
  if [ ! -f "android/build.gradle" ]; then
    echo "Initializing Capacitor for Android..."
    npx cap add android
  fi

  # Build web assets
  cd ../web-ui
  npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
  npm run build
  cd "$SCRIPT_DIR"

  # Sync with Capacitor
  npx cap sync android

  # Build APK
  cd android
  ./gradlew assembleDebug
  cd "$SCRIPT_DIR"

  echo "Android build complete ✓"
  echo "  Output: android/app/build/outputs/apk/debug/*.apk"
  echo ""
}

# ── All Platforms ────────────────────────────────────────────────────────────

build_all() {
  echo "Building for all platforms..."
  echo ""

  build_mac
  build_windows
  build_linux

  echo "══════════════════════════════════════════════"
  echo "All desktop builds complete!"
  echo "══════════════════════════════════════════════"
  echo ""

  # Android requires Android SDK
  if command -v sdkmanager &> /dev/null || [ -n "$ANDROID_HOME" ]; then
    build_android
  else
    echo "Android SDK not found. Skipping Android build."
    echo "To build Android: install Android SDK and set ANDROID_HOME"
  fi
}

# ── Parse Arguments ──────────────────────────────────────────────────────────

case "${1:-all}" in
  mac|macos)
    check_prerequisites
    install_deps
    build_ts
    build_mac
    ;;
  win|windows)
    check_prerequisites
    install_deps
    build_ts
    build_windows
    ;;
  linux)
    check_prerequisites
    install_deps
    build_ts
    build_linux
    ;;
  android)
    check_prerequisites
    install_deps
    build_ts
    build_android
    ;;
  all)
    check_prerequisites
    install_deps
    build_ts
    build_all
    ;;
  deps)
    check_prerequisites
    install_deps
    ;;
  ts)
    build_ts
    ;;
  *)
    echo "Usage: $0 [mac|win|linux|android|all|deps|ts]"
    echo ""
    echo "  macos    - Build macOS .dmg and .zip"
    echo "  windows  - Build Windows .exe installer"
    echo "  linux    - Build Linux .AppImage, .deb, .rpm"
    echo "  android  - Build Android .apk"
    echo "  all      - Build all desktop platforms"
    echo "  deps     - Install dependencies only"
    echo "  ts       - Build TypeScript only"
    exit 1
    ;;
esac

echo "Build script complete! 🚀"
