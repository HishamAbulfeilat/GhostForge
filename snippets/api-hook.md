# api-hook

## Purpose
Reusable React Query `useApi` hook pattern with typed requests.

## Code
```ts
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

export function useApi<T>(
  key: readonly unknown[],
  request: () => Promise<T>,
  options?: UseQueryOptions<T>
) {
  return useQuery<T>({
    queryKey: key,
    queryFn: request,
    staleTime: 30_000,
    retry: 1,
    ...options,
  });
}
```
