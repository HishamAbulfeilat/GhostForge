# Error Handling Standards

Consistent error handling across frontend, mobile, and backend.

---

## Frontend Error Handling

### Global Error Boundary (Next.js)
```typescript
// app/error.tsx (Next.js App Router)
'use client';
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground">{error.message}</p>
      <button onClick={reset} className="rounded-md bg-primary px-4 py-2 text-white">
        Try again
      </button>
    </div>
  );
}
```

### API Error Handling (React Query)
```typescript
// hooks/useProducts.ts
export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: productService.getAll,
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors
      if (axios.isAxiosError(error) && (error.response?.status ?? 0) < 500) return false;
      return failureCount < 3;
    },
    throwOnError: false, // handle in component
  });
}

// Component
function ProductList() {
  const { data, error, isLoading, refetch } = useProducts();

  if (isLoading) return <ProductsSkeleton />;
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!data?.length) return <EmptyState message="No products found" />;
  return <ProductGrid products={data} />;
}
```

### Error Message Utility
```typescript
// utils/error.ts
import axios from 'axios';

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error?.message
      ?? error.response?.data?.message
      ?? error.message
      ?? 'Network error. Please check your connection.';
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}
```

---

## Mobile Error Handling (React Native)

### Global Crash Handler
```typescript
// app/_layout.tsx (Expo Router)
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: process.env.EXPO_PUBLIC_APP_ENV,
});

// Wrap root with Sentry
export default Sentry.wrap(function RootLayout() {
  return <Stack />;
});
```

### Network Error Toast
```typescript
// hooks/useApiError.ts
import Toast from 'react-native-toast-message';
import { getErrorMessage } from '@/utils/error';

export function useApiError() {
  const showError = (error: unknown) => {
    Toast.show({
      type: 'error',
      text1: 'Something went wrong',
      text2: getErrorMessage(error),
      position: 'top',
    });
  };

  return { showError };
}
```

---

## Backend Error Handling (NestJS)

### Global Exception Filter
```typescript
// filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : 'Internal server error';

    // Log 5xx errors
    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url}`, exception instanceof Error ? exception.stack : String(exception));
      // Sentry.captureException(exception);
    }

    response.status(status).json({
      success: false,
      error: {
        code: this.getErrorCode(status),
        message: typeof message === 'string' ? message : (message as any).message,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    });
  }

  private getErrorCode(status: number): string {
    const codes: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      429: 'RATE_LIMITED',
      500: 'INTERNAL_ERROR',
    };
    return codes[status] ?? 'UNKNOWN_ERROR';
  }
}
```

---

## Sentry Setup

### Next.js
```bash
npx @sentry/wizard@latest -i nextjs
```

### React Native (Expo)
```bash
npx @sentry/wizard@latest -i reactNative
```

### Environment Variables
```bash
SENTRY_DSN=https://xxx@sentry.io/xxx
SENTRY_ORG=ghostforge
SENTRY_PROJECT=ghostforge-app
SENTRY_AUTH_TOKEN=xxx  # for source maps upload
```
