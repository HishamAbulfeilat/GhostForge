#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
VERSION='1.0.0'
CAREER_DIR="$HOME/.career"
PREP_DIR="$CAREER_DIR/prep"
mkdir -p "$CAREER_DIR" "$PREP_DIR"

print_header() {
  echo ""
  echo -e "${BLUE}=== Career Interview Prep ===${NC}"
  echo ""
}

usage() {
  cat <<USAGE
Usage:
  ghostforge career-prep <company>
  ghostforge career-prep prep <company>
  ghostforge career-prep list
  ghostforge career-prep open <company>
  ghostforge career-prep delete <company>
  ghostforge career-prep version
USAGE
}

slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//'
}

open_in_editor() {
  local file="$1"
  if [[ -n "${EDITOR:-}" ]] && command -v "${EDITOR%% *}" >/dev/null 2>&1; then
    $EDITOR "$file"
  elif command -v code >/dev/null 2>&1; then
    code "$file"
  elif command -v nano >/dev/null 2>&1; then
    nano "$file"
  elif command -v vi >/dev/null 2>&1; then
    vi "$file"
  else
    echo -e "${YELLOW}No editor found. File created at:${NC} $file"
  fi
}

latest_brief_for_company() {
  local slug="$1"
  find "$PREP_DIR" -maxdepth 1 -type f -name "${slug}-*.md" -print | sort | tail -n 1
}

create_brief() {
  local company="$1"
  local slug="$2"
  local file="$PREP_DIR/${slug}-$(date '+%Y-%m-%d').md"

  if [[ ! -f "$file" ]]; then
    cat > "$file" <<TEMPLATE
# Interview Prep — $company

- Date: $(date '+%Y-%m-%d')
- Company: $company
- Role:
- Hiring stage:
- Contact / interviewer:
- Job link:

## Role Context
- Product / team focus:
- Why this role fits my background:
- Relevant projects I should mention:

## Company Research Prompts
- What does $company build or sell?
- What recent announcements, launches, or funding news matter?
- What engineering values, stack, or culture signals can I reference?
- How does the company use React, Next.js, TypeScript, Azure, or related tooling?

## STAR Stories Scaffold
### Story 1 — Ownership
- Situation:
- Task:
- Action:
- Result:

### Story 2 — Performance / optimisation
- Situation:
- Task:
- Action:
- Result:

### Story 3 — Teamwork / stakeholder alignment
- Situation:
- Task:
- Action:
- Result:

### Story 4 — Debugging / incident response
- Situation:
- Task:
- Action:
- Result:

## Tech Questions Checklist
- [ ] React rendering, hooks, memoisation, forms
- [ ] Next.js routing, SSR/SSG/ISR, data fetching, caching
- [ ] TypeScript strict typing, utility types, narrowing
- [ ] State management (Context, Zustand, TanStack Query)
- [ ] Testing (Jest, Vitest, React Testing Library, Playwright)
- [ ] Performance, accessibility, and web vitals
- [ ] API integration, auth, and error handling
- [ ] Azure / CI-CD / deployment basics

## Questions To Ask The Interviewer
- What does success look like in the first 90 days?
- How is the frontend team structured and how are decisions made?
- What are the current technical priorities or biggest product challenges?
- How are testing, accessibility, and performance measured?
- What is the release process and deployment workflow?

## Final Notes
- Must-say achievements:
- Metrics to mention:
- Risks / weak spots to prepare for:
- Follow-up email points:
TEMPLATE
    echo -e "${GREEN}Created prep brief:${NC} $file"
  else
    echo -e "${YELLOW}Using existing brief:${NC} $file"
  fi

  open_in_editor "$file"
}

print_header
ACTION="${1:-help}"

case "$ACTION" in
  prep)
    shift
    company="$*"
    if [[ -z "$company" ]]; then
      usage
      exit 1
    fi
    create_brief "$company" "$(slugify "$company")"
    ;;

  list)
    echo -e "${BLUE}Saved prep briefs:${NC}"
    if find "$PREP_DIR" -maxdepth 1 -type f -name '*.md' | grep -q .; then
      find "$PREP_DIR" -maxdepth 1 -type f -name '*.md' -print | sort
    else
      echo -e "${YELLOW}No prep briefs found.${NC}"
    fi
    ;;

  open)
    shift
    company="$*"
    if [[ -z "$company" ]]; then
      usage
      exit 1
    fi
    file="$(latest_brief_for_company "$(slugify "$company")")"
    if [[ -z "$file" ]]; then
      echo -e "${RED}No prep brief found for $company.${NC}"
      exit 1
    fi
    open_in_editor "$file"
    ;;

  delete)
    shift
    company="$*"
    if [[ -z "$company" ]]; then
      usage
      exit 1
    fi
    slug="$(slugify "$company")"
    files=()
    while IFS= read -r file; do
      files+=("$file")
    done < <(find "$PREP_DIR" -maxdepth 1 -type f -name "${slug}-*.md" -print | sort)
    if [[ ${#files[@]} -eq 0 ]]; then
      echo -e "${YELLOW}No prep briefs found for $company.${NC}"
      exit 0
    fi
    for file in "${files[@]}"; do
      rm -f "$file"
      echo -e "${GREEN}Deleted:${NC} $file"
    done
    ;;

  version)
    echo "$VERSION"
    ;;

  help|-h|--help)
    usage
    ;;

  *)
    company="$*"
    if [[ -z "$company" ]]; then
      usage
      exit 1
    fi
    create_brief "$company" "$(slugify "$company")"
    ;;
esac
