import { ResourceCatalogPage } from '@/components/ResourceCatalogPage'

export default function VigoliumPage() {
  return (
    <ResourceCatalogPage
      eyebrow="GhostForge security tools"
      title="Vigolium security scanner"
      description="Vigolium provides vulnerability discovery and source-code auditing capabilities. Use it as a defensive testing aid to identify and remediate weaknesses in systems you control."
      items={[
        {
          name: 'Vigolium',
          url: 'https://github.com/vigolium/vigolium',
          description: 'AI-assisted security scanning with OWASP-focused checks, passive analysis, and SAST workflows.',
          meta: 'AGPL-3.0 · 317 modules',
        },
        {
          name: 'Vigolium documentation',
          url: 'https://vigolium.com',
          description: 'Read the upstream documentation and review its usage, data handling, and configuration guidance.',
          meta: 'Upstream documentation',
        },
      ]}
      notice={{
        title: 'Authorized defensive testing only',
        body: 'Only scan applications, APIs, networks, and source repositories that you own or have explicit permission to test. Do not use Vigolium to probe arbitrary third-party targets, evade controls, exploit users, or deploy generated attack code. Confirm scope and rate limits with the system owner before every scan, and treat findings as confidential.',
      }}
      commands={[
        'npm install -g @vigolium/vigolium',
        'vigolium scan -t https://your-owned-staging.example --strategy balanced',
        'vigolium agent audit --source . --diff HEAD~5',
      ]}
    />
  )
}
