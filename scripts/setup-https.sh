#!/bin/bash
# GhostForge HTTPS Setup — mkcert local certificate
# Enables mic/camera access from non-localhost devices (iPhone, other Macs).
#
# This script only installs the CA and generates certificates into web-ui/certs/.
# It does NOT touch next.config.mjs — the HTTPS custom server (web-ui/server.js)
# reads these certs and auto-regenerates them when missing or expired.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_UI_DIR="$SCRIPT_DIR/../web-ui"
CERT_DIR="$WEB_UI_DIR/certs"

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

# Install local CA (trusted by this machine)
mkcert -install
echo "✓ Local CA installed (trusted by this Mac)"

# Detect a real LAN IP (skip placeholder/loopback addresses)
LOCAL_IP=""
for iface in en0 en1 en2 en3; do
  IP=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
  if [[ -n "$IP" && "$IP" != 192.168.1.x && "$IP" != 127.* ]]; then
    LOCAL_IP="$IP"
    break
  fi
done

if [[ -z "$LOCAL_IP" ]]; then
  echo "⚠  Could not detect a LAN IP — cert will only cover localhost."
fi

# Generate cert for localhost + local IP (server.js regenerates if expired)
mkdir -p "$CERT_DIR"
ARGS=( -key-file "$CERT_DIR/key.pem" -cert-file "$CERT_DIR/cert.pem" localhost 127.0.0.1 ::1 )
if [[ -n "$LOCAL_IP" ]]; then
  ARGS+=( "$LOCAL_IP" )
fi
mkcert "${ARGS[@]}"
echo "✓ Certificates generated: web-ui/certs/cert.pem + key.pem"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║           HTTPS SETUP COMPLETE                       ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║ Start the server:  npm start (in web-ui/)            ║"
echo "║                                                      ║"
echo "║ Access from:                                         ║"
echo "║   https://localhost:3001      (this Mac)             ║"
echo "║   http://localhost:3000  →   https (auto-redirect)   ║"
if [[ -n "$LOCAL_IP" ]]; then
  echo "║   https://$LOCAL_IP:3001   (any device on LAN)   ║"
fi
echo "║                                                      ║"
echo "║ On iPhone: Settings → Wi-Fi → trust this IP cert    ║"
echo "║ Or install the CA on other devices:                 ║"
echo "║   mkcert -CAROOT  (copy rootCA.pem to the device)   ║"
echo "╚══════════════════════════════════════════════════════╝"
