#!/usr/bin/env bash
# GhostForge — Build Desktop App via Electron
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT/web-ui"
echo "  GhostForge Desktop Builder (Electron)"
cd "$WEB_DIR"
npm run build 2>&1 | tail -5
npm install electron electron-builder --save-dev --legacy-peer-deps 2>&1 | tail -3
# Add electron entry if not present
if [ ! -f electron.js ]; then
cat > electron.js << 'ELEOF'
const { app, BrowserWindow } = require('electron');
const path = require('path');
function createWindow() {
  const win = new BrowserWindow({ width: 1400, height: 900, webPreferences: { nodeIntegration: false } });
  win.loadURL('http://localhost:3001');
  win.setTitle('GhostForge AI');
}
app.whenReady().then(createWindow);
ELEOF
fi
echo "  Building for current platform..."
npx electron-builder build 2>&1 | tail -10
echo "  ✓ Check dist/ folder for your app"
