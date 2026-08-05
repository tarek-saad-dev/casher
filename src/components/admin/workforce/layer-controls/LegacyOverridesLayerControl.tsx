'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const LEGACY_TYPE_AR: Record<string, string> = {
  day_off: 'إجازة يوم',
  custom_hours: 'ساعات مخصصة',
  late_start: 'بداية متأخرة',
  early_leave: 'انصراف مبكر',
  block_range: 'حظر فترة',
};

type OverrideRow = {
  OverrideID?: number;
  overrideId?: number;
  Type?: string;
  type?: string;
  StartTime?: string | null;
  startTime?: string | null;
  EndTime?: string | null;
  endTime?: string | null;
  Reason?: string | null;
  reason?: string | null;
};

export function LegacyOverridesLayerControl({
  overrides,
  onOpenDaily,
  onSaved,
}: {
  overrides: OverrideRow[];
  onOpenDaily: (type: 'REPLACE_WINDOWS' | 'ADD_WINDOW' | 'CLOSE_DAY' | 'BLOCK_WINDOW') => void;
  onSaved: () => void;
}) {
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const rows = overrides.map((o) => ({
    id: Number(o.OverrideID ?? o.overrideId ?? 0),
    type: String(o.Type ?? o.type ?? ''),
    start: o.StartTime ?? o.startTime ?? null,
    end: o.EndTime ?? o.endTime ?? null,
    reason: o.Reason ?? o.reason ?? null,
  }));

  const cancel = async (id: number) => {
    if (!id) return;
    setCancellingId(id);
    setError(null);
    setHint(null);
    try {
      const res = await fetch(`/api/operations/schedule-control/override/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'فشل إلغاء التجاوز');
        return;
      }
      setHint('تم إلغاء التجاوز القديميم');
      onSaved();
    } catch {
      setError('تعذر الاتصال');
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-3" dir="rtl">
      <p className="text-xs text-zinc-400">
        التجاوزات القديمة ما زالت تُحسب. الأفضل للتحكم الجديد: التعديلات اليومية.
      </p>

      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" onClick={() => onOpenDaily('REPLACE_WINDOWS')}>
          استبدال مواعيد (يومي)
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onOpenDaily('ADD_WINDOW')}>
          إضافة فترة
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onOpenDaily('CLOSE_DAY')}>
          إغلاق اليوم
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-zinc-500">لا توجد تجاوزات قديمة نشطة لهذا اليوم.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id || `${r.type}-${r.start}`}
              className="rounded border border-zinc-800 bg-zinc-950/50 px-2.5 py-2 text-[11px]"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-zinc-200 font-medium">
                    {LEGACY_TYPE_AR[r.type] ?? r.type}
                  </p>
                  <p className="text-zinc-500 font-mono">
                    {r.start || '—'}
                    {r.end ? ` → ${r.end}` : ''}
                  </p>
                  {r.reason && <p className="text-zinc-500 mt-0.5">{r.reason}</p>}
                </div>
                {r.id > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px]"
                    disabled={cancellingId === r.id}
                    onClick={() => void cancel(r.id)}
                  >
                    {cancellingId === r.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      'إلغاء'
                    )}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {hint && <p className="text-[11px] text-emerald-200">{hint}</p>}
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}
