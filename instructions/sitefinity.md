# Sitefinity Instructions

## Versions
- Sitefinity CMS 14.x / 15.x (.NET / .NET Core)
- Sitefinity Renderer (decoupled Next.js/React frontend)
- Sitefinity Cloud (hosted SaaS)

## Architecture Patterns

### Traditional (ASP.NET MVC)
- Server-side rendering with Razor views
- Widget-based page builder
- Native .NET module development

### Decoupled (Next.js Renderer)
- Sitefinity as headless CMS
- Next.js frontend consuming Sitefinity REST API
- Widget/component mapping from Sitefinity to React

## Sitefinity REST API
```typescript
const SITEFINITY_URL = process.env.SITEFINITY_URL;

// Fetch dynamic content
const fetchNews = async () => {
  const res = await fetch(
    `${SITEFINITY_URL}/api/default/newsitems?$select=Title,Content,PublicationDate&$orderby=PublicationDate desc&$top=10`,
    {
      headers: {
        'X-SF-Service-Request': 'true',
        Authorization: `Bearer ${process.env.SITEFINITY_TOKEN}`,
      },
    }
  );
  return res.json();
};
```

## Next.js Renderer Setup
```bash
npx create-next-app sitefinity-site
npm install @progress/sitefinity-nextjs-sdk
```

```typescript
// pages/[[...slug]].tsx
import { RenderPage, initRendering } from '@progress/sitefinity-nextjs-sdk/pages';

export default function CatchAll({ layout }: { layout: any }) {
  return <RenderPage layout={layout} />;
}

export const getServerSideProps = initRendering(widgetRegistry, RenderPage);
```

## Widget Registration
```typescript
// widget-registry.ts
import { WidgetRegistry } from '@progress/sitefinity-nextjs-sdk';
import { ProductCard } from './widgets/ProductCard';
import { HeroBanner } from './widgets/HeroBanner';

export const widgetRegistry: WidgetRegistry = {
  widgets: {
    'ProductCard': { type: ProductCard },
    'HeroBanner': { type: HeroBanner },
  }
};
```

## Deployment
- Deploy ASP.NET CMS to Azure App Service (.NET runtime)
- Deploy Next.js Renderer to Azure Static Web Apps
- Configure CORS on Sitefinity to allow renderer domain
- Set `SF_CMS_URL` environment variable in renderer
