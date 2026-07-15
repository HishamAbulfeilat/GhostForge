#!/usr/bin/env bash
# ============================================================
# GhostForge Project Setup Wizard
# Interactive project scaffolder with AI conversation mode
# ============================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

GHOSTFORGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Banner ───────────────────────────────────────────────────
clear
echo -e "${BLUE}${BOLD}"
cat << 'BANNER'
  ███████╗      ██╗ █████╗ ██████╗  █████╗
  ██╔════╝      ██║██╔══██╗██╔══██╗██╔══██╗
  █████╗        ██║███████║██║  ██║███████║
  ██╔══╝   ██   ██║██╔══██║██║  ██║██╔══██║
  ███████╗ ╚█████╔╝██║  ██║██████╔╝██║  ██║
  ╚══════╝  ╚════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝
BANNER
echo -e "${NC}${BOLD}  🚀 Project Setup Wizard — Powered by GhostForge AI${NC}"
echo -e "  ─────────────────────────────────────────────"
echo ""

# ── Helper functions ─────────────────────────────────────────
ask() { echo -e "${CYAN}$1${NC}"; }
info() { echo -e "${BLUE}  ℹ  $1${NC}"; }
success() { echo -e "${GREEN}  ✅ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠️  $1${NC}"; }
error() { echo -e "${RED}  ❌ $1${NC}"; exit 1; }
divider() { echo -e "${BLUE}  ─────────────────────────────────────────────${NC}"; }

prompt_choice() {
  local question="$1"; shift
  local options=("$@")
  ask "$question"
  for i in "${!options[@]}"; do
    echo -e "  ${BOLD}[$((i+1))]${NC} ${options[$i]}"
  done
  local choice
  while true; do
    read -rp "  → Choose [1-${#options[@]}]: " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#options[@]} )); then
      echo "${options[$((choice-1))]}"
      return
    fi
    warn "Invalid choice. Enter a number between 1 and ${#options[@]}."
  done
}

prompt_yn() {
  local question="$1"
  local default="${2:-n}"
  ask "$question [y/N]: "
  read -rp "  → " answer
  answer="${answer:-$default}"
  [[ "${answer,,}" == "y" ]]
}

# ── Step 1: AI Conversation Mode ─────────────────────────────
echo -e "${BOLD}  How would you like to set up your project?${NC}"
echo ""
echo -e "  ${BOLD}[1]${NC} 🧙 ${BOLD}AI Mode${NC}        — Describe your app, AI figures out the setup"
echo -e "  ${BOLD}[2]${NC} 🔧 ${BOLD}Manual Mode${NC}    — Answer questions step by step"
echo ""
read -rp "  → Choose [1-2]: " MODE_CHOICE

PROJECT_TYPE=""
PLATFORM=""
FRAMEWORK=""
USE_TS="true"
USE_TAILWIND="true"
UI_LIB=""
STATE_MGMT=""
AUTH=""
BACKEND=""
TESTING=""
GIT_REMOTE=""
CICD=""
DEPLOY_TARGET=""
PROJECT_NAME=""
PROJECT_DESC=""

if [[ "$MODE_CHOICE" == "1" ]]; then
  # ── AI Conversation Mode ──────────────────────────────────
  echo ""
  echo -e "${CYAN}${BOLD}  🧙 AI Mode — Describe your app${NC}"
  divider
  echo -e "  Tell the AI what you want to build. Be as detailed as you like."
  echo -e "  Example: ${YELLOW}\"A mobile app for HR to manage leave requests with Arabic support and Azure AD login\"${NC}"
  echo ""
  read -rp "  💬 Describe your app: " PROJECT_DESC

  echo ""
  info "Analyzing your description..."
  sleep 1

  # Parse keywords from description for smart defaults
  DESC_LOWER="${PROJECT_DESC,,}"

  # Platform detection
  if echo "$DESC_LOWER" | grep -qE "mobile|app|ios|android|react native|expo"; then
    PLATFORM="mobile"
    FRAMEWORK="react-native"
    info "Detected: Mobile app (React Native + Expo)"
  elif echo "$DESC_LOWER" | grep -qE "dashboard|portal|website|web app|next\.?js|next js"; then
    PLATFORM="web"
    FRAMEWORK="nextjs"
    info "Detected: Web app (Next.js)"
  elif echo "$DESC_LOWER" | grep -qE "api|backend|server|microservice|rest|graphql"; then
    PLATFORM="backend"
    FRAMEWORK="nestjs"
    info "Detected: Backend API (NestJS)"
  else
    PLATFORM="web"
    FRAMEWORK="nextjs"
    info "Defaulting to: Web app (Next.js)"
  fi

  # Feature detection
  if echo "$DESC_LOWER" | grep -qE "azure ad|microsoft login|sso|single sign"; then
    AUTH="azure-ad"
    info "Detected: Azure AD authentication"
  elif echo "$DESC_LOWER" | grep -qE "google|oauth"; then
    AUTH="nextauth"
    info "Detected: OAuth authentication"
  elif echo "$DESC_LOWER" | grep -qE "login|auth|sign in|register"; then
    AUTH="jwt"
    info "Detected: JWT authentication"
  fi

  if echo "$DESC_LOWER" | grep -qE "arabic|rtl|bilingual|multi.?lang|language"; then
    info "Detected: Multi-language / RTL support needed"
    EXTRA_FEATURES="i18n-rtl"
  fi

  # Tailwind
  USE_TAILWIND="true"

  # Default state management
  STATE_MGMT="zustand-rq"

  # Ask for project name
  echo ""
  read -rp "  📁 Project name (e.g. ghostforge-hr-app): " PROJECT_NAME
  [[ -z "$PROJECT_NAME" ]] && error "Project name is required"

  # Show AI interpretation
  echo ""
  divider
  echo -e "${BOLD}  🧠 AI Interpretation${NC}"
  divider
  echo -e "  Project     : ${BOLD}$PROJECT_NAME${NC}"
  echo -e "  Description : $PROJECT_DESC"
  echo -e "  Platform    : ${BOLD}$PLATFORM${NC}"
  echo -e "  Framework   : ${BOLD}$FRAMEWORK${NC}"
  echo -e "  Auth        : ${BOLD}${AUTH:-none}${NC}"
  echo -e "  Styling     : ${BOLD}Tailwind CSS${NC}"
  echo -e "  State       : ${BOLD}Zustand + React Query${NC}"
  echo -e "  Language    : ${BOLD}TypeScript${NC}"
  echo ""

  if ! prompt_yn "  Does this look right? Continue with setup?"; then
    info "Switching to manual mode..."
    MODE_CHOICE="2"
  else
    # Ask remaining questions
    GIT_CHOICE=$(prompt_choice "11️⃣  Version control & repo hosting?" \
      "🐙 GitHub — init + push to GitHub" \
      "🔷 Azure DevOps — init + push to Azure Repos" \
      "📁 Local git only — no remote" \
      "⬜ Skip git setup")

    CICD_CHOICE=$(prompt_choice "12️⃣  Set up CI/CD pipeline?" \
      "🐙 GitHub Actions" \
      "🔷 Azure Pipelines" \
      "⬜ Skip for now")

    DEPLOY_CHOICE=$(prompt_choice "13️⃣  Deployment target?" \
      "☁️  Azure Static Web Apps" \
      "☁️  Azure App Service" \
      "📱 App Store + Play Store (React Native)" \
      "⬜ Skip deployment setup")
  fi
fi

# ── Manual Mode (or fallback from AI mode) ──────────────────
if [[ "$MODE_CHOICE" == "2" ]]; then
  echo ""
  divider
  echo -e "${BOLD}  🔧 Manual Setup — Step by Step${NC}"
  divider

  # Step 1: Name
  echo ""
  ask "1️⃣   Project name:"
  read -rp "  → " PROJECT_NAME
  [[ -z "$PROJECT_NAME" ]] && error "Project name is required"

  # Step 2: Frontend or Backend?
  echo ""
  PROJECT_TYPE=$(prompt_choice "2️⃣   Project type?" \
    "🖥️  Frontend" \
    "🖥️  Backend" \
    "🌐 Full Stack (Frontend + Backend)")

  # Step 3: Framework
  echo ""
  if echo "$PROJECT_TYPE" | grep -q "Frontend\|Full Stack"; then
    FRAMEWORK_CHOICE=$(prompt_choice "3️⃣   Frontend framework?" \
      "📱 React Native (Expo) — Mobile app" \
      "⚡ Next.js — Web SSR/SSG (Recommended for web)" \
      "⚛️  React + Vite — Web SPA")

    case "$FRAMEWORK_CHOICE" in
      *"React Native"*) PLATFORM="mobile"; FRAMEWORK="react-native" ;;
      *"Next.js"*)      PLATFORM="web";    FRAMEWORK="nextjs" ;;
      *"React + Vite"*) PLATFORM="web";    FRAMEWORK="react-vite" ;;
    esac
  fi

  if echo "$PROJECT_TYPE" | grep -q "Backend\|Full Stack"; then
    BACKEND_FRAMEWORK=$(prompt_choice "3️⃣  Backend framework?" \
      "🟢 NestJS — TypeScript, enterprise-grade (Recommended)" \
      "🟩 Express.js — Lightweight, flexible" \
      "⚡ Fastify — High performance")
  fi

  # Step 4: Language
  echo ""
  LANG_CHOICE=$(prompt_choice "4️⃣   Language?" \
    "🔷 TypeScript — Strongly typed (Recommended)" \
    "🟡 JavaScript")
  [[ "$LANG_CHOICE" == *"JavaScript"* ]] && USE_TS="false" || USE_TS="true"

  # Step 5: Tailwind
  echo ""
  if [[ "$FRAMEWORK" != "react-native" ]]; then
    if prompt_yn "5️⃣   Use Tailwind CSS for styling?"; then
      USE_TAILWIND="true"
      success "Tailwind CSS enabled"
    else
      USE_TAILWIND="false"
      STYLE_ALT=$(prompt_choice "5️⃣  Alternative styling?" \
        "💅 Styled Components" \
        "📦 CSS Modules" \
        "🎨 Emotion")
    fi
  else
    if prompt_yn "5️⃣   Use NativeWind (Tailwind for React Native)?"; then
      USE_TAILWIND="true"
      success "NativeWind enabled"
    fi
  fi

  # Step 6: UI Library
  echo ""
  if [[ "$FRAMEWORK" == "react-native" ]]; then
    UI_LIB=$(prompt_choice "6️⃣   UI component library?" \
      "📄 React Native Paper — Material Design" \
      "🏔️  Tamagui — Universal (fast, customizable)" \
      "⬜ None — build from scratch")
  else
    UI_LIB=$(prompt_choice "6️⃣   UI component library?" \
      "🪐 shadcn/ui — Accessible, customizable (Recommended)" \
      "🅜  Material UI (MUI) — Google Material Design" \
      "⬜ None — build from scratch")
  fi

  # Step 7: State Management
  echo ""
  STATE_CHOICE=$(prompt_choice "7️⃣   State management?" \
    "🐻 Zustand + React Query — Simple & powerful (Recommended)" \
    "🔴 Redux Toolkit + RTK Query — Enterprise" \
    "🔬 Jotai — Atomic" \
    "🌐 Context API — Minimal built-in")
  STATE_MGMT="$STATE_CHOICE"

  # Step 8: Auth
  echo ""
  AUTH_CHOICE=$(prompt_choice "8️⃣   Authentication?" \
    "🔷 Azure Active Directory (Azure AD)" \
    "🔑 Custom JWT (own backend)" \
    "🌐 Google OAuth" \
    "🔐 NextAuth.js (multiple providers)" \
    "⬜ No authentication needed")

  case "$AUTH_CHOICE" in
    *"Azure"*) AUTH="azure-ad" ;;
    *"JWT"*)   AUTH="jwt" ;;
    *"Google"*)AUTH="nextauth" ;;
    *"NextAuth"*)AUTH="nextauth" ;;
    *) AUTH="none" ;;
  esac

  # Step 9: Backend
  echo ""
  if [[ "$PROJECT_TYPE" != *"Backend"* ]]; then
    BACKEND_CHOICE=$(prompt_choice "9️⃣   Backend / API?" \
      "🔗 Connect to existing API — enter base URL" \
      "🖥️  Scaffold Node.js API alongside frontend" \
      "⬜ No backend needed")

    if [[ "$BACKEND_CHOICE" == *"existing"* ]]; then
      read -rp "  → API base URL: " EXISTING_API_URL
    fi
  fi

  # Step 10: Testing
  echo ""
  TEST_CHOICE=$(prompt_choice "🔟   Testing setup?" \
    "✅ Full — Jest + Testing Library + Playwright/Detox (Recommended)" \
    "🔬 Unit only — Jest + Testing Library" \
    "⬜ Skip — add later")
  TESTING="$TEST_CHOICE"

  # Step 11: Git & Repo
  echo ""
  GIT_CHOICE=$(prompt_choice "1️⃣1️⃣  Version control & hosting?" \
    "🐙 GitHub — init + push to GitHub" \
    "🔷 Azure DevOps — init + push to Azure Repos" \
    "📁 Local git only — no remote" \
    "⬜ Skip git setup")

  # Step 12: CI/CD
  echo ""
  CICD_CHOICE=$(prompt_choice "1️⃣2️⃣  CI/CD pipeline?" \
    "🐙 GitHub Actions" \
    "🔷 Azure Pipelines" \
    "⬜ Skip for now")

  # Step 13: Deployment
  echo ""
  DEPLOY_CHOICE=$(prompt_choice "1️⃣3️⃣  Deployment target?" \
    "☁️  Azure Static Web Apps" \
    "☁️  Azure App Service" \
    "📱 App Store + Play Store (React Native)" \
    "🌍 Vercel" \
    "⬜ Skip deployment setup")
fi

# ── Confirmation Summary ──────────────────────────────────────
echo ""
divider
echo -e "${BOLD}  ✅ Setup Summary${NC}"
divider
echo -e "  Project     : ${BOLD}$PROJECT_NAME${NC}"
[[ -n "$PROJECT_DESC" ]] && echo -e "  Description : $PROJECT_DESC"
echo -e "  Platform    : ${BOLD}${PLATFORM:-backend}${NC}"
echo -e "  Framework   : ${BOLD}${FRAMEWORK:-nestjs}${NC}"
echo -e "  Language    : ${BOLD}$([ "$USE_TS" == "true" ] && echo "TypeScript" || echo "JavaScript")${NC}"
echo -e "  Tailwind    : ${BOLD}$([ "$USE_TAILWIND" == "true" ] && echo "✅ Yes" || echo "❌ No")${NC}"
echo -e "  Auth        : ${BOLD}${AUTH:-none}${NC}"
echo -e "  Git remote  : ${BOLD}${GIT_CHOICE:-skip}${NC}"
echo -e "  CI/CD       : ${BOLD}${CICD_CHOICE:-skip}${NC}"
echo ""

if ! prompt_yn "  🚀 Ready to generate? Proceed?"; then
  echo "Cancelled."
  exit 0
fi

# ── Scaffold ─────────────────────────────────────────────────
echo ""
info "Scaffolding project: $PROJECT_NAME..."

case "$FRAMEWORK" in

  react-native)
    info "Creating React Native (Expo) project..."
    npx create-expo-app@latest "$PROJECT_NAME" --template blank-typescript
    cd "$PROJECT_NAME"
    npx expo install expo-router react-native-reanimated react-native-gesture-handler \
      react-native-safe-area-context react-native-screens expo-status-bar expo-system-ui

    if [[ "$USE_TAILWIND" == "true" ]]; then
      npm install nativewind tailwindcss
      info "NativeWind (Tailwind) installed"
    fi

    npm install @tanstack/react-query zustand axios react-hook-form zod @hookform/resolvers
    npm install -D typescript @types/react eslint prettier

    if [[ "$AUTH" == "azure-ad" || "$AUTH" == "jwt" ]]; then
      npx expo install expo-secure-store
      info "Secure token storage installed"
    fi

    mkdir -p src/{components/{common,features},hooks,services,store,utils,types,constants}
    mkdir -p "app/(auth)" "app/(tabs)"
    ;;

  nextjs)
    info "Creating Next.js project..."
    TS_FLAG=""
    [[ "$USE_TS" == "true" ]] && TS_FLAG="--typescript" || TS_FLAG="--js"
    TW_FLAG=""
    [[ "$USE_TAILWIND" == "true" ]] && TW_FLAG="--tailwind" || TW_FLAG="--no-tailwind"

    npx create-next-app@latest "$PROJECT_NAME" $TS_FLAG $TW_FLAG \
      --eslint --app --src-dir --import-alias "@/*" --no-git

    cd "$PROJECT_NAME"
    npm install @tanstack/react-query zustand axios react-hook-form zod @hookform/resolvers

    if [[ "$UI_LIB" == *"shadcn"* ]]; then
      npx shadcn@latest init --defaults
      info "shadcn/ui initialized"
    fi

    if [[ "$AUTH" == "nextauth" ]]; then
      npm install next-auth
    fi

    npm install -D husky lint-staged @playwright/test
    npm pkg set scripts.prepare="husky install"
    mkdir -p .husky && echo 'npx lint-staged' > .husky/pre-commit && chmod +x .husky/pre-commit
    ;;

  react-vite)
    info "Creating React + Vite project..."
    TEMPLATE="react-ts"
    [[ "$USE_TS" == "false" ]] && TEMPLATE="react"
    npm create vite@latest "$PROJECT_NAME" -- --template "$TEMPLATE"
    cd "$PROJECT_NAME" && npm install

    if [[ "$USE_TAILWIND" == "true" ]]; then
      npm install -D tailwindcss postcss autoprefixer
      npx tailwindcss init -p
    fi

    npm install react-router-dom @tanstack/react-query zustand axios react-hook-form zod @hookform/resolvers
    ;;

  nestjs)
    info "Creating NestJS project..."
    npx @nestjs/cli new "$PROJECT_NAME" --package-manager npm --skip-git --strict
    cd "$PROJECT_NAME"
    npm install @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt
    npm install class-validator class-transformer
    ;;
esac

# ── Copy GhostForge Agents files ───────────────────────────────────
echo ""
info "Copying GhostForge AI toolkit to project..."

mkdir -p .github/workflows .vscode ghostforge-agents

# Copy copilot instructions
cp "$GHOSTFORGE_DIR/.github/copilot-instructions.md" .github/
success "Copilot instructions copied → .github/copilot-instructions.md"

# Copy workflows
cp "$GHOSTFORGE_DIR/.github/workflows/"*.yml .github/workflows/ 2>/dev/null || true
success "GitHub Actions workflows copied"

# Copy VS Code settings
cp "$GHOSTFORGE_DIR/.vscode/settings.json" .vscode/
cp "$GHOSTFORGE_DIR/.vscode/extensions.json" .vscode/
success "VS Code settings copied (Copilot auto-read enabled)"

# Copy full ghostforge-agents reference folder
cp -r "$GHOSTFORGE_DIR/agents" ghostforge-agents/
cp -r "$GHOSTFORGE_DIR/commands" ghostforge-agents/
cp -r "$GHOSTFORGE_DIR/instructions" ghostforge-agents/
cp -r "$GHOSTFORGE_DIR/prompts" ghostforge-agents/
success "All agents, commands, instructions & prompts copied → ghostforge-agents/"

# ── .env files ──────────────────────────────────────────────
ENV_CONTENT="# API
$([ -n "${EXISTING_API_URL:-}" ] && echo "NEXT_PUBLIC_API_URL=$EXISTING_API_URL" || echo "NEXT_PUBLIC_API_URL=https://api.example.com")

# GitHub Issues integration (for /tickets command)
GITHUB_TOKEN=

# Azure DevOps Boards integration (for /tickets command)
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/ghostforge
AZURE_DEVOPS_PROJECT=your-project
AZURE_DEVOPS_PAT=

# Jira integration (optional)
JIRA_BASE_URL=https://ghostforge.atlassian.net
JIRA_EMAIL=
JIRA_API_TOKEN=
"

case "$AUTH" in
  azure-ad)  ENV_CONTENT+=$'\n# Azure AD\nAZURE_AD_CLIENT_ID=\nAZURE_AD_CLIENT_SECRET=\nAZURE_AD_TENANT_ID=\n' ;;
  nextauth)  ENV_CONTENT+=$'\n# NextAuth\nNEXTAUTH_SECRET=\nNEXTAUTH_URL=http://localhost:3000\n' ;;
  jwt)       ENV_CONTENT+=$'\n# JWT\nJWT_SECRET=\nJWT_EXPIRES_IN=15m\nJWT_REFRESH_EXPIRES_IN=7d\n' ;;
esac

echo "$ENV_CONTENT" > .env.example
cp .env.example .env.local
success ".env.example created"

# ── Git setup ────────────────────────────────────────────────
if [[ "${GIT_CHOICE:-}" != *"Skip"* ]]; then
  echo ""
  info "Initializing git..."
  git init
  git add .
  git commit -m "chore: initial project setup by GhostForge AI Toolkit"

  if [[ "${GIT_CHOICE:-}" == *"GitHub"* ]]; then
    echo ""
    read -rp "  GitHub org or username: " GH_OWNER
    VISIBILITY_CHOICE=$(prompt_choice "Repository visibility?" "🔒 Private (Recommended)" "🌐 Public")
    [[ "$VISIBILITY_CHOICE" == *"Private"* ]] && VISIBILITY="--private" || VISIBILITY="--public"

    if command -v gh &>/dev/null; then
      gh repo create "$GH_OWNER/$PROJECT_NAME" $VISIBILITY --source=. --remote=origin --push
      success "GitHub repo created: github.com/$GH_OWNER/$PROJECT_NAME"
    else
      warn "GitHub CLI (gh) not found. Install from https://cli.github.com then run:"
      echo "  gh repo create $GH_OWNER/$PROJECT_NAME $VISIBILITY --source=. --remote=origin --push"
    fi

  elif [[ "${GIT_CHOICE:-}" == *"Azure"* ]]; then
    read -rp "  Azure DevOps org name: " AZ_ORG
    read -rp "  Azure DevOps project name: " AZ_PROJECT
    REPO_URL="https://$AZ_ORG@dev.azure.com/$AZ_ORG/$AZ_PROJECT/_git/$PROJECT_NAME"
    git remote add origin "$REPO_URL"

    if command -v az &>/dev/null; then
      az repos create --name "$PROJECT_NAME" --org "https://dev.azure.com/$AZ_ORG" --project "$AZ_PROJECT" 2>/dev/null || true
      git push -u origin main 2>/dev/null || git push -u origin master 2>/dev/null || true
      success "Azure DevOps repo configured"
    else
      warn "Azure CLI not found. Install from https://aka.ms/installazureclimacos"
      echo "  Remote set to: $REPO_URL"
      echo "  Push manually: git push -u origin main"
    fi
  fi
fi

# ── Final ────────────────────────────────────────────────────
echo ""
divider
echo -e "${GREEN}${BOLD}  🎉 Project '$PROJECT_NAME' is ready!${NC}"
divider
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "  ${CYAN}  cd $PROJECT_NAME${NC}"
echo -e "  ${CYAN}  code .${NC}                   # Open in VS Code — Copilot auto-activates"
echo -e "  ${CYAN}  nano .env.local${NC}           # Fill in your environment variables"
echo -e "  ${CYAN}  npm install && npm run dev${NC}"
echo ""
echo -e "  ${BOLD}GitHub Copilot commands ready:${NC}"
echo -e "  ${YELLOW}  /add-feature${NC}  Add a new feature"
echo -e "  ${YELLOW}  /optimize${NC}     Optimize performance"
echo -e "  ${YELLOW}  /security${NC}     Run security audit"
echo -e "  ${YELLOW}  /tickets${NC}      View your assigned bug tickets"
echo -e "  ${YELLOW}  /test${NC}         Run automated test suite"
echo -e "  ${YELLOW}  /deploy${NC}       Deploy to ${DEPLOY_CHOICE:-Azure}"
echo -e "  ${YELLOW}  /autopilot on${NC} Let AI work autonomously"
echo ""
divider
