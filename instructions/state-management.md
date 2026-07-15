# State Management Guide

When to use which solution and deep patterns for each.

---

## Decision Guide

| Scenario | Recommended |
|----------|------------|
| Server data (API responses) | **React Query** (TanStack Query) |
| Simple global UI state | **Zustand** |
| Complex client state with many actions | **Redux Toolkit** |
| Form state | **React Hook Form** |
| Single component state | **useState** / **useReducer** |
| Shared state between a few components | **Context API** |
| Atomic/derived state | **Jotai** |

> **Rule**: Don't put server data in Redux/Zustand. Use React Query for anything that comes from an API.

---

## React Query (Server State)

### Setup
```typescript
// app/providers.tsx
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,    // 1 minute
        retry: (count, error) => {
          if ((error as any)?.response?.status >= 400 && (error as any)?.response?.status < 500) return false;
          return count < 2;
        },
      },
    },
  }));
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools />
    </QueryClientProvider>
  );
}
```

### Query + Mutation Pattern
```typescript
// hooks/useProducts.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productService } from '@/services/productService';

export const productKeys = {
  all: ['products'] as const,
  list: (filters: object) => [...productKeys.all, 'list', filters] as const,
  detail: (id: string) => [...productKeys.all, 'detail', id] as const,
};

export function useProducts(filters = {}) {
  return useQuery({
    queryKey: productKeys.list(filters),
    queryFn: () => productService.getAll(filters),
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: productKeys.detail(id),
    queryFn: () => productService.getById(id),
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: productService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: productService.delete,
    onMutate: async (id) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: productKeys.all });
      const previous = queryClient.getQueryData(productKeys.all);
      queryClient.setQueryData(productKeys.all, (old: any[]) =>
        old?.filter((p) => p.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      queryClient.setQueryData(productKeys.all, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: productKeys.all }),
  });
}
```

---

## Zustand (Client State)

### Pattern: One store per feature domain
```typescript
// store/uiStore.ts  ← global UI state
import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'system';
  setSidebarOpen: (open: boolean) => void;
  setTheme: (theme: UIState['theme']) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme: 'system',
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setTheme: (theme) => set({ theme }),
}));

// Prefer selectors to avoid unnecessary re-renders
const sidebarOpen = useUIStore((s) => s.sidebarOpen);  // ✅ only re-renders when sidebarOpen changes
const { sidebarOpen } = useUIStore();  // ❌ re-renders on any store change
```

### With Persistence
```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';  // mobile
// import { localStorage } from 'zustand/middleware';  // web

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({ language: 'en', notifications: true, setLanguage: (lang) => set({ language: lang }) }),
    { name: 'ghostforge-settings', storage: createJSONStorage(() => AsyncStorage) }
  )
);
```

---

## Redux Toolkit (Complex Enterprise State)

### Store Setup
```typescript
// store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from './api';
import authReducer from './slices/authSlice';
import cartReducer from './slices/cartSlice';

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    auth: authReducer,
    cart: cartReducer,
  },
  middleware: (getDefault) => getDefault().concat(api.middleware),
});

setupListeners(store.dispatch);
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

### RTK Query (API layer)
```typescript
// store/api.ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { RootState } from '.';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: process.env.NEXT_PUBLIC_API_URL,
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).auth.accessToken;
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return headers;
    },
  }),
  tagTypes: ['Product', 'Order', 'User'],
  endpoints: (builder) => ({
    getProducts: builder.query<Product[], void>({
      query: () => '/products',
      providesTags: ['Product'],
    }),
    createProduct: builder.mutation<Product, Partial<Product>>({
      query: (body) => ({ url: '/products', method: 'POST', body }),
      invalidatesTags: ['Product'],
    }),
  }),
});

export const { useGetProductsQuery, useCreateProductMutation } = api;
```

---

## React Native Specifics

### MMKV for fast persistence (Zustand)
```typescript
import { MMKV } from 'react-native-mmkv';
import { StateStorage } from 'zustand/middleware';

const storage = new MMKV();

const mmkvStorage: StateStorage = {
  getItem: (name) => storage.getString(name) ?? null,
  setItem: (name, value) => storage.set(name, value),
  removeItem: (name) => storage.delete(name),
};

export const useSettingsStore = create<SettingsState>()(
  persist((set) => ({ ... }), { name: 'settings', storage: createJSONStorage(() => mmkvStorage) })
);
```
