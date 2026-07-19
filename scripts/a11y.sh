#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

ACTION="${1:-help}"
shift || true
DATA_DIR="$HOME/.ghostforge/a11y"
HISTORY_FILE="$DATA_DIR/history.csv"
LATEST_JSON="$DATA_DIR/latest-axe.json"
LATEST_RTL="$DATA_DIR/latest-rtl.txt"
mkdir -p "$DATA_DIR"
[[ -f "$HISTORY_FILE" ]] || echo 'date,url,critical,serious,moderate,minor,total' > "$HISTORY_FILE"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  ♿  GhostForge A11y Deep Auditor${NC}"
  echo -e "${DIM}  Run axe-core audits, inspect RTL issues, and track accessibility drift.${NC}"
  echo ""
}

install_cmd() {
  header
  npm install -g @axe-core/cli
}

audit_cmd() {
  local url="${1:-}"
  [[ -n "$url" ]] || {
    echo -e "${RED}✖ URL is required.${NC}"
    exit 1
  }
  command -v axe >/dev/null 2>&1 || {
    echo -e "${YELLOW}⚠ axe CLI not found. Run: bash scripts/a11y.sh install${NC}"
    exit 1
  }
  header
  axe "$url" --reporter json > "$LATEST_JSON"
  python3 - <<'PY' "$LATEST_JSON" "$url" "$HISTORY_FILE"
from pathlib import Path
import json, sys

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
url = sys.argv[2]
history = Path(sys.argv[3])
violations = report.get("violations", [])
counts = {"critical": 0, "serious": 0, "moderate": 0, "minor": 0}

for item in violations:
    impact = item.get("impact") or "minor"
    counts[impact] = counts.get(impact, 0) + 1

for impact in ["critical", "serious", "moderate", "minor"]:
    print(f"{impact}: {counts.get(impact, 0)}")
print(f"total: {len(violations)}")

with history.open("a", encoding="utf-8") as fh:
    fh.write(f"{__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')},{url},{counts.get('critical',0)},{counts.get('serious',0)},{counts.get('moderate',0)},{counts.get('minor',0)},{len(violations)}\n")
PY
}

rtl_cmd() {
  local dir="${1:-src}"
  [[ -d "$dir" ]] || {
    echo -e "${RED}✖ Directory not found: $dir${NC}"
    exit 1
  }
  header
  python3 - <<'PY' "$dir" "$LATEST_RTL"
from pathlib import Path
import re, sys

base = Path(sys.argv[1])
out = Path(sys.argv[2])
issues = []

for file in base.rglob("*"):
    if file.suffix not in {".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".scss"}:
        continue
    try:
        text = file.read_text(encoding="utf-8")
    except Exception:
        continue
    if "<html" in text and "lang=" not in text:
        issues.append(f"{file}: missing lang attribute on <html>")
    if 'dir="ltr"' in text or "dir='ltr'" in text:
        issues.append(f"{file}: hardcoded dir=\"ltr\"")
    if "text-align: left" in text or "text-left" in text:
        issues.append(f"{file}: left-aligned text without RTL override")
    if re.search(r"[\u0600-\u06FF]", text) and 'dir="rtl"' not in text and "dir='rtl'" not in text:
        issues.append(f"{file}: Arabic text detected without RTL container")

out.write_text("\n".join(issues) + ("\n" if issues else ""), encoding="utf-8")
if issues:
    print("\n".join(issues[:50]))
else:
    print("✅ No RTL-specific a11y issues detected.")
PY
}

report_cmd() {
  header
  local file="$DATA_DIR/report-$(date +%Y%m%d-%H%M%S).md"
  {
    echo "# Accessibility Report"
    echo ""
    echo "Generated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    if [[ -f "$LATEST_JSON" ]]; then
      echo "## Latest axe results"
      python3 - <<'PY' "$LATEST_JSON"
from pathlib import Path
import json, sys
report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
for item in report.get("violations", []):
    print(f"- **{item.get('impact','minor')}** — {item.get('id')} — {item.get('help')}")
PY
      echo ""
    fi
    if [[ -f "$LATEST_RTL" ]]; then
      echo "## RTL checks"
      sed 's/^/- /' "$LATEST_RTL" || true
      echo ""
    fi
    echo "## Suggested fixes"
    echo "- Add semantic roles and labels for interactive controls"
    echo "- Verify keyboard focus order and visible focus states"
    echo "- Use logical direction-aware CSS for Arabic / RTL"
  } > "$file"
  echo -e "${GREEN}✅ Saved report:${NC} $file"
}

history_cmd() {
  header
  tail -n 10 "$HISTORY_FILE" | awk -F',' 'NR==1{next} { printf "  %-19s  %-28s  C:%2s  S:%2s  M:%2s  m:%2s  T:%2s\n", $1, substr($2,1,28), $3, $4, $5, $6, $7 }'
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/a11y.sh audit <url>
  bash scripts/a11y.sh install
  bash scripts/a11y.sh rtl [dir]
  bash scripts/a11y.sh report
  bash scripts/a11y.sh history
  bash scripts/a11y.sh help
EOF
}

case "$ACTION" in
  audit) audit_cmd "${1:-}" ;;
  install) install_cmd ;;
  rtl) rtl_cmd "${1:-src}" ;;
  report) report_cmd ;;
  history) history_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
