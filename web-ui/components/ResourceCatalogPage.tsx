import Link from 'next/link'

export interface ResourceItem {
  name: string
  description: string
  url: string
  meta?: string
}

interface ResourceCatalogPageProps {
  eyebrow: string
  title: string
  description: string
  items: ResourceItem[]
  notice?: {
    title: string
    body: string
    tone?: 'warning' | 'info'
  }
  commands?: string[]
}

export function ResourceCatalogPage({
  eyebrow,
  title,
  description,
  items,
  notice,
  commands = [],
}: ResourceCatalogPageProps) {
  return (
    <main className="min-h-[100dvh] bg-[#030712] px-4 py-8 text-gray-200">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <Link href="/dashboard" className="text-sm text-gray-500 transition hover:text-white">
            ← Dashboard
          </Link>
          <p className="mt-8 text-xs font-mono uppercase tracking-[0.24em] text-violet-400">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-400">{description}</p>
        </header>

        {notice && (
          <aside
            role="note"
            className={`mb-6 rounded-lg border p-4 ${
              notice.tone === 'info'
                ? 'border-sky-800/60 bg-sky-950/30'
                : 'border-amber-700/70 bg-amber-950/30'
            }`}
          >
            <h2 className="font-semibold text-white">{notice.title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-300">{notice.body}</p>
          </aside>
        )}

        {commands.length > 0 && (
          <section className="mb-6 rounded-lg border border-white/[0.08] bg-[#080d18] p-4">
            <h2 className="text-sm font-semibold text-white">Defensive commands</h2>
            <p className="mt-1 text-xs text-gray-500">
              Run these only against systems and source code you own or are explicitly authorized to test.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {commands.map(command => (
                <code key={command} className="overflow-x-auto rounded bg-black/30 px-3 py-2 text-xs text-emerald-300">
                  {command}
                </code>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(item => (
            <a
              key={item.name}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-white/[0.08] bg-[#080d18] p-4 transition hover:border-violet-500/50 hover:bg-white/[0.04]"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold text-white">{item.name}</h2>
                <span aria-hidden="true" className="text-gray-600">↗</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-gray-400">{item.description}</p>
              {item.meta && <p className="mt-3 text-xs text-violet-300">{item.meta}</p>}
            </a>
          ))}
        </section>
      </div>
    </main>
  )
}
