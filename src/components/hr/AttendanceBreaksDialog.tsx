'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { sqlTimeForInput } from '@/lib/timeUtils';
import {
  type AttendanceBreakInterval,
  breakIntervalMinutes,
  computeNetWorkedHours,
  formatBreakMinutesLabel,
  sumBreakMinutes,
} from '@/lib/hr/attendance-breaks';

export type AttendanceBreakDialogMode = 'interrupt' | 'rest';

interface AttendanceBreaksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empName: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  breaks: AttendanceBreakInterval[];
  onChange: (breaks: AttendanceBreakInterval[]) => void;
  /** interrupt = وقت مستقطع (deducts hours). rest = وقت البريك (no deduction). */
  mode?: AttendanceBreakDialogMode;
}

const COPY: Record<
  AttendanceBreakDialogMode,
  {
    title: string;
    description: string;
    empty: string;
    add: string;
    total: string;
    doneTestId: string;
    addTestId: string;
  }
> = {
  interrupt: {
    title: 'وقت مستقطع',
    description:
      'سجّل فترات الخروج والرجوع أثناء الوردية. تُخصم من إجمالي ساعات العمل، وتظهر تلقائياً كـ «غير متاح لفترة» في إدارة مواعيد اليوم.',
    empty: 'لا توجد فترات مستقطعة',
    add: 'إضافة فترة مستقطعة',
    total: 'إجمالي المستقطع',
    doneTestId: 'break-dialog-done',
    addTestId: 'break-add-row',
  },
  rest: {
    title: 'وقت البريك',
    description:
      'سجّل فترات البريك أثناء الوردية. لا تُخصم من ساعات العمل، وتظهر تلقائياً كـ «غير متاح لفترة» في إدارة مواعيد اليوم (ممنوع الحجز فيها).',
    empty: 'لا توجد فترات بريك',
    add: 'إضافة فترة بريك',
    total: 'إجمالي البريك',
    doneTestId: 'break-time-dialog-done',
    addTestId: 'break-time-add-row',
  },
};

export default function AttendanceBreaksDialog({
  open,
  onOpenChange,
  empName,
  checkInTime,
  checkOutTime,
  breaks,
  onChange,
  mode = 'interrupt',
}: AttendanceBreaksDialogProps) {
  const copy = COPY[mode];
  const totalMins = sumBreakMinutes(breaks);
  const netHours =
    mode === 'interrupt'
      ? computeNetWorkedHours(checkInTime, checkOutTime, breaks)
      : null;

  const updateAt = (index: number, field: 'LeaveAt' | 'ReturnAt', value: string) => {
    const next = breaks.map((b, i) => {
      if (i !== index) return b;
      const updated = { ...b, [field]: value || null };
      updated.Minutes = breakIntervalMinutes(updated.LeaveAt, updated.ReturnAt);
      return updated;
    });
    onChange(next);
  };

  const addRow = () => {
    onChange([...breaks, { LeaveAt: '', ReturnAt: null, Minutes: 0, Notes: null }]);
  };

  const removeAt = (index: number) => {
    onChange(breaks.filter((_, i) => i !== index));
  };

  const accent = mode === 'interrupt' ? 'text-amber-400' : 'text-teal-400';
  const doneBtn =
    mode === 'interrupt'
      ? 'bg-amber-600 hover:bg-amber-700 text-black'
      : 'bg-teal-600 hover:bg-teal-700 text-white';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>
            {copy.title} — {empName}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-zinc-500">{copy.description}</p>

        <div className="space-y-3 max-h-72 overflow-y-auto">
          {breaks.length === 0 && (
            <p className="text-center text-zinc-500 text-sm py-4">{copy.empty}</p>
          )}
          {breaks.map((b, index) => {
            const mins = breakIntervalMinutes(b.LeaveAt, b.ReturnAt);
            return (
              <div
                key={b.ID ?? `new-${index}`}
                className="flex items-end gap-2 p-2 rounded-lg border border-zinc-800 bg-zinc-950/40"
                data-testid={`${mode}-break-row-${index}`}
              >
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] text-zinc-500">خروج</label>
                  <Input
                    type="time"
                    value={sqlTimeForInput(b.LeaveAt)}
                    onChange={(e) => updateAt(index, 'LeaveAt', e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white h-9 text-xs"
                    data-testid={`${mode}-break-leave-${index}`}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] text-zinc-500">رجوع</label>
                  <Input
                    type="time"
                    value={sqlTimeForInput(b.ReturnAt)}
                    onChange={(e) => updateAt(index, 'ReturnAt', e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white h-9 text-xs"
                    data-testid={`${mode}-break-return-${index}`}
                  />
                </div>
                <div className="w-14 text-center pb-2">
                  <span className={`text-[11px] ${accent}`}>
                    {mins > 0 ? formatBreakMinutesLabel(mins) : '—'}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeAt(index)}
                  className="h-9 w-9 p-0 text-rose-400 hover:bg-rose-500/20"
                  title="حذف"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={addRow}
          className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 gap-1"
          data-testid={copy.addTestId}
        >
          <Plus className="w-4 h-4" />
          {copy.add}
        </Button>

        <div className="flex items-center justify-between text-xs border-t border-zinc-800 pt-3">
          <span className="text-zinc-500">
            {copy.total}:{' '}
            <span className={`font-medium ${accent}`}>{formatBreakMinutesLabel(totalMins)}</span>
          </span>
          {mode === 'interrupt' ? (
            <span className="text-zinc-500">
              صافي الساعات:{' '}
              <span className="text-sky-400 font-medium">
                {netHours != null ? `${netHours.toFixed(2)} س` : '—'}
              </span>
            </span>
          ) : (
            <span className="text-zinc-500">يمنع الحجز · لا يُخصم من الساعات</span>
          )}
        </div>

        <Button
          type="button"
          onClick={() => onOpenChange(false)}
          className={`w-full font-semibold ${doneBtn}`}
          data-testid={copy.doneTestId}
        >
          تم
        </Button>
      </DialogContent>
    </Dialog>
  );
}
