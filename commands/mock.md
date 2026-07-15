# /mock Command

## Description
Generates MSW (Mock Service Worker) handlers, Faker.js factories, and seed data from your TypeScript types. Instantly gives you a full mock API layer for development and testing.

## Usage
```
/mock api [endpoint]        → Generate MSW handler for an API endpoint
/mock factory [type]        → Generate Faker.js factory for a TypeScript type
/mock seed [count]          → Generate seed data JSON files
/mock all                   → Generate mocks for all services in the project
/mock server                → Set up the full MSW browser/node worker
```

## Examples
```
/mock api /api/products
/mock api /api/auth/login
/mock factory User
/mock factory Product --count 20
/mock all
/mock server
```

## Generated Output

### MSW Handler
```typescript
// src/mocks/handlers/products.ts
import { http, HttpResponse, delay } from 'msw';
import { productFactory } from '../factories/productFactory';
import type { Product } from '@/types/product.types';

export const productHandlers = [
  // GET /api/products — list with pagination
  http.get('/api/products', async ({ request }) => {
    await delay(200); // realistic network delay
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const products = productFactory.buildList(limit);
    return HttpResponse.json({
      success: true,
      data: products,
      meta: { total: 100, page, limit, totalPages: Math.ceil(100 / limit) },
    });
  }),

  // GET /api/products/:id
  http.get('/api/products/:id', async ({ params }) => {
    await delay(100);
    const product = productFactory.build({ id: params.id as string });
    return HttpResponse.json({ success: true, data: product });
  }),

  // POST /api/products
  http.post('/api/products', async ({ request }) => {
    await delay(300);
    const body = await request.json() as Partial<Product>;
    const product = productFactory.build(body);
    return HttpResponse.json({ success: true, data: product }, { status: 201 });
  }),

  // PUT /api/products/:id
  http.put('/api/products/:id', async ({ params, request }) => {
    await delay(200);
    const body = await request.json() as Partial<Product>;
    const product = productFactory.build({ ...body, id: params.id as string });
    return HttpResponse.json({ success: true, data: product });
  }),

  // DELETE /api/products/:id
  http.delete('/api/products/:id', async () => {
    await delay(150);
    return new HttpResponse(null, { status: 204 });
  }),
];
```

### Faker Factory
```typescript
// src/mocks/factories/productFactory.ts
import { faker } from '@faker-js/faker';
import type { Product } from '@/types/product.types';

type FactoryOverrides = Partial<Product>;

const build = (overrides: FactoryOverrides = {}): Product => ({
  id: faker.string.uuid(),
  name: faker.commerce.productName(),
  description: faker.commerce.productDescription(),
  price: parseFloat(faker.commerce.price({ min: 10, max: 500 })),
  imageUrl: faker.image.url({ width: 400, height: 400 }),
  category: faker.commerce.department(),
  stock: faker.number.int({ min: 0, max: 200 }),
  isActive: faker.datatype.boolean({ probability: 0.9 }),
  createdAt: faker.date.past().toISOString(),
  updatedAt: faker.date.recent().toISOString(),
  ...overrides,
});

const buildList = (count: number, overrides: FactoryOverrides = {}): Product[] =>
  Array.from({ length: count }, () => build(overrides));

export const productFactory = { build, buildList };
```

### MSW Server Setup
```typescript
// src/mocks/browser.ts (for browser/Storybook/dev)
import { setupWorker } from 'msw/browser';
import { productHandlers } from './handlers/products';
import { authHandlers } from './handlers/auth';
import { orderHandlers } from './handlers/orders';

export const worker = setupWorker(
  ...productHandlers,
  ...authHandlers,
  ...orderHandlers,
);

// src/mocks/node.ts (for Jest/Node tests)
import { setupServer } from 'msw/node';
import { productHandlers } from './handlers/products';
import { authHandlers } from './handlers/auth';

export const server = setupServer(
  ...productHandlers,
  ...authHandlers,
);
```

## See Also
- `commands/test.md` — Run tests using mocks
- `agents/qa.md` — QA agent documentation
