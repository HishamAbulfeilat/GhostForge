#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
VERSION='1.0.0'
CAREER_DIR="$HOME/.career"
CV_DIR="$CAREER_DIR/cv"
CACHE_DIR="$CV_DIR/.cache"
mkdir -p "$CAREER_DIR" "$CV_DIR" "$CACHE_DIR"

TEMP_FILES=()
cleanup() {
  for file in "${TEMP_FILES[@]:-}"; do
    [[ -f "$file" ]] && rm -f "$file"
  done
}
trap cleanup EXIT

print_header() {
  echo ""
  echo -e "${BLUE}=== Career CV Manager ===${NC}"
  echo ""
}

usage() {
  cat <<USAGE
Usage:
  ghostforge career-cv init <path>
  ghostforge career-cv save [message]
  ghostforge career-cv diff [version1] [version2]
  ghostforge career-cv versions
  ghostforge career-cv log
  ghostforge career-cv export [format]
  ghostforge career-cv status
  ghostforge career-cv version

Commands:
  init <path>         Initialise ~/.career/cv as a git-tracked CV repository
  save [message]      Save the current CV with a commit message
  diff [v1] [v2]      Show changes between CV versions (defaults to last 2 commits)
  versions | log      Show CV version history
  export [format]     Export current CV to ~/Desktop/CV-YYYY-MM-DD.<ext>
  status              Show repo status, last save, and pending changes
  version             Print script version
USAGE
}

meta_get() {
  local key="$1"
  [[ -f "$CV_DIR/.cv-meta" ]] || return 1
  awk -F'=' -v search="$key" '$1 == search { sub(/^[^=]+=*/, "", $0); print $0 }' "$CV_DIR/.cv-meta"
}

current_cv_name() {
  local stored
  stored="$(meta_get "CV_FILE" 2>/dev/null || true)"
  if [[ -n "$stored" && -f "$CV_DIR/$stored" ]]; then
    echo "$stored"
    return 0
  fi

  local found
  found="$(find "$CV_DIR" -maxdepth 1 -type f -name 'cv.*' -print | head -n 1 | xargs -I{} basename "{}" 2>/dev/null || true)"
  [[ -n "$found" ]] && echo "$found"
}

current_cv_path() {
  local name
  name="$(current_cv_name)"
  [[ -n "$name" ]] && echo "$CV_DIR/$name"
}

ensure_repo() {
  if [[ ! -d "$CV_DIR/.git" ]]; then
    echo -e "${RED}CV repository not initialised. Run: ghostforge career-cv init <path>${NC}"
    exit 1
  fi

  if [[ -z "$(current_cv_name)" ]]; then
    echo -e "${RED}No tracked CV file found in $CV_DIR.${NC}"
    exit 1
  fi
}

is_text_like() {
  local ext="$1"
  case "$ext" in
    txt|md|markdown|rst)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

extract_revision_text() {
  local revision="$1"
  local tracked_file="$2"
  local output_file="$3"
  local extension="${tracked_file##*.}"
  local raw_file="$CACHE_DIR/${revision//\//-}.${extension}"

  git -C "$CV_DIR" show "${revision}:${tracked_file}" > "$raw_file"
  TEMP_FILES+=("$raw_file" "$output_file")

  if is_text_like "$extension"; then
    cp "$raw_file" "$output_file"
    return 0
  fi

  case "$extension" in
    docx)
      if command -v pandoc >/dev/null 2>&1; then
        pandoc "$raw_file" -t plain -o "$output_file" >/dev/null 2>&1
        return 0
      fi
      ;;
    pdf)
      if command -v pdftotext >/dev/null 2>&1; then
        pdftotext "$raw_file" "$output_file" >/dev/null 2>&1
        return 0
      fi
      ;;
  esac

  return 1
}

export_with_format() {
  local source_file="$1"
  local format="$2"
  local destination="$3"
  local source_ext="${source_file##*.}"

  if [[ "$format" == "$source_ext" ]]; then
    cp "$source_file" "$destination"
    return 0
  fi

  case "$source_ext:$format" in
    txt:txt|md:md|markdown:markdown)
      cp "$source_file" "$destination"
      return 0
      ;;
    txt:pdf|md:pdf|markdown:pdf|txt:docx|md:docx|markdown:docx|docx:pdf|docx:txt|docx:md)
      if command -v pandoc >/dev/null 2>&1; then
        pandoc "$source_file" -o "$destination" >/dev/null 2>&1
        return 0
      fi
      ;;
    pdf:txt)
      if command -v pdftotext >/dev/null 2>&1; then
        pdftotext "$source_file" "$destination" >/dev/null 2>&1
        return 0
      fi
      ;;
  esac

  return 1
}

print_header
ACTION="${1:-help}"

case "$ACTION" in
  init)
    SOURCE_PATH="${2:-}"
    if [[ -z "$SOURCE_PATH" ]]; then
      usage
      exit 1
    fi
    if [[ ! -f "$SOURCE_PATH" ]]; then
      echo -e "${RED}CV file not found: $SOURCE_PATH${NC}"
      exit 1
    fi

    base_name="$(basename "$SOURCE_PATH")"
    extension=""
    if [[ "$base_name" == *.* ]]; then
      extension=".${base_name##*.}"
    fi
    target_name="cv${extension}"

    mkdir -p "$CV_DIR"
    [[ -d "$CV_DIR/.git" ]] || git init -q "$CV_DIR"
    find "$CV_DIR" -maxdepth 1 -type f -name 'cv.*' ! -name "$target_name" -delete
    cp "$SOURCE_PATH" "$CV_DIR/$target_name"

    cat > "$CV_DIR/.cv-meta" <<META
CV_FILE=$target_name
ORIGINAL_NAME=$base_name
INITIALIZED_AT=$(date '+%Y-%m-%d %H:%M:%S')
META

    git -C "$CV_DIR" add "$target_name" .cv-meta
    if git -C "$CV_DIR" rev-parse --verify HEAD >/dev/null 2>&1; then
      if git -C "$CV_DIR" diff --cached --quiet; then
        echo -e "${YELLOW}CV repository already initialised and unchanged.${NC}"
      else
        git -C "$CV_DIR" commit -m "Reinitialise CV from $base_name" >/dev/null
        echo -e "${GREEN}CV repository updated at $CV_DIR${NC}"
      fi
    else
      git -C "$CV_DIR" commit -m "Initial CV import ($(date '+%Y-%m-%d'))" >/dev/null
      echo -e "${GREEN}Initial CV repository created at $CV_DIR${NC}"
    fi
    echo -e "${BLUE}Tracked file:${NC} $CV_DIR/$target_name"
    ;;

  save)
    ensure_repo
    message="${2:-CV update $(date '+%Y-%m-%d %H:%M:%S')}"
    tracked_name="$(current_cv_name)"
    git -C "$CV_DIR" add "$tracked_name" .cv-meta
    if git -C "$CV_DIR" diff --cached --quiet; then
      echo -e "${YELLOW}No changes to save.${NC}"
      exit 0
    fi
    git -C "$CV_DIR" commit -m "$message" >/dev/null
    echo -e "${GREEN}Saved CV version:${NC} $message"
    ;;

  diff)
    ensure_repo
    tracked_name="$(current_cv_name)"
    rev1="${2:-}"
    rev2="${3:-}"

    if [[ -z "$rev1" && -z "$rev2" ]]; then
      revisions=()
      while IFS= read -r revision; do
        revisions+=("$revision")
      done < <(git -C "$CV_DIR" rev-list --max-count=2 HEAD)
      if [[ ${#revisions[@]} -lt 2 ]]; then
        echo -e "${YELLOW}Need at least 2 commits to compare.${NC}"
        exit 0
      fi
      rev2="${revisions[0]}"
      rev1="${revisions[1]}"
    elif [[ -n "$rev1" && -z "$rev2" ]]; then
      rev2="HEAD"
    fi

    extension="${tracked_name##*.}"
    echo -e "${BLUE}Comparing:${NC} $rev1 -> $rev2"

    if is_text_like "$extension"; then
      git -C "$CV_DIR" --no-pager diff --color=always "$rev1" "$rev2" -- "$tracked_name" | cat
      exit 0
    fi

    left_text="$CACHE_DIR/left-${rev1//\//-}.txt"
    right_text="$CACHE_DIR/right-${rev2//\//-}.txt"
    if extract_revision_text "$rev1" "$tracked_name" "$left_text" && extract_revision_text "$rev2" "$tracked_name" "$right_text"; then
      diff -u "$left_text" "$right_text" || true
    else
      echo -e "${YELLOW}Text conversion unavailable for .$extension files.${NC}"
      echo -e "${YELLOW}Install pandoc (docx) or pdftotext (pdf), or compare with git log / external viewer.${NC}"
      git -C "$CV_DIR" --no-pager diff --stat "$rev1" "$rev2" -- "$tracked_name"
    fi
    ;;

  versions|log)
    ensure_repo
    git -C "$CV_DIR" --no-pager log --date=short --pretty=format:'%C(yellow)%h%Creset  %C(green)%ad%Creset  %s' -- "$(current_cv_name)"
    echo ""
    ;;

  export)
    ensure_repo
    tracked_path="$(current_cv_path)"
    tracked_name="$(basename "$tracked_path")"
    source_ext="${tracked_name##*.}"
    format="${2:-$source_ext}"
    destination="$HOME/Desktop/CV-$(date '+%Y-%m-%d').$format"
    mkdir -p "$HOME/Desktop"

    if export_with_format "$tracked_path" "$format" "$destination"; then
      echo -e "${GREEN}Exported CV:${NC} $destination"
    else
      echo -e "${RED}Could not export to .$format from .$source_ext.${NC}"
      echo -e "${YELLOW}Try installing pandoc or pdftotext, or export using the original file format.${NC}"
      exit 1
    fi
    ;;

  status)
    ensure_repo
    tracked_path="$(current_cv_path)"
    last_commit="$(git -C "$CV_DIR" log -1 --date=short --pretty=format:'%ad — %s' -- "$(current_cv_name)")"
    echo -e "${BLUE}Repository:${NC} $CV_DIR"
    echo -e "${BLUE}Current CV:${NC} $tracked_path"
    echo -e "${BLUE}Last saved:${NC} $last_commit"
    echo -e "${BLUE}Changes:${NC}"
    if git -C "$CV_DIR" status --short | grep -q .; then
      git -C "$CV_DIR" --no-pager status --short
    else
      echo -e "${GREEN}Working tree clean.${NC}"
    fi
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
