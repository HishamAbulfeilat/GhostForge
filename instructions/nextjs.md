# Next.js Instructions

## Setup
```bash
npx create-next-app@latest my-app --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd my-app
npm install @tanstack/react-query zustand axios react-hook-form zod @hookform/resolvers
npx shadcn@latest init
```

## App Router Structure
```
src/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page
│   ├── (auth)/             # Route group
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx      # Dashboard layout
│   │   └── page.tsx
│   └── api/                # API routes
│       └── auth/[...nextauth]/route.ts
├── components/
├── lib/
└── types/
```

## Server vs Client Components
```typescript
// Server Component (default in App Router) — no 'use client'
// Can: fetch data, access server-side resources, reduce JS bundle
export default async function ProductList() {
  const products = await fetch('/api/products').then(r => r.json());
  return <ul>{products.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}

// Client Component — needs interactivity or browser APIs
'use client';
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

## Next.js Performance Checklist
- Use `next/image` for all images
- Use `next/font` for fonts
- Dynamic import heavy components: `const Chart = dynamic(() => import('./Chart'))`
- Use React Suspense for loading states
- Implement ISR for semi-static pages

## next.config.ts
```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  serverExternalPackages: ['winston', 'winston-daily-rotate-file'],
};

export default nextConfig;
```

## Internationalization (i18n)
```text
src/
├── app/
│   └── [locale]/
│       ├── layout.tsx
│       └── page.tsx
├── i18n/
│   ├── navigation.ts
│   ├── request.ts
│   └── routing.ts
└── messages/
    ├── ar.json
    └── en.json
```

```typescript
// src/i18n/routing.ts
import {defineRouting} from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  localeDetection: false,
});
```

```typescript
// src/i18n/navigation.ts
import {createNavigation} from 'next-intl/navigation';
import {routing} from './routing';

export const {Link, redirect, usePathname, useRouter} = createNavigation(routing);
```

```typescript
// src/i18n/request.ts
import {getRequestConfig} from 'next-intl/server';
import {routing} from './routing';

export default getRequestConfig(async ({locale}) => ({
  locale: routing.locales.includes(locale as 'ar' | 'en') ? locale : routing.defaultLocale,
  messages: (await import(`../../messages/${locale ?? routing.defaultLocale}.json`)).default,
}));
```

```typescript
// middleware.ts
import createMiddleware from 'next-intl/middleware';
import type {NextRequest} from 'next/server';
import {routing} from '@/i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  return intlMiddleware(request);
}

export const config = {
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
};
```

```tsx
// src/app/[locale]/layout.tsx
import {NextIntlClientProvider} from 'next-intl';
import {getMessages} from 'next-intl/server';

export default async function LocaleLayout({
  children,
}: Readonly<{children: React.ReactNode}>) {
  const messages = await getMessages();

  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
```

- Use the `[locale]` dynamic segment for App Router pages.
- Arabic is the default locale: `defaultLocale: 'ar'` and `localeDetection: false`.
- Use `Link` and `useRouter` from `@/i18n/navigation`, not `next/navigation`, for locale-aware navigation.
- Keep translations in `messages/ar.json` and `messages/en.json`.

## Logging
```typescript
// src/lib/logger.ts
import {createLogger, format, transports} from 'winston';
import 'winston-daily-rotate-file';

export const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: {service: 'web-app'},
  transports: [new transports.Console()],
});
```

- Keep Winston usage on the server side only (route handlers, server actions, server utilities).

## Azure AD Auth
- For Azure AD SSO, prefer `@azure/msal-browser` with `@azure/msal-react`.
- Wrap client auth flows with `MsalProvider` and keep token acquisition inside shared auth/service utilities.

## Body Size Limits
- For large uploads or export workflows, set `experimental.serverActions.bodySizeLimit` to `'100mb'`.
