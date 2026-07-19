#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$HOME/.ghostforge/health"
HISTORY_FILE="$DATA_DIR/history.csv"
BADGE_FILE="$DATA_DIR/badge.md"
mkdir -p "$DATA_DIR"
[[ -f "$HISTORY_FILE" ]] || echo 'date,target,total,grade,tech_debt,coverage,bundle,lighthouse,a11y,available_max' > "$HISTORY_FILE"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🏥  GhostForge Codebase Health Score${NC}"
  echo -e "${DIM}  Weighted health grade across tech debt, coverage, bundle, lighthouse, and accessibility.${NC}"
  echo ""
}

grade_color() {
  case "$1" in
    A) printf '%b' "$GREEN" ;;
    B) printf '%b' "$CYAN" ;;
    C) printf '%b' "$YELLOW" ;;
    D|F) printf '%b' "$RED" ;;
    *) printf '%b' "$DIM" ;;
  esac
}

score_cmd() {
  local target="${1:-.}"
  target="${target/#\~/$HOME}"
  if [[ -d "$target" ]]; then
    target="$(cd "$target" && pwd)"
  fi

  local tech_raw=""
  if [[ -x "$ROOT_DIR/scripts/tech-debt.sh" || -f "$ROOT_DIR/scripts/tech-debt.sh" ]]; then
    tech_raw="$(bash "$ROOT_DIR/scripts/tech-debt.sh" score "$target" 2>/dev/null | grep -oE '[0-9]+/100' | head -1 | cut -d/ -f1 || true)"
  fi

  local output
  output="$(python3 - <<'PY' "$target" "$HISTORY_FILE" "$tech_raw"
import csv
import math
import sys
from datetime import datetime
from pathlib import Path

target = Path(sys.argv[1]).expanduser()
history_path = Path(sys.argv[2]).expanduser()
tech_raw = sys.argv[3].strip()

coverage_file = Path.home() / '.ghostforge' / 'coverage' / 'history.csv'
bundle_file = Path.home() / '.ghostforge' / 'bundle' / 'history.csv'
lighthouse_file = Path.home() / '.ghostforge' / 'lighthouse' / 'history.csv'
a11y_file = Path.home() / '.ghostforge' / 'a11y' / 'history.csv'

checks = []

def latest_row(path):
    if not path.exists():
        return None
    with path.open('r', encoding='utf-8', newline='') as handle:
        rows = list(csv.DictReader(handle))
    return rows[-1] if rows else None

def bounded(value, low=0, high=20):
    return max(low, min(high, int(round(value))))

if tech_raw:
    debt_score = bounded(float(tech_raw) / 5)
    debt_meta = f"raw debt score {tech_raw}/100"
    checks.append(('Tech Debt', debt_score, 20, debt_meta, debt_score >= 14))
else:
    checks.append(('Tech Debt', None, 20, 'tech-debt.sh unavailable or no score produced', False))

coverage_row = latest_row(coverage_file)
if coverage_row:
    lines = float((coverage_row.get('lines') or '0').strip() or 0)
    coverage_score = bounded(lines / 5)
    checks.append(('Coverage', coverage_score, 20, f"latest lines coverage {lines:.2f}%", coverage_score >= 16))
else:
    checks.append(('Coverage', None, 20, 'run ghostforge coverage snapshot first', False))

bundle_row = latest_row(bundle_file)
if bundle_row:
    size_kb = float((bundle_row.get('size_kb') or '0').strip() or 0)
    if size_kb < 200:
        bundle_score = 20
    elif size_kb < 500:
        bundle_score = 15
    elif size_kb < 1000:
        bundle_score = 10
    else:
        bundle_score = 5
    checks.append(('Bundle', bundle_score, 20, f"latest bundle {size_kb:.0f} KB", bundle_score >= 15))
else:
    checks.append(('Bundle', None, 20, 'run ghostforge bundle track first', False))

lh_row = latest_row(lighthouse_file)
if lh_row:
    metrics = [float((lh_row.get(key) or '0').strip() or 0) for key in ('performance', 'accessibility', 'best_practices', 'seo')]
    avg = sum(metrics) / len(metrics)
    lighthouse_score = bounded(avg / 5)
    checks.append(('Lighthouse', lighthouse_score, 20, f"average score {avg:.2f}", lighthouse_score >= 16))
else:
    checks.append(('Lighthouse', None, 20, 'run ghostforge lighthouse run first', False))

a11y_row = latest_row(a11y_file)
if a11y_row:
    violations = int(float((a11y_row.get('total') or '0').strip() or 0))
    if violations == 0:
        a11y_score = 20
    elif violations < 5:
        a11y_score = 15
    elif violations < 15:
        a11y_score = 10
    else:
        a11y_score = 5
    checks.append(('A11y', a11y_score, 20, f"latest violations {violations}", a11y_score >= 15))
else:
    checks.append(('A11y', None, 20, 'run ghostforge a11y audit first', False))

available_max = sum(max_score for _, score, max_score, _, _ in checks if score is not None)
raw_total = sum(score for _, score, _, _, _ in checks if score is not None)
total = int(round((raw_total / available_max) * 100)) if available_max else 0
if total >= 90:
    grade = 'A'
elif total >= 80:
    grade = 'B'
elif total >= 70:
    grade = 'C'
elif total >= 60:
    grade = 'D'
else:
    grade = 'F'

tips = []
for label, score, _, meta, healthy in checks:
    if score is None:
        tips.append(f"Populate {label.lower()} data — {meta}.")
    elif not healthy:
        if label == 'Tech Debt':
            tips.append('Reduce TODO hotspots and long functions to lift the debt slice.')
        elif label == 'Coverage':
            tips.append('Raise automated coverage, especially lines and branches, to improve resilience.')
        elif label == 'Bundle':
            tips.append('Trim build output with lazy loading, dependency pruning, and chunk analysis.')
        elif label == 'Lighthouse':
            tips.append('Improve performance/accessibility/best-practices scores before the next release.')
        elif label == 'A11y':
            tips.append('Fix the highest-impact accessibility violations to recover fast points.')
if not tips:
    tips.append('Excellent balance — keep tracking each dimension to preserve an A-grade baseline.')

row = {
    'date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    'target': str(target),
    'total': total,
    'grade': grade,
    'tech_debt': '' if checks[0][1] is None else checks[0][1],
    'coverage': '' if checks[1][1] is None else checks[1][1],
    'bundle': '' if checks[2][1] is None else checks[2][1],
    'lighthouse': '' if checks[3][1] is None else checks[3][1],
    'a11y': '' if checks[4][1] is None else checks[4][1],
    'available_max': available_max,
}
write_header = not history_path.exists() or history_path.stat().st_size == 0
with history_path.open('a', encoding='utf-8', newline='') as handle:
    writer = csv.DictWriter(handle, fieldnames=['date','target','total','grade','tech_debt','coverage','bundle','lighthouse','a11y','available_max'])
    if write_header:
        writer.writeheader()
    writer.writerow(row)

print(f"TOTAL={total}")
print(f"GRADE={grade}")
print(f"AVAILABLE_MAX={available_max}")
for label, score, max_score, meta, _ in checks:
    score_text = 'n/a' if score is None else str(score)
    print(f"CHECK={label}|{score_text}|{max_score}|{meta}")
for tip in tips[:5]:
    print(f"TIP={tip}")
PY
)"

  header
  local total grade gradec
  total="$(printf '%s\n' "$output" | awk -F= '/^TOTAL=/{print $2; exit}')"
  grade="$(printf '%s\n' "$output" | awk -F= '/^GRADE=/{print $2; exit}')"
  gradec="$(grade_color "$grade")"
  echo -e "${BLUE}Target:${NC} $target"
  echo -e "${BLUE}Health Score:${NC} ${gradec}${BOLD}${grade} (${total}/100)${NC}"
  echo ""
  printf '%-14s %-12s %-10s %s\n' "Check" "Score" "Max" "Notes"
  printf '%s\n' "────────────────────────────────────────────────────────────────────────────"
  while IFS= read -r line; do
    [[ "$line" == CHECK=* ]] || continue
    local payload label score max meta
    payload="${line#CHECK=}"
    IFS='|' read -r label score max meta <<< "$payload"
    printf '%-14s %-12s %-10s %s\n' "$label" "$score" "$max" "$meta"
  done <<< "$output"
  echo ""
  echo -e "${BOLD}Improvement tips:${NC}"
  while IFS= read -r line; do
    [[ "$line" == TIP=* ]] || continue
    echo -e "  • ${line#TIP=}"
  done <<< "$output"
}

breakdown_cmd() {
  header
  if [[ ! -f "$HISTORY_FILE" ]] || [[ "$(wc -l < "$HISTORY_FILE" | tr -d ' ')" -le 1 ]]; then
    echo -e "${YELLOW}⚠ No health history yet. Run: bash scripts/health-score.sh score${NC}"
    return 0
  fi
  python3 - <<'PY' "$HISTORY_FILE"
import csv
import sys
from pathlib import Path
path = Path(sys.argv[1]).expanduser()
with path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))
row = rows[-1]
print(f"Latest score: {row['total']}/100 ({row['grade']})")
print(f"Target      : {row['target']}")
print(f"Recorded    : {row['date']}")
print('')
print(f"{'Tech Debt':<12} {row.get('tech_debt') or 'n/a':>4}/20")
print(f"{'Coverage':<12} {row.get('coverage') or 'n/a':>4}/20")
print(f"{'Bundle':<12} {row.get('bundle') or 'n/a':>4}/20")
print(f"{'Lighthouse':<12} {row.get('lighthouse') or 'n/a':>4}/20")
print(f"{'A11y':<12} {row.get('a11y') or 'n/a':>4}/20")
PY
}

history_cmd() {
  header
  if [[ ! -f "$HISTORY_FILE" ]] || [[ "$(wc -l < "$HISTORY_FILE" | tr -d ' ')" -le 1 ]]; then
    echo -e "${YELLOW}⚠ No health history yet.${NC}"
    return 0
  fi
  python3 - <<'PY' "$HISTORY_FILE"
import csv
import sys
from pathlib import Path
path = Path(sys.argv[1]).expanduser()
with path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))[-10:]
trend = ''.join(row['grade'] for row in rows)
print(f"Grade trend: {trend}")
print('')
print(f"{'When':<19} {'Score':<8} {'Grade':<6} Target")
print('─' * 78)
for row in rows:
    print(f"{row['date']:<19} {row['total'] + '/100':<8} {row['grade']:<6} {row['target']}")
PY
}

badge_cmd() {
  header
  if [[ ! -f "$HISTORY_FILE" ]] || [[ "$(wc -l < "$HISTORY_FILE" | tr -d ' ')" -le 1 ]]; then
    echo -e "${YELLOW}⚠ No saved score yet. Run score first.${NC}"
    return 0
  fi
  python3 - <<'PY' "$HISTORY_FILE" "$BADGE_FILE"
import csv
import sys
from pathlib import Path
history_path = Path(sys.argv[1]).expanduser()
badge_path = Path(sys.argv[2]).expanduser()
with history_path.open('r', encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))
row = rows[-1]
grade = row['grade']
color = {'A':'brightgreen','B':'green','C':'yellow','D':'orange','F':'red'}.get(grade, 'lightgrey')
url = f"https://img.shields.io/badge/health-{grade}-{color}"
md = f"## Codebase Health Badge\n![Health Grade]({url})\nLatest score: **{row['total']}/100** for `{row['target']}`\n"
badge_path.write_text(md, encoding='utf-8')
print(url)
print('')
print(md)
PY
}

help_cmd() {
  header
  cat <<EOF2
Usage:
  bash scripts/health-score.sh score [dir]
  bash scripts/health-score.sh breakdown
  bash scripts/health-score.sh history
  bash scripts/health-score.sh badge
  bash scripts/health-score.sh help
EOF2
}

case "$ACTION" in
  score) score_cmd "${1:-.}" ;;
  breakdown) breakdown_cmd ;;
  history) history_cmd ;;
  badge) badge_cmd ;;
  help|--help|-h) help_cmd ;;
  *) help_cmd; exit 1 ;;
esac
