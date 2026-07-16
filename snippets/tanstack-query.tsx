import * as React from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useQueryErrorResetBoundary,
  type InfiniteData
} from '@tanstack/react-query';

interface Product {
  id: string;
  name: string;
  price: number;
}

interface ProductsResponse {
  items: Product[];
  nextCursor?: string;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      throwOnError: false
    }
  }
});

async function getJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export function ProductsProvider({ children }: React.PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function useProducts() {
  return useQuery({
    queryKey: ['products', 'list'],
    queryFn: () => getJson<Product[]>('/api/products')
  });
}

export function useCreateProduct() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Pick<Product, 'name' | 'price'>) =>
      getJson<Product>('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
    onMutate: async (payload) => {
      await client.cancelQueries({ queryKey: ['products', 'list'] });
      const previousProducts = client.getQueryData<Product[]>(['products', 'list']) ?? [];

      client.setQueryData<Product[]>(['products', 'list'], [
        ...previousProducts,
        {
          id: `temp-${Date.now()}`,
          ...payload
        }
      ]);

      return { previousProducts };
    },
    onError: (_error, _payload, context) => {
      client.setQueryData(['products', 'list'], context?.previousProducts ?? []);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['products', 'list'] });
    }
  });
}

export function useInfiniteProducts() {
  return useInfiniteQuery({
    queryKey: ['products', 'infinite'],
    queryFn: ({ pageParam }) =>
      getJson<ProductsResponse>(`/api/products?cursor=${pageParam ?? ''}`),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined
  });
}

export function ProductsPanel() {
  const { reset } = useQueryErrorResetBoundary();
  const { data, error, isPending, refetch } = useProducts();
  const createProduct = useCreateProduct();
  const infiniteProducts = useInfiniteProducts();

  React.useEffect(() => {
    reset();
  }, [reset]);

  if (error) {
    throw error;
  }

  if (isPending) {
    return <p>Loading products...</p>;
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        className="rounded-md bg-slate-900 px-4 py-2 text-white"
        onClick={() => createProduct.mutate({ name: 'New product', price: 199 })}
      >
        Add product
      </button>

      <ul className="space-y-2">
        {data?.map((product) => (
          <li key={product.id} className="rounded-lg border border-slate-200 p-3">
            {product.name} - {product.price}
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => refetch()}>
        Refresh list
      </button>

      <section className="space-y-2">
        {infiniteProducts.data?.pages.flatMap((page) => page.items).map((product) => (
          <div key={product.id}>{product.name}</div>
        ))}
        <button
          type="button"
          disabled={!infiniteProducts.hasNextPage || infiniteProducts.isFetchingNextPage}
          onClick={() => infiniteProducts.fetchNextPage()}
        >
          {infiniteProducts.isFetchingNextPage ? 'Loading more...' : 'Load more'}
        </button>
      </section>
    </div>
  );
}

export type ProductPages = InfiniteData<ProductsResponse>;
