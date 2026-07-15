# /scaffold Command

## Description
Generate a single code piece instantly — component, hook, service, screen, API route, store slice, or type — without scaffolding a full project. The most frequently used daily command.

## Usage
```
/scaffold component [name] [description]
/scaffold hook [name] [description]
/scaffold service [name] [description]
/scaffold screen [name] [description]     ← React Native
/scaffold page [name] [description]       ← Next.js
/scaffold api [name] [description]        ← Next.js API route
/scaffold store [name] [description]      ← Zustand store or Redux slice
/scaffold type [name] [description]       ← TypeScript types/interfaces
/scaffold form [name] [description]       ← React Hook Form + Zod
/scaffold modal [name] [description]      ← Modal component
/scaffold context [name] [description]    ← React Context + Provider
```

## Examples
```
/scaffold component ProductCard with image, title, price, add-to-cart button
/scaffold hook useInfiniteScroll for FlatList with React Query
/scaffold service PaymentService with processPayment, getHistory, refund methods
/scaffold screen ProfileScreen with avatar, edit form, logout button
/scaffold page /dashboard/analytics with charts and date filter
/scaffold api /api/products with GET list and POST create
/scaffold store cartStore with items, add, remove, clear, total computed
/scaffold form LoginForm with email, password, remember me, validation
/scaffold type User with id, name, email, role, avatar, createdAt
```

## Behavior

1. **Read existing code** — detects project conventions before generating
2. **Match the stack** — uses the project's styling solution, state manager, etc.
3. **TypeScript first** — always generates typed code
4. **Include tests** — optionally generates test file alongside

## Generated Output Examples

### Component
```typescript
// components/features/ProductCard/ProductCard.tsx
import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Product } from '@/types/product.types';

interface ProductCardProps {
  product: Product;
  onAddToCart: (product: Product) => void;
  className?: string;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onAddToCart,
  className,
}) => {
  return (
    <div className={cn('rounded-lg border bg-card p-4 shadow-sm', className)}>
      <img
        src={product.imageUrl}
        alt={product.name}
        className="mb-3 h-48 w-full rounded-md object-cover"
        loading="lazy"
      />
      <h3 className="text-lg font-semibold text-foreground">{product.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
        {product.description}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xl font-bold text-primary">
          ${product.price.toFixed(2)}
        </span>
        <Button
          size="sm"
          onClick={() => onAddToCart(product)}
          aria-label={`Add ${product.name} to cart`}
        >
          Add to Cart
        </Button>
      </div>
    </div>
  );
};

export default ProductCard;
```

### Custom Hook
```typescript
// hooks/useInfiniteScroll.ts
import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteQueryOptions } from '@/types/query.types';

interface UseInfiniteScrollOptions<T> {
  queryKey: string[];
  fetchFn: (page: number) => Promise<{ data: T[]; hasMore: boolean; nextPage: number }>;
  enabled?: boolean;
}

export function useInfiniteScroll<T>({
  queryKey,
  fetchFn,
  enabled = true,
}: UseInfiniteScrollOptions<T>) {
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 1 }) => fetchFn(pageParam as number),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextPage : undefined,
    initialPageParam: 1,
    enabled,
  });
}
```

### Zustand Store
```typescript
// store/cartStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '@/types/product.types';

interface CartItem extends Product {
  quantity: number;
}

interface CartState {
  items: CartItem[];
  add: (product: Product) => void;
  remove: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
  total: () => number;
  itemCount: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      add: (product) =>
        set((state) => {
          const existing = state.items.find((i) => i.id === product.id);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
              ),
            };
          }
          return { items: [...state.items, { ...product, quantity: 1 }] };
        }),

      remove: (productId) =>
        set((state) => ({
          items: state.items.filter((i) => i.id !== productId),
        })),

      updateQuantity: (productId, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.id !== productId)
              : state.items.map((i) =>
                  i.id === productId ? { ...i, quantity } : i
                ),
        })),

      clear: () => set({ items: [] }),
      total: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    { name: 'ghostforge-cart' }
  )
);
```

### React Hook Form + Zod Form
```typescript
// components/forms/LoginForm.tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  rememberMe: z.boolean().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSubmit: (data: LoginFormData) => Promise<void>;
  isLoading?: boolean;
}

export function LoginForm({ onSubmit, isLoading }: LoginFormProps) {
  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register('email')}
          aria-describedby={errors.email ? 'email-error' : undefined} />
        {errors.email && (
          <p id="email-error" role="alert" className="mt-1 text-sm text-destructive">
            {errors.email.message}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" {...register('password')}
          aria-describedby={errors.password ? 'password-error' : undefined} />
        {errors.password && (
          <p id="password-error" role="alert" className="mt-1 text-sm text-destructive">
            {errors.password.message}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Signing in...' : 'Sign In'}
      </Button>
    </form>
  );
}
```

## Options
```
/scaffold component ProductCard --with-tests    → also generates ProductCard.test.tsx
/scaffold component ProductCard --with-story    → also generates ProductCard.stories.tsx
/scaffold hook useCart --with-tests
/scaffold service UserService --with-mock       → generates mock implementation too
```

## See Also
- `commands/create.md` — Full project scaffold
- `commands/add-feature.md` — Add complete feature
