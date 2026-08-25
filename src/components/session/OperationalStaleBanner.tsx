'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/useSession';
import { useState } from 'react';

/**
 * Single top banner when bootstrap reports stale / reconciliation failure.
 * Financial writes remain blocked by the backend; this is UX only.
 */
export default function OperationalStaleBanner() {
  const { stale, reconciliationError, refresh, isAuthenticated, loading } = useSession();
  const [retrying, setRetrying] = useState(false);

  if (!isAuthenticated || loading || !stale) return null;

  async function handleRetry() {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      role="alert"
      className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm"
      dir="rtl"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">تعذر تجهيز يوم العمل الحالي</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              العمليات المالية متوقفة مؤقتًا لحماية بيانات اليوم.
              {reconciliationError ? null : null}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-amber-500/40"
          onClick={() => void handleRetry()}
          disabled={retrying}
        >
          {retrying ? <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin" /> : null}
          إعادة المحاولة
        </Button>
      </div>
    </div>
  );
}
