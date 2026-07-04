'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BookingMoveSession } from '@/lib/bookingDragReschedule';
import type { PendingPasteSelection } from './useBookingCutPaste';
import { formatTimeRange } from './schedulerUtils';

interface Props {
  open: boolean;
  session: BookingMoveSession | null;
  pending: PendingPasteSelection | null;
  isCommitting: boolean;
  fallbackSlots: Array<{ startIso: string; endIso: string; empName: string; empId: number }>;
  onConfirm: () => void;
  onCancel: () => void;
  onSelectSlot: (empId: number, startIso: string, endIso: string, empName: string) => void;
}

export function BookingCutPasteConfirmSheet({
  open,
  session,
  pending,
  isCommitting,
  fallbackSlots,
  onConfirm,
  onCancel,
  onSelectSlot,
}: Props) {
  if (!open || !session) return null;

  const slot = pending?.slot;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/80 bg-card/98 p-4 shadow-2xl backdrop-blur-md md:hidden">
      <div className="mx-auto max-w-lg space-y-3">
        <div>
          <p className="text-sm font-bold text-foreground">تأكيد نقل الموعد</p>
          <p className="text-xs text-muted-foreground">{session.customerName}</p>
        </div>

        {slot ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <p>
              إلى{' '}
              <span className="font-semibold text-primary">
                {slot.empId === session.originalEmpId ? session.originalEmpName : slot.empName}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {formatTimeRange(slot.startIso, slot.endIso)} · {session.durationMinutes} دقيقة
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">اختر وقتًا من القائمة أو من الجدول</p>
        )}

        {fallbackSlots.length > 0 && (
          <div className="max-h-36 space-y-1 overflow-y-auto">
            <p className="text-[11px] text-muted-foreground">أوقات متاحة</p>
            {fallbackSlots.slice(0, 12).map((s) => (
              <button
                key={`${s.empId}-${s.startIso}`}
                type="button"
                className="flex w-full items-center justify-between rounded-md border border-border/60 px-2 py-1.5 text-xs hover:bg-surface-muted"
                onClick={() => onSelectSlot(s.empId, s.startIso, s.endIso, s.empName)}
              >
                <span>{s.empName}</span>
                <span className="text-primary">{formatTimeRange(s.startIso, s.endIso)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={isCommitting}
          >
            إلغاء
          </Button>
          <Button
            type="button"
            className="flex-1 gap-2"
            onClick={onConfirm}
            disabled={!slot || isCommitting}
          >
            {isCommitting && <Loader2 className="size-4 animate-spin" />}
            تأكيد النقل
          </Button>
        </div>
      </div>
    </div>
  );
}
