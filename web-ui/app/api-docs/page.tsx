'use client'

import { ApiCommandPage } from '@/components/ApiCommandPage'

export default function ApiDocsPage() {
  return (
    <ApiCommandPage
      title="API Docs Generator"
      eyebrow="Developer tooling"
      description="Scan route files, generate Markdown summaries, and create OpenAPI definitions directly from the app or repo you are working in."
      defaultCommand="ghostforge api-docs scan ."
      placeholder="ghostforge api-docs markdown ."
      examples={[
        'ghostforge api-docs scan .',
        'ghostforge api-docs markdown .',
        'ghostforge api-docs openapi .',
      ]}
      accent="#38bdf8"
    />
  )
}
