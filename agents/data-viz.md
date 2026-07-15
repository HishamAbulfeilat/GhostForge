# 📊 Data Visualization Agent

**Role**: Expert in charts, dashboards, and data visualization for web and mobile apps.

---

## Tech Stack
- **Web**: Recharts, Chart.js, Victory, Nivo, Tremor, Observable Plot
- **Mobile**: Victory Native XL, React Native Chart Kit, Skia-based charts
- **BI Embed**: Power BI Embedded, Azure Data Explorer
- **Tables**: TanStack Table v8, AG Grid
- **Maps**: Mapbox GL, Azure Maps, Leaflet

---

## Chart Examples

### Recharts (Web)
```typescript
// components/charts/RevenueChart.tsx
'use client';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

interface RevenueData {
  month: string;
  revenue: number;
  target: number;
}

interface RevenueChartProps {
  data: RevenueData[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <h3 className="mb-4 text-lg font-semibold">Monthly Revenue</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="month" className="text-xs text-muted-foreground" />
          <YAxis
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            className="text-xs text-muted-foreground"
          />
          <Tooltip formatter={(value: number) => [`$${value.toLocaleString()}`, '']} />
          <Legend />
          <Line type="monotone" dataKey="revenue" stroke="#0ea5e9" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="target" stroke="#94a3b8" strokeWidth={1} strokeDasharray="5 5" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

### Victory Native XL (React Native)
```typescript
// components/charts/SalesChart.tsx
import { CartesianChart, Line, useChartPressState } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import { View, Text } from 'react-native';

interface SalesChartProps {
  data: { x: number; y: number }[];
}

export function SalesChart({ data }: SalesChartProps) {
  const { state, isActive } = useChartPressState({ x: 0, y: { y: 0 } });

  return (
    <View style={{ height: 250 }}>
      <CartesianChart
        data={data}
        xKey="x"
        yKeys={['y']}
        chartPressState={state}
      >
        {({ points }) => (
          <>
            <Line points={points.y} color="#0ea5e9" strokeWidth={2} animate={{ type: 'spring' }} />
            {isActive && (
              <Circle cx={state.x.position} cy={state.y.y.position} r={8} color="#0ea5e9" />
            )}
          </>
        )}
      </CartesianChart>
    </View>
  );
}
```

### TanStack Table (Data Tables)
```typescript
// components/tables/ProductTable.tsx
'use client';
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel,
  flexRender, type ColumnDef,
} from '@tanstack/react-table';
import { useState } from 'react';
import type { Product } from '@/types/product.types';

const columns: ColumnDef<Product>[] = [
  { accessorKey: 'name', header: 'Product Name', enableSorting: true },
  { accessorKey: 'category', header: 'Category', enableColumnFilter: true },
  {
    accessorKey: 'price',
    header: 'Price',
    cell: ({ getValue }) => `$${(getValue() as number).toFixed(2)}`,
    enableSorting: true,
  },
  {
    accessorKey: 'stock',
    header: 'Stock',
    cell: ({ getValue }) => {
      const stock = getValue() as number;
      return <span className={stock < 10 ? 'text-destructive font-medium' : ''}>{stock}</span>;
    },
  },
];

export function ProductTable({ data }: { data: Product[] }) {
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: { sorting, globalFilter },
    onSortingChange: setSorting as any,
    onGlobalFilterChange: setGlobalFilter,
  });

  return (
    <div>
      <input
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.target.value)}
        placeholder="Search products..."
        className="mb-4 w-full rounded-md border px-3 py-2 text-sm"
      />
      <div className="rounded-md border">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b bg-muted/50">
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-3 text-left text-sm font-medium"
                    onClick={header.column.getToggleSortingHandler()}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b hover:bg-muted/25">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-sm">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
        <div className="flex gap-2">
          <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>←</button>
          <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>→</button>
        </div>
      </div>
    </div>
  );
}
```

### KPI Card Component
```typescript
// components/charts/KPICard.tsx
interface KPICardProps {
  title: string;
  value: string | number;
  change: number; // percentage change vs previous period
  icon?: React.ReactNode;
}

export function KPICard({ title, value, change, icon }: KPICardProps) {
  const isPositive = change >= 0;
  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className={`mt-1 text-sm ${isPositive ? 'text-green-600' : 'text-destructive'}`}>
        {isPositive ? '↑' : '↓'} {Math.abs(change)}% vs last period
      </p>
    </div>
  );
}
```

## Power BI Embedded
```typescript
// components/PowerBIReport.tsx
'use client';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';

export function PowerBIReport({ embedToken, reportId, embedUrl }) {
  return (
    <PowerBIEmbed
      embedConfig={{
        type: 'report',
        id: reportId,
        embedUrl,
        accessToken: embedToken,
        tokenType: models.TokenType.Embed,
        settings: { navContentPaneEnabled: false, filterPaneEnabled: true },
      }}
      cssClassName="powerbi-frame h-[600px] w-full rounded-lg"
    />
  );
}
```
