'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TimeWindowEditor } from '@/components/admin/workforce/TimeWindowEditor';
import type { DailyAdjustmentType } from '@/lib/availability/dailyAdjustments';
import { DAILY_ADJUSTMENT_TYPE_AR } from '@/lib/availability/workforceUiLabels';
import {
  type WindowDraft,
  validateWindowDrafts,
} from '@/lib/availability/timeWindowEditorUtils';

const TYPE_HELP: Record<DailyAdjustmentType, string> = {
  CLOSE_DAY: 'سيتم إغلاق يوم الموظف بالكامل ومنع الحجوزات والطابور.',
  REPLACE_WINDOWS: 'ستستبدل هذه الفترات مواعيد العمل الأساسية لهذا اليوم.',
  ADD_WINDOW: 'سيتم إضافة هذه الفترات إلى ساعات العمل الحالية.',
  BLOCK_WINDOW: 'سيتم منع الحجوزات والطابور داخل هذه الفترة فقط.',
};

export function DailyAdjustmentModal({
  open,
  onClose,
  employeeName,
  businessDate,
  adjustmentType,
  saving,
  error,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  employeeName: string;
  businessDate: string;
  adjustmentType: DailyAdjustmentType;
  saving: boolean;
  error: string | null;
  onSubmit: (payload: {
    adjustmentType: DailyAdjustmentType;
    reasonText: string;
    reasonCode: string;
    windows?: WindowDraft[];
  }) => void | Promise<void>;
}) {
  const needsWindows = adjustmentType !== 'CLOSE_DAY';
  const [reasonText, setReasonText] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [windows, setWindows] = useState<WindowDraft[]>([
    { start: '10:00', end: '18:00', endDayOffset: 0 },
  ]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [overlapWarning, setOverlapWarning] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReasonText('');
    setReasonCode('');
    setLocalError(null);
    setOverlapWarning(false);
    setWindows([{ start: '10:00', end: '18:00', endDayOffset: 0 }]);
  }, [open, adjustmentType]);

  const isDirty =
    reasonText.trim() !== '' ||
    reasonCode.trim() !== '' ||
    (needsWindows &&
      (windows.length !== 1 ||
        windows[0]?.start !== '10:00' ||
        windows[0]?.end !== '18:00' ||
        windows[0]?.endDayOffset !== 0));

  const handleClose = () => {
    if (saving) return;
    if (isDirty && !window.confirm('هناك تغييرات غير محفوظة. هل تريد الإغلاق؟')) {
      return;
    }
    onClose();
  };

  const handleSubmit = async () => {
    if (saving) return;
    setLocalError(null);
    const validated = validateWindowDrafts(needsWindows ? windows : [], {
      required: needsWindows,
      forbidden: !needsWindows,
    });
    if (!validated.ok) {
      setLocalError(validated.message);
      return;
    }
    setOverlapWarning(validated.overlapWarning);
    await onSubmit({
      adjustmentType,
      reasonText: reasonText.trim(),
      reasonCode: reasonCode.trim(),
      windows: needsWindows ? validated.windows : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{DAILY_ADJUSTMENT_TYPE_AR[adjustmentType]}</DialogTitle>
          <DialogDescription>{TYPE_HELP[adjustmentType]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <Label>الموظف</Label>
            <p className="mt-1 text-zinc-200">{employeeName}</p>
          </div>
          <div>
            <Label>تاريخ العمل</Label>
            <p className="mt-1 text-zinc-200 font-mono">{businessDate}</p>
          </div>
          <div>
            <Label htmlFor="adj-reason-text">السبب</Label>
            <Textarea
              id="adj-reason-text"
              value={reasonText}
              disabled={saving}
              onChange={(e) => setReasonText(e.target.value)}
              rows={2}
              placeholder="اختياري"
            />
          </div>
          <div>
            <Label htmlFor="adj-reason-code">رمز السبب (اختياري)</Label>
            <Input
              id="adj-reason-code"
              value={reasonCode}
              disabled={saving}
              onChange={(e) => setReasonCode(e.target.value)}
              placeholder="مثلاً: ops_close"
            />
          </div>
          {needsWindows && (
            <TimeWindowEditor windows={windows} onChange={setWindows} disabled={saving} />
          )}
          {overlapWarning && (
            <p className="text-xs text-amber-300" role="status">
              تنبيه: توجد نوافذ متداخلة — سيتم تطبيعها على الخادم.
            </p>
          )}
          {(localError || error) && (
            <p className="text-sm text-rose-300" role="alert">
              {localError || error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" disabled={saving} onClick={handleClose}>
            إلغاء
          </Button>
          <Button type="button" disabled={saving} onClick={() => void handleSubmit()}>
            {saving ? 'جاري الحفظ…' : 'تأكيد'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
