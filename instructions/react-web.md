# React Web Instructions

## Setup (Vite + TypeScript)
```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install @tanstack/react-query zustand axios react-router-dom react-hook-form zod
```

## Key Packages
```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.22.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^4.5.0",
    "axios": "^1.6.0",
    "react-hook-form": "^7.51.0",
    "zod": "^3.22.0",
    "@hookform/resolvers": "^3.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "tailwindcss": "^3.4.0",
    "eslint": "^8.57.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "prettier": "^3.2.0",
    "vitest": "^1.3.0",
    "@testing-library/react": "^14.2.0"
  }
}
```

## Folder Structure
```
src/
├── components/
│   ├── ui/           # Reusable base components
│   └── features/     # Feature-specific components
├── hooks/            # Custom hooks
├── pages/ or app/    # Route pages
├── services/         # API calls
├── store/            # Zustand stores
├── types/            # TypeScript types
├── utils/            # Helper functions
└── lib/              # Third-party configurations
```

## shadcn/ui Setup
```bash
npx shadcn@latest init
npx shadcn@latest add button input card dialog form
```
