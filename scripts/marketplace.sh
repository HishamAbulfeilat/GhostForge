#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════╗
# ║   GhostForge AI — Marketplace                                  ║
# ║   Browse and install agents, commands, skills, plugins    ║
# ╚═══════════════════════════════════════════════════════════╝
set -euo pipefail

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG="$GHOSTFORGE_DIR/marketplace/catalog.json"
SOURCES="$GHOSTFORGE_DIR/marketplace/sources.json"
REGISTRY="$GHOSTFORGE_DIR/marketplace/registry.json"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; CYAN='\033[0;36m'; NC='\033[0m'

divider() { echo -e "${DIM}══════════════════════════════════════════════════════${NC}"; }
header()   { echo -e "${BLUE}${BOLD}  🏪 GhostForge Marketplace${NC}"; divider; }

show_help() {
  header
  echo ""
  echo -e "  ${BOLD}Usage:${NC}"
  echo -e "  ${CYAN}bash scripts/marketplace.sh${NC} [command]"
  echo ""
  echo -e "  ${BOLD}Commands:${NC}"
  echo -e "  ${GREEN}list${NC}          List all catalog items"
  echo -e "  ${GREEN}search <q>${NC}    Search items by name/tag/category"
  echo -e "  ${GREEN}install <id>${NC}  Install an item from the catalog"
  echo -e "  ${GREEN}installed${NC}     Show installed items"
  echo -e "  ${GREEN}sources${NC}       List trusted sources"
  echo -e "  ${GREEN}browse${NC}        Interactive browse mode"
  echo -e "  ${GREEN}open-aitmpl${NC}   Open aitmpl.com in browser"
  echo -e "  ${GREEN}gh-discover${NC}   Discover agents from GitHub topics"
  echo ""
}

list_items() {
  header
  echo ""
  if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}Node.js required${NC}"; exit 1
  fi
  CATALOG_PATH="$CATALOG" node - <<'NODEEOF'
const fs = require('fs');
const catalog = JSON.parse(fs.readFileSync(process.env.CATALOG_PATH, 'utf8'));
const byCategory = {};
catalog.items.forEach(item => {
  if (!byCategory[item.category]) byCategory[item.category] = [];
  byCategory[item.category].push(item);
});
Object.entries(byCategory).forEach(([cat, items]) => {
  console.log(`\n  \x1b[1m\x1b[34m${cat}\x1b[0m`);
  items.forEach(item => {
    const status = item.installed ? '\x1b[32m✅\x1b[0m' : '\x1b[2m○\x1b[0m';
    console.log(`  ${status} \x1b[1m${item.name}\x1b[0m \x1b[2m[${item.type}]\x1b[0m`);
    console.log(`     \x1b[2m${item.description}\x1b[0m`);
  });
});
console.log();
NODEEOF
}

search_items() {
  local query="${1:-}"
  if [[ -z "$query" ]]; then
    read -rp "  Search query: " query
  fi
  header
  echo -e "\n  ${DIM}Searching for: ${NC}${BOLD}$query${NC}\n"
  node -e "
const fs = require('fs');
const catalog = JSON.parse(fs.readFileSync('$CATALOG', 'utf8'));
const q = '$query'.toLowerCase();
const results = catalog.items.filter(i =>
  i.name.toLowerCase().includes(q) ||
  i.description.toLowerCase().includes(q) ||
  (i.tags || []).some(t => t.toLowerCase().includes(q))
);
if (results.length === 0) {
  console.log('  \x1b[33mNo items found for: $query\x1b[0m\n');
} else {
  results.forEach(item => {
    const status = item.installed ? '\x1b[32m✅ installed\x1b[0m' : '\x1b[2mavailable\x1b[0m';
    console.log('  \x1b[1m' + item.name + '\x1b[0m \x1b[2m[' + item.type + ']\x1b[0m  ' + status);
    console.log('  \x1b[2m' + item.description + '\x1b[0m');
    console.log('  tags: \x1b[36m' + (item.tags || []).join(', ') + '\x1b[0m');
    console.log();
  });
}
"
}

install_item() {
  local item_id="${1:-}"
  if [[ -z "$item_id" ]]; then
    echo -e "${YELLOW}Usage: bash marketplace.sh install <item-id>${NC}"
    echo -e "${DIM}Run 'bash marketplace.sh list' to see item IDs${NC}"
    exit 1
  fi
  
  header
  echo ""
  local install_cmd name
  install_cmd="$(node -e "
const fs = require('fs');
const catalog = JSON.parse(fs.readFileSync('$CATALOG', 'utf8'));
const item = catalog.items.find(i => i.id === '$item_id');
if (!item) { console.log('NOT_FOUND'); process.exit(0); }
console.log(item.install_command || item.url || 'BUILT_IN:' + (item.file || ''));
" 2>/dev/null)"
  
  name="$(node -e "
const fs = require('fs');
const c = JSON.parse(fs.readFileSync('$CATALOG', 'utf8'));
const i = c.items.find(i => i.id === '$item_id');
console.log(i ? i.name : 'Unknown');
" 2>/dev/null)"

  if [[ "$install_cmd" == "NOT_FOUND" ]]; then
    echo -e "${RED}  ✖ Item '$item_id' not found in catalog${NC}"
    echo -e "${DIM}  Run: bash marketplace.sh list${NC}"
    exit 1
  fi

  echo -e "${BLUE}${BOLD}  Installing: $name${NC}"
  
  if [[ "$install_cmd" == BUILT_IN:* ]]; then
    echo -e "${GREEN}  ✅ Already available! File: ${install_cmd#BUILT_IN:}${NC}"
  elif [[ "$install_cmd" == http* ]]; then
    echo -e "${CYAN}  Opening: $install_cmd${NC}"
    open "$install_cmd" 2>/dev/null || xdg-open "$install_cmd" 2>/dev/null || echo -e "${DIM}  Visit: $install_cmd${NC}"
  else
    echo -e "${DIM}  Running: $install_cmd${NC}"
    eval "$install_cmd"
    echo -e "${GREEN}  ✅ $name installed!${NC}"
  fi
  echo ""
}

list_installed() {
  header
  echo ""
  node -e "
const fs = require('fs');
const catalog = JSON.parse(fs.readFileSync('$CATALOG', 'utf8'));
const registry = fs.existsSync('$REGISTRY') ? JSON.parse(fs.readFileSync('$REGISTRY', 'utf8')) : { installed: [], custom_agents: [], custom_models: [] };
const builtIn = catalog.items.filter(i => i.installed);
console.log('  \x1b[1mBuilt-in GhostForge Items:\x1b[0m');
builtIn.forEach(i => console.log('  \x1b[32m✅\x1b[0m \x1b[1m' + i.name + '\x1b[0m \x1b[2m[' + i.type + ']\x1b[0m'));
if ((registry.installed || []).length > 0) {
  console.log('\n  \x1b[1mUser Installed:\x1b[0m');
  registry.installed.forEach(i => console.log('  \x1b[32m✅\x1b[0m \x1b[1m' + i.name + '\x1b[0m \x1b[2m[' + i.type + ']\x1b[0m  ' + i.file));
}
if ((registry.custom_agents || []).length > 0) {
  console.log('\n  \x1b[1mCustom Agents:\x1b[0m');
  registry.custom_agents.forEach(a => console.log('  \x1b[32m✅\x1b[0m \x1b[1m' + a.name + '\x1b[0m  ' + a.file));
}
console.log();
"
}

list_sources() {
  header
  echo ""
  node -e "
const fs = require('fs');
const sources = JSON.parse(fs.readFileSync('$SOURCES', 'utf8'));
sources.sources.forEach(s => {
  console.log('  \x1b[1m' + s.name + '\x1b[0m \x1b[2m[' + s.type + ']\x1b[0m');
  console.log('  \x1b[2m' + s.description + '\x1b[0m');
  console.log('  \x1b[36m' + s.url + '\x1b[0m');
  console.log();
});
"
}

open_aitmpl() {
  echo -e "\n${BLUE}${BOLD}  Opening aitmpl.com — AI Templates Marketplace${NC}"
  echo -e "${DIM}  Browse React hooks, Next.js starters, AI components...${NC}\n"
  open "https://aitmpl.com" 2>/dev/null || xdg-open "https://aitmpl.com" 2>/dev/null || echo -e "${CYAN}  Visit: https://aitmpl.com${NC}"
}

discover_github() {
  header
  echo ""
  echo -e "${DIM}  Discovering copilot-agent repos on GitHub...${NC}\n"
  if ! command -v gh >/dev/null 2>&1; then
    echo -e "${YELLOW}  gh CLI not found. Visit: https://github.com/topics/copilot-agent${NC}"
    return
  fi
  gh search repos --topic copilot-agent --limit 10 --json nameWithOwner,description,stargazersCount \
    2>/dev/null | node -e "
let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
  try {
    const repos = JSON.parse(s);
    repos.forEach(r => console.log('  \x1b[1m' + r.nameWithOwner + '\x1b[0m ⭐' + r.stargazersCount + '\n  \x1b[2m' + (r.description||'') + '\x1b[0m\n'));
  } catch { console.log('  No results found'); }
})" || echo -e "${DIM}  Could not fetch GitHub results${NC}"
}

interactive_browse() {
  header
  echo ""
  echo -e "  ${BOLD}Actions:${NC}"
  echo -e "  ${GREEN}[1]${NC} Browse all items"
  echo -e "  ${GREEN}[2]${NC} Search items"
  echo -e "  ${GREEN}[3]${NC} View sources"
  echo -e "  ${GREEN}[4]${NC} Open aitmpl.com"
  echo -e "  ${GREEN}[5]${NC} Discover GitHub agents"
  echo -e "  ${GREEN}[q]${NC} Quit"
  echo ""
  read -rp "  Choice: " choice
  case "$choice" in
    1) list_items ;;
    2) search_items ;;
    3) list_sources ;;
    4) open_aitmpl ;;
    5) discover_github ;;
    q|Q) exit 0 ;;
    *) echo -e "${YELLOW}Unknown choice${NC}" ;;
  esac
}

CMD="${1:-browse}"
case "$CMD" in
  list)           list_items ;;
  search)         search_items "${2:-}" ;;
  install)        install_item "${2:-}" ;;
  installed)      list_installed ;;
  sources)        list_sources ;;
  open-aitmpl)    open_aitmpl ;;
  gh-discover)    discover_github ;;
  browse|"")      interactive_browse ;;
  help|--help|-h) show_help ;;
  *)              show_help ;;
esac
