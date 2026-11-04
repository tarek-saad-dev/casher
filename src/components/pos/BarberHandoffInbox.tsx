'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2, X } from 'lucide-react';

export type BarberHandoffInboxItem = {
  handoffId: number;
  bookingId: number;
  empId: number;
  empName: string;
  clientId: number | null;
  clientName: string;
  serviceCount: number;
  startTime: string;
  updatedAt: string;
  lockedByOther: boolean;
};

type Props = {
  enabled: boolean;
  onClaim: (handoffId: number) => Promise<void> | void;
  claimingId: number | null;
};

function minutesAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'الآن';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hrs = Math.floor(mins / 60);
  return `منذ ${hrs} س`;
}

/**
 * Optional non-blocking inbox. Hidden when empty so manual POS stays primary.
 */
export default function BarberHandoffInbox({ enabled, onClaim, claimingId }: Props) {
  const [items, setItems] = useState<BarberHandoffInboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      return;
    }
    try {
      const res = await fetch('/api/pos/barber-handoffs', { cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { items?: BarberHandoffInboxItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
      setError('');
    } catch {
      setError('تعذر تحديث وارد الحلاقين');
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const id = window.setInterval(() => void refresh(), 12_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, refresh]);

  if (!enabled || items.length === 0) {
    return null;
  }

  return (
    <div className="relative" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-500/15 dark:text-amber-100"
      >
        <Bell className="h-4 w-4" />
        وارد الحلاقين ({items.length})
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-40 mt-2 w-[min(100vw-2rem,22rem)] rounded-2xl border border-border bg-card p-3 shadow-xl sm:left-auto sm:right-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-bold">طلبات جاهزة للتحصيل</p>
            <button
              type="button"
              aria-label="إغلاق"
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            اختياري — تقدر تتجاهل الوارد وتحاسب يدوي في أي وقت
          </p>
          {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {items.map((item) => {
              const busy = claimingId === item.handoffId;
              return (
                <li key={item.handoffId}>
                  <button
                    type="button"
                    disabled={busy || item.lockedByOther}
                    onClick={async () => {
                      await onClaim(item.handoffId);
                      setOpen(false);
                      void refresh();
                    }}
                    className="flex w-full flex-col gap-1 rounded-xl border border-border/70 bg-background px-3 py-2 text-right transition hover:border-amber-500/40 disabled:opacity-60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-bold">{item.clientName}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground" dir="ltr">
                        {item.startTime || '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {item.empName} · {item.serviceCount} خدمة
                      </span>
                      <span>{minutesAgo(item.updatedAt)}</span>
                    </div>
                    {item.lockedByOther ? (
                      <span className="text-[11px] text-amber-700 dark:text-amber-300">مفتوح على جهاز آخر</span>
                    ) : null}
                    {busy ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> جاري التحميل…
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
