'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import RecentInvoicesPanel from '@/components/pos/recent-invoices/RecentInvoicesPanel';
import { cn } from '@/lib/utils';

interface RecentInvoicesDrawerProps {
  open: boolean;
  onClose: () => void;
  onEditSale?: (saleId: number) => void;
  onDeleteSale?: (saleId: number) => void;
  onRefresh?: () => void;
}

export default function RecentInvoicesDrawer({
  open,
  onClose,
  onEditSale,
  onDeleteSale,
  onRefresh,
}: RecentInvoicesDrawerProps) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, handleEscape]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshToken((t) => t + 1);
    onRefresh?.();
    window.setTimeout(() => setIsRefreshing(false), 600);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" dir="rtl">
      <button
        type="button"
        aria-label="إغلاق"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="آخر الفواتير"
        className={cn(
          'absolute top-0 bottom-0 right-0 flex flex-col',
          'w-full border-l border-border bg-surface shadow-2xl',
          'md:w-[min(100%,500px)] md:min-w-[440px]',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-base font-bold text-foreground">آخر الفواتير</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              aria-label="تحديث القائمة"
              title="تحديث"
              disabled={isRefreshing}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-muted text-muted-foreground transition-colors hover:bg-surface-muted/80 hover:text-foreground disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-muted text-muted-foreground transition-colors hover:bg-surface-muted/80 hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4">
          <RecentInvoicesPanel
            enabled={open}
            refreshToken={refreshToken}
            onEditSale={(saleId) => {
              onEditSale?.(saleId);
              onClose();
            }}
            onDeleteSale={onDeleteSale}
            onRefresh={onRefresh}
          />
        </div>
      </aside>
    </div>
  );
}
