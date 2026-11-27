'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/shared/EmptyState';

/**
 * Data table (DRVO UI kit) — one table look for lists and reports.
 * - Numeric columns align to the reading end with tabular figures (LTR digits).
 * - Loading shows skeleton rows of the final shape (no layout jump).
 * - Empty / no-results / error states are explicit, never a blank table.
 * - Optional client-side sort per column (`sortValue`).
 * Server pagination and filtering stay in the page; this only renders.
 */
export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** Right-aligned tabular numbers, LTR. */
  numeric?: boolean;
  align?: 'start' | 'center' | 'end';
  /** Enables sorting on this column. */
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  loadingRows?: number;
  /** Set when the load failed; shown instead of rows. */
  error?: string | null;
  onRetry?: () => void;
  empty?: { title: string; description?: string; kind?: 'empty' | 'no-results' };
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  footer?: ReactNode;
  caption?: string;
  className?: string;
  /** Sticky header inside a scroll container of this max height (e.g. '70vh'). */
  maxHeight?: string;
  dense?: boolean;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

const ALIGN: Record<'start' | 'center' | 'end', string> = {
  start: 'text-start',
  center: 'text-center',
  end: 'text-end',
};

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  loadingRows = 6,
  error,
  onRetry,
  empty = { title: 'لا توجد بيانات' },
  onRowClick,
  rowClassName,
  footer,
  caption,
  className,
  maxHeight,
  dense = false,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), 'ar') * factor;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'desc' } : s.dir === 'desc' ? { key, dir: 'asc' } : null));

  const cellPad = dense ? 'px-3 py-1.5' : 'px-3 py-2.5';
  const alignOf = (c: DataTableColumn<T>) => (c.numeric ? 'text-end' : ALIGN[c.align ?? 'start']);

  if (error && !loading) {
    return (
      <EmptyState
        kind="error"
        title="تعذر تحميل البيانات"
        description={error}
        action={onRetry ? { label: 'إعادة المحاولة', onClick: onRetry } : undefined}
        className={className}
      />
    );
  }

  if (!loading && rows.length === 0) {
    return <EmptyState kind={empty.kind ?? 'empty'} title={empty.title} description={empty.description} className={className} />;
  }

  return (
    <div
      className={cn('overflow-auto rounded-xl border border-border bg-card', className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-sm" aria-busy={loading || undefined}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sticky top-0 z-[1] bg-surface-muted">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'whitespace-nowrap border-b border-border font-semibold text-muted-foreground',
                    cellPad,
                    alignOf(c),
                    c.headerClassName,
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {c.header}
                      {active ? (
                        sort!.dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: loadingRows }, (_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className={cellPad}>
                      <Skeleton className={cn('h-4', c.numeric ? 'ms-auto w-16' : 'w-3/4')} />
                    </td>
                  ))}
                </tr>
              ))
            : sorted.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-border last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-surface-muted',
                    rowClassName?.(row),
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(cellPad, alignOf(c), c.numeric && 'num tabular-nums', c.className)}
                      dir={c.numeric ? 'ltr' : undefined}
                    >
                      {c.cell(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
        {footer && !loading ? <tfoot className="border-t border-border bg-surface-muted font-semibold">{footer}</tfoot> : null}
      </table>
    </div>
  );
}
