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
    "paths": { "@/*": ["./src/*"] }
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
```

## Rules
- Never use `any` — use `unknown` if type is truly unknown
- Always type function return values explicitly
- Use union types for string literals
- Use `satisfies` operator for config objects
- Prefer `interface` for object shapes, `type` for unions/intersections
