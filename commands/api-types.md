# /api-types Command

## Purpose
Generate TypeScript types and an API service file from an OpenAPI/Swagger spec URL or local JSON/YAML file.

## Usage
```bash
/api-types
/api-types https://api.example.com/swagger.json
/api-types ./openapi.yaml
/api-types --out src/types/api.ts
```

## Options
| Option | Description |
|---|---|
| `[url/path]` | OpenAPI spec URL or local file path |
| `--out <path>` | Output file path (default: `src/types/api.generated.ts`) |
| `--service` | Also generate an API service file with typed fetch helpers |
| `--client axios` | Generate an Axios client instead of plain fetch |

## Examples
```bash
/api-types https://petstore3.swagger.io/api/v3/openapi.json
/api-types ./docs/openapi.yaml --out src/types/api.ts --service
/api-types --client axios
```

## What AI does step by step
1. Prompts for OpenAPI spec URL or file path if not provided.
2. Fetches/reads the OpenAPI spec (JSON or YAML).
3. Runs `npx openapi-typescript@latest <url> --output <out>` to generate TypeScript types.
4. If `--service` flag is set, generates a typed API service file with:
   - Fetch/Axios wrapper per endpoint
   - Request/response TypeScript types
   - Error handling and interceptors
5. Formats the output with Prettier if available.
6. Reports generated file paths.

## Output Example
```
✅ Types generated: src/types/api.generated.ts
   ├─ 42 type definitions
   ├─ 18 request types
   └─ 18 response types

✅ Service file: src/services/api.service.ts
   ├─ GET  /users → getUsers(): Promise<UsersResponse>
   ├─ POST /users → createUser(body: CreateUserRequest): Promise<User>
   └─ ...
```

## Notes
- Uses `openapi-typescript` under the hood (no installation needed — npx)
- Works with OpenAPI 3.x and Swagger 2.x specs
- Respects path aliases from `tsconfig.json`
- Generated types include `readonly` where appropriate
