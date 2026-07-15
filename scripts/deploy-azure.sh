#!/bin/bash

# ============================================================
# GhostForge Azure Deployment Script
# ============================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}🚀 GhostForge Azure Deployment${NC}"
echo "--------------------------------"

# Environment selection
echo "Select environment:"
echo "  1) Staging"
echo "  2) Production"
read -p "Choose [1-2]: " ENV_CHOICE

ENVIRONMENT=$( [ "$ENV_CHOICE" == "2" ] && echo "production" || echo "staging" )
echo -e "${YELLOW}Deploying to: ${ENVIRONMENT}${NC}"

# Deployment type
echo ""
echo "Deployment type:"
echo "  1) Azure Static Web Apps (Next.js/React)"
echo "  2) Azure App Service (Node.js API)"
echo "  3) EAS Build (React Native)"
read -p "Choose [1-3]: " DEPLOY_TYPE

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
