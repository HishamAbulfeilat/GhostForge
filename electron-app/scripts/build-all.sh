#!/bin/bash
# GhostForge JARVIS — Build for All Platforms
# Produces macOS (.dmg, .zip), Windows (.exe, portable), Linux (.AppImage, .deb, .rpm, .snap)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║  GhostForge JARVIS — Cross-Platform Build    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── TypeScript Compile ──────────────────────────────────────────────────────

echo "Compiling TypeScript..."
npx tsc
echo "TypeScript compiled ✓"
echo ""

# ── macOS ──────────────────────────────────────────────────────────────────

echo "Building for macOS (x64 + arm64)..."
npx electron-builder --mac --publish never
echo "macOS build complete ✓"
echo ""

# ── Windows ────────────────────────────────────────────────────────────────

echo "Building for Windows (x64)..."
npx electron-builder --win --publish never
echo "Windows build complete ✓"
echo ""

# ── Linux ──────────────────────────────────────────────────────────────────

echo "Building for Linux (x64)..."
npx electron-builder --linux --publish never
echo "Linux build complete ✓"
echo ""

echo "══════════════════════════════════════════════"
echo "All desktop builds complete!"
echo "Artifacts in: release/"
echo "══════════════════════════════════════════════"
