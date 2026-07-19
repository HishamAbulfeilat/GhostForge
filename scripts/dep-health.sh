#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🩺  GhostForge Dependency Health${NC}"
  echo -e "${DIM}  Audit risk, upgrade drift, and dependency score.${NC}"
  echo ""
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/dep-health.sh check
  bash scripts/dep-health.sh audit
  bash scripts/dep-health.sh outdated
  bash scripts/dep-health.sh full
  bash scripts/dep-health.sh help
EOF
}

require_pkg() {
  [[ -f package.json ]] || { echo -e "${RED}✖ package.json not found in current directory.${NC}"; exit 1; }
}

check_cmd() {
  require_pkg
  header
  npm audit --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s||'{}');const v=j.metadata?.vulnerabilities||{};console.log('  critical:',v.critical||0);console.log('  high    :',v.high||0);console.log('  medium  :',v.medium||0);console.log('  low     :',v.low||0);});"
}

audit_cmd() {
  require_pkg
  header
  npm audit || true
}

outdated_cmd() {
  require_pkg
  header
  npm outdated --json 2>/dev/null | node - <<'NODE'
let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  const data = s.trim() ? JSON.parse(s) : {};
  const rows = Object.entries(data);
  if (!rows.length) {
    console.log('  ✅ All dependencies are current');
    return;
  }
  for (const [name, info] of rows) {
    const cur = info.current || 'n/a';
    const wanted = info.wanted || 'n/a';
    const latest = info.latest || 'n/a';
    const sameMajor = String(cur).split('.')[0] === String(latest).split('.')[0];
    const sameMinor = String(cur).split('.').slice(0, 2).join('.') === String(latest).split('.').slice(0, 2).join('.');
    const color = sameMinor ? '\x1b[32m' : sameMajor ? '\x1b[33m' : '\x1b[31m';
    console.log(`  ${color}${name.padEnd(28)} ${String(cur).padEnd(12)} -> ${String(latest).padEnd(12)} wanted ${wanted}\x1b[0m`);
  }
});
NODE
}

full_cmd() {
  require_pkg
  header
  local audit_json outdated_json
  audit_json="$(npm audit --json 2>/dev/null || true)"
  outdated_json="$(npm outdated --json 2>/dev/null || true)"
  node - <<'NODE' "$audit_json" "$outdated_json"
const audit = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const outdated = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const v = audit.metadata?.vulnerabilities || {};
const outdatedCount = Object.keys(outdated || {}).length;
const score = Math.max(0, 100 - ((v.critical || 0) * 20 + (v.high || 0) * 10 + (v.medium || 0) * 4 + outdatedCount));
console.log(`  Score        : ${score}/100`);
console.log(`  Critical     : ${v.critical || 0}`);
console.log(`  High         : ${v.high || 0}`);
console.log(`  Medium       : ${v.medium || 0}`);
console.log(`  Low          : ${v.low || 0}`);
console.log(`  Outdated pkgs: ${outdatedCount}`);
NODE
}

case "$ACTION" in
  check) check_cmd ;;
  audit) audit_cmd ;;
  outdated) outdated_cmd ;;
  full) full_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
