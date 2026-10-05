# GhostForge web UI — hosted ("friends") mode. See docs/HOSTING.md.
#
#   docker build -t ghostforge-hosted .
#   docker run -d --name ghostforge -p 127.0.0.1:3001:3001 \
#     -e AUTH_SECRET=$(openssl rand -hex 32) -e ADMIN_PASSWORD='choose-a-long-one' \
#     -v ghostforge-data:/data ghostforge-hosted
#
# The image contains no keys or personal data: secrets come from the
# environment at run time, and user data lives in the /data volume.

FROM node:22-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# The web UI reads a few repo files at run time (marketplace catalog, docs
# for the snippets page), so the build context is the repository root.
COPY . .
WORKDIR /app/web-ui
RUN npm ci --no-audit --no-fund \
 && npm run build \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    GHOSTFORGE_MODE=hosted \
    GHOSTFORGE_DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/web-ui
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
