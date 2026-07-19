#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
VERSION='1.0.0'
CAREER_DIR="$HOME/.career"
TRACK_DB="$CAREER_DIR/applications.db"
TRACK_JSON="$CAREER_DIR/applications.json"
mkdir -p "$CAREER_DIR"

VALID_STATUSES="applied screening interview offer rejected withdrawn"
BACKEND="json"
if command -v sqlite3 >/dev/null 2>&1; then
  BACKEND="sqlite"
fi

print_header() {
  echo ""
  echo -e "${BLUE}=== Career Application Tracker ===${NC}"
  echo ""
}

usage() {
  cat <<USAGE
Usage:
  ghostforge career-track add <company> <role> [url]
  ghostforge career-track update <id> <status>
  ghostforge career-track list [--status <status>]
  ghostforge career-track note <id> <text>
  ghostforge career-track stats
  ghostforge career-track export
  ghostforge career-track ado-sync
  ghostforge career-track version

Statuses:
  applied | screening | interview | offer | rejected | withdrawn
USAGE
}

is_valid_status() {
  [[ " $VALID_STATUSES " == *" $1 "* ]]
}

init_storage() {
  if [[ "$BACKEND" == "sqlite" ]]; then
    python3 - "$TRACK_DB" <<'PY'
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.execute(
    '''CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company TEXT NOT NULL,
        role TEXT NOT NULL,
        url TEXT,
        status TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )'''
)
conn.commit()
conn.close()
PY
  elif [[ ! -f "$TRACK_JSON" ]]; then
    cat > "$TRACK_JSON" <<JSON
{"last_id": 0, "applications": []}
JSON
  fi
}

backend_label() {
  if [[ "$BACKEND" == "sqlite" ]]; then
    echo "SQLite ($TRACK_DB)"
  else
    echo "JSON ($TRACK_JSON)"
  fi
}

print_header
init_storage
ACTION="${1:-help}"

case "$ACTION" in
  add)
    company="${2:-}"
    role="${3:-}"
    url="${4:-}"
    if [[ -z "$company" || -z "$role" ]]; then
      usage
      exit 1
    fi
    app_id="$(python3 - "$BACKEND" "$TRACK_DB" "$TRACK_JSON" "$company" "$role" "$url" <<'PY'
import json, sqlite3, sys
from datetime import datetime
backend, db_file, json_file, company, role, url = sys.argv[1:7]
now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
if backend == 'sqlite':
    conn = sqlite3.connect(db_file)
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO applications (company, role, url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        (company, role, url, 'applied', now, now),
    )
    conn.commit()
    print(cur.lastrowid)
    conn.close()
else:
    with open(json_file, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    app_id = data.get('last_id', 0) + 1
    data['last_id'] = app_id
    data.setdefault('applications', []).append({
        'id': app_id,
        'company': company,
        'role': role,
        'url': url,
        'status': 'applied',
        'notes': '',
        'created_at': now,
        'updated_at': now,
    })
    with open(json_file, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, indent=2)
    print(app_id)
PY
)"
    echo -e "${GREEN}Added application #$app_id${NC}"
    echo -e "${BLUE}Backend:${NC} $(backend_label)"
    ;;

  update)
    id="${2:-}"
    status="${3:-}"
    if [[ -z "$id" || -z "$status" ]]; then
      usage
      exit 1
    fi
    if ! is_valid_status "$status"; then
      echo -e "${RED}Invalid status: $status${NC}"
      exit 1
    fi
    if ! python3 - "$BACKEND" "$TRACK_DB" "$TRACK_JSON" "$id" "$status" <<'PY'
import json, sqlite3, sys
from datetime import datetime
backend, db_file, json_file, app_id, status = sys.argv[1:6]
now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
updated = False
if backend == 'sqlite':
    conn = sqlite3.connect(db_file)
    cur = conn.cursor()
    cur.execute('UPDATE applications SET status = ?, updated_at = ? WHERE id = ?', (status, now, app_id))
    updated = cur.rowcount > 0
    conn.commit()
    conn.close()
else:
    with open(json_file, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    for item in data.get('applications', []):
        if str(item.get('id')) == app_id:
            item['status'] = status
            item['updated_at'] = now
            updated = True
            break
    if updated:
        with open(json_file, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, indent=2)
if not updated:
    raise SystemExit('NOT_FOUND')
PY
    then
      echo -e "${RED}Application #$id not found.${NC}"
      exit 1
    fi
    echo -e "${GREEN}Updated application #$id to $status${NC}"
    ;;

  list)
    status_filter=""
    shift || true
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --status)
          status_filter="${2:-}"
          shift 2
          ;;
        *)
          echo -e "${RED}Unknown option: $1${NC}"
          exit 1
          ;;
      esac
    done
    if [[ -n "$status_filter" ]] && ! is_valid_status "$status_filter"; then
      echo -e "${RED}Invalid status: $status_filter${NC}"
      exit 1
    fi
    python3 - "$BACKEND" "$TRACK_DB" "$TRACK_JSON" "$status_filter" <<'PY'
import json, sqlite3, sys
from textwrap import shorten
backend, db_file, json_file, status_filter = sys.argv[1:5]
if backend == 'sqlite':
    conn = sqlite3.connect(db_file)
    conn.row_factory = sqlite3.Row
    query = 'SELECT id, company, role, status, updated_at, url FROM applications'
    params = []
    if status_filter:
        query += ' WHERE status = ?'
        params.append(status_filter)
    query += ' ORDER BY datetime(updated_at) DESC, id DESC'
    rows = [dict(row) for row in conn.execute(query, params).fetchall()]
    conn.close()
else:
    with open(json_file, 'r', encoding='utf-8') as handle:
        rows = data = json.load(handle).get('applications', [])
    if status_filter:
        rows = [row for row in rows if row.get('status') == status_filter]
    rows = sorted(rows, key=lambda row: (row.get('updated_at', ''), row.get('id', 0)), reverse=True)
if not rows:
    print('No applications found.')
    raise SystemExit(0)
print(f"{'ID':<4} {'Company':<22} {'Role':<24} {'Status':<11} {'Updated':<19} URL")
print('-' * 96)
for row in rows:
    url = shorten(row.get('url') or '-', width=28, placeholder='...')
    company = shorten(row.get('company') or '-', width=22, placeholder='...')
    role = shorten(row.get('role') or '-', width=24, placeholder='...')
    print(f"{str(row.get('id')):<4} {company:<22} {role:<24} {row.get('status', '-'):<11} {row.get('updated_at', '-'):<19} {url}")
PY
    ;;

  note)
    id="${2:-}"
    shift 2 || true
    note_text="$*"
    if [[ -z "$id" || -z "$note_text" ]]; then
      usage
      exit 1
    fi
    if ! python3 - "$BACKEND" "$TRACK_DB" "$TRACK_JSON" "$id" "$note_text" <<'PY'
import json, sqlite3, sys
from datetime import datetime
backend, db_file, json_file, app_id, note_text = sys.argv[1:6]
now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
entry = f'- [{now}] {note_text}'
updated = False
if backend == 'sqlite':
    conn = sqlite3.connect(db_file)
    cur = conn.cursor()
    current = cur.execute('SELECT notes FROM applications WHERE id = ?', (app_id,)).fetchone()
    if current is not None:
        notes = current[0] or ''
        notes = f'{notes}\n{entry}'.strip()
        cur.execute('UPDATE applications SET notes = ?, updated_at = ? WHERE id = ?', (notes, now, app_id))
        conn.commit()
        updated = True
    conn.close()
else:
    with open(json_file, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    for item in data.get('applications', []):
        if str(item.get('id')) == app_id:
            notes = item.get('notes', '')
            item['notes'] = f'{notes}\n{entry}'.strip()
            item['updated_at'] = now
            updated = True
            break
    if updated:
        with open(json_file, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, indent=2)
if not updated:
    raise SystemExit('NOT_FOUND')
PY
    then
      echo -e "${RED}Application #$id not found.${NC}"
      exit 1
    fi
    echo -e "${GREEN}Added note to application #$id${NC}"
    ;;

  stats)
    python3 - "$BACKEND" "$TRACK_DB" "$TRACK_JSON" <<'PY'
import json, sqlite3, sys
from collections import Counter
from datetime import datetime
backend, db_file, json_file = sys.argv[1:4]
if backend == 'sqlite':
    conn = sqlite3.connect(db_file)
    conn.row_factory = sqlite3.Row
    rows = [dict(row) for row in conn.execute('SELECT * FROM applications').fetchall()]
    conn.close()
else:
    with open(json_file, 'r', encoding='utf-8') as handle:
        rows = json.load(handle).get('applications', [])
total = len(rows)
if total == 0:
    print('No applications tracked yet.')
    raise SystemExit(0)
counts = Counter(row.get('status', 'unknown') for row in rows)
responded_statuses = {'screening', 'interview', 'offer', 'rejected', 'withdrawn'}
responded = [row for row in rows if row.get('status') in responded_statuses]
response_rate = (len(responded) / total) * 100 if total else 0
avg_days = 0.0
if responded:
    durations = []
    for row in responded:
        created = datetime.strptime(row['created_at'], '%Y-%m-%d %H:%M:%S')
        updated = datetime.strptime(row['updated_at'], '%Y-%m-%d %H:%M:%S')
        durations.append((updated - created).total_seconds() / 86400)
    avg_days = sum(durations) / len(durations)
print(f'Total applications: {total}')
print('By status:')
for status in ['applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn']:
    print(f'  - {status}: {counts.get(status, 0)}')
print(f'Response rate: {response_rate:.1f}%')
print(f'Average days to current response state: {avg_days:.1f}')
PY
    ;;

  export)
    csv_file="$CAREER_DIR/applications.csv"
    python3 - "$BACKEND" "$TRACK_DB" "$TRACK_JSON" "$csv_file" <<'PY'
import csv, json, sqlite3, sys
backend, db_file, json_file, csv_file = sys.argv[1:5]
if backend == 'sqlite':
    conn = sqlite3.connect(db_file)
    conn.row_factory = sqlite3.Row
    rows = [dict(row) for row in conn.execute('SELECT * FROM applications ORDER BY id').fetchall()]
    conn.close()
else:
    with open(json_file, 'r', encoding='utf-8') as handle:
        rows = json.load(handle).get('applications', [])
fields = ['id', 'company', 'role', 'url', 'status', 'created_at', 'updated_at', 'notes']
with open(csv_file, 'w', encoding='utf-8', newline='') as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key, '') for key in fields})
print(csv_file)
PY
    echo -e "${GREEN}Exported applications:${NC} $csv_file"
    ;;

  ado-sync)
    echo -e "${BLUE}Azure DevOps sync stub${NC}"
    echo "1. Create a work item type such as 'Career Application' or use Tasks/Bugs."
    echo "2. Map fields: company -> Title, role/url -> Description, status -> State, notes -> Discussion."
    echo "3. Export with 'ghostforge career-track export' and import the CSV manually or script against ADO REST APIs."
    echo "4. Consider storing the ADO work item ID back into notes for bi-directional tracking."
    ;;

  version)
    echo "$VERSION"
    ;;

  help|-h|--help)
    usage
    ;;

  *)
    usage
    exit 1
    ;;
esac
