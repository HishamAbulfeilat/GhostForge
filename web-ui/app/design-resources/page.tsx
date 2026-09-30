import { ResourceCatalogPage, type ResourceItem } from '@/components/ResourceCatalogPage'

const resources: ResourceItem[] = [
  { name: 'Coolors', url: 'https://coolors.co', description: 'Fast, collaborative color palette generation.', meta: 'Color' },
  { name: 'Lucide', url: 'https://lucide.dev', description: 'Open-source, consistent icon library for product interfaces.', meta: 'Icons' },
  { name: 'Google Fonts', url: 'https://fonts.google.com', description: 'Free, production-ready typefaces for web projects.', meta: 'Typography' },
  { name: 'Unsplash', url: 'https://unsplash.com', description: 'High-quality stock photography for prototypes and products.', meta: 'Photography' },
  { name: 'Figma Community', url: 'https://www.figma.com/community', description: 'Community files, UI kits, templates, and plugins.', meta: 'Prototyping' },
  { name: 'Radix UI', url: 'https://www.radix-ui.com', description: 'Unstyled, accessible React primitives for robust interfaces.', meta: 'Components' },
  { name: 'v0', url: 'https://v0.dev', description: 'AI-assisted interface exploration and component generation.', meta: 'AI design' },
  { name: 'getdesign.md', url: 'https://github.com/ibelick/get-design-md', description: 'AI-ready design system documentation for existing sites.', meta: 'Documentation' },
]

export default function DesignResourcesPage() {
  return (
    <ResourceCatalogPage
      eyebrow="GhostForge resources"
      title="Design resources"
      description="A curated starting point for color, icons, typography, imagery, prototyping, and accessible interface foundations. These links mirror the design resources available from the GhostForge TUI."
      items={resources}
    />
  )
}
