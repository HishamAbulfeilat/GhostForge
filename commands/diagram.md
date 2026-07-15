# /diagram Command

## Description
Generates Mermaid diagrams from your code — architecture, data flow, database ERD, component tree, API flow, and more. Renders inline in GitHub, VS Code, and Notion.

## Usage
```
/diagram architecture       → System architecture overview
/diagram flow [feature]     → User/data flow for a feature
/diagram erd                → Database entity relationship diagram from schema
/diagram components         → React component tree
/diagram api [endpoint]     → API request/response sequence diagram
/diagram auth               → Authentication flow diagram
/diagram ci                 → CI/CD pipeline diagram
```

## Examples
```
/diagram auth
/diagram erd
/diagram flow checkout process
/diagram architecture
```

## Output Examples

### Authentication Flow
```mermaid
sequenceDiagram
  participant U as User
  participant A as App
  participant API as Backend API
  participant AzAD as Azure AD

  U->>A: Tap "Sign in with Microsoft"
  A->>AzAD: Redirect to Azure AD login
  AzAD-->>U: Show Microsoft login page
  U->>AzAD: Enter credentials
  AzAD-->>A: Return auth code
  A->>API: POST /auth/azure with auth code
  API->>AzAD: Validate token
  AzAD-->>API: User info
  API-->>A: Access token + Refresh token
  A->>A: Store in SecureStore
  A-->>U: Navigate to Home screen
```

### System Architecture
```mermaid
graph TB
  subgraph Client
    WEB[Next.js Web App]
    MOB[React Native App]
  end
  subgraph Azure Cloud
    CDN[Azure Front Door / CDN]
    SWA[Static Web Apps]
    API[App Service - NestJS API]
    DB[(Azure SQL Database)]
    CACHE[(Redis Cache)]
    KV[Key Vault]
    AI[Application Insights]
  end
  subgraph Auth
    AAD[Azure Active Directory]
  end

  WEB --> CDN --> SWA
  MOB --> API
  SWA --> API
  API --> DB
  API --> CACHE
  API --> KV
  API --> AI
  WEB & MOB --> AAD
  API --> AAD
```

### Database ERD
```mermaid
erDiagram
  USER {
    uuid id PK
    string email UK
    string full_name
    string role
    boolean is_active
    datetime created_at
  }
  ORDER {
    uuid id PK
    uuid user_id FK
    decimal total_amount
    string status
    datetime created_at
  }
  ORDER_ITEM {
    uuid id PK
    uuid order_id FK
    uuid product_id FK
    int quantity
    decimal unit_price
  }
  PRODUCT {
    uuid id PK
    string name
    decimal price
    int stock
    string category
  }

  USER ||--o{ ORDER : "places"
  ORDER ||--|{ ORDER_ITEM : "contains"
  PRODUCT ||--o{ ORDER_ITEM : "included in"
```

## Where to use Mermaid diagrams
- GitHub PRs and READMEs (native rendering)
- VS Code (Markdown Preview Mermaid Support extension)
- Notion pages
- Confluence (Mermaid plugin)
- Storybook documentation

## See Also
- `commands/pr-description.md` — Include diagrams in PR descriptions
- `agents/devops.md` — Architecture planning
