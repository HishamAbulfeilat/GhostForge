#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
VERSION='1.0.0'
CAREER_DIR="$HOME/.career"
CACHE_DIR="$CAREER_DIR/gap-cache"
mkdir -p "$CAREER_DIR" "$CACHE_DIR"

TEMP_FILES=()
cleanup() {
  for file in "${TEMP_FILES[@]:-}"; do
    [[ -f "$file" ]] && rm -f "$file"
  done
}
trap cleanup EXIT

print_header() {
  echo ""
  echo -e "${BLUE}=== Career Gap Analyzer ===${NC}"
  echo ""
}

usage() {
  cat <<USAGE
Usage:
  ghostforge career-gap score <cv-file> <jd-file>
  ghostforge career-gap keywords <file>
  ghostforge career-gap suggest <cv-file> <jd-file>
  ghostforge career-gap version
USAGE
}

extract_text_to_file() {
  local source_file="$1"
  local output_file="$2"
  local extension="${source_file##*.}"
  extension="$(echo "$extension" | tr '[:upper:]' '[:lower:]')"
  TEMP_FILES+=("$output_file")

  case "$extension" in
    txt|md|markdown|rst)
      cat "$source_file" > "$output_file"
      ;;
    pdf)
      if command -v pdftotext >/dev/null 2>&1; then
        pdftotext "$source_file" "$output_file" >/dev/null 2>&1
      else
        echo -e "${YELLOW}pdftotext is not installed. Convert the PDF to text/markdown first, or install pdftotext.${NC}"
        return 1
      fi
      ;;
    docx)
      if command -v pandoc >/dev/null 2>&1; then
        pandoc "$source_file" -t plain -o "$output_file" >/dev/null 2>&1
      else
        echo -e "${YELLOW}pandoc is not installed. Convert the DOCX to text/markdown first, or install pandoc.${NC}"
        return 1
      fi
      ;;
    *)
      echo -e "${RED}Unsupported file type: .$extension${NC}"
      echo -e "${YELLOW}Use plain text or markdown. For PDF/DOCX, convert first or install pdftotext/pandoc.${NC}"
      return 1
      ;;
  esac
}

keyword_python() {
  python3 - "$1" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(encoding='utf-8', errors='ignore').lower()
patterns = [
    ('react', r'\breact\b'),
    ('next.js', r'\bnext\.?js\b'),
    ('typescript', r'\btypescript\b|\bts\b'),
    ('javascript', r'\bjavascript\b'),
    ('tailwind css', r'\btailwind\b'),
    ('html', r'\bhtml5?\b'),
    ('css', r'\bcss3?\b'),
    ('sass', r'\bsass\b|\bscss\b'),
    ('redux', r'\bredux\b'),
    ('zustand', r'\bzustand\b'),
    ('tanstack query', r'\btanstack query\b|\breact query\b'),
    ('react hook form', r'\breact hook form\b'),
    ('zod', r'\bzod\b'),
    ('graphql', r'\bgraphql\b'),
    ('rest api', r'\brest\b|\bapi\b'),
    ('node.js', r'\bnode\.?js\b'),
    ('express', r'\bexpress\b'),
    ('nestjs', r'\bnest\s?js\b|\bnestjs\b'),
    ('vite', r'\bvite\b'),
    ('webpack', r'\bwebpack\b'),
    ('azure', r'\bazure\b'),
    ('azure devops', r'\bazure devops\b|\bado\b'),
    ('github actions', r'\bgithub actions\b'),
    ('docker', r'\bdocker\b'),
    ('kubernetes', r'\bkubernetes\b|\baks\b'),
    ('msal', r'\bmsal\b'),
    ('oauth', r'\boauth\b'),
    ('openid connect', r'\bopenid connect\b|\boidc\b'),
    ('jest', r'\bjest\b'),
    ('vitest', r'\bvitest\b'),
    ('playwright', r'\bplaywright\b'),
    ('cypress', r'\bcypress\b'),
    ('storybook', r'\bstorybook\b'),
    ('react native', r'\breact native\b'),
    ('expo', r'\bexpo\b'),
    ('sitecore', r'\bsitecore\b'),
    ('sitefinity', r'\bsitefinity\b'),
    ('sql', r'\bsql\b|\bsqlite\b|\bpostgresql\b|\bmssql\b'),
    ('mongodb', r'\bmongodb\b'),
    ('redis', r'\bredis\b'),
    ('accessibility', r'\baccessibility\b|\bwcag\b|\ba11y\b'),
    ('rtl', r'\brtl\b|\bright-to-left\b'),
    ('i18n', r'\bi18n\b|\binternationali[sz]ation\b|\blocali[sz]ation\b'),
    ('responsive design', r'\bresponsive\b'),
    ('figma', r'\bfigma\b'),
    ('ui/ux', r'\bui\b|\bux\b'),
    ('testing library', r'\btesting library\b'),
    ('performance', r'\bperformance\b|\bweb vitals\b|\boptimization\b'),
    ('agile', r'\bagile\b|\bscrum\b|\bkanban\b'),
]
found = [label for label, pattern in patterns if re.search(pattern, text)]
for keyword in sorted(set(found)):
    print(keyword)
PY
}

print_header
ACTION="${1:-help}"

case "$ACTION" in
  keywords)
    file="${2:-}"
    if [[ -z "$file" || ! -f "$file" ]]; then
      usage
      exit 1
    fi
    extracted="$CACHE_DIR/keywords-$(date +%s).txt"
    extract_text_to_file "$file" "$extracted"
    echo -e "${BLUE}Keywords in $file:${NC}"
    keyword_python "$extracted"
    ;;

  score)
    cv_file="${2:-}"
    jd_file="${3:-}"
    if [[ -z "$cv_file" || -z "$jd_file" || ! -f "$cv_file" || ! -f "$jd_file" ]]; then
      usage
      exit 1
    fi
    cv_text="$CACHE_DIR/cv-$(date +%s).txt"
    jd_text="$CACHE_DIR/jd-$(date +%s).txt"
    extract_text_to_file "$cv_file" "$cv_text"
    extract_text_to_file "$jd_file" "$jd_text"
    python3 - "$cv_text" "$jd_text" <<'PY'
import re, sys
from pathlib import Path
patterns = [
    ('react', r'\breact\b'), ('next.js', r'\bnext\.?js\b'), ('typescript', r'\btypescript\b|\bts\b'),
    ('javascript', r'\bjavascript\b'), ('tailwind css', r'\btailwind\b'), ('html', r'\bhtml5?\b'),
    ('css', r'\bcss3?\b'), ('sass', r'\bsass\b|\bscss\b'), ('redux', r'\bredux\b'),
    ('zustand', r'\bzustand\b'), ('tanstack query', r'\btanstack query\b|\breact query\b'),
    ('react hook form', r'\breact hook form\b'), ('zod', r'\bzod\b'), ('graphql', r'\bgraphql\b'),
    ('rest api', r'\brest\b|\bapi\b'), ('node.js', r'\bnode\.?js\b'), ('express', r'\bexpress\b'),
    ('nestjs', r'\bnest\s?js\b|\bnestjs\b'), ('vite', r'\bvite\b'), ('webpack', r'\bwebpack\b'),
    ('azure', r'\bazure\b'), ('azure devops', r'\bazure devops\b|\bado\b'), ('github actions', r'\bgithub actions\b'),
    ('docker', r'\bdocker\b'), ('kubernetes', r'\bkubernetes\b|\baks\b'), ('msal', r'\bmsal\b'),
    ('oauth', r'\boauth\b'), ('openid connect', r'\bopenid connect\b|\boidc\b'), ('jest', r'\bjest\b'),
    ('vitest', r'\bvitest\b'), ('playwright', r'\bplaywright\b'), ('cypress', r'\bcypress\b'),
    ('storybook', r'\bstorybook\b'), ('react native', r'\breact native\b'), ('expo', r'\bexpo\b'),
    ('sitecore', r'\bsitecore\b'), ('sitefinity', r'\bsitefinity\b'), ('sql', r'\bsql\b|\bsqlite\b|\bpostgresql\b|\bmssql\b'),
    ('mongodb', r'\bmongodb\b'), ('redis', r'\bredis\b'), ('accessibility', r'\baccessibility\b|\bwcag\b|\ba11y\b'),
    ('rtl', r'\brtl\b|\bright-to-left\b'), ('i18n', r'\bi18n\b|\binternationali[sz]ation\b|\blocali[sz]ation\b'),
    ('responsive design', r'\bresponsive\b'), ('figma', r'\bfigma\b'), ('ui/ux', r'\bui\b|\bux\b'),
    ('testing library', r'\btesting library\b'), ('performance', r'\bperformance\b|\bweb vitals\b|\boptimization\b'),
    ('agile', r'\bagile\b|\bscrum\b|\bkanban\b'),
]
def extract(path):
    text = Path(path).read_text(encoding='utf-8', errors='ignore').lower()
    return {label for label, pattern in patterns if re.search(pattern, text)}
cv = extract(sys.argv[1])
jd = extract(sys.argv[2])
if not jd:
    print('No job-description keywords found. Use plain text/markdown with clearer skill content.')
    raise SystemExit(0)
matching = sorted(cv & jd)
missing = sorted(jd - cv)
score = round((len(matching) / len(jd)) * 100)
print(f'Fit score: {score}/100')
print('Matching skills:')
print('  ' + (', '.join(matching) if matching else 'None detected'))
print('Missing skills:')
print('  ' + (', '.join(missing) if missing else 'None — strong keyword fit'))
print(f'Keyword match: {len(matching)} of {len(jd)} job keywords')
PY
    ;;

  suggest)
    cv_file="${2:-}"
    jd_file="${3:-}"
    if [[ -z "$cv_file" || -z "$jd_file" || ! -f "$cv_file" || ! -f "$jd_file" ]]; then
      usage
      exit 1
    fi
    cv_text="$CACHE_DIR/cv-suggest-$(date +%s).txt"
    jd_text="$CACHE_DIR/jd-suggest-$(date +%s).txt"
    extract_text_to_file "$cv_file" "$cv_text"
    extract_text_to_file "$jd_file" "$jd_text"
    python3 - "$cv_text" "$jd_text" "$cv_file" "$jd_file" <<'PY'
import re, sys
from pathlib import Path
patterns = [
    ('react', r'\breact\b'), ('next.js', r'\bnext\.?js\b'), ('typescript', r'\btypescript\b|\bts\b'),
    ('javascript', r'\bjavascript\b'), ('tailwind css', r'\btailwind\b'), ('redux', r'\bredux\b'),
    ('zustand', r'\bzustand\b'), ('tanstack query', r'\btanstack query\b|\breact query\b'), ('graphql', r'\bgraphql\b'),
    ('node.js', r'\bnode\.?js\b'), ('azure', r'\bazure\b'), ('azure devops', r'\bazure devops\b|\bado\b'),
    ('jest', r'\bjest\b'), ('vitest', r'\bvitest\b'), ('playwright', r'\bplaywright\b'), ('storybook', r'\bstorybook\b'),
    ('accessibility', r'\baccessibility\b|\bwcag\b|\ba11y\b'), ('performance', r'\bperformance\b|\bweb vitals\b'),
    ('i18n', r'\bi18n\b|\blocali[sz]ation\b'), ('rtl', r'\brtl\b|\bright-to-left\b'), ('agile', r'\bagile\b|\bscrum\b'),
]
def extract(path):
    text = Path(path).read_text(encoding='utf-8', errors='ignore').lower()
    return {label for label, pattern in patterns if re.search(pattern, text)}
cv = extract(sys.argv[1])
jd = extract(sys.argv[2])
matching = sorted(cv & jd)
missing = sorted(jd - cv)
print('Paste this prompt into Claude or Copilot:')
print('')
print(f"I have a CV in '{sys.argv[3]}' and a job description in '{sys.argv[4]}'.")
print('Please tailor my CV for this role without inventing experience.')
print(f"Keep strong emphasis on these matching skills: {', '.join(matching) if matching else 'none detected' }.")
print(f"Help me better represent or close these missing keywords: {', '.join(missing) if missing else 'none detected' }.")
print('Return:')
print('1. A concise fit summary')
print('2. Bullet-point CV edits section by section')
print('3. Suggested rewritten summary/profile')
print('4. Achievement bullets with stronger impact wording')
print('5. Gaps I should be ready to explain in interviews')
PY
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
