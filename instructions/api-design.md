# API Design Standards

Standards for REST APIs, GraphQL, and tRPC used in GhostForge projects.

---

## REST API Standards

### URL Conventions
```
GET    /api/v1/products              List (paginated)
GET    /api/v1/products/:id          Get one
POST   /api/v1/products              Create
PUT    /api/v1/products/:id          Full replace
PATCH  /api/v1/products/:id          Partial update
DELETE /api/v1/products/:id          Delete (soft preferred)
GET    /api/v1/products/:id/reviews  Nested resource
POST   /api/v1/products/:id/publish  Action on resource
```

### Response Shape (always consistent)
```typescript
// Success
interface ApiResponse<T> {
  success: true;
  data: T;
  message?: string;
}

// Error
interface ApiError {
  success: false;
  error: {
    code: string;          // Machine-readable: 'VALIDATION_ERROR'
    message: string;       // Human-readable
    fields?: Record<string, string[]>; // Field-level errors
  };
}

// Paginated list
interface PaginatedResponse<T> {
  success: true;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
```

### NestJS Implementation
```typescript
// products.controller.ts
@Controller('api/v1/products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(@Query() query: PaginationDto): Promise<PaginatedResponse<Product>> {
    const { data, total } = await this.productsService.findAll(query);
    return {
      success: true,
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
        hasNext: query.page < Math.ceil(total / query.limit),
        hasPrev: query.page > 1,
      },
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateProductDto): Promise<ApiResponse<Product>> {
    const product = await this.productsService.create(dto);
    return { success: true, data: product, message: 'Product created' };
  }
}
```

### Validation (class-validator + Zod)
```typescript
// NestJS DTO
import { IsString, IsNumber, IsPositive, MinLength, IsOptional } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsNumber()
  @IsPositive()
  price: number;

  @IsString()
  @IsOptional()
  description?: string;
}

// Frontend Zod schema (same validation, different runtime)
const createProductSchema = z.object({
  name: z.string().min(2),
  price: z.number().positive(),
  description: z.string().optional(),
});
```

---

## tRPC (Type-safe API, no REST)
```typescript
// server/routers/products.ts
import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';

export const productsRouter = router({
  list: protectedProcedure
    .input(z.object({ page: z.number().default(1), limit: z.number().default(20) }))
    .query(async ({ input, ctx }) => {
      return ctx.db.product.findMany({
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        where: { isActive: true },
      });
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(2), price: z.number().positive() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.product.create({ data: input });
    }),
});

// Client — fully type-safe, no manual types needed
const { data } = trpc.products.list.useQuery({ page: 1 });
const createProduct = trpc.products.create.useMutation();
```

---

## API Error Codes
```typescript
export enum ApiErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
```

---

## Axios Client (Frontend)
```typescript
// lib/api.ts
import axios, { AxiosError } from 'axios';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach token
api.interceptors.request.use((config) => {
  const token = getAccessToken(); // from store or cookie
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 → refresh token
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return api.request(error.config!);
      logout(); // token refresh failed
    }
    return Promise.reject(error);
  }
);
```
