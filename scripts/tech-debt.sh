#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

ACTION="${1:-help}"
shift || true
REPORT_DIR="$HOME/.ghostforge/tech-debt"
mkdir -p "$REPORT_DIR"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🏚️  GhostForge Tech Debt Scanner${NC}"
  echo -e "${DIM}  Scan TODOs, complexity, deprecated patterns, and debt trend score.${NC}"
  echo ""
}

scan_dir() {
  printf '%s\n' "${1:-src}"
}

todos_cmd() {
  local dir
  dir="$(scan_dir "${1:-src}")"
  header
  if [[ ! -d "$dir" ]]; then
    echo -e "${YELLOW}⚠ Directory not found: $dir${NC}"
    exit 0
  fi
  grep -RInE 'TODO|FIXME|HACK|XXX|TEMP' "$dir" 2>/dev/null \
    | awk -F: '{count[$1]++} END {for (file in count) printf "%4d  %s\n", count[file], file}' \
    | sort -rn \
    | head -10 \
    || echo -e "${GREEN}✅ No TODO-style comments found.${NC}"
}

complexity_cmd() {
  local dir
  dir="$(scan_dir "${1:-src}")"
  header
  TARGET_DIR="$dir" python3 - <<'PY'
from pathlib import Path
import os, re

base = Path(os.environ["TARGET_DIR"])
files = [p for p in base.rglob("*") if p.suffix in {".js", ".jsx", ".ts", ".tsx"}]
issues = []

for file in files:
    try:
        lines = file.read_text(encoding="utf-8").splitlines()
    except Exception:
        continue
    if len(lines) > 300:
        issues.append(f"FILE  {file} — {len(lines)} lines")
    starts = []
    for idx, line in enumerate(lines, 1):
        if re.search(r"\bfunction\b|=>\s*\{|class\s+\w+", line):
            starts.append(idx)
    for start, end in zip(starts, starts[1:] + [len(lines) + 1]):
        if end - start > 50:
            issues.append(f"FUNC  {file}:{start} — ~{end - start} lines")

if issues:
    print("\n".join(issues[:50]))
else:
    print("✅ No large files or oversized functions detected.")
PY
}

deprecated_cmd() {
  local dir
  dir="$(scan_dir "${1:-src}")"
  header
  python3 - <<'PY' "$dir"
from pathlib import Path
import re, sys

base = Path(sys.argv[1])
patterns = [
    ("componentWillMount", r"componentWillMount"),
    ("findDOMNode", r"findDOMNode"),
    ("unsafe dangerouslySetInnerHTML", r"dangerouslySetInnerHTML"),
    ("TypeScript any", r":\s*any\b"),
    ("var declarations", r"\bvar\s+"),
    ("console.log in source", r"console\.log\("),
]
counts = {name: 0 for name, _ in patterns}

for file in base.rglob("*"):
    if file.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
        continue
    try:
        text = file.read_text(encoding="utf-8")
    except Exception:
        continue
    for name, pattern in patterns:
        for match in re.finditer(pattern, text):
            if name == "unsafe dangerouslySetInnerHTML" and "sanitize" in text[max(0, match.start() - 120):match.end() + 120]:
                continue
            if name == "console.log in source" and "debug" in file.name.lower():
                continue
            counts[name] += 1

for name, count in counts.items():
    print(f"{name}: {count}")
PY
}

score_cmd() {
  local dir todos_count complex_count deprecated_count score
  dir="$(scan_dir "${1:-src}")"
  todos_count="$(grep -RInE 'TODO|FIXME|HACK|XXX|TEMP' "$dir" 2>/dev/null | wc -l | tr -d ' ' || echo 0)"
  complex_count="$(TARGET_DIR="$dir" python3 - <<'PY'
from pathlib import Path
import os, re

base = Path(os.environ["TARGET_DIR"])
count = 0
for file in base.rglob("*"):
    if file.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
        continue
    try:
        lines = file.read_text(encoding="utf-8").splitlines()
    except Exception:
        continue
    if len(lines) > 300:
        count += 1
    starts = [idx for idx, line in enumerate(lines, 1) if re.search(r"\bfunction\b|=>\s*\{|class\s+\w+", line)]
    for start, end in zip(starts, starts[1:] + [len(lines) + 1]):
        if end - start > 50:
            count += 1
print(count)
PY
)"
  deprecated_count="$(python3 - <<'PY' "$dir"
from pathlib import Path
import re, sys

base = Path(sys.argv[1])
count = 0
for file in base.rglob("*"):
    if file.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
        continue
    try:
        text = file.read_text(encoding="utf-8")
    except Exception:
        continue
    count += len(re.findall(r"componentWillMount|findDOMNode|dangerouslySetInnerHTML|:\s*any\b|\bvar\s+|console\.log\(", text))
print(count)
PY
)"
  score=$((100 - todos_count * 2 - complex_count * 5 - deprecated_count * 3))
  (( score < 0 )) && score=0
  header
  echo -e "${CYAN}Score:${NC} ${BOLD}${score}/100${NC}"
  echo -e "${DIM}Formula:${NC} 100 - (todos×2) - (complex×5) - (deprecated×3)"
}

report_cmd() {
  local dir file score
  dir="$(scan_dir "${1:-src}")"
  score="$(bash "$0" score "$dir" | grep -oE '[0-9]+/100' | head -1 || echo '0/100')"
  file="$REPORT_DIR/report-$(date +%Y%m%d-%H%M%S).md"
  {
    echo "# Tech Debt Report"
    echo ""
    echo "- Directory: \`$dir\`"
    echo "- Score: **$score**"
    echo "- Generated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    echo "## TODO / FIXME / HACK"
    bash "$0" todos "$dir"
    echo ""
    echo "## Complexity"
    bash "$0" complexity "$dir"
    echo ""
    echo "## Deprecated Patterns"
    bash "$0" deprecated "$dir"
  } > "$file"
  header
  echo -e "${GREEN}✅ Saved report:${NC} $file"
}

scan_cmd() {
  local dir
  dir="$(scan_dir "${1:-src}")"
  header
  bash "$0" score "$dir"
  echo ""
  echo -e "${BOLD}Top TODO files:${NC}"
  bash "$0" todos "$dir"
  echo ""
  echo -e "${BOLD}Complexity warnings:${NC}"
  bash "$0" complexity "$dir"
  echo ""
  echo -e "${BOLD}Deprecated patterns:${NC}"
  bash "$0" deprecated "$dir"
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/tech-debt.sh scan [dir]
  bash scripts/tech-debt.sh todos [dir]
  bash scripts/tech-debt.sh complexity [dir]
  bash scripts/tech-debt.sh deprecated [dir]
  bash scripts/tech-debt.sh score [dir]
  bash scripts/tech-debt.sh report [dir]
  bash scripts/tech-debt.sh help
EOF
}

case "$ACTION" in
  scan) scan_cmd "${1:-src}" ;;
  todos) todos_cmd "${1:-src}" ;;
  complexity) complexity_cmd "${1:-src}" ;;
  deprecated) deprecated_cmd "${1:-src}" ;;
  score) score_cmd "${1:-src}" ;;
  report) report_cmd "${1:-src}" ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
