'use client';

import { forwardRef, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ServiceSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  resultCount?: number;
  className?: string;
}

const ServiceSearchInput = forwardRef<HTMLInputElement, ServiceSearchInputProps>(
  function ServiceSearchInput(
    { value, onChange, onClear, resultCount, className },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);

    const setRefs = (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClear();
        inputRef.current?.blur();
      }
    };

    const isActive = value.trim().length > 0;

    return (
      <div className={cn('min-w-0', className)}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={setRefs}
            type="search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ابحث عن خدمة: حلاقة، دقن، بشرة..."
            aria-label="بحث عن خدمة"
            dir="rtl"
            className={cn(
              'h-10 w-full rounded-xl border border-border bg-surface py-2 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground',
              'transition-colors focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/25',
              '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
            )}
          />
          {isActive ? (
            <button
              type="button"
              onClick={onClear}
              aria-label="مسح البحث"
              className="absolute top-1/2 left-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 hidden -translate-y-1/2 rounded-md border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline"
            >
              /
            </span>
          )}
        </div>
        {isActive && typeof resultCount === 'number' && (
          <p className="mt-1.5 text-xs text-muted-foreground" aria-live="polite">
            {resultCount === 0
              ? 'لا توجد نتائج مطابقة'
              : `${resultCount} ${resultCount === 1 ? 'نتيجة' : 'نتائج'}`}
          </p>
        )}
      </div>
    );
  },
);

export default ServiceSearchInput;
