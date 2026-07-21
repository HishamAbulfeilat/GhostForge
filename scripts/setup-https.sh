#!/bin/bash
# GhostForge HTTPS Setup — mkcert local certificate
# Enables mic/camera access from non-localhost devices (iPhone, other Macs)
# ────────────────────────────────────────────────────────────────────────────

set -e
cd ~/GhostForge/web-ui

echo "🔐 GhostForge HTTPS Setup"
echo "=========================="

# Install mkcert
if ! command -v mkcert &>/dev/null; then
  echo "📦 Installing mkcert..."
  if command -v brew &>/dev/null; then
    brew install mkcert nss
  else
    echo "❌ Homebrew not found. Install mkcert manually: https://github.com/FiloSottile/mkcert"
    exit 1
  fi
fi

echo "✓ mkcert installed"

# Install local CA
mkcert -install
echo "✓ Local CA installed (trusted by your Mac)"

# Get local IP
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "192.168.1.x")
echo "📍 Local IP detected: $LOCAL_IP"

# Generate cert for localhost + local IP
mkdir -p certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost 127.0.0.1 "$LOCAL_IP" ::1
echo "✓ Certificates generated: web-ui/certs/cert.pem + key.pem"

# Update next.config.mjs to use HTTPS
cat > next.config.mjs << 'NEXTCONFIG'
/** @type {import('next').NextConfig} */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

let httpsConfig = {}
try {
  httpsConfig = {
    key: readFileSync(join(__dirname, 'certs', 'key.pem')),
    cert: readFileSync(join(__dirname, 'certs', 'cert.pem')),
  }
} catch { /* certs not yet generated */ }

const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['resemblyzer'],
  },
  server: Object.keys(httpsConfig).length > 0 ? httpsConfig : undefined,
}

export default nextConfig
NEXTCONFIG

echo "✓ next.config.mjs updated for HTTPS"

# Update .env.local NEXTAUTH_URL if present
if grep -q "NEXTAUTH_URL" .env.local 2>/dev/null; then
  sed -i '' "s|http://localhost:3001|https://localhost:3001|g" .env.local
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║           HTTPS SETUP COMPLETE                       ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║ Restart the server:  npm start -- -p 3001            ║"
echo "║                                                      ║"
echo "║ Access from:                                         ║"
echo "║   https://localhost:3001      (this Mac)             ║"
echo "║   https://$LOCAL_IP:3001   (any device on LAN)   ║"
echo "║                                                      ║"
echo "║ On iPhone: Settings → Wi-Fi → trust this IP cert    ║"
echo "║ Or install the CA: mkcert -CAROOT (copy to phone)   ║"
echo "╚══════════════════════════════════════════════════════╝"

# Add certs to gitignore
if ! grep -q "certs/" ~/GhostForge/web-ui/.gitignore 2>/dev/null; then
  echo "certs/" >> ~/GhostForge/web-ui/.gitignore
fi
