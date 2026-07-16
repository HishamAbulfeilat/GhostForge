#!/usr/bin/env bash
set -euo pipefail
GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; CYAN='\033[0;36m'; NC='\033[0m'

ACTION="${1:-status}"

ADO_ORG="${AZURE_DEVOPS_ORG:-${ADO_ORG:-}}"
ADO_PROJECT="${AZURE_DEVOPS_PROJECT:-${ADO_PROJECT:-}}"
ADO_TOKEN="${AZURE_DEVOPS_PAT:-${ADO_TOKEN:-}}"

for env_file in "$GHOSTFORGE_DIR/.env.local" "$(pwd)/.env.local" "$(pwd)/.env"; do
  [[ -f "$env_file" ]] && source <(grep -E '^(AZURE_DEVOPS_|ADO_)' "$env_file" | sed 's/^/export /') 2>/dev/null || true
done
ADO_ORG="${AZURE_DEVOPS_ORG:-${ADO_ORG:-}}"
ADO_PROJECT="${AZURE_DEVOPS_PROJECT:-${ADO_PROJECT:-}}"
ADO_TOKEN="${AZURE_DEVOPS_PAT:-${ADO_TOKEN:-}}"

echo ""
echo -e "${BLUE}${BOLD}  ╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}  ║   Azure DevOps Integration                   ║${NC}"
echo -e "${BLUE}${BOLD}  ╚══════════════════════════════════════════════╝${NC}"
echo ""

ado_api() {
  local path="$1"
  local method="${2:-GET}"
  local body="${3:-}"
  if [[ -z "$ADO_TOKEN" || -z "$ADO_ORG" || -z "$ADO_PROJECT" ]]; then
    echo "NOT_CONFIGURED"
    return 1
  fi
  local auth
  auth="$(printf ':%s' "$ADO_TOKEN" | base64)"
  local url="https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis/${path}"
  if [[ -n "$body" ]]; then
    curl -s -X "$method" -H "Authorization: Basic $auth" -H "Content-Type: application/json" -d "$body" "$url"
  else
    curl -s -H "Authorization: Basic $auth" "$url"
  fi
}

check_config() {
  if [[ -z "$ADO_ORG" || -z "$ADO_PROJECT" || -z "$ADO_TOKEN" ]]; then
    echo -e "  ${YELLOW}⚠  Azure DevOps not configured.${NC}"
    echo ""
    echo -e "  ${BOLD}Add to your .env.local:${NC}"
    echo -e "  ${DIM}AZURE_DEVOPS_ORG=your-org-name${NC}"
    echo -e "  ${DIM}AZURE_DEVOPS_PROJECT=your-project-name${NC}"
    echo -e "  ${DIM}AZURE_DEVOPS_PAT=your-personal-access-token${NC}"
    echo ""
    echo -e "  ${DIM}Get a PAT: Azure DevOps → User Settings → Personal Access Tokens${NC}"
    echo -e "  ${DIM}Required scopes: Work Items (Read), Build (Read), Code (Read)${NC}"
    return 1
  fi
  return 0
}

case "$ACTION" in
  status)
    check_config || exit 0
    echo -e "  ${BLUE}Org:${NC} $ADO_ORG  ${BLUE}Project:${NC} $ADO_PROJECT"
    echo ""
    RESULT="$(ado_api "build/builds?api-version=7.0&\$top=1" 2>/dev/null || true)"
    if echo "$RESULT" | grep -q '"value"'; then
      echo -e "  ${GREEN}✅ Connected to Azure DevOps${NC}"
    else
      echo -e "  ${RED}✖  Connection failed. Check PAT and org/project names.${NC}"
    fi
    ;;

  pipelines)
    check_config || exit 0
    echo -e "  ${BLUE}Fetching recent pipeline runs...${NC}"
    echo ""
    RESULT="$(ado_api "build/builds?api-version=7.0&\$top=10&queryOrder=queueTimeDescending" 2>/dev/null || true)"
    if command -v python3 &>/dev/null && echo "$RESULT" | grep -q '"value"'; then
      echo "$RESULT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
builds = data.get('value', [])[:10]
if not builds:
    print('  No recent builds found.')
else:
    for b in builds:
        result = b.get('result', b.get('status', '?'))
        icon = '✅' if result == 'succeeded' else '❌' if result == 'failed' else '🔄' if result in ('inProgress', 'running') else '⚪'
        name = (b.get('definition', {}).get('name', '?'))[:30]
        branch = (b.get('sourceBranch', '').replace('refs/heads/', ''))[:20]
        started = (b.get('startTime', '?'))[:10]
        print(f'  {icon}  {name:<30}  {branch:<20}  {started}')
" || echo -e "  ${YELLOW}Could not parse response.${NC}"
    else
      echo -e "  ${YELLOW}No data or not configured.${NC}"
    fi
    ;;

  tickets|workitems)
    check_config || exit 0
    echo -e "  ${BLUE}Fetching work items assigned to you...${NC}"
    echo ""
    WIQL='{"query": "SELECT [System.Id],[System.Title],[System.State],[System.Priority],[System.AssignedTo] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] <> '\''Closed'\'' AND [System.State] <> '\''Resolved'\'' ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.CreatedDate] DESC"}'
    WIQL_RESULT="$(ado_api "wit/wiql?api-version=7.0" "POST" "$WIQL" 2>/dev/null || true)"

    if command -v python3 &>/dev/null && echo "$WIQL_RESULT" | grep -q '"workItems"'; then
      IDS="$(echo "$WIQL_RESULT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ids = [str(i['id']) for i in d.get('workItems', [])[:15]]
print(','.join(ids))
" 2>/dev/null || true)"

      if [[ -n "$IDS" ]]; then
        ITEMS_RESULT="$(ado_api "wit/workitems?ids=$IDS&api-version=7.0&\$expand=none" 2>/dev/null || true)"
        echo "$ITEMS_RESULT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
items = data.get('value', [])
priority_icons = {'1': '🔴', '2': '🟠', '3': '🟡', '4': '🟢'}
for item in items:
    f = item.get('fields', {})
    _id = item.get('id', '?')
    title = (f.get('System.Title', '?'))[:45]
    state = f.get('System.State', '?')
    prio = str(f.get('Microsoft.VSTS.Common.Priority', '3'))
    icon = priority_icons.get(prio, '⚪')
    print(f'  {icon}  #{_id:<6}  {title:<45}  [{state}]')
" 2>/dev/null || echo -e "  ${YELLOW}Could not parse work items.${NC}"
      else
        echo -e "  ${GREEN}✅ No open work items assigned to you.${NC}"
      fi
    else
      echo -e "  ${YELLOW}No work items data. Check PAT has Work Items (Read) scope.${NC}"
    fi
    ;;

  config)
    echo -e "  ${BOLD}Azure DevOps Configuration${NC}"
    echo ""
    echo -e "  ${DIM}Add these to ${GHOSTFORGE_DIR}/.env.local:${NC}"
    echo ""
    echo -e "  ${CYAN}AZURE_DEVOPS_ORG${NC}=your-org-name"
    echo -e "  ${CYAN}AZURE_DEVOPS_PROJECT${NC}=your-project-name"
    echo -e "  ${CYAN}AZURE_DEVOPS_PAT${NC}=your-personal-access-token"
    echo ""
    echo -e "  ${DIM}PAT required scopes: Work Items (Read), Build (Read), Code (Read)${NC}"
    echo -e "  ${DIM}Get PAT: https://dev.azure.com/{org}/_usersSettings/tokens${NC}"
    ;;

  *)
    echo -e "  Usage: bash scripts/ado.sh [status|pipelines|tickets|config]"
    ;;
esac
echo ""
