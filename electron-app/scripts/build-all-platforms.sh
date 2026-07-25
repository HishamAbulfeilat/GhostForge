#!/bin/bash
# GhostForge JARVIS — Universal Build Script
# Builds for ALL platforms: macOS, Windows, Linux, Android
# Usage: ./build-all-platforms.sh [--release]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

RELEASE_FLAG=""
if [ "${1:-}" = "--release" ]; then
  RELEASE_FLAG="--publish always"
else
  RELEASE_FLAG="--publish never"
fi

echo "╔══════════════════════════════════════════════╗"
echo "║  GhostForge JARVIS — Universal Build         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Check Prerequisites ───────────────────────────────────────────────────

check_prereqs() {
  local ok=true

  if ! command -v node &>/dev/null; then
    echo "Error: Node.js not found"
    ok=false
  fi

  if ! command -v npm &>/dev/null; then
    echo "Error: npm not found"
    ok=false
  fi

  if [ "$ok" = false ]; then
    exit 1
  fi

  echo "Node.js $(node -v)"
  echo "npm $(npm -v)"
  echo ""
}

# ── Generate Icons ────────────────────────────────────────────────────────

generate_icons() {
  echo "=== Generating Icons ==="
  if [ ! -f "build/icon.icns" ] || [ ! -f "build/icon.ico" ] || [ ! -f "build/icons/icon.png" ]; then
    node scripts/generate-icons.js
  else
    echo "Icons already exist, skipping generation"
  fi
  echo ""
}

# ── Build TypeScript ──────────────────────────────────────────────────────

build_ts() {
  echo "=== Building TypeScript ==="
  npx tsc
  echo "TypeScript compiled"
  echo ""
}

# ── Build Web UI ──────────────────────────────────────────────────────────

build_web() {
  local web_dir="$PROJECT_DIR/../web-ui"
  if [ -d "$web_dir" ]; then
    echo "=== Building Web UI ==="
    cd "$web_dir"
    npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
    npm run build
    cd "$PROJECT_DIR"
    echo "Web UI built"
    echo ""
  fi
}

# ── macOS Build ────────────────────────────────────────────────────────────

build_mac() {
  echo "=== Building macOS DMG (arm64) ==="
  npx electron-builder --mac dmg --arm64 $RELEASE_FLAG
  echo ""

  echo "=== Building macOS DMG (x64) ==="
  npx electron-builder --mac dmg --x64 $RELEASE_FLAG
  echo ""

  echo "=== Building macOS ZIP ==="
  npx electron-builder --mac zip $RELEASE_FLAG
  echo ""
}

# ── Windows Build ──────────────────────────────────────────────────────────

build_win() {
  echo "=== Building Windows NSIS Installer ==="
  npx electron-builder --win nsis --x64 $RELEASE_FLAG
  echo ""

  echo "=== Building Windows Portable ==="
  npx electron-builder --win portable --x64 $RELEASE_FLAG
  echo ""
}

# ── Linux Build ────────────────────────────────────────────────────────────

build_linux() {
  echo "=== Building Linux AppImage ==="
  npx electron-builder --linux AppImage --x64 $RELEASE_FLAG
  echo ""

  echo "=== Building Linux DEB ==="
  npx electron-builder --linux deb --x64 $RELEASE_FLAG
  echo ""

  echo "=== Building Linux RPM ==="
  npx electron-builder --linux rpm --x64 $RELEASE_FLAG
  echo ""
}

# ── Android Build ──────────────────────────────────────────────────────────

build_android() {
  echo "=== Building Android APK ==="

  # Check if Android SDK is available
  if [ -z "${ANDROID_HOME:-}" ] && ! command -v sdkmanager &>/dev/null; then
    echo "Android SDK not found, skipping Android build"
    echo "Set ANDROID_HOME or install Android Studio"
    echo ""
    return 0
  fi

  if ! command -v java &>/dev/null; then
    echo "Java not found, skipping Android build"
    echo "Install JDK 21+ for Android builds"
    echo ""
    return 0
  fi

  bash scripts/build-android.sh
  echo ""
}

# ── Main ───────────────────────────────────────────────────────────────────

check_prereqs
generate_icons
build_ts
build_web
build_mac
build_win
build_linux
build_android

echo "=== All builds complete! ==="
echo ""
ls -la release/ 2>/dev/null || echo "No release artifacts found"
