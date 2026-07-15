# React Patterns

Advanced React patterns used in GhostForge projects.

---

## Compound Components
```typescript
// Flexible, composable API — used for complex UI components
interface CardProps { children: React.ReactNode; className?: string; }
const CardContext = React.createContext<{ variant: string }>({ variant: 'default' });

const Card = ({ children, className }: CardProps) => (
  <CardContext.Provider value={{ variant: 'default' }}>
    <div className={cn('rounded-lg border bg-card', className)}>{children}</div>
  </CardContext.Provider>
);
Card.Header = ({ children }: { children: React.ReactNode }) => (
  <div className="border-b p-4 font-semibold">{children}</div>
);
Card.Body = ({ children }: { children: React.ReactNode }) => (
  <div className="p-4">{children}</div>
);
Card.Footer = ({ children }: { children: React.ReactNode }) => (
  <div className="border-t p-4">{children}</div>
);

// Usage:
<Card>
  <Card.Header>Title</Card.Header>
  <Card.Body>Content</Card.Body>
  <Card.Footer><Button>Action</Button></Card.Footer>
</Card>
```

## Render Props
```typescript
// Share stateful logic with flexible rendering
interface DataFetcherProps<T> {
  url: string;
  render: (data: T | null, loading: boolean, error: Error | null) => React.ReactNode;
}

function DataFetcher<T>({ url, render }: DataFetcherProps<T>) {
  const { data, isLoading, error } = useQuery({ queryKey: [url], queryFn: () => fetch(url).then(r => r.json()) });
  return <>{render(data ?? null, isLoading, error as Error | null)}</>;
}

// Usage:
<DataFetcher<Product[]>
  url="/api/products"
  render={(products, loading, error) => {
    if (loading) return <Spinner />;
    if (error) return <ErrorMessage error={error} />;
    return <ProductList products={products!} />;
  }}
/>
```

## Custom Hook Pattern (Data + UI separation)
```typescript
// All logic in the hook — component is pure presentation
function useProductList(categoryId: string) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['products', categoryId],
    queryFn: () => productService.getByCategory(categoryId),
  });

  const { mutate: deleteProduct, isPending: isDeleting } = useMutation({
    mutationFn: productService.delete,
    onSuccess: () => refetch(),
  });

  return {
    products: data ?? [],
    isLoading,
    error,
    deleteProduct,
    isDeleting,
  };
}

// Component: just renders
function ProductListScreen({ categoryId }: { categoryId: string }) {
  const { products, isLoading, error, deleteProduct } = useProductList(categoryId);
  if (isLoading) return <LoadingScreen />;
  if (error) return <ErrorScreen error={error} />;
  return <ProductList products={products} onDelete={deleteProduct} />;
}
```

## Context + Reducer (for complex state)
```typescript
type Action =
  | { type: 'SET_FILTER'; payload: string }
  | { type: 'TOGGLE_VIEW'; payload: 'grid' | 'list' }
  | { type: 'RESET' };

interface State { filter: string; view: 'grid' | 'list'; }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_FILTER': return { ...state, filter: action.payload };
    case 'TOGGLE_VIEW': return { ...state, view: action.payload };
    case 'RESET': return { filter: '', view: 'grid' };
    default: return state;
  }
}

const ProductContext = React.createContext<{
  state: State; dispatch: React.Dispatch<Action>;
} | null>(null);

export function ProductProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { filter: '', view: 'grid' });
  return <ProductContext.Provider value={{ state, dispatch }}>{children}</ProductContext.Provider>;
}

export function useProduct() {
  const ctx = React.useContext(ProductContext);
  if (!ctx) throw new Error('useProduct must be used within ProductProvider');
  return ctx;
}
```

## Error Boundary
```typescript
'use client'; // Next.js
import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
    // Send to Sentry: Sentry.captureException(error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center p-8">
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <button onClick={() => this.setState({ hasError: false })} className="mt-4 underline">
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

## Performance Patterns
```typescript
// React.memo — prevent re-renders when props haven't changed
const ProductCard = React.memo(({ product, onAdd }: ProductCardProps) => (
  <div>...</div>
), (prevProps, nextProps) => prevProps.product.id === nextProps.product.id);

// useMemo — expensive calculations
const sortedProducts = useMemo(
  () => products.sort((a, b) => a.price - b.price),
  [products]
);

// useCallback — stable function references
const handleAddToCart = useCallback((product: Product) => {
  addToCart(product);
}, [addToCart]);

// Lazy loading
const HeavyChart = React.lazy(() => import('./HeavyChart'));
// Usage:
<Suspense fallback={<ChartSkeleton />}>
  <HeavyChart data={data} />
</Suspense>
```
