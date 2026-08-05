'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DAILY_ADJUSTMENT_TYPE_AR,
  formatHhmmPreview,
} from '@/lib/availability/workforceUiLabels';
import type { DailyAdjustmentType } from '@/lib/availability/dailyAdjustments';

export type HistoryAdjustment = {
  adjustmentId: number;
  adjustmentType: DailyAdjustmentType;
  reasonCode: string | null;
  reasonText: string | null;
  source: string;
  windows: Array<{ start: string; end: string; endDayOffset: 0 | 1 }>;
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: string;
  version: number;
  isActive?: boolean;
  cancelledBy?: number | null;
  cancelledByName?: string | null;
  cancelledAt?: string | null;
};

export function DailyAdjustmentHistory({
  adjustments,
  cancellingId,
  onRequestCancel,
  emptyLabel = 'لا توجد تعديلات يومية نشطة.',
  showCancel = true,
}: {
  adjustments: HistoryAdjustment[];
  cancellingId: number | null;
  onRequestCancel?: (adjustmentId: number) => void;
  emptyLabel?: string;
  showCancel?: boolean;
}) {
  if (!adjustments.length) {
    return (
      <p className="text-sm text-zinc-500" role="status">
        {emptyLabel}
      </p>
    );
  }

  const sorted = [...adjustments].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    if (ta !== tb) return ta - tb;
    return a.adjustmentId - b.adjustmentId;
  });

  return (
    <ul className="space-y-3" aria-label="قائمة التعديلات اليومية">
      {sorted.map((adj) => {
        const cancelled = adj.isActive === false || !!adj.cancelledAt;
        return (
          <li
            key={adj.adjustmentId}
            className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 p-3 space-y-2"
          >
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex flex-wrap gap-1.5 items-center">
                <Badge variant="outline">
                  {DAILY_ADJUSTMENT_TYPE_AR[adj.adjustmentType] ?? adj.adjustmentType}
                </Badge>
                {cancelled && (
                  <Badge
                    variant="secondary"
                    className="bg-zinc-700 text-zinc-200"
                    aria-label="ملغي"
                  >
                    ملغي
                  </Badge>
                )}
              </div>
              <span className="text-[11px] text-zinc-500 font-mono">v{adj.version}</span>
            </div>
            {(adj.reasonText || adj.reasonCode) && (
              <p className="text-xs text-zinc-300">{adj.reasonText || adj.reasonCode}</p>
            )}
            {adj.windows.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {adj.windows.map((w, i) => (
                  <span
                    key={i}
                    className="text-[11px] rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-200"
                  >
                    {formatHhmmPreview(w.start, w.end, w.endDayOffset)}
                  </span>
                ))}
              </div>
            )}
            <div className="text-[11px] text-zinc-500 flex flex-wrap gap-x-3 gap-y-1">
              <span>المصدر: {adj.source}</span>
              <span>
                بواسطة: {adj.createdByName ?? adj.createdBy ?? '—'}
              </span>
              <span>{adj.createdAt}</span>
            </div>
            {cancelled && (
              <div className="text-[11px] text-zinc-500 flex flex-wrap gap-x-3">
                <span>ألغاه: {adj.cancelledByName ?? adj.cancelledBy ?? '—'}</span>
                {adj.cancelledAt && <span>{adj.cancelledAt}</span>}
              </div>
            )}
            {showCancel && !cancelled && onRequestCancel && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={cancellingId === adj.adjustmentId}
                aria-describedby="cancel-adj-help"
                onClick={() => onRequestCancel(adj.adjustmentId)}
              >
                {cancellingId === adj.adjustmentId ? 'جاري الإلغاء…' : 'إلغاء تعديل'}
              </Button>
            )}
          </li>
        );
      })}
      <span id="cancel-adj-help" className="sr-only">
        سيتم إعادة حساب توافر الموظف فورًا بعد الإلغاء.
      </span>
    </ul>
  );
}
