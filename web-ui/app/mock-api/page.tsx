'use client'

import { ApiCommandPage } from '@/components/ApiCommandPage'

export default function MockApiPage() {
  return (
    <ApiCommandPage
      title="Mock API Generator"
      eyebrow="Developer tooling"
      description="Generate MSW handlers from an OpenAPI or Swagger schema so API mocks can be spun up without creating the handlers by hand."
      defaultCommand="ghostforge api-mock generate ./openapi.json"
      placeholder="ghostforge api-mock generate https://example.com/openapi.json"
      examples={[
        'ghostforge api-mock generate ./openapi.json',
        'ghostforge api-mock generate https://example.com/openapi.json',
        'ghostforge api-mock list',
      ]}
      accent="#f59e0b"
    />
  )
}
