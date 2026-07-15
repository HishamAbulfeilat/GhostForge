# /setup Command

## Description
Interactive project setup wizard. Asks all necessary questions step by step, then scaffolds the full project, initializes Git, and optionally connects to GitHub or Azure DevOps.

## Usage
```
/setup
/setup [brief description of the project]
```

## Examples
```
/setup
/setup a job portal app for GhostForge HR team
/setup a mobile app for tracking daily tasks
```

---

## Wizard Flow (Step by Step)

When `/setup` is triggered, the AI will ask the following questions **one at a time**:

---

### Step 1 — Project Name & Description
```
👋 Welcome to the GhostForge Project Setup Wizard!

1️⃣  What is the project name?
   > (e.g., ghostforge-portal, hr-mobile-app)
```

---

### Step 2 — Platform
```
2️⃣  What platform are you building for?

   [1] 📱 Mobile only       → React Native (Expo)
   [2] 🌐 Web only          → Choose framework next
   [3] 📱🌐 Both             → Monorepo (React Native + Next.js)
```

---

### Step 3 — Framework (if Web or Both)
```
3️⃣  Which web framework?

   [1] ⚡ Next.js            → SSR, SSG, App Router (Recommended)
   [2] ⚛️  React + Vite       → SPA, lightweight
   [3] 🔷 React + CRA        → Classic setup
```

---

### Step 4 — Language
```
4️⃣  Which language?

   [1] 🔷 TypeScript         → Strongly typed (Recommended)
   [2] 🟡 JavaScript         → No type checking
```

---

### Step 5 — Styling
```
5️⃣  Which styling solution?

   [1] 🎨 Tailwind CSS       → Utility-first (Recommended for Web)
   [2] 🎨 NativeWind         → Tailwind for React Native
   [3] 💅 Styled Components  → CSS-in-JS
   [4] 📦 CSS Modules        → Scoped CSS
   [5] 🎨 Tamagui            → Universal UI (Web + Mobile)
```

---

### Step 6 — UI Component Library
```
6️⃣  UI component library?

   [1] 🪐 shadcn/ui          → Accessible, customizable (Web - Recommended)
   [2] 🎭 React Native Paper → Material Design (Mobile)
   [3] 🏔️  Tamagui            → Universal (Web + Mobile)
   [4] 🅜  Material UI (MUI) → Google Material Design (Web)
   [5] ⬜ None               → Build from scratch
```

---

### Step 7 — State Management
```
7️⃣  State management?

   [1] 🐻 Zustand + React Query    → Simple & powerful (Recommended)
   [2] 🔴 Redux Toolkit + RTK Query → Enterprise-grade
   [3] 🔬 Jotai                   → Atomic state
   [4] 📡 React Query only         → Server state only
   [5] 🌐 Context API              → Minimal, built-in
```

---

### Step 8 — Authentication
```
8️⃣  Do you need authentication?

   [1] ✅ Yes — Custom JWT (own backend)
   [2] ✅ Yes — Azure Active Directory (Microsoft)
   [3] ✅ Yes — Google OAuth
   [4] ✅ Yes — NextAuth.js (multiple providers)
   [5] ❌ No authentication needed
```

---

### Step 9 — Backend / API
```
9️⃣  Backend setup?

   [1] 🔗 Connect to existing API  → Enter base URL
   [2] 🖥️  Scaffold Node.js API     → Express or NestJS
   [3] ⚡ Next.js API Routes       → Serverless (Next.js only)
   [4] ☁️  Azure Functions          → Serverless on Azure
   [5] ⬜ No backend needed
```

---

### Step 10 — Testing
```
🔟  Testing setup?

   [1] ✅ Full setup     → Jest + Testing Library + Playwright/Detox
   [2] 🔬 Unit only      → Jest + Testing Library
   [3] ⬜ Skip testing   → Add later
```

---

### Step 11 — Version Control
```
1️⃣1️⃣  Version control & hosting?

   [1] 🐙 GitHub            → Init repo + push to GitHub
   [2] 🔷 Azure DevOps       → Init repo + push to Azure Repos
   [3] 📁 Local only         → Just git init, no remote
   [4] ⬜ Skip               → No git setup
```

   If GitHub or Azure DevOps:
```
   → Repository name? (default: [project-name])
   → Visibility: [1] Public  [2] Private (Recommended)
   → Organization/username: ___________
```

---

### Step 12 — CI/CD Pipeline
```
1️⃣2️⃣  Set up CI/CD pipeline?

   [1] 🐙 GitHub Actions    → Auto lint, test, deploy on push
   [2] 🔷 Azure Pipelines   → Enterprise CI/CD on Azure DevOps
   [3] ⬜ Skip               → Add later
```

---

### Step 13 — Deployment Target
```
1️⃣3️⃣  Where will this be deployed?

   [1] ☁️  Azure Static Web Apps  → Best for Next.js/React
   [2] ☁️  Azure App Service      → For SSR or APIs
   [3] 🌍 Vercel                 → Zero-config Next.js
   [4] 📱 App Store + Play Store → React Native
   [5] ⬜ Skip deployment setup
```

---

### Step 14 — Confirm & Generate
```
✅ Setup Summary:
─────────────────────────────
  Project:     [name]
  Platform:    [Mobile / Web / Both]
  Framework:   [Next.js / React Native / etc.]
  Language:    [TypeScript / JavaScript]
  Styling:     [Tailwind / NativeWind / etc.]
  UI Library:  [shadcn/ui / Paper / etc.]
  State:       [Zustand + RQ / Redux / etc.]
  Auth:        [Azure AD / JWT / None]
  Backend:     [Existing API / Node.js / None]
  Testing:     [Full / Unit / None]
  Git:         [GitHub / Azure DevOps / Local]
  CI/CD:       [GitHub Actions / Azure Pipelines]
  Deploy:      [Azure Static Web Apps / Vercel / etc.]
─────────────────────────────

🚀 Ready to generate! Confirm? [Y/n]
```

---

## What Gets Generated

After confirmation, the AI will:

### 📁 Project Files
- Full folder structure matching the chosen stack
- `package.json` with all required dependencies
- `tsconfig.json` (strict TypeScript)
- ESLint + Prettier configuration
- Tailwind / NativeWind config
- `.env.example` with all required variables
- `.gitignore`
- `README.md` with full setup instructions

### 🔐 Authentication (if selected)
- Auth provider configuration
- Login / logout / register screens or pages
- Protected routes / screens
- Token storage (SecureStore for mobile, httpOnly cookies for web)

### 🔗 API Layer
- Axios instance with interceptors
- Base service class or hooks
- Type-safe API response types

### 🧪 Testing
- Jest configuration
- Testing Library setup
- Sample test file
- Playwright/Detox config (if E2E selected)

### 🐙 GitHub Setup (if selected)
```bash
git init
git add .
git commit -m "chore: initial setup via GhostForge /setup wizard"
gh repo create [org/project-name] --private --source=. --remote=origin --push
```

### 🔷 Azure DevOps Setup (if selected)
```bash
git init
git add .
git commit -m "chore: initial setup via GhostForge /setup wizard"
az devops project create --name [project-name]
git remote add origin https://[org]@dev.azure.com/[org]/[project]/_git/[repo]
git push -u origin main
```

### ⚙️ CI/CD Pipeline
- GitHub Actions: `.github/workflows/ci.yml` (lint + test + build + deploy)
- Azure Pipelines: `azure-pipelines.yml` (build + staging + production)

---

## Post-Setup Instructions

```
🎉 Project [name] is ready!

Next steps:
  cd [project-name]
  cp .env.example .env.local
  # Fill in your environment variables
  npm install
  npm run dev

GitHub Copilot commands ready to use:
  /add-feature   → Add a new feature
  /optimize      → Optimize performance
  /security      → Run security audit
  /deploy        → Deploy to [chosen target]
  /qa            → Run QA checks
  /tickets       → View your assigned bug tickets
```
