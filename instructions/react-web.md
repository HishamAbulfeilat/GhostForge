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
    "@tanstack/react-table": "^8.0.0",
    "@tabler/icons-react": "^3.0.0",
    "react-apexcharts": "^1.0.0",
    "apexcharts": "^3.0.0",
    "@dnd-kit/sortable": "^9.0.0",
    "@dnd-kit/modifiers": "^7.0.0",
    "@tiptap/react": "^2.0.0",
    "zustand": "^4.5.0",
    "axios": "^1.6.0",
    "react-hook-form": "^7.51.0",
    "jspdf": "^2.5.0",
    "xlsx": "^0.18.0",
    "html2canvas": "^1.4.0",
    "dompurify": "^3.0.0",
    "react-dropzone": "^14.0.0",
    "react-phone-number-input": "^3.0.0",
    "sonner": "^1.0.0",
    "vaul": "^0.9.0",
    "react-multi-date-picker": "^4.0.0",
    "moment-hijri": "^3.0.0",
    "zod": "^3.22.0",
    "@hookform/resolvers": "^3.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vite-tsconfig-paths": "^4.3.0",
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

## Path Aliases
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
});
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@components/*": ["./src/components/*"],
      "@hooks/*": ["./src/hooks/*"],
      "@utils/*": ["./src/utils/*"],
      "@types/*": ["./src/types/*"],
      "@store/*": ["./src/store/*"],
      "@services/*": ["./src/services/*"],
      "@constants/*": ["./src/constants/*"],
      "@providers/*": ["./src/providers/*"]
    }
  }
}
```

## Data Table
```tsx
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';

type User = {
  id: string;
  name: string;
  email: string;
};

const columnHelper = createColumnHelper<User>();

const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor('email', {
    header: 'Email',
    cell: (info) => info.getValue(),
  }),
];

export function UserTable({ data }: { data: User[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <table>
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <th key={header.id}>
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## Chart
```tsx
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

const options: ApexOptions = {
  chart: { toolbar: { show: false } },
  xaxis: { categories: ['Jan', 'Feb', 'Mar', 'Apr'] },
  stroke: { curve: 'smooth' },
};

const series = [
  {
    name: 'Revenue',
    data: [120, 180, 150, 220],
  },
];

export function RevenueChart() {
  return <Chart type="line" height={320} options={options} series={series} />;
}
```

## HTML Sanitization
- Always sanitize HTML received from APIs before rendering with `dangerouslySetInnerHTML`.

```tsx
import DOMPurify from 'dompurify';

export function SafeHtml({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;
}
```
