'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Loader2, AlertTriangle, CheckCircle2, Clock, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/useSession';

interface ShiftRow {
  ID: number;
  UserName: string;
  ShiftName: string;
  StartTime: string;
  EndTime: string | null;
  Status: boolean;
  salesCount: number;
  totalRevenue: number;
}

interface PaymentRow {
  method: string;
  cnt: number;
  total: number;
}

interface DaySummaryData {
  dayID: number;
  date: string;
  status: boolean;
  shiftsCount: number;
  shifts: ShiftRow[];
  salesCount: number;
  totalRevenue: number;
  paymentBreakdown: PaymentRow[];
}

interface OpenShiftInfo {
  ID: number;
  UserName: string;
  ShiftName: string;
  StartTime: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onClosed: () => void;
}

export default function CloseDayModal({ open, onClose, onClosed }: Props) {
  const { day, refresh } = useSession();

  const [summary, setSummary] = useState<DaySummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [openShiftsWarning, setOpenShiftsWarning] = useState<OpenShiftInfo[]>([]);

  // Load summary when modal opens
  const loadSummary = useCallback(async () => {
    if (!day) return;
    setLoading(true);
    setError('');
    setOpenShiftsWarning([]);
    try {
      const res = await fetch(`/api/day/summary?id=${day.ID}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setSummary(data);
    } catch { setError('خطأ في تحميل ملخص اليوم'); }
    finally { setLoading(false); }
  }, [day]);

  useEffect(() => {
    if (open && day) {
      loadSummary();
    }
  }, [open, day, loadSummary]);

  // Close day (without force)
  async function handleClose(forceCloseShifts: boolean) {
    setError('');
    setOpenShiftsWarning([]);
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
          setOpenShiftsWarning(data.openShifts || []);
          setError(data.error);
        } else {
          setError(data.error);
        }
        return;
      }
      await refresh();
      onClosed();
    } catch { setError('خطأ في إغلاق اليوم'); }
    finally { setActionLoading(false); }
  }

  if (!open) return null;

  const dayDate = day ? new Date(day.NewDay).toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }) : '';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-border">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10">
            <CalendarDays className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold">ملخص اليوم قبل الإغلاق</h2>
            <p className="text-sm text-muted-foreground">{dayDate}</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Summary Stats */}
          {summary && !loading && (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-2xl font-bold">{summary.salesCount}</p>
                  <p className="text-xs text-muted-foreground">عدد الفواتير</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-2xl font-bold">{summary.totalRevenue.toLocaleString('ar-EG')}</p>
                  <p className="text-xs text-muted-foreground">إجمالي الإيرادات</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-2xl font-bold">{summary.shiftsCount}</p>
                  <p className="text-xs text-muted-foreground">عدد الورديات</p>
                </div>
              </div>

              {/* Payment breakdown */}
              {summary.paymentBreakdown.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">تفصيل طرق الدفع</h4>
                  <div className="space-y-1">
                    {summary.paymentBreakdown.map((p, i) => (
                      <div key={i} className="flex justify-between text-sm bg-muted/30 rounded px-3 py-1.5">
                        <span>{p.method}</span>
                        <span className="font-medium">{p.total.toLocaleString('ar-EG')} ({p.cnt})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Shifts list */}
              {summary.shifts.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">ورديات اليوم</h4>
                  <div className="space-y-1">
                    {summary.shifts.map((s) => (
                      <div key={s.ID} className="flex items-center justify-between text-sm bg-muted/30 rounded px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          {s.Status ? (
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                          )}
                          <span>{s.UserName} — {s.ShiftName}</span>
                        </div>
                        <span className="font-medium">
                          {s.totalRevenue.toLocaleString('ar-EG')} ({s.salesCount})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Open Shifts Warning */}
          {openShiftsWarning.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-500">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h4 className="font-semibold text-sm">يوجد {openShiftsWarning.length} وردية مفتوحة</h4>
              </div>
              <div className="space-y-1">
                {openShiftsWarning.map((s) => (
                  <div key={s.ID} className="flex items-center gap-2 text-sm">
                    <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{s.UserName} — {s.ShiftName}</span>
                    <span className="text-xs text-muted-foreground">(من {s.StartTime?.trim()})</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                يمكنك إغلاق الورديات تلقائياً أو إغلاقها يدوياً أولاً.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleClose(true)}
                disabled={actionLoading}
                className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Clock className="w-4 h-4 ml-2" />}
                إغلاق الورديات المفتوحة وإغلاق اليوم
              </Button>
            </div>
          )}

          {/* Error (non-shift) */}
          {error && openShiftsWarning.length === 0 && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex gap-2 p-5 pt-0">
          <Button
            variant="destructive"
            onClick={() => handleClose(false)}
            disabled={actionLoading || loading}
            className="flex-1"
          >
            {actionLoading ? (
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4 ml-2" />
            )}
            تأكيد إغلاق اليوم
          </Button>
          <Button variant="outline" onClick={onClose} disabled={actionLoading}>
            إلغاء
          </Button>
        </div>
      </div>
    </div>
  );
}
