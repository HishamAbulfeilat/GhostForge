#!/bin/bash
# GhostForge JARVIS — Icon Generator Wrapper
# Generates build icons from SVG using Node.js + sharp

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║  GhostForge JARVIS — Icon Generator          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Error: Node.js not found. Install from https://nodejs.org"
  exit 1
fi

echo "Node.js $(node -v)"
echo ""

# Check sharp is installed
if ! node -e "require('sharp')" 2>/dev/null; then
  echo "Installing sharp..."
  npm install sharp --no-save
fi

echo "Generating icons..."
node scripts/generate-icons.js
echo ""
echo "Done! Icons are in build/ and build/icons/"
