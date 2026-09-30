'use client'

import { ApiCommandPage } from '@/components/ApiCommandPage'

export default function ApiTypesPage() {
  return (
    <ApiCommandPage
      title="API Types Generator"
      eyebrow="Developer tooling"
      description="Generate TypeScript interfaces from a Swagger or OpenAPI spec and optionally create a matching API service wrapper."
      defaultCommand="ghostforge api-types --out=src/types/api.generated.ts https://petstore3.swagger.io/api/v3/openapi.json"
      placeholder="ghostforge api-types --service --out=src/types/api.generated.ts ./openapi.json"
      examples={[
        'ghostforge api-types --out=src/types/api.generated.ts https://petstore3.swagger.io/api/v3/openapi.json',
        'ghostforge api-types --service --out=src/types/api.generated.ts ./openapi.json',
        'ghostforge api-types --out=src/types/api.generated.ts ./docs/openapi.yaml',
      ]}
      accent="#a78bfa"
    />
  )
}
