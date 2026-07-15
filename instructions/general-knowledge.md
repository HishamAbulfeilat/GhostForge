# General Knowledge Base

The AI has expert-level knowledge in all of the following areas:

## Frontend
All major frameworks: React, Vue, Angular, Svelte, Solid, Qwik
Build tools: Vite, Webpack, Rollup, esbuild, Turbopack
CSS: Tailwind, CSS Modules, Styled Components, Sass/SCSS, PostCSS
Testing: Jest, Vitest, Playwright, Cypress, Testing Library

## Mobile
React Native, Expo, Flutter/Dart, Swift (iOS), Kotlin (Android)
Cross-platform patterns, native modules, performance optimization
App Store / Play Store submission process

## Backend
Node.js (Express, NestJS, Fastify, Hapi)
Python (Django, FastAPI, Flask)
Java (Spring Boot), C# (.NET), Go (Gin), Ruby (Rails), PHP (Laravel)
Databases: PostgreSQL, MySQL, MongoDB, Redis, SQLite, DynamoDB
ORMs: Prisma, TypeORM, Drizzle, Sequelize, SQLAlchemy

## DevOps
Docker, Docker Compose, Kubernetes
CI/CD: GitHub Actions, Azure DevOps, GitLab CI, Jenkins, CircleCI
Cloud: Azure, AWS, GCP
Infrastructure as Code: Terraform, Bicep, ARM templates
Monitoring: Datadog, New Relic, Azure Monitor, Grafana

## Security
OWASP Top 10 (Web + Mobile + API)
Penetration testing concepts
Cryptography basics, TLS/SSL, JWT
Identity providers: Azure AD, Auth0, Okta, Firebase Auth
GDPR, data privacy

## UI/UX
Figma, Adobe XD, Sketch
Design systems: Material Design, Human Interface Guidelines
Accessibility: WCAG 2.1, ARIA
Color theory, typography, layout principles
User research, usability testing

## AI/ML
OpenAI APIs (GPT, DALL-E, Whisper, Embeddings)
Azure OpenAI Service
LangChain, vector databases
GitHub Copilot API

## Project Management
Agile/Scrum, Kanban
Jira, Azure Boards, GitHub Projects
Code review best practices
Technical documentation

---

## SDLC (Software Development Life Cycle)

### Phases
1. **Requirements** — Gather from stakeholders, write user stories, define acceptance criteria
2. **Design** — System architecture, DB schema, API contracts, UI wireframes
3. **Development** — Feature branches, conventional commits, code reviews, pair programming
4. **Testing** — Unit → Integration → E2E → UAT → Performance → Security
5. **Deployment** — Staging → Smoke tests → Production → Monitor
6. **Maintenance** — Bug triage by priority, hotfixes, refactoring sprints

### Branch Strategy (GitFlow)
```
main        → production (protected, requires PR)
develop     → integration branch
feature/*   → new features (branch from develop)
fix/*       → bug fixes
hotfix/*    → production emergency fixes (branch from main)
release/*   → release preparation
```

### Commit Convention (Conventional Commits)
```
feat(scope): add product search functionality
fix(auth): handle expired token gracefully #142
chore(deps): upgrade expo-router to 3.5.0
docs(api): update authentication endpoints
refactor(cart): extract CartItem into separate component
test(login): add unit tests for email validation
ci(pipeline): add Lighthouse performance check
```

---

## API Design Standards

### RESTful Conventions
```
GET    /api/v1/products          → list products
GET    /api/v1/products/:id      → get one product
POST   /api/v1/products          → create product
PUT    /api/v1/products/:id      → full update
PATCH  /api/v1/products/:id      → partial update
DELETE /api/v1/products/:id      → delete product
```

### Standard Response Shape
```typescript
// Success
{ "success": true, "data": {...}, "message": "Product created" }

// Error
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Email is required", "fields": ["email"] } }

// Paginated list
{ "success": true, "data": [...], "meta": { "total": 100, "page": 1, "limit": 20, "totalPages": 5 } }
```

### HTTP Status Codes
```
200 OK          → Success (GET, PATCH, PUT)
201 Created     → Resource created (POST)
204 No Content  → Success, no body (DELETE)
400 Bad Request → Validation error
401 Unauthorized→ Not authenticated
403 Forbidden   → Authenticated but not authorized
404 Not Found   → Resource doesn't exist
409 Conflict    → Duplicate resource
422 Unprocessable → Business logic error
429 Too Many Requests → Rate limited
500 Internal Server Error → Server crash
```

---

## Accessibility (A11y) Deep Reference

### WCAG 2.1 AA Requirements
- **1.1.1** Non-text content has alt text
- **1.3.1** Structure conveyed by markup (headings, lists, tables)
- **1.4.3** Contrast ratio ≥ 4.5:1 (normal text), 3:1 (large text)
- **1.4.4** Text resizes up to 200% without loss of content
- **2.1.1** All functionality accessible via keyboard
- **2.4.3** Logical focus order
- **2.4.7** Focus indicator visible
- **3.3.1** Errors identified in text
- **3.3.2** Labels for inputs

### React Native A11y
```typescript
<TouchableOpacity
  accessible={true}
  accessibilityLabel="Add to cart"
  accessibilityHint="Adds this product to your shopping cart"
  accessibilityRole="button"
  accessibilityState={{ disabled: isLoading }}
>
```

---

## Performance Targets

| Metric | Target | Tool |
|--------|--------|------|
| Lighthouse Performance | ≥ 90 | Lighthouse CI |
| First Contentful Paint | < 1.8s | Lighthouse |
| Largest Contentful Paint | < 2.5s | Lighthouse |
| Cumulative Layout Shift | < 0.1 | Lighthouse |
| Time to Interactive | < 3.8s | Lighthouse |
| React Native FPS | ≥ 60fps | RN Profiler |
| App cold start | < 3s | Expo DevTools |
| API response (p95) | < 500ms | Application Insights |
