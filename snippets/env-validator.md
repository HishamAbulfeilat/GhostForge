# env-validator

## Purpose
Validate environment variables with Zod.

## Code
```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  API_URL: z.string().url(),
  AZURE_CLIENT_ID: z.string().min(1),
});

export const env = envSchema.parse(process.env);
```
