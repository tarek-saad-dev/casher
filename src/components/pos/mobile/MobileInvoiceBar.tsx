'use client';

import { ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileInvoiceBarProps {
  itemCount: number;
  grandTotal: number;
  onOpen: () => void;
  className?: string;
}

export default function MobileInvoiceBar({
  itemCount,
  grandTotal,
  onOpen,
  className,
}: MobileInvoiceBarProps) {
  const serviceLabel = itemCount === 1 ? 'خدمة' : 'خدمات';
  const ctaLabel = itemCount > 0 ? 'عرض الفاتورة' : 'إكمال الدفع';

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface/95 backdrop-blur-md md:hidden',
        'pb-[env(safe-area-inset-bottom)]',
        className,
      )}
      dir="rtl"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${itemCount} ${serviceLabel} — ${grandTotal.toFixed(0)} ج.م — ${ctaLabel}`}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-right transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <ShoppingCart className="h-5 w-5" />
          {itemCount > 0 && (
            <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {itemCount}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {itemCount} {serviceLabel} — {grandTotal.toFixed(0)} ج.م
          </p>
          <p className="text-xs text-muted-foreground">{ctaLabel}</p>
        </div>

        <span className="shrink-0 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground">
          {ctaLabel}
        </span>
      </button>
    </div>
  );
}
