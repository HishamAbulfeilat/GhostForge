# TypeScript Instructions

## tsconfig.json (Strict)
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@components/*": ["./src/components/*"],
      "@hooks/*": ["./src/hooks/*"],
      "@utils/*": ["./src/utils/*"],
      "@types/*": ["./src/types/*"],
      "@store/*": ["./src/store/*"],
      "@services/*": ["./src/services/*"],
      "@constants/*": ["./src/constants/*"],
      "@providers/*": ["./src/providers/*"]
    }
  }
}
```

## Common Patterns
```typescript
// API Response type
interface ApiResponse<T> {
  data: T;
  message: string;
  success: boolean;
}

// Component Props
interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

// Zod schema + TypeScript type
import { z } from 'zod';
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
type LoginFormData = z.infer<typeof loginSchema>;

// Generic custom hook
function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : initialValue;
  });
  // ...
}

// Azure MSAL typing pattern
import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';

interface AuthState {
  account: AccountInfo | null;
  instance: PublicClientApplication;
}
```

## Barrel Exports
```typescript
// src/components/user-card/index.ts
export * from './user-card';
export * from './user-card.types';
```

- Every component folder should expose an `index.ts` file for clean imports and consistent barrel exports.

## Rules
- Never use `any` — use `unknown` if type is truly unknown
- Always type function return values explicitly
- Use union types for string literals
- Use `satisfies` operator for config objects
- Prefer `interface` for object shapes, `type` for unions/intersections
