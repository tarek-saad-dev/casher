'use client';

import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * List toolbar (DRVO UI kit): search on the reading start, filters in the
 * middle, page actions on the end; active filters show as removable chips
 * under it so users always see why a list is shorter than expected.
 */
export interface ToolbarProps {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  /** Selects, date pickers, segmented controls … */
  filters?: ReactNode;
  actions?: ReactNode;
  chips?: FilterChipItem[];
  onClearAll?: () => void;
  className?: string;
}

export interface FilterChipItem {
  key: string;
  label: ReactNode;
  onRemove: () => void;
}

export default function Toolbar({ search, filters, actions, chips, onClearAll, className }: ToolbarProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {search ? (
          <label className="relative min-w-0 basis-full sm:basis-auto sm:min-w-[12rem] flex-1 sm:max-w-xs">
            <span className="sr-only">{search.placeholder ?? 'بحث'}</span>
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? 'بحث'}
              className="h-9 w-full rounded-md border border-input bg-background ps-8 pe-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        ) : null}
        {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
        {actions ? <div className="ms-auto flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {chips && chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <FilterChip key={c.key} label={c.label} onRemove={c.onRemove} />
          ))}
          {onClearAll && chips.length > 1 ? (
            <button type="button" onClick={onClearAll} className="text-xs text-primary hover:underline">
              مسح الكل
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FilterChip({ label, onRemove }: { label: ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary-soft px-2.5 py-0.5 text-xs text-foreground">
      {label}
      <button type="button" onClick={onRemove} className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full hover:bg-primary/15">
        <X className="size-3" aria-hidden />
        <span className="sr-only">إزالة الفلتر</span>
      </button>
    </span>
  );
}
