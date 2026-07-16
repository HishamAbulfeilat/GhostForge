# Arabic / RTL — GhostForge Localization Standards

## Overview
All GhostForge web projects support **Arabic (AR) and English (EN)**. Arabic is the **default locale** in production. Every component, layout, and data display must work correctly in both directions.

---

## next-intl Setup (Next.js App Router)

### Routing Pattern — `app/[locale]/`
```
app/
├── [locale]/
│   ├── layout.tsx        ← sets dir="rtl"/"ltr" on <html>
│   ├── page.tsx
│   ├── dashboard/page.tsx
│   └── (public)/
│       ├── login/page.tsx
│       └── register/page.tsx
├── messages/
│   ├── en.json
│   └── ar.json
└── i18n/
    ├── routing.ts
    └── request.ts
```

### `i18n/routing.ts`
```typescript
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'ar'],
  defaultLocale: 'ar',       // Arabic is DEFAULT
  localeDetection: false,    // Never auto-detect from browser
});
```

### `i18n/request.ts`
```typescript
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

### `middleware.ts`
```typescript
import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { runAuthGuards } from './core/middleware/auth';

const intlMiddleware = createMiddleware(routing);

export default async function middleware(req: NextRequest) {
  const authResult = await runAuthGuards(req);
  if (authResult) return authResult;
  return intlMiddleware(req);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
```

### Root Layout — Setting `dir`
```typescript
// app/[locale]/layout.tsx
import { getLocale } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

export default async function LocaleLayout({ children, params }: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

### Using Translations in Components
```typescript
// Server Component
import { getTranslations } from 'next-intl/server';

export default async function Page() {
  const t = await getTranslations('Dashboard');
  return <h1>{t('title')}</h1>;
}

// Client Component
'use client';
import { useTranslations, useLocale } from 'next-intl';

export function Header() {
  const t = useTranslations('Common');
  const locale = useLocale();
  const isRTL = locale === 'ar';

  return <button>{t('submit')}</button>;
}

// Navigation / Link
import { Link, useRouter, usePathname } from '@/i18n/navigation';
// NOT from 'next/navigation' — always use the i18n-aware versions
```

### Translation Files Pattern
```json
// messages/ar.json
{
  "Common": {
    "submit": "إرسال",
    "cancel": "إلغاء",
    "loading": "جاري التحميل...",
    "error": "حدث خطأ",
    "save": "حفظ",
    "delete": "حذف",
    "search": "بحث",
    "yes": "نعم",
    "no": "لا"
  },
  "Dashboard": {
    "title": "لوحة التحكم",
    "welcome": "مرحباً {name}"
  }
}
```

---

## react-i18next (Vite/Vite-based projects)

```typescript
// i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import arTranslation from './locales/ar.json';
import enTranslation from './locales/en.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { ar: { translation: arTranslation }, en: { translation: enTranslation } },
    lng: 'ar',             // Arabic default
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

// In component
const { t, i18n } = useTranslation();
const isRTL = i18n.language === 'ar';

// Switch language
i18n.changeLanguage('en');
// Update document direction
document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
document.documentElement.lang = i18n.language;
```

---

## Tailwind RTL Patterns

```typescript
// tailwind.config.js — dark mode is DISABLED in GhostForge projects
const config = {
  darkMode: ['false'],
  // ...
};

// In components — use start/end instead of left/right
// ✅ RTL-safe
<div className="ms-4 me-2 ps-3 pe-3 text-start border-s-2">
  <span className="float-start">Icon</span>
</div>

// ❌ Not RTL-safe
<div className="ml-4 mr-2 pl-3 pr-3 text-left border-l-2">
  <span className="float-left">Icon</span>
</div>
```

---

## Hijri Calendar (Islamic Calendar)

```typescript
// moment-hijri — for Hijri date display
import moment from 'moment-hijri';

// Convert Gregorian to Hijri
const hijriDate = moment('2024-03-15').format('iDD/iMM/iYYYY');
// → "05/09/1445"

// Hijri date components
const hijriYear  = moment().iYear();
const hijriMonth = moment().iMonth() + 1; // 0-indexed
const hijriDay   = moment().iDate();

// Format for display in Arabic
const formatted = moment().locale('ar').format('iD iMMMM iYYYY');
// → "15 رمضان 1445"

// Add/subtract Hijri months
const nextHijriMonth = moment().add(1, 'iMonth');
```

```typescript
// react-multi-date-picker with Hijri support
import DatePicker from 'react-multi-date-picker';
import arabic from 'react-date-object/calendars/arabic';
import arabic_ar from 'react-date-object/locales/arabic_ar';

<DatePicker
  calendar={arabic}
  locale={arabic_ar}
  value={value}
  onChange={setValue}
/>
```

---

## Arabic Number Formatting

```typescript
// Format numbers in Arabic locale
const formatNumber = (num: number, locale = 'ar-SA') =>
  new Intl.NumberFormat(locale).format(num);

// Currency
const formatCurrency = (amount: number, locale = 'ar-SA') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'SAR' }).format(amount);

// Date
const formatDate = (date: Date, locale = 'ar-SA') =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
```

---

## Common RTL Gotchas

### ❌ Never hardcode directions
```typescript
// ❌ Wrong
style={{ textAlign: 'right', marginLeft: '10px' }}

// ✅ Correct
style={{ textAlign: 'start', marginInlineStart: '10px' }}
// or use Tailwind: className="text-start ms-2"
```

### ❌ Icons that need flipping in RTL
```typescript
const { i18n } = useTranslation();
// Arrows, chevrons, etc. need to flip in RTL
<ChevronRight className={i18n.language === 'ar' ? 'rotate-180' : ''} />

// Or use CSS logical properties
<span style={{ transform: document.dir === 'rtl' ? 'scaleX(-1)' : 'none' }}>
  <ArrowRight />
</span>
```

### next-intl `Link` — always use i18n-aware version
```typescript
// ❌ Wrong — doesn't preserve locale prefix
import Link from 'next/link';
<Link href="/dashboard">Dashboard</Link>

// ✅ Correct — keeps /ar/ or /en/ prefix
import { Link } from '@/i18n/navigation';
<Link href="/dashboard">Dashboard</Link>
```

### next-intl `useRouter` — always use i18n-aware version
```typescript
// ❌ Wrong
import { useRouter } from 'next/navigation';

// ✅ Correct
import { useRouter, usePathname } from '@/i18n/navigation';
```

### `[locale]/[...slug]` catch-all pattern (MOS project)
```typescript
// app/[locale]/[...slug]/page.tsx
// Handles dynamic service routes
export default async function SlugPage({
  params,
}: {
  params: { locale: string; slug: string[] };
}) {
  const { locale, slug } = await params;
  const servicePath = slug.join('/');
  // ...
}
```

---

## Language Switcher Component
```typescript
'use client';
import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale });
  };

  return (
    <button onClick={() => switchLocale(locale === 'ar' ? 'en' : 'ar')}>
      {locale === 'ar' ? 'English' : 'العربية'}
    </button>
  );
}
```
