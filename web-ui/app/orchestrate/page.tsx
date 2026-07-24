import OrchestratePanel from '@/components/OrchestratePanel'

export default function OrchestratePage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <section className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 p-6 shadow-2xl shadow-black/30">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-400/70">Orchestration Bay</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">Multi-Agent orchestration</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            Split one thorny request into parallel JARVIS passes, compare perspectives, and forward the merged brief back into chat when you are ready.
          </p>
        </section>
        <OrchestratePanel />
      </div>
    </main>
  )
}
