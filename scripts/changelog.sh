#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  📝  GhostForge Changelog Generator${NC}"
  echo -e "${DIM}  Conventional commits → readable release notes.${NC}"
  echo ""
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/changelog.sh generate [since]
  bash scripts/changelog.sh bump [major|minor|patch]
  bash scripts/changelog.sh preview [since]
  bash scripts/changelog.sh help
EOF
}

build_entry() {
  local since="$1"
  python3 - <<'PY' "$since"
import subprocess, sys, datetime
since = sys.argv[1]
if since:
    log_cmd = ['git', '--no-pager', 'log', f'{since}..HEAD', '--pretty=format:%s']
else:
    log_cmd = ['git', '--no-pager', 'log', '--pretty=format:%s']
raw = subprocess.check_output(log_cmd, text=True).splitlines()
sections = {'break': [], 'feat': [], 'fix': [], 'docs': [], 'chore': [], 'other': []}
for msg in raw:
    if msg.startswith('feat!') or 'BREAKING CHANGE' in msg or msg.startswith('break:'):
        sections['break'].append(msg)
    elif msg.startswith('feat'):
        sections['feat'].append(msg.split(':', 1)[1].strip() if ':' in msg else msg)
    elif msg.startswith('fix'):
        sections['fix'].append(msg.split(':', 1)[1].strip() if ':' in msg else msg)
    elif msg.startswith('docs'):
        sections['docs'].append(msg.split(':', 1)[1].strip() if ':' in msg else msg)
    elif msg.startswith('chore'):
        sections['chore'].append(msg.split(':', 1)[1].strip() if ':' in msg else msg)
    else:
        sections['other'].append(msg)
version = subprocess.getoutput('cat VERSION 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || echo unreleased').strip()
print(f"## [{version}] — {datetime.date.today().isoformat()}\n")
labels = [('💥 Breaking Changes', 'break'), ('✨ Features', 'feat'), ('🐛 Fixes', 'fix'), ('📚 Docs', 'docs'), ('🔧 Chores', 'chore'), ('📝 Other', 'other')]
for title, key in labels:
    if sections[key]:
        print(f"### {title}\n")
        for item in sections[key]:
            print(f"- {item}")
        print()
PY
}

generate_cmd() {
  local since="${1:-$(git describe --tags --abbrev=0 2>/dev/null || true)}"
  local entry
  entry="$(build_entry "$since")"
  if [[ -f CHANGELOG.md ]]; then
    printf '%s\n\n%s' "$entry" "$(cat CHANGELOG.md)" > CHANGELOG.md
  else
    printf '%s\n' "$entry" > CHANGELOG.md
  fi
  header
  echo -e "${GREEN}✅ CHANGELOG.md updated.${NC}"
}

preview_cmd() {
  local since="${1:-$(git describe --tags --abbrev=0 2>/dev/null || true)}"
  header
  build_entry "$since"
}

bump_cmd() {
  local kind="${1:-patch}"
  python3 - <<'PY' "$kind"
import json, sys
from pathlib import Path
kind = sys.argv[1]
for candidate in [Path('package.json'), Path('tui/package.json')]:
    if candidate.exists():
        path = candidate
        break
else:
    raise SystemExit('No package.json found')
data = json.loads(path.read_text())
major, minor, patch = map(int, data.get('version', '0.0.0').split('.'))
if kind == 'major':
    major, minor, patch = major + 1, 0, 0
elif kind == 'minor':
    minor, patch = minor + 1, 0
else:
    patch += 1
new = f'{major}.{minor}.{patch}'
data['version'] = new
path.write_text(json.dumps(data, indent=2) + '\n')
print(path)
print(new)
PY
  header
  local file version
  file="$(python3 - <<'PY'
import json
from pathlib import Path
for candidate in [Path('package.json'), Path('tui/package.json')]:
    if candidate.exists():
        data = json.loads(candidate.read_text())
        print(candidate)
        print(data['version'])
        break
PY
)"
  local pkg_file pkg_version
  pkg_file="$(printf '%s\n' "$file" | sed -n '1p')"
  pkg_version="$(printf '%s\n' "$file" | sed -n '2p')"
  echo -e "${GREEN}✅ Bumped ${pkg_file} to v${pkg_version}${NC}"
  echo -e "${DIM}Suggested tag: git tag v${pkg_version} && git push origin v${pkg_version}${NC}"
}

case "$ACTION" in
  generate) generate_cmd "${1:-}" ;;
  preview)  preview_cmd "${1:-}" ;;
  bump)     bump_cmd "${1:-patch}" ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
