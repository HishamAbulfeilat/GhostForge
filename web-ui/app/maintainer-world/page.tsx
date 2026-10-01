import AgentWorldView from '@/components/AgentWorldView'

export const metadata = {
  title: 'Maintainer World | GhostForge',
  description: 'Private monitor for GhostForge Copilot and Claude agent sessions.',
}

export default function MaintainerWorldPage() {
  return (
    <AgentWorldView
      variant="maintainer"
      title="GhostForge Maintainer World"
      subtitle="Private monitor for configured Copilot and Claude sessions, their roles, active work, progress, and real workflow connections."
    />
  )
}
