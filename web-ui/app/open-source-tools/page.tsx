import { ResourceCatalogPage, type ResourceItem } from '@/components/ResourceCatalogPage'

const tools: ResourceItem[] = [
  { name: 'OpenHuman', url: 'https://github.com/tinyhumansai/openhuman', description: 'Persistent local memory and agent orchestration for personal AI workflows.', meta: 'GPL-3.0' },
  { name: 'OpenBot', url: 'https://github.com/CopilotKit/openbot', description: 'Policy-governed AI coworkers with browser, file, and tool access.', meta: 'MIT' },
  { name: 'Browser Use', url: 'https://github.com/browser-use/browser-use', description: 'Makes websites accessible to agents for approved automation and data tasks.', meta: 'MIT' },
  { name: 'ECC Tools', url: 'https://github.com/ECC-Tools/.github', description: 'Skills, rules, hooks, and AgentShield patterns for coding agents.', meta: 'MIT · ecc.tools' },
]

export default function OpenSourceToolsPage() {
  return (
    <ResourceCatalogPage
      eyebrow="GhostForge integrations"
      title="Open-source tools"
      description="Explore open-source projects that can complement GhostForge and JARVIS. Review each project’s license, security posture, and permissions before integrating it."
      items={tools}
      notice={{
        title: 'Review before you integrate',
        body: 'These are external projects, not GhostForge dependencies. Use isolated environments, pin trusted versions, and grant only the permissions an integration actually needs.',
        tone: 'info',
      }}
    />
  )
}
