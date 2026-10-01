#!/bin/bash

# ============================================================
# GhostForge Azure Deployment Script
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

ENVIRONMENT="${ENVIRONMENT:-staging}"
DEPLOY_TYPE="${DEPLOY_TYPE:-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env|-e)
      ENVIRONMENT="${2:-staging}"
      shift 2
      ;;
    --type|-t)
      DEPLOY_TYPE="${2:-1}"
      shift 2
      ;;
    staging|production|dev)
      ENVIRONMENT="$1"
      shift
      ;;
    1|2|3|static|app-service|appservice|eas|eas-build|azure-static|nextjs|node)
      DEPLOY_TYPE="$1"
      shift
      ;;
    *)
      echo -e "${RED}Unsupported argument: $1${NC}" >&2
      exit 2
      ;;
  esac
done

case "$DEPLOY_TYPE" in
  static|azure-static|nextjs|1)
    DEPLOY_TYPE="1"
    ;;
  app-service|appservice|node|2)
    DEPLOY_TYPE="2"
    ;;
  eas|eas-build|expo|3)
    DEPLOY_TYPE="3"
    ;;
  *)
    echo -e "${RED}Unsupported deployment type: ${DEPLOY_TYPE}${NC}" >&2
    exit 2
    ;;
 esac

if [[ "${GF_NON_INTERACTIVE:-0}" != "1" && ! -t 0 ]]; then
  echo -e "${YELLOW}Non-interactive mode detected; using ${ENVIRONMENT} (${DEPLOY_TYPE}).${NC}"
fi

if [[ "${GF_NON_INTERACTIVE:-0}" != "1" && -t 0 ]]; then
  echo -e "${BLUE}🚀 GhostForge Azure Deployment${NC}"
  echo "--------------------------------"
  echo "Select environment:"
  echo "  1) Staging"
  echo "  2) Production"
  read -p "Choose [1-2]: " ENV_CHOICE
  ENVIRONMENT=$( [ "$ENV_CHOICE" == "2" ] && echo "production" || echo "staging" )
  echo ""
  echo "Deployment type:"
  echo "  1) Azure Static Web Apps (Next.js/React)"
  echo "  2) Azure App Service (Node.js API)"
  echo "  3) EAS Build (React Native)"
  read -p "Choose [1-3]: " DEPLOY_TYPE
  case "$DEPLOY_TYPE" in
    1|static|azure-static|nextjs) DEPLOY_TYPE="1" ;;
    2|app-service|appservice|node) DEPLOY_TYPE="2" ;;
    3|eas|eas-build|expo) DEPLOY_TYPE="3" ;;
    *) echo -e "${RED}Unsupported deployment type: ${DEPLOY_TYPE}${NC}" >&2; exit 2 ;;
  esac
fi

echo -e "${YELLOW}Deploying to: ${ENVIRONMENT}${NC}"
case $DEPLOY_TYPE in
  1)
    echo -e "${BLUE}Building Next.js app...${NC}"
    npm ci
    npm test -- --passWithNoTests
    npm run build
    echo -e "${YELLOW}Upload .next/ folder to Azure Static Web Apps${NC}"
    echo -e "${GREEN}✅ Build complete. Push to GitHub to trigger Azure deployment.${NC}"
    ;;
  2)
    echo -e "${BLUE}Building Node.js API...${NC}"
    npm ci
    npm run build
    echo "Creating deployment package..."
    zip -r deploy.zip . -x "node_modules/*" ".git/*"
    echo -e "${GREEN}✅ deploy.zip created. Upload to Azure App Service.${NC}"
    ;;
  3)
    echo -e "${BLUE}Starting EAS Build...${NC}"
    npx eas build --platform all --profile "$ENVIRONMENT"
    echo -e "${GREEN}✅ EAS Build started. Check progress at https://expo.dev${NC}"
    ;;
esac
