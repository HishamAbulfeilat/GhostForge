import { getTranslations } from 'next-intl/server';

export default async function HomePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'HomePage' });
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <main dir={dir} className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-4xl font-bold text-slate-900">{t('title')}</h1>
      <p className="mt-4 text-lg text-slate-600">{t('description')}</p>
      <button className="mt-8 rounded-lg bg-slate-900 px-5 py-3 text-sm font-medium text-white">
        {t('cta')}
      </button>
    </main>
  );
}
