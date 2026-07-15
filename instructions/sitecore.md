# Sitecore Instructions

## Versions
- Sitecore XP 9.x / 10.x (on-premise or Azure PaaS)
- Sitecore XM (lightweight, no xDB)
- Sitecore XM Cloud (SaaS, headless-first)
- Sitecore JSS (JavaScript Services — Next.js/React frontend)
- Sitecore SXA (Experience Accelerator — drag-and-drop page builder)

## Architecture: Helix

```
Foundation Layer  → Shared services, utilities (logging, config, base classes)
Feature Layer     → Self-contained features (Navigation, Products, Auth, Search)
Project Layer     → Site-specific assemblies that wire features together
```

## JSS + Next.js Setup
```bash
npx create-sitecore-jss@latest           --appName ghostforge-web           --templates nextjs           --hostName http://cm.ghostforge.localhost           --fetchWith GraphQL
```

## Key Packages
```json
{
  "@sitecore-jss/sitecore-jss-nextjs": "^21.6.0",
  "@sitecore-jss/sitecore-jss": "^21.6.0"
}
```

## Content Fetching Patterns

### Layout Service (REST)
```typescript
import { LayoutService } from '@sitecore-jss/sitecore-jss-nextjs';
const layoutData = await layoutService.fetchLayoutData('/en/home');
```

### GraphQL Edge
```graphql
query GetProduct($path: String!) {
  item(path: $path, language: "en") {
    id
    name
    field(name: "Title") { value }
    field(name: "Price") { value }
    field(name: "Image") {
      ... on ImageField { src alt }
    }
  }
}
```

## Sitecore CLI
```bash
dotnet sitecore login --cm https://cm.ghostforge.localhost --auth https://id.ghostforge.localhost
dotnet sitecore ser pull        # sync items to disk
dotnet sitecore ser push        # push items to Sitecore
dotnet sitecore index rebuild   # rebuild search indexes
```

## Deployment Checklist
- [ ] Serialize all content items (SCS/Unicorn/TDS)
- [ ] Patch configs via `.config` files in `App_Config/Include`
- [ ] Publish items after deploy
- [ ] Warm up application after publish
- [ ] Rebuild search indexes if content schema changed
- [ ] Clear HTML/output cache
