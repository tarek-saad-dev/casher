'use client';

import { useState } from 'react';
import { CalendarDays, Loader2, AlertTriangle, ArrowLeftRight, Clock, Users, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/useSession';
import { usePermission } from '@/hooks/usePermission';

interface OpenShiftInfo {
  ID: number;
  UserName: string;
  ShiftName: string;
  StartTime: string;
}

interface Props {
  open: boolean;
  openDayDate: string | null;
  todayDate: string | null;
  openShifts: OpenShiftInfo[];
  onDismiss: () => void;
  onResolved: () => void;
}

export default function DayRolloverModal({
  open,
  openDayDate,
  todayDate,
  openShifts,
  onDismiss,
  onResolved,
}: Props) {
  const { refresh } = useSession();
  const canClose = usePermission('day.close');
  const canOpen = usePermission('day.open');

  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [showShiftWarning, setShowShiftWarning] = useState(false);

  if (!open) return null;

  const formattedOldDate = openDayDate
    ? new Date(openDayDate + 'T00:00:00').toLocaleDateString('ar-EG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : '';
  const formattedToday = todayDate
    ? new Date(todayDate + 'T00:00:00').toLocaleDateString('ar-EG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : '';

  async function handleCloseAndOpen(forceCloseShifts: boolean) {
    setError('');
    setActionLoading(true);
    try {
      const res = await fetch('/api/day/close-and-open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceCloseShifts }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'OPEN_SHIFTS') {
          setShowShiftWarning(true);
          setError(data.error);
        } else {
          setError(data.error);
        }
        return;
      }
      await refresh();
      onResolved();
    } catch { setError('خطأ في الاتصال بالخادم'); }
    finally { setActionLoading(false); }
  }

  async function handleCloseOnly(forceCloseShifts: boolean) {
    setError('');
    setActionLoading(true);
    try {
      const res = await fetch('/api/day/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceCloseShifts }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'OPEN_SHIFTS') {
          setShowShiftWarning(true);
          setError(data.error);
        } else {
          setError(data.error);
        }
        return;
      }
      await refresh();
      onResolved();
    } catch { setError('خطأ في الاتصال بالخادم'); }
    finally { setActionLoading(false); }
  }

  // Non-admin view: informational banner only
  if (!canClose) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10">
              <ShieldAlert className="w-5 h-5 text-amber-500" />
            </div>
            <h2 className="text-lg font-bold">يوم العمل يحتاج إلى إغلاق</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            يوم العمل الحالي ({formattedOldDate}) قد تجاوز التاريخ الفعلي ({formattedToday}).
            <br />
            <strong>يرجى إبلاغ المسؤول لإغلاق اليوم وبدء يوم جديد.</strong>
          </p>
          <Button variant="outline" onClick={onDismiss} className="w-full">
            حسناً
          </Button>
        </div>
      </div>
    );
  }

  // Admin view: full action modal
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-border">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10">
            <CalendarDays className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold">يوم العمل السابق لا يزال مفتوحاً</h2>
            <p className="text-sm text-muted-foreground">يتطلب تدخلك</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Info */}
          <div className="rounded-lg bg-muted/30 p-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">اليوم المفتوح:</span>
              <span className="font-medium text-amber-500">{formattedOldDate}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">التاريخ الفعلي:</span>
              <span className="font-medium text-emerald-500">{formattedToday}</span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            يوجد يوم تشغيل مفتوح بتاريخ سابق. هل ترغب في إغلاق اليوم السابق؟
          </p>

          {/* Open shifts warning */}
          {(openShifts.length > 0 || showShiftWarning) && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-500">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-semibold text-sm">
                  يوجد {openShifts.length} وردية مفتوحة
                </span>
              </div>
              <div className="space-y-1">
                {openShifts.map((s) => (
                  <div key={s.ID} className="flex items-center gap-2 text-sm">
                    <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{s.UserName} — {s.ShiftName}</span>
                    <span className="text-xs text-muted-foreground">(من {s.StartTime?.trim()})</span>
                  </div>
                ))}
              </div>

              {showShiftWarning && (
                <div className="flex flex-col gap-2 pt-1">
                  <p className="text-xs text-muted-foreground">
                    يمكنك إغلاق الورديات تلقائياً للمتابعة:
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCloseAndOpen(true)}
                      disabled={actionLoading}
                      className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10 text-xs"
                    >
                      {actionLoading ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <Clock className="w-3.5 h-3.5 ml-1" />}
                      إغلاق الورديات + إغلاق وفتح يوم جديد
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCloseOnly(true)}
                      disabled={actionLoading}
                      className="text-xs"
                    >
                      إغلاق الورديات + إغلاق اليوم فقط
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && !showShiftWarning && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 p-5 pt-0">
          {canOpen && (
            <Button
              onClick={() => handleCloseAndOpen(false)}
              disabled={actionLoading}
              className="w-full"
            >
              {actionLoading ? (
                <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              ) : (
                <ArrowLeftRight className="w-4 h-4 ml-2" />
              )}
              إغلاق اليوم السابق وبدء يوم جديد
            </Button>
          )}

          <Button
            variant="secondary"
            onClick={() => handleCloseOnly(false)}
            disabled={actionLoading}
            className="w-full"
          >
            إغلاق اليوم السابق فقط
          </Button>

          <Button
            variant="ghost"
            onClick={onDismiss}
            disabled={actionLoading}
            className="w-full text-muted-foreground"
          >
            تأجيل
          </Button>
        </div>
      </div>
    </div>
  );
}
