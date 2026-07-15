# Docker Instructions

Docker configuration standards for GhostForge projects.

---

## Next.js Dockerfile (Production)
```dockerfile
# Dockerfile
FROM node:20-alpine AS base

# Dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs &&     adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

## Node.js / NestJS Dockerfile
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3001
CMD ["node", "dist/main.js"]
```

## .dockerignore
```
node_modules
.next
.git
*.log
.env*
!.env.example
dist
coverage
.DS_Store
```

## Docker Compose (Local Dev)
```yaml
# docker-compose.yml
services:
  web:
    build: ./apps/web
    ports: ["3000:3000"]
    environment:
      - NEXT_PUBLIC_API_URL=http://api:3001
    depends_on: [api]
    volumes:
      - ./apps/web:/app
      - /app/node_modules
      - /app/.next

  api:
    build: ./apps/api
    ports: ["3001:3001"]
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/ghostforge
      - REDIS_URL=redis://redis:6379
    depends_on: [db, redis]

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ghostforge
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports: ["5432:5432"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  pgdata:
```

## Azure Container Registry (ACR) Push
```bash
# Login
az acr login --name myregistry

# Build and tag
docker build -t myregistry.azurecr.io/web:latest ./apps/web
docker build -t myregistry.azurecr.io/api:1.3.0 ./apps/api

# Push
docker push myregistry.azurecr.io/web:latest
docker push myregistry.azurecr.io/api:1.3.0
```

## GitHub Actions — Build and Push to ACR
```yaml
- name: Login to ACR
  uses: azure/docker-login@v1
  with:
    login-server: myregistry.azurecr.io
    username: ${{ secrets.ACR_USERNAME }}
    password: ${{ secrets.ACR_PASSWORD }}

- name: Build and push
  run: |
    docker build -t myregistry.azurecr.io/web:${{ github.sha }} .
    docker push myregistry.azurecr.io/web:${{ github.sha }}
```

## Best Practices
1. Always use multi-stage builds (smaller final image)
2. Run as non-root user (`adduser appuser`)
3. Use `.dockerignore` to exclude node_modules, .git, .env
4. Pin base image versions (`node:20-alpine` not `node:latest`)
5. Use `npm ci` not `npm install` in Docker
6. Set `NODE_ENV=production` in final stage
7. Expose only necessary ports
8. Use health checks in production
