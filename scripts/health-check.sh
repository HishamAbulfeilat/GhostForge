#!/usr/bin/env bash
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$(pwd)"
FIX=false

for arg in "$@"; do
  case "$arg" in
    --fix) FIX=true ;;
    *) TARGET="$arg" ;;
  esac
done

TARGET="${TARGET/#\~/$HOME}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

normalize_remote_url() {
  local remote="$1"
  if [[ "$remote" =~ ^git@github.com:(.+)\.git$ ]]; then
    echo "https://github.com/${BASH_REMATCH[1]}"
  elif [[ "$remote" =~ ^https?:// ]]; then
    echo "${remote%.git}"
  else
    echo "$remote"
  fi
}

load_env_file "$GHOSTFORGE_DIR/.env.local"
if [[ "$TARGET" != "$GHOSTFORGE_DIR" ]]; then
  load_env_file "$TARGET/.env.local"
fi

divider() { echo -e "${DIM}══════════════════════════════════════════════════════${NC}"; }
status_icon() {
  local score="$1"
  if (( score >= 90 )); then echo "🟢"; elif (( score >= 70 )); then echo "🟡"; elif (( score >= 50 )); then echo "🟠"; else echo "🔴"; fi
}
category_icon() {
  local got="$1" max="$2"
  if (( got == max )); then echo "✅"; elif (( got == 0 )); then echo "❌"; else echo "⚠️"; fi
}

if [[ ! -f "$TARGET/package.json" ]]; then
  echo -e "${RED}${BOLD}✖ package.json not found in $TARGET${NC}"
  exit 1
fi

if $FIX; then
  echo -e "${BLUE}${BOLD}Running safe fixes first...${NC}"
  (cd "$TARGET" && npm audit fix >/dev/null 2>&1 || true)
  if (cd "$TARGET" && npm run lint -- --fix >/dev/null 2>&1); then :; else true; fi
fi

echo ""
echo -e "${BLUE}${BOLD}  GhostForge Project Health Check${NC}"
echo -e "${DIM}  Target: $TARGET${NC}"
divider

# npm audit
AUDIT_JSON="$(cd "$TARGET" && npm audit --json 2>/dev/null || true)"
AUDIT_CRITICAL=0; AUDIT_HIGH=0; AUDIT_MODERATE=0; AUDIT_LOW=0
if [[ -n "$AUDIT_JSON" ]]; then
  AUDIT_CRITICAL="$(printf '%s' "$AUDIT_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=j.metadata?.vulnerabilities||{};console.log(v.critical||0)}catch{console.log(0)}})")"
  AUDIT_HIGH="$(printf '%s' "$AUDIT_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=j.metadata?.vulnerabilities||{};console.log(v.high||0)}catch{console.log(0)}})")"
  AUDIT_MODERATE="$(printf '%s' "$AUDIT_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=j.metadata?.vulnerabilities||{};console.log(v.moderate||0)}catch{console.log(0)}})")"
  AUDIT_LOW="$(printf '%s' "$AUDIT_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=j.metadata?.vulnerabilities||{};console.log(v.low||0)}catch{console.log(0)}})")"
fi
AUDIT_SCORE=25
(( AUDIT_SCORE -= AUDIT_CRITICAL * 12 )) || true
(( AUDIT_SCORE -= AUDIT_HIGH * 6 )) || true
(( AUDIT_SCORE -= AUDIT_MODERATE * 3 )) || true
(( AUDIT_SCORE -= AUDIT_LOW )) || true
(( AUDIT_SCORE < 0 )) && AUDIT_SCORE=0

# outdated
OUTDATED_JSON="$(cd "$TARGET" && npm outdated --json 2>/dev/null || true)"
OUTDATED_COUNT=0
if [[ -n "$OUTDATED_JSON" && "$OUTDATED_JSON" != "{}" ]]; then
  OUTDATED_COUNT="$(printf '%s' "$OUTDATED_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(Object.keys(j).length)}catch{console.log(0)}})")"
fi
OUTDATED_SCORE=$(( 20 - OUTDATED_COUNT * 4 ))
(( OUTDATED_SCORE < 0 )) && OUTDATED_SCORE=0

# coverage
COVERAGE_FILE=''
for file in "$TARGET/coverage/coverage-summary.json" "$TARGET/coverage-summary.json" "$TARGET/coverage/lcov-report/index.html" "$TARGET/coverage/lcov.info"; do
  if [[ -f "$file" ]]; then COVERAGE_FILE="$file"; break; fi
done
COVERAGE_PCT=0
if [[ "$COVERAGE_FILE" == *.json ]]; then
  COVERAGE_PCT="$(node -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const total=j.total||{};const pct=total.lines?.pct ?? total.statements?.pct ?? 0;console.log(Math.round(pct));}catch{console.log(0)}" "$COVERAGE_FILE")"
elif [[ -n "$COVERAGE_FILE" ]]; then
  COVERAGE_PCT=60
fi
if (( COVERAGE_PCT >= 90 )); then COVERAGE_SCORE=20
elif (( COVERAGE_PCT >= 80 )); then COVERAGE_SCORE=18
elif (( COVERAGE_PCT >= 70 )); then COVERAGE_SCORE=14
elif (( COVERAGE_PCT >= 60 )); then COVERAGE_SCORE=10
elif (( COVERAGE_PCT > 0 )); then COVERAGE_SCORE=5
else COVERAGE_SCORE=0
fi

# bundle size
BUNDLE_DIR=''
for dir in "$TARGET/dist" "$TARGET/build" "$TARGET/.next" "$TARGET/web-build"; do
  if [[ -d "$dir" ]]; then BUNDLE_DIR="$dir"; break; fi
done
BUNDLE_MB=0
if [[ -n "$BUNDLE_DIR" ]]; then
  BUNDLE_MB="$(du -sm "$BUNDLE_DIR" 2>/dev/null | awk '{print $1}')"
fi
if [[ -z "$BUNDLE_MB" ]]; then BUNDLE_MB=0; fi
if [[ -z "$BUNDLE_DIR" ]]; then BUNDLE_SCORE=5
elif (( BUNDLE_MB <= 5 )); then BUNDLE_SCORE=15
elif (( BUNDLE_MB <= 10 )); then BUNDLE_SCORE=12
elif (( BUNDLE_MB <= 20 )); then BUNDLE_SCORE=8
else BUNDLE_SCORE=3
fi

# critical tickets
CRITICAL_TICKETS=0
if command -v gh >/dev/null 2>&1 && (cd "$TARGET" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
  ISSUE_JSON="$(cd "$TARGET" && gh issue list --state open --limit 100 --json labels 2>/dev/null || true)"
  if [[ -n "$ISSUE_JSON" ]]; then
    CRITICAL_TICKETS="$(printf '%s' "$ISSUE_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const issues=JSON.parse(s);let count=0;for(const issue of issues){const labels=(issue.labels||[]).map(l=>(l.name||'').toLowerCase());if(labels.includes('critical')||labels.includes('p0')) count++;}console.log(count)}catch{console.log(0)}})")"
  fi
fi
if (( CRITICAL_TICKETS == 0 )); then TICKETS_SCORE=10
elif (( CRITICAL_TICKETS == 1 )); then TICKETS_SCORE=6
else TICKETS_SCORE=0
fi

# lint
LINT_OUTPUT=''
LINT_SCORE=0
if (cd "$TARGET" && npm run lint >/dev/null 2>&1); then
  LINT_SCORE=10
else
  if node -e "const fs=require('fs');const p=process.argv[1];const pkg=JSON.parse(fs.readFileSync(p,'utf8'));process.exit(pkg.scripts&&pkg.scripts.lint?0:1)" "$TARGET/package.json" 2>/dev/null; then
    LINT_SCORE=0
  else
    LINT_SCORE=3
  fi
fi

TOTAL=$(( AUDIT_SCORE + OUTDATED_SCORE + COVERAGE_SCORE + BUNDLE_SCORE + TICKETS_SCORE + LINT_SCORE ))
ICON="$(status_icon "$TOTAL")"
CACHE_FILE="$TARGET/.ghostforge-health-cache"
cat > "$CACHE_FILE" <<CACHE
score=$TOTAL
updated=$(date +%F)
audit=$AUDIT_SCORE
outdated=$OUTDATED_SCORE
coverage=$COVERAGE_SCORE
bundle=$BUNDLE_SCORE
tickets=$TICKETS_SCORE
lint=$LINT_SCORE
CACHE

NOTIFY_HEALTH_THRESHOLD="${NOTIFY_HEALTH_THRESHOLD:-70}"
if (( TOTAL < NOTIFY_HEALTH_THRESHOLD )); then
  ALERT_LEVEL=warning
  ALERT_MESSAGE="Project health score dropped to ${TOTAL}/100 for ${TARGET}"
  REMOTE_URL="$(cd "$TARGET" && git config --get remote.origin.url 2>/dev/null || true)"
  ACTION_URL="$(normalize_remote_url "$REMOTE_URL")"

  if [[ -n "${SLACK_WEBHOOK:-}" ]]; then
    "$GHOSTFORGE_DIR/scripts/notify.sh" slack "$SLACK_WEBHOOK" "$ALERT_MESSAGE" "$ALERT_LEVEL" "$ACTION_URL" "Open Repository" || true
  fi

  if [[ -n "${TEAMS_WEBHOOK:-}" ]]; then
    "$GHOSTFORGE_DIR/scripts/notify.sh" teams "$TEAMS_WEBHOOK" "$ALERT_MESSAGE" "$ALERT_LEVEL" "$ACTION_URL" "Open Repository" || true
  fi
fi

printf '{\n'
printf '  %b"project"%b: "%s",\n' "$BLUE" "$NC" "$TARGET"
printf '  %b"score"%b: "%s %s/100",\n' "$BLUE" "$NC" "$ICON" "$TOTAL"
printf '  %b"breakdown"%b: {\n' "$BLUE" "$NC"
printf '    "%s npmAudit": { "score": %d, "max": 25, "details": "critical=%s high=%s moderate=%s low=%s" },\n' "$(category_icon "$AUDIT_SCORE" 25)" "$AUDIT_SCORE" "$AUDIT_CRITICAL" "$AUDIT_HIGH" "$AUDIT_MODERATE" "$AUDIT_LOW"
printf '    "%s outdatedDeps": { "score": %d, "max": 20, "details": "%s packages outdated" },\n' "$(category_icon "$OUTDATED_SCORE" 20)" "$OUTDATED_SCORE" "$OUTDATED_COUNT"
printf '    "%s testCoverage": { "score": %d, "max": 20, "details": "%s%% lines (%s)" },\n' "$(category_icon "$COVERAGE_SCORE" 20)" "$COVERAGE_SCORE" "$COVERAGE_PCT" "${COVERAGE_FILE##$TARGET/}"
printf '    "%s bundleSize": { "score": %d, "max": 15, "details": "%s" },\n' "$(category_icon "$BUNDLE_SCORE" 15)" "$BUNDLE_SCORE" "$( [[ -n "$BUNDLE_DIR" ]] && echo "${BUNDLE_DIR##$TARGET/} ${BUNDLE_MB}MB" || echo 'no build artifact found' )"
printf '    "%s criticalTickets": { "score": %d, "max": 10, "details": "%s open critical tickets" },\n' "$(category_icon "$TICKETS_SCORE" 10)" "$TICKETS_SCORE" "$CRITICAL_TICKETS"
printf '    "%s lintErrors": { "score": %d, "max": 10, "details": "%s" }\n' "$(category_icon "$LINT_SCORE" 10)" "$LINT_SCORE" "$( (( LINT_SCORE == 10 )) && echo 'lint passed' || (( LINT_SCORE == 3 )) && echo 'no lint script found' || echo 'lint failed' )"
printf '  }\n'
printf '}\n'

divider
echo -e "${GREEN}${BOLD}Final health score:${NC} ${ICON} ${BOLD}${TOTAL}/100${NC}"
echo -e "${DIM}Cached at: $CACHE_FILE${NC}"
