'use client';

import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, Plus, X, Loader2, CheckCircle2, XCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/useSession';
import { usePermission } from '@/hooks/usePermission';

interface DayRow {
  ID: number;
  NewDay: string;
  Status: boolean;
  shiftsCount: number;
  salesCount: number;
  totalRevenue: number;
}

interface DaySummary {
  dayID: number;
  date: string;
  status: boolean;
  shiftsCount: number;
  shifts: { ID: number; UserName: string; ShiftName: string; StartTime: string; EndTime: string | null; Status: boolean; salesCount: number; totalRevenue: number }[];
  salesCount: number;
  totalRevenue: number;
  paymentBreakdown: { method: string; cnt: number; total: number }[];
}

export default function DayControlPage() {
  const { day, refresh } = useSession();
  const canOpen = usePermission('day.open');
  const canClose = usePermission('day.close');

  const [history, setHistory] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/day/history');
      const data = await res.json();
      if (Array.isArray(data)) setHistory(data);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function handleOpenDay() {
    setError('');
    setActionLoading(true);
    try {
      const res = await fetch('/api/day/open', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      await refresh();
      await loadHistory();
    } catch { setError('خطأ في الاتصال بالخادم'); }
    finally { setActionLoading(false); }
  }

  async function handleRequestClose() {
    if (!day) return;
    setError('');
    setActionLoading(true);
    try {
      const res = await fetch(`/api/day/summary?id=${day.ID}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error); setActionLoading(false); return; }
      setSummary(data);
      setShowSummary(true);
    } catch { setError('خطأ في تحميل ملخص اليوم'); }
    finally { setActionLoading(false); }
  }

  async function handleConfirmClose() {
    setError('');
    setActionLoading(true);
    try {
      const res = await fetch('/api/day/close', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setShowSummary(false);
      setSummary(null);
      await refresh();
      await loadHistory();
    } catch { setError('خطأ في إغلاق اليوم'); }
    finally { setActionLoading(false); }
  }

  const hasActiveDay = day && day.Status === true;

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <CalendarDays className="w-6 h-6" />
        إدارة يوم العمل
      </h1>

      {/* Current Day Status */}
      <div className={`rounded-xl border p-5 ${hasActiveDay ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-muted/20'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {hasActiveDay ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            ) : (
              <XCircle className="w-6 h-6 text-muted-foreground" />
            )}
            <div>
              <h2 className="text-lg font-semibold">
                {hasActiveDay ? 'يوم العمل مفتوح' : 'لا يوجد يوم عمل مفتوح'}
              </h2>
              {hasActiveDay && day && (
                <p className="text-sm text-muted-foreground">
                  {new Date(day.NewDay).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  <span className="mr-2 text-xs opacity-60">ID: {day.ID}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {!hasActiveDay && canOpen && (
              <Button onClick={handleOpenDay} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Plus className="w-4 h-4 ml-2" />}
                فتح يوم جديد
              </Button>
            )}
            {hasActiveDay && canClose && (
              <Button variant="destructive" onClick={handleRequestClose} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <X className="w-4 h-4 ml-2" />}
                إغلاق اليوم
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Close Day Summary Modal */}
      {showSummary && summary && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
          <h3 className="text-lg font-bold">ملخص اليوم قبل الإغلاق</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
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

          {/* Shifts */}
          {summary.shifts.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">ورديات اليوم</h4>
              <div className="space-y-1">
                {summary.shifts.map((s) => (
                  <div key={s.ID} className="flex justify-between text-sm bg-muted/30 rounded px-3 py-1.5">
                    <span>{s.UserName} — {s.ShiftName}</span>
                    <span className="font-medium">
                      {s.totalRevenue.toLocaleString('ar-EG')} ({s.salesCount} فاتورة)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="destructive" onClick={handleConfirmClose} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}
              تأكيد إغلاق اليوم
            </Button>
            <Button variant="outline" onClick={() => setShowSummary(false)}>إلغاء</Button>
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="text-lg font-semibold mb-3">سجل الأيام</h3>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground">
                  <th className="p-3 text-right">ID</th>
                  <th className="p-3 text-right">التاريخ</th>
                  <th className="p-3 text-center">الحالة</th>
                  <th className="p-3 text-center">الورديات</th>
                  <th className="p-3 text-center">الفواتير</th>
                  <th className="p-3 text-left">الإيرادات</th>
                </tr>
              </thead>
              <tbody>
                {history.map((d) => (
                  <tr key={d.ID} className="border-t border-border hover:bg-muted/20">
                    <td className="p-3 font-mono text-xs">{d.ID}</td>
                    <td className="p-3">
                      {new Date(d.NewDay).toLocaleDateString('ar-EG', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="p-3 text-center">
                      {d.Status ? (
                        <span className="inline-flex items-center gap-1 text-emerald-500 text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> مفتوح
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                          <XCircle className="w-3.5 h-3.5" /> مغلق
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-center">{d.shiftsCount}</td>
                    <td className="p-3 text-center">{d.salesCount}</td>
                    <td className="p-3 text-left font-medium">{d.totalRevenue.toLocaleString('ar-EG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
