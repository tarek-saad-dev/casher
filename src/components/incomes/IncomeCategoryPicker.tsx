'use client';

import { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface IncomeCategoryOption {
  ExpINID: number;
  CatName: string;
}

interface IncomeCategoryPickerProps {
  categories: IncomeCategoryOption[];
  selectedId: number | null;
  onSelect: (categoryId: number) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  disabled?: boolean;
  categoryError?: string | null;
}

function CategorySkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-10 animate-pulse rounded-lg bg-surface-muted" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-lg bg-surface-muted" />
        ))}
      </div>
    </div>
  );
}

export default function IncomeCategoryPicker({
  categories,
  selectedId,
  onSelect,
  loading = false,
  error = null,
  onRetry,
  disabled = false,
  categoryError = null,
}: IncomeCategoryPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.CatName.toLowerCase().includes(q));
  }, [categories, searchQuery]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">تصنيف الإيراد</p>
          <p className="mt-0.5 text-xs text-muted-foreground">اختر التصنيف المناسب</p>
        </div>
        <CategorySkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">تصنيف الإيراد</p>
          <p className="mt-0.5 text-xs text-muted-foreground">اختر التصنيف المناسب</p>
        </div>
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              إعادة المحاولة
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">تصنيف الإيراد</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">لا توجد تصنيفات متاحة حاليًا</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground">تصنيف الإيراد</p>
        <p className="mt-0.5 text-xs text-muted-foreground">اختر التصنيف المناسب</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="ابحث عن تصنيف..."
          disabled={disabled}
          className="w-full rounded-xl border border-border bg-surface-muted py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
        {searchQuery ? (
          <button
            type="button"
            aria-label="مسح البحث"
            onClick={() => setSearchQuery('')}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-muted/30 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">لا توجد تصنيفات مطابقة</p>
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label="تصنيف الإيراد"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filtered.map((category) => {
            const selected = selectedId === category.ExpINID;
            return (
              <button
                key={category.ExpINID}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onSelect(category.ExpINID)}
                className={cn(
                  'flex min-h-[48px] w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-right transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                  selected
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-surface-muted/40 text-foreground hover:border-primary/40 hover:bg-surface-muted',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <span className="min-w-0 flex-1 text-sm font-medium leading-snug">
                  {category.CatName}
                </span>
                {selected ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {categoryError ? (
        <p className="text-xs text-destructive" role="alert">
          {categoryError}
        </p>
      ) : null}
    </div>
  );
}
