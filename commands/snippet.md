# /snippet Command

## Purpose
Browse, insert, save, and adapt reusable code snippets from the GhostForge snippet library.

## Usage
```bash
/snippet list
/snippet [name]
/snippet use [name]
/snippet save [name]
```

## Options
| Command | Description |
|---|---|
| `/snippet list` | Show all available snippets in the library |
| `/snippet [name]` | Open and adapt the named snippet for the current task |
| `/snippet use [name]` | Insert the named snippet into the current workflow or target file |
| `/snippet save [name]` | Save selected code as a new snippet document |

## Built-in snippet library
Snippets live in `snippets/`.

| Snippet | Description |
|---|---|
| `api-hook` | Reusable API hook pattern |
| `apexcharts` | React ApexCharts line, bar, and area chart examples |
| `auth-interceptor` | Auth-aware Axios interceptor pattern |
| `azure-ad-login` | Azure AD login flow example |
| `dnd-kit` | Accessible sortable list with `@dnd-kit` |
| `env-validator` | Environment validation helper |
| `error-boundary` | React error boundary example |
| `export-utils` | PDF, table PDF, Excel, and CSV export helpers |
| `file-upload` | Dropzone upload flow with previews and progress |
| `form-submit-handler` | Shared form submit state pattern |
| `msal-auth` | MSAL provider, token acquisition, and auth guard hooks |
| `next-intl-page` | Next.js App Router + next-intl locale page setup |
| `protected-route` | Route protection wrapper example |
| `rhf-zod-form` | React Hook Form + Zod form pattern |
| `rn-safe-area` | React Native safe-area wrapper pattern |
| `tanstack-query` | Query, mutation, infinite query, and optimistic update patterns |
| `tanstack-table` | Generic TanStack Table v8 setup |
| `tiptap-editor` | TipTap rich text editor with common extensions |
| `zustand-store` | Zustand store with persist and devtools |

## Examples
```bash
/snippet list
/snippet tanstack-query
/snippet use msal-auth
/snippet save secure-fetch-wrapper
```

## What AI does step by step
1. Reads the `snippets/` directory and lists snippet names.
2. Opens the selected snippet and understands its intent, dependencies, and usage notes.
3. Adapts the snippet to the current stack, file conventions, and import style before inserting it.
4. When the user runs `/snippet [name]`, explains where the snippet fits and how to wire it into the current feature.
5. When saving a new snippet, documents its purpose, code, and usage clearly.
