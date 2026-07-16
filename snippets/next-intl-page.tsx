// This snippet spans multiple files. Copy each block into the matching file path.
// app/[locale]/layout.tsx
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, hasLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

const locales = ['ar', 'en'] as const;
type Locale = (typeof locales)[number];

function isRtlLocale(locale: string) {
  return locale.startsWith('ar');
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'HomePage' });

  return {
    title: t('title'),
    description: t('description')
  };
}

export async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(locales, locale)) {
    notFound();
  }

  const messages = await getMessages();
  const dir = isRtlLocale(locale) ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir}>
      <body className="min-h-screen bg-white text-slate-950 antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

// app/[locale]/page.tsx
export default async function LocalePage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'HomePage' });

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <p className="mt-3 text-slate-600">{t('description')}</p>
      <HomePageClient locale={locale} />
    </main>
  );
}

// components/home-page-client.tsx
'use client';

import { useTranslations } from 'next-intl';

export function HomePageClient({ locale }: { locale: Locale }) {
  const t = useTranslations('HomePage');
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <section dir={dir} className="mt-8 rounded-2xl border border-slate-200 p-6">
      <h2 className="text-xl font-semibold">{t('cta')}</h2>
      <p className="mt-2 text-sm text-slate-500">{t('description')}</p>
    </section>
  );
}
