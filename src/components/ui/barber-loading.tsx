'use client';

import { Loader2 } from 'lucide-react';
import { usePrintBrand } from '@/lib/tenant/tenantBrandClient';

/**
 * Route-level loading state. Renders INSIDE the work area (the app shell stays
 * visible) with calm, non-cinematic feedback (ADR-025: no theatre on loading).
 */
export default function BarberLoading() {
  const brand = usePrintBrand();

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-center"
    >
      <Loader2 className="size-7 animate-spin text-primary" aria-hidden />
      <div className="space-y-0.5">
        {brand.name ? <p className="text-sm font-bold text-foreground">{brand.name}</p> : null}
        <p className="text-xs text-muted-foreground">جاري التحميل…</p>
      </div>
    </div>
  );
}
