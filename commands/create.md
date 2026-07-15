# /create Command

## Description
Scaffolds a complete new project from scratch with all configurations set up and ready to use.

## Usage
```
/create [description of what the app should do]
```

## Examples
```
/create a React Native app with authentication, home screen with product list, cart, and checkout
/create a Next.js dashboard with user management, charts, and Azure AD login
/create a React web app for a job portal with search, filters, and application tracking
```

## Workflow

When this command is triggered, the AI will:

### Step 1: Gather Requirements
Ask the user:
1. **Project type**: React Native (mobile), Next.js (web SSR), React (web SPA), or both?
2. **Language**: TypeScript (recommended) or JavaScript?
3. **Styling**: Tailwind CSS, CSS Modules, Styled Components, or NativeWind?
4. **State management**: Redux Toolkit, Zustand, React Query, or Context?
5. **Authentication needed?** Yes/No → which provider? (Custom JWT, Azure AD, Google, etc.)
6. **Backend/API**: Existing API URL, or scaffold a new one?
7. **Deployment target**: Azure, Vercel, App Store/Play Store?

### Step 2: Scaffold Project
Generate:
- Complete folder structure
- All configuration files (TypeScript, ESLint, Prettier, Tailwind, etc.)
- Base components (Layout, Button, Input, Modal, etc.)
- Navigation setup
- Authentication flow (if required)
- API service layer with Axios/fetch
- State management setup
- Environment variable template
- README with setup instructions
- CI/CD pipeline (GitHub Actions / Azure Pipelines)
- .gitignore, .editorconfig, husky setup

### Step 3: Provide Setup Instructions
```bash
# After scaffold:
cd [project-name]
npm install         # or yarn / pnpm
cp .env.example .env.local
npm run dev
```

## Output Checklist
- [ ] Project runs without errors
- [ ] TypeScript configured (strict)
- [ ] Linting and formatting configured
- [ ] Pre-commit hooks set up
- [ ] Base navigation/routing works
- [ ] Authentication skeleton ready
- [ ] API layer ready
- [ ] Environment variables documented
- [ ] README complete
- [ ] CI/CD pipeline file generated
