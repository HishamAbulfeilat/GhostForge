# Next.js Instructions

## Setup
```bash
npx create-next-app@latest my-app --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd my-app
npm install @tanstack/react-query zustand axios react-hook-form zod @hookform/resolvers
npx shadcn@latest init
```

## App Router Structure
```
src/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page
│   ├── (auth)/             # Route group
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx      # Dashboard layout
│   │   └── page.tsx
│   └── api/                # API routes
│       └── auth/[...nextauth]/route.ts
├── components/
├── lib/
└── types/
```

## Server vs Client Components
```typescript
// Server Component (default in App Router) — no 'use client'
// Can: fetch data, access server-side resources, reduce JS bundle
export default async function ProductList() {
  const products = await fetch('/api/products').then(r => r.json());
  return <ul>{products.map(p => <li key={p.id}>{p.name}</li>)}</ul>;
}

// Client Component — needs interactivity or browser APIs
'use client';
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

## Next.js Performance Checklist
- Use `next/image` for all images
- Use `next/font` for fonts
- Dynamic import heavy components: `const Chart = dynamic(() => import('./Chart'))`
- Use React Suspense for loading states
- Implement ISR for semi-static pages
