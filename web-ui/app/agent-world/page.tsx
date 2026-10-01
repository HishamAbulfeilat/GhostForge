import AgentWorldView from '@/components/AgentWorldView'

export const metadata = {
  title: 'Agent World | GhostForge',
  description: 'A live, operator-safe view of GhostForge agents and workflows.',
}

export default function AgentWorldPage() {
  return (
    <AgentWorldView
      variant="product"
      title="GhostForge Agent World"
      subtitle="A live, operator-safe view of the real agents, tasks, and project flow in the current GhostForge snapshot."
    />
  )
}
