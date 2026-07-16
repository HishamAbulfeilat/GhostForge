import * as React from 'react';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table';

type RowData = Record<string, unknown>;
type AccessorKey<TData extends RowData> = Extract<keyof TData, string>;

export function createTextColumn<TData extends RowData>(
  key: AccessorKey<TData>,
  header: string
): ColumnDef<TData, unknown> {
  const columnHelper = createColumnHelper<TData>();

  return columnHelper.accessor(key, {
    header,
    cell: ({ getValue }) => {
      const value = getValue();
      return <span>{String(value ?? '—')}</span>;
    }
  });
}

interface DataTableProps<TData extends RowData> {
  data: TData[];
  columns: Array<ColumnDef<TData, unknown>>;
  searchableColumn?: AccessorKey<TData>;
  pageSizeOptions?: number[];
}

export function DataTable<TData extends RowData>({
  data,
  columns,
  searchableColumn,
  pageSizeOptions = [10, 20, 50]
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSizeOptions[0] ?? 10
  });

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      pagination
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel()
  });

  const activeFilter = searchableColumn ? table.getColumn(searchableColumn) : undefined;

  return (
    <div className="space-y-4">
      {activeFilter ? (
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder={`Filter by ${String(searchableColumn)}`}
          value={(activeFilter.getFilterValue() as string | undefined) ?? ''}
          onChange={(event) => activeFilter.setFilterValue(event.target.value)}
        />
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortDirection = header.column.getIsSorted();
                  const sortIcon =
                    sortDirection === 'asc' ? '▲' : sortDirection === 'desc' ? '▼' : '↕';

                  return (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-start font-semibold text-slate-700"
                    >
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          className="inline-flex items-center gap-2"
                          onClick={header.column.getToggleSortingHandler()}
                          disabled={!header.column.getCanSort()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {header.column.getCanSort() ? (
                            <span aria-hidden="true">{sortIcon}</span>
                          ) : null}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No results found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-slate-700">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span>Rows per page</span>
          <select
            className="rounded-md border border-slate-300 px-2 py-1"
            value={table.getState().pagination.pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </button>
          <span className="text-slate-600">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
          </span>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

type User = {
  id: number;
  name: string;
  email: string;
  status: 'active' | 'inactive';
};

const userColumnHelper = createColumnHelper<User>();

export const userColumns: Array<ColumnDef<User, unknown>> = [
  userColumnHelper.accessor('name', {
    header: 'Name',
    cell: ({ getValue }) => <strong>{getValue()}</strong>
  }),
  userColumnHelper.accessor('email', {
    header: 'Email'
  }),
  userColumnHelper.accessor('status', {
    header: 'Status',
    cell: ({ getValue }) => (
      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs uppercase">
        {getValue()}
      </span>
    )
  })
];
