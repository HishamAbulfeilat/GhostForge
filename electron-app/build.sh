#!/usr/bin/env bash
# GhostForge JARVIS — platform build entrypoint
# Android is invoked via the portable script in scripts/build-android.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "help" ] || [ "${2:-}" = "-h" ] || [ "${2:-}" = "--help" ] || [ "${2:-}" = "help" ]; then
  echo "Usage: $0 [mac|win|linux|android|all|deps|ts] [debug|release|bundle]"
  echo ""
  echo "  macos    - Build macOS .dmg and .zip"
  echo "  windows  - Build Windows .exe installer"
  echo "  linux    - Build Linux .AppImage, .deb, .rpm"
  echo "  android  - Build Android .apk"
  echo "  all      - Build all desktop platforms"
  echo "  deps     - Install dependencies only"
  echo "  ts       - Build TypeScript only"
  exit 0
fi

echo "╔══════════════════════════════════════════════╗"
echo "║  GhostForge JARVIS — Build Script            ║"
echo "║  v5.2.1                                       ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

check_prerequisites() {
  echo "Checking prerequisites..."

  if ! command -v node &>/dev/null; then
    echo "Error: Node.js not found. Install from https://nodejs.org"
    exit 1
  fi

  if ! command -v npm &>/dev/null; then
    echo "Error: npm not found."
    exit 1
  fi

  echo "Node.js $(node -v) ✓"
  echo "npm $(npm -v) ✓"
  echo ""
}

install_deps() {
  echo "Installing dependencies..."
  npm install
  echo ""
}

build_ts() {
  echo "Building TypeScript..."
  npx tsc
  echo "TypeScript build complete ✓"
  echo ""
}

build_mac() {
  echo "Building for macOS (x64 + arm64)..."
  npx electron-builder --mac --publish never
  echo "macOS build complete ✓"
  echo "  Output: release/*.dmg, release/*.zip"
  echo ""
}

build_windows() {
  echo "Building for Windows (x64)..."
  npx electron-builder --win --publish never
  echo "Windows build complete ✓"
  echo "  Output: release/*.exe"
  echo ""
}

build_linux() {
  echo "Building for Linux (x64)..."
  npx electron-builder --linux --publish never
  echo "Linux build complete ✓"
  echo "  Output: release/*.AppImage, release/*.deb, release/*.rpm"
  echo ""
}

build_android() {
  local target="${1:-debug}"
  echo "Building for Android..."
  bash scripts/build-android.sh "$target"
  echo "Android build complete ✓"
  echo ""
}

build_all() {
  local target="${1:-debug}"
  echo "Building for all platforms..."
  echo ""

  build_mac
  build_windows
  build_linux

  echo "══════════════════════════════════════════════"
  echo "All desktop builds complete!"
  echo "══════════════════════════════════════════════"
  echo ""

  if [ -n "${ANDROID_HOME:-}" ] || [ -n "${ANDROID_SDK_ROOT:-}" ] || command -v sdkmanager &>/dev/null; then
    build_android "$target"
  else
    echo "Android SDK not found. Skipping Android build."
    echo "To build Android: set ANDROID_HOME or ANDROID_SDK_ROOT to your Android SDK path."
  fi
}

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
    build_android "${2:-debug}"
    ;;
  all)
    check_prerequisites
    install_deps
    build_ts
    build_all "${2:-debug}"
    ;;
  deps)
    check_prerequisites
    install_deps
    ;;
  ts)
    build_ts
    ;;
  *)
    echo "Usage: $0 [mac|win|linux|android|all|deps|ts] [debug|release|bundle]"
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
