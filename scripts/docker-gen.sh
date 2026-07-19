#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🐳  GhostForge Docker Generator${NC}"
  echo -e "${DIM}  Generate production and development Docker assets for modern JS apps.${NC}"
  echo ""
}

detect_type() {
  local explicit="${1:-}"
  if [[ -n "$explicit" ]]; then
    printf '%s\n' "$explicit"
    return 0
  fi
  if [[ -f package.json ]]; then
    node - <<'NODE'
const fs = require('fs');
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const scripts = Object.values(pkg.scripts || {}).join(' ').toLowerCase();
  if (scripts.includes('next')) console.log('nextjs');
  else if (scripts.includes('vite')) console.log('react-vite');
  else console.log('node');
} catch {
  console.log('nextjs');
}
NODE
  else
    echo "nextjs"
  fi
}

write_dockerignore() {
  cat > .dockerignore <<'EOF2'
node_modules
npm-debug.log
.next/cache
dist
build
coverage
.git
.gitignore
.DS_Store
.env*
EOF2
}

generate_cmd() {
  local type
  type="$(detect_type "${1:-}")"
  header
  case "$type" in
    nextjs)
      cat > Dockerfile <<'EOF2'
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
EOF2
      ;;
    node)
      cat > Dockerfile <<'EOF2'
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start"]
EOF2
      ;;
    react-vite)
      cat > Dockerfile <<'EOF2'
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
EOF2
      ;;
    *)
      echo -e "${RED}✖ Unsupported type: $type${NC}"
      exit 1
      ;;
  esac
  write_dockerignore
  echo -e "${GREEN}✅ Generated Dockerfile for ${BOLD}$type${NC}"
}

compose_cmd() {
  header
  cat > docker-compose.yml <<'EOF2'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    profiles: ["postgres"]
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    profiles: ["redis"]
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  postgres-data:
  redis-data:
EOF2
  echo -e "${GREEN}✅ Generated docker-compose.yml${NC}"
  echo -e "${DIM}Use --profile postgres and/or --profile redis to enable optional services.${NC}"
}

dev_cmd() {
  header
  cat > docker-compose.dev.yml <<'EOF2'
services:
  app:
    image: node:20-alpine
    working_dir: /app
    command: sh -c "npm install && npm run dev"
    ports:
      - "3000:3000"
      - "5173:5173"
    environment:
      NODE_ENV: development
      CHOKIDAR_USEPOLLING: "true"
    volumes:
      - .:/app
      - /app/node_modules
EOF2
  echo -e "${GREEN}✅ Generated docker-compose.dev.yml${NC}"
}

clean_cmd() {
  header
  rm -f Dockerfile docker-compose.yml docker-compose.dev.yml .dockerignore
  echo -e "${GREEN}✅ Removed generated Docker assets.${NC}"
}

help_cmd() {
  header
  cat <<EOF2
Usage:
  bash scripts/docker-gen.sh generate [nextjs|node|react-vite]
  bash scripts/docker-gen.sh compose
  bash scripts/docker-gen.sh dev
  bash scripts/docker-gen.sh clean
  bash scripts/docker-gen.sh help
EOF2
}

case "$ACTION" in
  generate) generate_cmd "${1:-}" ;;
  compose) compose_cmd ;;
  dev) dev_cmd ;;
  clean) clean_cmd ;;
  help|--help|-h) help_cmd ;;
  *) help_cmd; exit 1 ;;
esac
