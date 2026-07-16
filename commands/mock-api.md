# /mock-api Command

## Purpose
Generate MSW (Mock Service Worker) request handlers from an OpenAPI spec file.

## Usage
```bash
/mock-api openapi.yaml          # Generate handlers from spec
/mock-api openapi.json --out src/mocks/handlers.ts
/mock-api --list                # List existing mock handlers
```

## What It Generates
- `src/mocks/handlers.ts` — MSW handler functions
- `src/mocks/browser.ts` — browser setup worker
- `src/mocks/server.ts` — Node.js test server setup
- `src/mocks/db.ts` — in-memory data store

## Requirements
```bash
npm install msw --save-dev
npx msw init public/
```

## Output
Ready-to-use MSW handlers for all endpoints in your OpenAPI spec.
