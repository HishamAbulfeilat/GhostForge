#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

ACTION="${1:-help}"
shift || true

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🔐  GhostForge Environment Manager${NC}"
  echo -e "${DIM}  Validate, compare, sanitize, sync, and audit your .env files.${NC}"
  echo ""
}

resolve_env_file() {
  local file="${1:-}"
  if [[ -n "$file" ]]; then
    printf '%s\n' "$file"
  elif [[ -f .env.local ]]; then
    printf '.env.local\n'
  else
    printf '.env\n'
  fi
}

parse_keys() {
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$1" | cut -d'=' -f1
}

validate_cmd() {
  local file
  file="$(resolve_env_file "${1:-}")"
  [[ -f "$file" ]] || {
    echo -e "${RED}✖ File not found: $file${NC}"
    exit 1
  }
  header
  FILE="$file" python3 - <<'PY'
from pathlib import Path
import os, re, subprocess

file = Path(os.environ["FILE"])
text = file.read_text(encoding="utf-8").splitlines()
invalid, empty = [], []
values = {}

for i, line in enumerate(text, 1):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key = key.strip()
    value = value.strip()
    values[key] = value
    if not re.match(r"^[A-Z][A-Z0-9_]*$", key):
        invalid.append((i, key))
    if value == "" and not key.endswith("_OPTIONAL"):
        empty.append((i, key))

env_name = (values.get("NODE_ENV") or values.get("APP_ENV") or values.get("ENV") or "").lower()
localhost = [(k, v) for k, v in values.items() if "localhost" in v or "127.0.0.1" in v]

tracked = False
try:
    subprocess.check_output(["git", "ls-files", "--error-unmatch", str(file)], stderr=subprocess.DEVNULL)
    tracked = True
except Exception:
    tracked = False

secret_hits = []
if tracked:
    for key, value in values.items():
        if re.search(r"(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|ACCESS_KEY)", key) and value and "<" not in value and "changeme" not in value.lower():
            secret_hits.append(key)

print(f"Checking: {file}")
if invalid:
    print("\nInvalid key casing:")
    for line, key in invalid:
        print(f"  - line {line}: {key}")
if empty:
    print("\nEmpty required values:")
    for line, key in empty:
        print(f"  - line {line}: {key}")
if env_name and env_name not in ("dev", "development", "local") and localhost:
    print("\nLocalhost URLs in non-dev environment:")
    for key, value in localhost:
        print(f"  - {key}={value}")
if secret_hits:
    print("\nTracked secrets detected:")
    for key in secret_hits:
        print(f"  - {key}")
if not any([invalid, empty, secret_hits]) and not (env_name and env_name not in ("dev", "development", "local") and localhost):
    print("✅ Environment file looks good.")
PY
}

diff_cmd() {
  local file1="${1:-}" file2="${2:-}"
  [[ -n "$file1" && -n "$file2" ]] || {
    echo -e "${RED}✖ Provide two env files.${NC}"
    exit 1
  }
  [[ -f "$file1" && -f "$file2" ]] || {
    echo -e "${RED}✖ Both files must exist.${NC}"
    exit 1
  }
  header
  local only1 only2
  only1="$(comm -23 <(parse_keys "$file1" | sort) <(parse_keys "$file2" | sort) || true)"
  only2="$(comm -13 <(parse_keys "$file1" | sort) <(parse_keys "$file2" | sort) || true)"
  echo -e "${CYAN}${BOLD}${file1} only:${NC}"
  [[ -n "$only1" ]] && printf '%s\n' "$only1" | sed "s/^/${GREEN}  + ${NC}/" || echo -e "${DIM}  none${NC}"
  echo -e "${CYAN}${BOLD}${file2} only:${NC}"
  [[ -n "$only2" ]] && printf '%s\n' "$only2" | sed "s/^/${YELLOW}  + ${NC}/" || echo -e "${DIM}  none${NC}"
}

example_cmd() {
  local file target
  file="$(resolve_env_file "${1:-}")"
  [[ -f "$file" ]] || {
    echo -e "${RED}✖ File not found: $file${NC}"
    exit 1
  }
  target=".env.example"
  header
  FILE="$file" TARGET="$target" python3 - <<'PY'
from pathlib import Path
import os, re

src = Path(os.environ["FILE"])
target = Path(os.environ["TARGET"])
out = []

for line in src.read_text(encoding="utf-8").splitlines():
    stripped = line.strip()
    if not stripped:
        out.append("")
        continue
    if stripped.startswith("#"):
        out.append(line)
        continue
    if "=" not in line:
        out.append(line)
        continue
    key, _ = line.split("=", 1)
    key = key.strip()
    placeholder = "<value>"
    if "URL" in key or "URI" in key:
        placeholder = "<url>"
    elif key.endswith("_PORT"):
        placeholder = "<port>"
    elif re.search(r"(KEY|SECRET|TOKEN|PASSWORD)", key):
        placeholder = "<secret>"
    out.append(f"{key}={placeholder}")

target.write_text("\n".join(out) + "\n", encoding="utf-8")
print(target)
PY
  echo -e "${GREEN}✅ Generated .env.example from ${file}.${NC}"
}

sync_cmd() {
  local source="${1:-}" target="${2:-}"
  [[ -n "$source" && -n "$target" ]] || {
    echo -e "${RED}✖ Source and target files are required.${NC}"
    exit 1
  }
  [[ -f "$source" && -f "$target" ]] || {
    echo -e "${RED}✖ Source and target must exist.${NC}"
    exit 1
  }
  header
  SOURCE="$source" TARGET="$target" python3 - <<'PY'
from pathlib import Path
import os, re

source = Path(os.environ["SOURCE"])
target = Path(os.environ["TARGET"])
source_lines = source.read_text(encoding="utf-8").splitlines()
target_lines = target.read_text(encoding="utf-8").splitlines()
keys = set()

for line in target_lines:
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
    if m:
        keys.add(m.group(1))

added = []
for line in source_lines:
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
    if m and m.group(1) not in keys:
        target_lines.append(line)
        keys.add(m.group(1))
        added.append(m.group(1))

target.write_text("\n".join(target_lines).rstrip() + "\n", encoding="utf-8")
print("\n".join(added))
PY
}

audit_cmd() {
  header
  python3 - <<'PY'
from pathlib import Path
import re, subprocess

files = sorted([p for p in Path(".").rglob(".env*") if ".git/" not in str(p) and "node_modules/" not in str(p)])
if not files:
    print("No .env files found.")
    raise SystemExit(0)

tracked = set()
try:
    tracked = set(subprocess.check_output(["git", "ls-files", ".env*"], text=True).splitlines())
except Exception:
    tracked = set()

for file in files:
    lines = file.read_text(encoding="utf-8").splitlines()
    keys = [line.split("=", 1)[0] for line in lines if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", line)]
    committed = str(file) in tracked
    print(f"- {file} ({len(keys)} keys){'  [tracked]' if committed else ''}")
    if committed:
        for line in lines:
            if "=" not in line or line.strip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            if re.search(r"(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|ACCESS_KEY)", key) and value and "<" not in value and "changeme" not in value.lower():
                print(f"  ⚠ potential committed secret: {key}")
PY
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/env-manager.sh validate [file]
  bash scripts/env-manager.sh diff <file1> <file2>
  bash scripts/env-manager.sh example [file]
  bash scripts/env-manager.sh sync <source> <target>
  bash scripts/env-manager.sh audit
  bash scripts/env-manager.sh help
EOF
}

case "$ACTION" in
  validate) validate_cmd "${1:-}" ;;
  diff) diff_cmd "${1:-}" "${2:-}" ;;
  example) example_cmd "${1:-}" ;;
  sync) sync_cmd "${1:-}" "${2:-}" ;;
  audit) audit_cmd ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
