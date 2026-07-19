#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-$(pwd)}"
TARGET="${TARGET/#\~/$HOME}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
line() { echo -e "${DIM}═══════════════════════════════════════════════${NC}"; }

critical=0; high=0; medium=0
if command -v gh >/dev/null 2>&1 && (cd "$TARGET" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
  issues="$(cd "$TARGET" && gh issue list --state open --limit 100 --json labels 2>/dev/null || true)"
  if [[ -n "$issues" ]]; then
    read -r critical high medium <<<"$(printf '%s' "$issues" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const issues=JSON.parse(s);let c=0,h=0,m=0;for(const i of issues){const labels=(i.labels||[]).map(l=>(l.name||'').toLowerCase());if(labels.includes('critical')||labels.includes('p0')) c++; else if(labels.includes('high')||labels.includes('p1')) h++; else if(labels.includes('medium')||labels.includes('p2')) m++;}console.log(c,h,m)}catch{console.log('0 0 0')}})")"
  fi
fi

auditCritical=0; auditModerate=0
if [[ -f "$TARGET/package.json" ]]; then
  audit_json="$(cd "$TARGET" && npm audit --json 2>/dev/null || true)"
  if [[ -n "$audit_json" ]]; then
    read -r auditCritical auditModerate <<<"$(printf '%s' "$audit_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=j.metadata?.vulnerabilities||{};console.log(v.critical||0,v.moderate||0)}catch{console.log('0 0')}})")"
  fi
fi

outdated=0
if [[ -f "$TARGET/package.json" ]]; then
  outdated_json="$(cd "$TARGET" && npm outdated --json 2>/dev/null || true)"
  if [[ -n "$outdated_json" && "$outdated_json" != "{}" ]]; then
    outdated="$(printf '%s' "$outdated_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(Object.keys(JSON.parse(s)).length)}catch{console.log(0)}})")"
  fi
fi

branch='not-a-git-repo'; dirty=0
if (cd "$TARGET" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
  branch="$(cd "$TARGET" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  dirty="$(cd "$TARGET" && git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
fi

health='N/A'
if [[ -f "$TARGET/.ghostforge-health-cache" ]]; then
  health="$(grep '^score=' "$TARGET/.ghostforge-health-cache" | head -1 | cut -d'=' -f2)"
fi

tip='/fix-tickets --dry-run'

echo ""
line
echo -e " ${BLUE}${BOLD}GhostForge — Good morning, Dev!${NC}"
echo -e " ${DIM}Date: $(date '+%A, %B %d')${NC}"
line
echo ""
echo -e "${BOLD}🎫 TICKETS (GitHub Issues)${NC}"
echo -e "   ${RED}🔴 ${critical} critical${NC}  ${YELLOW}🟠 ${high} high${NC}  ${BLUE}🟡 ${medium} medium${NC}"
echo ""
echo -e "${BOLD}🔒 SECURITY${NC}"
echo -e "   npm audit: ${auditCritical} critical, ${auditModerate} moderate"
echo ""
echo -e "${BOLD}📦 DEPS${NC}"
echo -e "   ${outdated} outdated packages (run: /upgrade)"
echo ""
echo -e "${BOLD}🔀 GIT STATUS${NC}"
echo -e "   Branch: ${branch}  |  ${dirty} uncommitted files"
echo ""
echo -e "${BOLD}💊 LAST HEALTH SCORE${NC}: ${health}/100 (from .ghostforge-health-cache)"
echo ""
line
echo -e "Tip of the day: ${GREEN}${tip}${NC}"
line
