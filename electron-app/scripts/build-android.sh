#!/usr/bin/env bash
# GhostForge JARVIS — Android build entrypoint
# Usage: bash scripts/build-android.sh [debug|release|bundle]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ANDROID_DIR="$PROJECT_DIR/android"
GRADLEW="$ANDROID_DIR/gradlew"

usage() {
  echo "Usage: $0 [debug|release|bundle]"
  echo "  debug   : assembleDebug (default)"
  echo "  release : assembleRelease"
  echo "  bundle  : bundleRelease"
}

resolve_android_sdk() {
  local candidate
  for candidate in \
    "${ANDROID_HOME:-}" \
    "${ANDROID_SDK_ROOT:-}" \
    "${ANDROID_SDK:-}" \
    "$HOME/Android/Sdk" \
    "$HOME/Library/Android/sdk" \
    "$HOME/Android/sdk" \
    "/opt/android-sdk" \
    "/usr/local/android-sdk" \
    "/usr/local/share/android-sdk"; do
    if [ -n "${candidate:-}" ] && [ -d "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  if [ -f "$ANDROID_DIR/local.properties" ]; then
    candidate="$(sed -n 's/^[[:space:]]*sdk.dir[[:space:]]*=[[:space:]]*//p' "$ANDROID_DIR/local.properties" | head -n 1 || true)"
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  fi

  return 1
}

resolve_java_home() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    echo "$JAVA_HOME"
    return 0
  fi

  if command -v java >/dev/null 2>&1; then
    local java_bin
    java_bin="$(command -v java)"
    local candidate
    candidate="$(dirname "$(dirname "$java_bin")")"
    if [ -x "$candidate/bin/java" ]; then
      echo "$candidate"
      return 0
    fi
  fi

  return 1
}

require_prereqs() {
  if [ ! -d "$ANDROID_DIR" ] || [ ! -f "$GRADLEW" ]; then
    echo "Error: Android project is not initialized at $ANDROID_DIR"
    echo "Run: cd $PROJECT_DIR && npx cap add android"
    exit 1
  fi

  local java_home
  java_home="$(resolve_java_home || true)"
  if [ -z "$java_home" ]; then
    echo "Error: JDK 21+ is required for Android builds. Set JAVA_HOME to a valid JDK or install one."
    exit 1
  fi

  export JAVA_HOME="$java_home"
  export PATH="$JAVA_HOME/bin:$PATH"

  local java_version
  java_version="$($JAVA_HOME/bin/java -version 2>&1 | awk -F '"' '/version/ {print $2; exit}' | cut -d '.' -f 1)"
  if [ -z "$java_version" ] || [ "$java_version" -lt 21 ]; then
    echo "Error: JDK 21+ is required. Current JAVA_HOME=$JAVA_HOME provides Java ${java_version:-unknown}."
    exit 1
  fi

  local sdk_dir
  sdk_dir="$(resolve_android_sdk || true)"
  if [ -z "$sdk_dir" ]; then
    echo "Error: Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT to your SDK path."
    echo "Typical locations: ~/Android/Sdk, ~/Library/Android/sdk, or /opt/android-sdk"
    exit 1
  fi

  export ANDROID_HOME="$sdk_dir"
  export ANDROID_SDK_ROOT="$sdk_dir"
  export ANDROID_SDK="$sdk_dir"

  if [ ! -x "$GRADLEW" ]; then
    echo "Error: Missing Android Gradle wrapper at $GRADLEW"
    exit 1
  fi
}

run_gradle_task() {
  local task="$1"
  echo "Using JAVA_HOME=$JAVA_HOME"
  echo "Using Android SDK=$ANDROID_HOME"
  echo "Running Gradle task: $task"
  chmod +x "$GRADLEW" 2>/dev/null || true
  (
    cd "$ANDROID_DIR"
    ./gradlew --no-daemon "$task"
  )
}

TARGET="${1:-debug}"
case "$TARGET" in
  debug|--debug|-d)
    TARGET_TASK="assembleDebug"
    ;;
  release|--release|-r)
    TARGET_TASK="assembleRelease"
    ;;
  bundle|--bundle|-b)
    TARGET_TASK="bundleRelease"
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "Error: unknown target '$TARGET'"
    usage
    exit 2
    ;;
 esac

require_prereqs
run_gradle_task "$TARGET_TASK"

echo "Android build finished: $TARGET_TASK"
