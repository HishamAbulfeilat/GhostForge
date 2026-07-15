#!/usr/bin/env bash
set -euo pipefail

# Usage: notify.sh [slack|teams] [webhook_url] [message] [level: info|warning|critical] [action_url] [action_text]

CHANNEL="${1:-}"
WEBHOOK_URL="${2:-}"
MESSAGE="${3:-}"
LEVEL="${4:-info}"
ACTION_URL="${5:-}"
ACTION_TEXT="${6:-Open Link}"

BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

if [[ -z "$CHANNEL" || -z "$WEBHOOK_URL" || -z "$MESSAGE" ]]; then
  echo -e "${RED}${BOLD}✖ Usage:${NC} notify.sh [slack|teams] [webhook_url] [message] [level] [action_url] [action_text]"
  exit 1
fi

if [[ ! "$CHANNEL" =~ ^(slack|teams)$ ]]; then
  echo -e "${RED}${BOLD}✖ Unsupported channel:${NC} $CHANNEL"
  exit 1
fi

case "$LEVEL" in
  critical)
    COLOR_HEX="#D92D20"
    ANSI_COLOR="$RED"
    LEVEL_LABEL="CRITICAL"
    ;;
  warning)
    COLOR_HEX="#F79009"
    ANSI_COLOR="$YELLOW"
    LEVEL_LABEL="WARNING"
    ;;
  *)
    COLOR_HEX="#1570EF"
    ANSI_COLOR="$BLUE"
    LEVEL_LABEL="INFO"
    ;;
esac

VERSION="$(cat "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/VERSION" 2>/dev/null || echo "2.2.0")"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"
TITLE="GhostForge AI Developer Toolkit v${VERSION}"

if [[ "$CHANNEL" == "slack" ]]; then
  PAYLOAD="$(python3 - <<'PY' "$TITLE" "$MESSAGE" "$LEVEL_LABEL" "$COLOR_HEX" "$TIMESTAMP" "$ACTION_URL" "$ACTION_TEXT"
import json, sys
_, title, message, level_label, color_hex, timestamp, action_url, action_text = sys.argv
blocks = [
  {"type": "header", "text": {"type": "plain_text", "text": f"{title} — {level_label}"}},
  {"type": "section", "fields": [
    {"type": "mrkdwn", "text": f"*Level:* {level_label}"},
    {"type": "mrkdwn", "text": f"*Timestamp:* {timestamp}"}
  ]},
  {"type": "section", "text": {"type": "mrkdwn", "text": message}}
]
if action_url:
  blocks.append({
    "type": "actions",
    "elements": [{
      "type": "button",
      "text": {"type": "plain_text", "text": action_text or "Open Link"},
      "url": action_url,
      "style": "danger" if level_label == "CRITICAL" else "primary"
    }]
  })
payload = {
  "attachments": [{"color": color_hex, "blocks": blocks}],
  "text": f"{title} — {level_label}: {message}"
}
print(json.dumps(payload))
PY
)"
else
  PAYLOAD="$(python3 - <<'PY' "$TITLE" "$MESSAGE" "$LEVEL_LABEL" "$COLOR_HEX" "$TIMESTAMP" "$ACTION_URL" "$ACTION_TEXT"
import json, sys
_, title, message, level_label, color_hex, timestamp, action_url, action_text = sys.argv
payload = {
  "@type": "MessageCard",
  "@context": "https://schema.org/extensions",
  "themeColor": color_hex.replace('#', ''),
  "summary": f"{title} — {level_label}",
  "title": f"{title} — {level_label}",
  "sections": [{
    "activityTitle": message,
    "facts": [
      {"name": "Level", "value": level_label},
      {"name": "Timestamp", "value": timestamp}
    ],
    "markdown": True
  }]
}
if action_url:
  payload["potentialAction"] = [{
    "@type": "OpenUri",
    "name": action_text or "Open Link",
    "targets": [{"os": "default", "uri": action_url}]
  }]
print(json.dumps(payload))
PY
)"
fi

echo -e "${ANSI_COLOR}${BOLD}➜ Sending ${LEVEL_LABEL} notification to ${CHANNEL}${NC}"
HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data "$PAYLOAD" "$WEBHOOK_URL")"

if [[ "$HTTP_CODE" =~ ^2 ]]; then
  echo -e "${GREEN}${BOLD}✔ Notification sent${NC} (${CHANNEL}, ${TIMESTAMP})"
else
  echo -e "${RED}${BOLD}✖ Notification failed${NC} (HTTP ${HTTP_CODE})"
  exit 1
fi
