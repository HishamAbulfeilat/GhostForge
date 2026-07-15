# Monorepo Instructions

Standards for Turborepo and Nx monorepos used in GhostForge projects.

---

## When to Use a Monorepo
- Web app + Mobile app sharing types, API client, or UI components
- Multiple services that deploy together
- Shared component library used across projects

---

## Turborepo Setup

```bash
npx create-turbo@latest ghostforge-monorepo
cd ghostforge-monorepo
```

### Structure
```text
ghostforge-monorepo/
├── apps/
│   ├── web/          # Next.js 14
│   └── mobile/       # React Native (Expo)
├── packages/
│   ├── ui/           # Shared React + React Native components
│   ├── types/        # Shared TypeScript types
│   ├── api-client/   # Shared Axios service layer
│   └── config/       # Shared ESLint, TypeScript, Tailwind configs
├── turbo.json
└── package.json
```

### turbo.json
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**", "build/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "lint": { "dependsOn": ["^lint"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "type-check": { "dependsOn": ["^build"] }
  }
}
```

### Root package.json
```json
{
  "name": "ghostforge-monorepo",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "type-check": "turbo type-check",
    "dev:web": "turbo dev --filter=web",
    "dev:mobile": "turbo dev --filter=mobile",
    "build:web": "turbo build --filter=web"
  },
  "devDependencies": {
    "turbo": "latest",
    "typescript": "^5.4.0"
  }
}
```

### Shared UI Package
```typescript
// packages/ui/package.json
{
  "name": "@ghostforge/ui",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "peerDependencies": {
    "react": ">=18",
    "react-native": ">=0.73"
  }
}

// packages/ui/src/index.ts
export { Button } from './components/Button';
export { Input } from './components/Input';
export { Card } from './components/Card';
export type { ButtonProps, InputProps, CardProps } from './types';
```

### Shared Types Package
```typescript
// packages/types/src/index.ts
export interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'user' | 'viewer';
  avatarUrl?: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  category: string;
  stock: number;
  isActive: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: { total: number; page: number; limit: number; totalPages: number };
}
```

### Shared API Client
```typescript
// packages/api-client/src/index.ts
import axios from 'axios';

export function createApiClient(baseURL: string, getToken: () => string | null) {
  const client = axios.create({ baseURL, timeout: 10_000 });

  client.interceptors.request.use((config) => {
    const token = getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  return client;
}

export { productService } from './services/productService';
export { authService } from './services/authService';
```

### Shared Config Package
```javascript
// packages/config/eslint-base.js
module.exports = {
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};

// packages/config/tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

## Common Commands
```bash
# Run all apps in dev mode
turbo dev

# Run only web
turbo dev --filter=web

# Build everything
turbo build

# Run tests for changed packages only
turbo test --filter=[HEAD^1]

# Add package to specific app
cd apps/web && npm install some-package

# Add shared package dependency
cd apps/web && npm install @ghostforge/ui
```

## CI Pipeline for Monorepo
```yaml
# .github/workflows/ci.yml
- name: Build affected packages
  run: turbo build --filter=[HEAD^1]

- name: Test affected packages  
  run: turbo test --filter=[HEAD^1]
```
