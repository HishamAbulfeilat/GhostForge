#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'
GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECTS_FILE="$GHOSTFORGE_DIR/.registered-projects"

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  💊  GhostForge Health Check${NC}"
  echo -e "${DIM}  Single-project or multi-project health scanning from one entrypoint.${NC}"
  echo ""
}

divider() { echo -e "${DIM}══════════════════════════════════════════════════════${NC}"; }

status_icon() {
  local score="$1"
  if (( score >= 90 )); then echo "🟢"; elif (( score >= 70 )); then echo "🟡"; elif (( score >= 50 )); then echo "🟠"; else echo "🔴"; fi
}

category_icon() {
  local got="$1" max="$2"
  if (( got == max )); then echo "✅"; elif (( got == 0 )); then echo "❌"; else echo "⚠️"; fi
}

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

project_cmd() {
  local target="${1:-$(pwd)}"
  local fix="${2:-false}"
  target="${target/#\~/$HOME}"
  target="$(cd "$target" 2>/dev/null && pwd)"
  load_env_file "$GHOSTFORGE_DIR/.env.local"
  if [[ "$target" != "$GHOSTFORGE_DIR" ]]; then
    load_env_file "$target/.env.local"
  fi
  [[ -f "$target/package.json" ]] || {
    echo -e "${RED}${BOLD}✖ package.json not found in $target${NC}"
    exit 1
  }

  if [[ "$fix" == "true" ]]; then
    echo -e "${CYAN}${BOLD}Running safe fixes first...${NC}"
    (cd "$target" && npm audit fix >/dev/null 2>&1 || true)
    (cd "$target" && npm run lint -- --fix >/dev/null 2>&1 || true)
  fi

  header
  echo -e "${CYAN}Target:${NC} $target"
  divider

  local audit_json audit_critical audit_high audit_moderate audit_low audit_score
  audit_json="$(cd "$target" && npm audit --json 2>/dev/null || true)"
  audit_critical=0; audit_high=0; audit_moderate=0; audit_low=0
  if [[ -n "$audit_json" ]]; then
    audit_critical="$(printf '%s' "$audit_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=j.metadata?.vulnerabilities||{};console.log(v.critical||0)}catch{console.log(0)}})")"
    audit_high="$(printf '%s' "$audit_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=j.metadata?.vulnerabilities||{};console.log(v.high||0)}catch{console.log(0)}})")"
    audit_moderate="$(printf '%s' "$audit_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=j.metadata?.vulnerabilities||{};console.log(v.moderate||0)}catch{console.log(0)}})")"
    audit_low="$(printf '%s' "$audit_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=j.metadata?.vulnerabilities||{};console.log(v.low||0)}catch{console.log(0)}})")"
  fi
  audit_score=25
  (( audit_score -= audit_critical * 12 )) || true
  (( audit_score -= audit_high * 6 )) || true
  (( audit_score -= audit_moderate * 3 )) || true
  (( audit_score -= audit_low )) || true
  (( audit_score < 0 )) && audit_score=0

  local outdated_json outdated_count outdated_score
  outdated_json="$(cd "$target" && npm outdated --json 2>/dev/null || true)"
  outdated_count=0
  if [[ -n "$outdated_json" && "$outdated_json" != "{}" ]]; then
    outdated_count="$(printf '%s' "$outdated_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(Object.keys(j).length)}catch{console.log(0)}})")"
  fi
  outdated_score=$((20 - outdated_count * 4))
  (( outdated_score < 0 )) && outdated_score=0

  local coverage_file="" coverage_pct coverage_score
  for file in "$target/coverage/coverage-summary.json" "$target/coverage-summary.json" "$target/coverage/lcov-report/index.html" "$target/coverage/lcov.info"; do
    if [[ -f "$file" ]]; then coverage_file="$file"; break; fi
  done
  coverage_pct=0
  if [[ "$coverage_file" == *.json ]]; then
    coverage_pct="$(node -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const total=j.total||{};const pct=total.lines?.pct ?? total.statements?.pct ?? 0;console.log(Math.round(pct));}catch{console.log(0)}" "$coverage_file")"
  elif [[ -n "$coverage_file" ]]; then
    coverage_pct=60
  fi
  if (( coverage_pct >= 90 )); then coverage_score=20
  elif (( coverage_pct >= 80 )); then coverage_score=18
  elif (( coverage_pct >= 70 )); then coverage_score=14
  elif (( coverage_pct >= 60 )); then coverage_score=10
  elif (( coverage_pct > 0 )); then coverage_score=5
  else coverage_score=0
  fi

  local bundle_dir="" bundle_mb bundle_score
  for dir in "$target/dist" "$target/build" "$target/.next" "$target/web-build"; do
    if [[ -d "$dir" ]]; then bundle_dir="$dir"; break; fi
  done
  bundle_mb=0
  if [[ -n "$bundle_dir" ]]; then
    bundle_mb="$(du -sm "$bundle_dir" 2>/dev/null | awk '{print $1}')"
  fi
  [[ -z "$bundle_mb" ]] && bundle_mb=0
  if [[ -z "$bundle_dir" ]]; then bundle_score=5
  elif (( bundle_mb <= 5 )); then bundle_score=15
  elif (( bundle_mb <= 10 )); then bundle_score=12
  elif (( bundle_mb <= 20 )); then bundle_score=8
  else bundle_score=3
  fi

  local critical_tickets tickets_score
  critical_tickets=0
  if command -v gh >/dev/null 2>&1 && (cd "$target" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
    local issue_json
    issue_json="$(cd "$target" && gh issue list --state open --limit 100 --json labels 2>/dev/null || true)"
    if [[ -n "$issue_json" ]]; then
      critical_tickets="$(printf '%s' "$issue_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const issues=JSON.parse(s);let count=0;for(const issue of issues){const labels=(issue.labels||[]).map(l=>(l.name||'').toLowerCase());if(labels.includes('critical')||labels.includes('p0')) count++;}console.log(count)}catch{console.log(0)}})")"
    fi
  fi
  if (( critical_tickets == 0 )); then tickets_score=10
  elif (( critical_tickets == 1 )); then tickets_score=6
  else tickets_score=0
  fi

  local lint_score react_doctor_score is_react total icon cache_file
  lint_score=0
  if (cd "$target" && npm run lint >/dev/null 2>&1); then
    lint_score=10
  else
    if node -e "const fs=require('fs');const p=process.argv[1];const pkg=JSON.parse(fs.readFileSync(p,'utf8'));process.exit(pkg.scripts&&pkg.scripts.lint?0:1)" "$target/package.json" 2>/dev/null; then
      lint_score=0
    else
      lint_score=3
    fi
  fi

  react_doctor_score=-1
  is_react=false
  if node -e "const fs=require('fs');const p=process.argv[1];const pkg=JSON.parse(fs.readFileSync(p,'utf8'));const deps={...(pkg.dependencies||{}), ...(pkg.devDependencies||{})};process.exit(('react' in deps)?0:1)" "$target/package.json" 2>/dev/null; then
    is_react=true
  fi
  if $is_react && command -v npx >/dev/null 2>&1; then
    local rd_output
    rd_output="$(cd "$target" && npx react-doctor@latest --score 2>/dev/null || true)"
    if [[ "$rd_output" =~ ^[0-9]+$ ]]; then react_doctor_score="$rd_output"; fi
  fi

  total=$(( audit_score + outdated_score + coverage_score + bundle_score + tickets_score + lint_score ))
  icon="$(status_icon "$total")"
  cache_file="$target/.ghostforge-health-cache"
  cat > "$cache_file" <<CACHE
score=$total
updated=$(date +%F)
audit=$audit_score
outdated=$outdated_score
coverage=$coverage_score
bundle=$bundle_score
tickets=$tickets_score
lint=$lint_score
react_doctor=$react_doctor_score
CACHE

  local notify_threshold
  notify_threshold="${NOTIFY_HEALTH_THRESHOLD:-70}"
  if (( total < notify_threshold )); then
    local alert_message remote_url action_url
    alert_message="Project health score dropped to ${total}/100 for ${target}"
    remote_url="$(cd "$target" && git config --get remote.origin.url 2>/dev/null || true)"
    action_url="$(normalize_remote_url "$remote_url")"
    [[ -n "${SLACK_WEBHOOK:-}" ]] && "$GHOSTFORGE_DIR/scripts/notify.sh" slack "$SLACK_WEBHOOK" "$alert_message" warning "$action_url" "Open Repository" || true
    [[ -n "${TEAMS_WEBHOOK:-}" ]] && "$GHOSTFORGE_DIR/scripts/notify.sh" teams "$TEAMS_WEBHOOK" "$alert_message" warning "$action_url" "Open Repository" || true
  fi

  printf '{\n'
  printf '  %b"project"%b: "%s",\n' "$CYAN" "$NC" "$target"
  printf '  %b"score"%b: "%s %s/100",\n' "$CYAN" "$NC" "$icon" "$total"
  printf '  %b"breakdown"%b: {\n' "$CYAN" "$NC"
  printf '    "%s npmAudit": { "score": %d, "max": 25, "details": "critical=%s high=%s moderate=%s low=%s" },\n' "$(category_icon "$audit_score" 25)" "$audit_score" "$audit_critical" "$audit_high" "$audit_moderate" "$audit_low"
  printf '    "%s outdatedDeps": { "score": %d, "max": 20, "details": "%s packages outdated" },\n' "$(category_icon "$outdated_score" 20)" "$outdated_score" "$outdated_count"
  printf '    "%s testCoverage": { "score": %d, "max": 20, "details": "%s%% lines (%s)" },\n' "$(category_icon "$coverage_score" 20)" "$coverage_score" "$coverage_pct" "${coverage_file##$target/}"
  printf '    "%s bundleSize": { "score": %d, "max": 15, "details": "%s" },\n' "$(category_icon "$bundle_score" 15)" "$bundle_score" "$( [[ -n "$bundle_dir" ]] && echo "${bundle_dir##$target/} ${bundle_mb}MB" || echo 'no build artifact found' )"
  printf '    "%s criticalTickets": { "score": %d, "max": 10, "details": "%s open critical tickets" },\n' "$(category_icon "$tickets_score" 10)" "$tickets_score" "$critical_tickets"
  printf '    "%s lintErrors": { "score": %d, "max": 10, "details": "%s" }%s\n' "$(category_icon "$lint_score" 10)" "$lint_score" "$( (( lint_score == 10 )) && echo 'lint passed' || (( lint_score == 3 )) && echo 'no lint script found' || echo 'lint failed' )" "$( $is_react && echo ',' || echo '' )"
  if $is_react; then
    if (( react_doctor_score >= 0 )); then
      printf '    "%s reactDoctor": { "score": "%s/100", "details": "https://www.react.doctor" }\n' "$(status_icon "$react_doctor_score")" "$react_doctor_score"
    else
      printf '    "reactDoctor": { "score": "n/a", "details": "install: npx react-doctor@latest" }\n'
    fi
  fi
  printf '  }\n}\n'
  divider
  echo -e "${GREEN}${BOLD}Final health score:${NC} ${icon} ${BOLD}${total}/100${NC}"
  if $is_react && (( react_doctor_score >= 0 )); then
    echo -e "${CYAN}React Doctor score:${NC} $(status_icon "$react_doctor_score") ${react_doctor_score}/100"
  fi
  echo -e "${DIM}Cached at: $cache_file${NC}"
}

all_cmd() {
  header
  [[ -f "$PROJECTS_FILE" && -s "$PROJECTS_FILE" ]] || {
    echo -e "${YELLOW}⚠ No registered projects found.${NC}"
    exit 0
  }
  mapfile -t projects < <(grep -v '^\s*#' "$PROJECTS_FILE" | grep -v '^\s*$' || true)
  [[ ${#projects[@]} -gt 0 ]] || {
    echo -e "${YELLOW}⚠ No valid project paths in .registered-projects${NC}"
    exit 0
  }
  declare -A scores
  declare -A icons

  run_health() {
    local proj="$1"
    if [[ ! -d "$proj" ]]; then
      scores["$proj"]="N/A"
      icons["$proj"]="⚫"
      return
    fi
    local cache_json="$proj/.ghostforge-cache/health.json"
    local cache_legacy="$proj/.ghostforge-health-cache"
    if [[ -f "$cache_json" ]]; then
      local raw score
      raw="$(cat "$cache_json" 2>/dev/null || true)"
      score="$(echo "$raw" | python3 -c "import sys,re; d=sys.stdin.read(); m=re.search(r'\"(\d+)\/100\"', d); print(m.group(1) if m else '?')" 2>/dev/null || echo "?")"
      scores["$proj"]="$score"
    elif [[ -f "$cache_legacy" ]]; then
      scores["$proj"]="$(grep -E '^score=' "$cache_legacy" 2>/dev/null | head -1 | cut -d'=' -f2 || echo '?')"
    else
      scores["$proj"]="$(bash "$0" project "$proj" 2>/dev/null | grep -oE '[0-9]+/100' | head -1 | cut -d/ -f1 || echo '?')"
    fi
    local score="${scores[$proj]}"
    if [[ "$score" =~ ^[0-9]+$ ]]; then
      (( score >= 90 )) && icons["$proj"]="🟢" || (( score >= 70 )) && icons["$proj"]="🟡" || (( score >= 50 )) && icons["$proj"]="🟠" || icons["$proj"]="🔴"
    else
      icons["$proj"]="⚫"
    fi
  }

  for proj in "${projects[@]}"; do
    proj="${proj/#\~/$HOME}"
    run_health "$proj"
  done

  printf "  ${CYAN}%-4s  %-35s  %-8s  %s${NC}\n" "Icon" "Project" "Score" "Path"
  echo -e "  ${DIM}$(printf '%.0s─' {1..65})${NC}"
  local total=0 count=0
  for proj in "${projects[@]}"; do
    proj="${proj/#\~/$HOME}"
    local name score icon
    name="$(basename "$proj")"
    score="${scores[$proj]:-?}"
    icon="${icons[$proj]:-⚫}"
    if [[ "$score" =~ ^[0-9]+$ ]]; then
      total=$((total + score))
      count=$((count + 1))
      printf "  %s    %-35s  %3s/100  %s\n" "$icon" "$name" "$score" "$proj"
    else
      printf "  %s    %-35s  %7s  %s\n" "$icon" "$name" 'no data' "$proj"
    fi
  done
  if (( count > 0 )); then
    echo ""
    echo -e "${CYAN}Average:${NC} $((total / count))/100"
  fi
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/health-check.sh project [path] [--fix]
  bash scripts/health-check.sh all
  bash scripts/health-check.sh help

Compatibility:
  bash scripts/health-check.sh /path/to/project [--fix]
EOF
}

ACTION="${1:-project}"
case "$ACTION" in
  help|--help|-h)
    help_text
    ;;
  all)
    all_cmd
    ;;
  project)
    target="${2:-$(pwd)}"
    fix=false
    [[ "${3:-}" == "--fix" || "${2:-}" == "--fix" ]] && fix=true
    project_cmd "$target" "$fix"
    ;;
  *)
    target="$ACTION"
    fix=false
    [[ "${2:-}" == "--fix" ]] && fix=true
    project_cmd "$target" "$fix"
    ;;
esac
