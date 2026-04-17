'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, Plus, X, Loader2, CheckCircle2, XCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/useSession';
import { usePermission } from '@/hooks/usePermission';

interface ShiftDef {
  ShiftID: number;
  ShiftName: string;
}

interface ShiftRow {
  ID: number;
  NewDay: string;
  UserID: number;
  ShiftID: number;
  StartTime: string;
  EndTime: string | null;
  Status: boolean;
  UserName: string;
  ShiftName: string;
  salesCount: number;
  totalRevenue: number;
}

interface ShiftSummaryData {
  shiftMoveID: number;
  userName: string;
  shiftName: string;
  startTime: string;
  salesCount: number;
  totalRevenue: number;
  paymentBreakdown: { method: string; cnt: number; total: number }[];
  cashIn: number;
  cashOut: number;
}

export default function ShiftControlPage() {
  const { shift, day, hasActiveDay, hasActiveShift, refresh, user } = useSession();
  const canOpen = usePermission('shift.open');
  const canClose = usePermission('shift.close');

  const [definitions, setDefinitions] = useState<ShiftDef[]>([]);
  const [history, setHistory] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [showOpenDialog, setShowOpenDialog] = useState(false);
  const [selectedShiftID, setSelectedShiftID] = useState<number | null>(null);
  const [summary, setSummary] = useState<ShiftSummaryData | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [defsRes, histRes] = await Promise.all([
        fetch('/api/shift/definitions'),
        fetch('/api/shift/history'),
      ]);
      const defs = await defsRes.json();
      const hist = await histRes.json();
      if (Array.isArray(defs)) setDefinitions(defs);
      if (Array.isArray(hist)) setHistory(hist);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleOpenShift() {
    if (!selectedShiftID) { setError('يجب اختيار الوردية'); return; }
    setError('');
    setActionLoading(true);
    try {
      const res = await fetch('/api/shift/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftID: selectedShiftID }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setShowOpenDialog(false);
      setSelectedShiftID(null);
      await refresh();
      await loadData();
    } catch { setError('خطأ في الاتصال بالخادم'); }
    finally { setActionLoading(false); }
  }

  async function handleRequestClose() {
    if (!shift) return;
    setError('');
    setActionLoading(true);
    try {
      const res = await fetch(`/api/shift/summary?id=${shift.ID}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error); setActionLoading(false); return; }
      setSummary(data);
      setShowSummary(true);
    } catch { setError('خطأ في تحميل ملخص الوردية'); }
    finally { setActionLoading(false); }
  }

  async function handleConfirmClose() {
    if (!shift) return;
    setError('');
    setActionLoading(true);
    try {
      const res = await fetch('/api/shift/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftMoveID: shift.ID }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setShowSummary(false);
      setSummary(null);
      await refresh();
      await loadData();
    } catch { setError('خطأ في إغلاق الوردية'); }
    finally { setActionLoading(false); }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Clock className="w-6 h-6" />
        إدارة الورديات
      </h1>

      {/* Current Shift Status */}
      <div className={`rounded-xl border p-5 ${hasActiveShift ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-muted/20'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {hasActiveShift ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            ) : (
              <XCircle className="w-6 h-6 text-muted-foreground" />
            )}
            <div>
              <h2 className="text-lg font-semibold">
                {hasActiveShift ? 'وردية مفتوحة' : 'لا يوجد وردية مفتوحة'}
              </h2>
              {hasActiveShift && shift && (
                <p className="text-sm text-muted-foreground">
                  {shift.ShiftName || `وردية #${shift.ShiftID}`} — {shift.UserName || user?.UserName}
                  <span className="mr-2">من {shift.StartTime?.trim()}</span>
                  <span className="mr-2 text-xs opacity-60">ID: {shift.ID}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {!hasActiveShift && hasActiveDay && canOpen && (
              <Button onClick={() => { setShowOpenDialog(true); setSelectedShiftID(definitions[0]?.ShiftID || null); }} disabled={actionLoading}>
                <Plus className="w-4 h-4 ml-2" />
                فتح وردية
              </Button>
            )}
            {!hasActiveDay && (
              <p className="text-sm text-muted-foreground">يجب فتح يوم عمل أولاً</p>
            )}
            {hasActiveShift && canClose && (
              <Button variant="destructive" onClick={handleRequestClose} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <X className="w-4 h-4 ml-2" />}
                إغلاق الوردية
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

      {/* Open Shift Dialog */}
      {showOpenDialog && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
          <h3 className="text-lg font-bold">اختر الوردية</h3>
          <div className="grid grid-cols-3 gap-3">
            {definitions.map((d) => (
              <button
                key={d.ShiftID}
                onClick={() => setSelectedShiftID(d.ShiftID)}
                className={`rounded-lg border p-3 text-center text-sm transition-colors ${
                  selectedShiftID === d.ShiftID
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                {d.ShiftName}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={handleOpenShift} disabled={actionLoading || !selectedShiftID}>
              {actionLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Plus className="w-4 h-4 ml-2" />}
              فتح الوردية
            </Button>
            <Button variant="outline" onClick={() => setShowOpenDialog(false)}>إلغاء</Button>
          </div>
        </div>
      )}

      {/* Close Shift Summary */}
      {showSummary && summary && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
          <h3 className="text-lg font-bold">ملخص الوردية قبل الإغلاق</h3>
          <p className="text-sm text-muted-foreground">
            {summary.shiftName} — {summary.userName} — من {summary.startTime?.trim()}
          </p>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-2xl font-bold">{summary.salesCount}</p>
              <p className="text-xs text-muted-foreground">فواتير</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-2xl font-bold">{summary.totalRevenue.toLocaleString('ar-EG')}</p>
              <p className="text-xs text-muted-foreground">إيرادات</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-2xl font-bold text-emerald-500">{summary.cashIn.toLocaleString('ar-EG')}</p>
              <p className="text-xs text-muted-foreground">وارد</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-2xl font-bold text-destructive">{summary.cashOut.toLocaleString('ar-EG')}</p>
              <p className="text-xs text-muted-foreground">صادر</p>
            </div>
          </div>

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

          <div className="flex gap-2 pt-2">
            <Button variant="destructive" onClick={handleConfirmClose} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}
              تأكيد إغلاق الوردية
            </Button>
            <Button variant="outline" onClick={() => setShowSummary(false)}>إلغاء</Button>
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="text-lg font-semibold mb-3">سجل الورديات</h3>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground">
                  <th className="p-3 text-right">ID</th>
                  <th className="p-3 text-right">التاريخ</th>
                  <th className="p-3 text-right">المستخدم</th>
                  <th className="p-3 text-right">الوردية</th>
                  <th className="p-3 text-right">البداية</th>
                  <th className="p-3 text-right">النهاية</th>
                  <th className="p-3 text-center">الحالة</th>
                  <th className="p-3 text-center">الفواتير</th>
                  <th className="p-3 text-left">الإيرادات</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.ID} className="border-t border-border hover:bg-muted/20">
                    <td className="p-3 font-mono text-xs">{s.ID}</td>
                    <td className="p-3 text-xs">{new Date(s.NewDay).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })}</td>
                    <td className="p-3">{s.UserName}</td>
                    <td className="p-3">{s.ShiftName}</td>
                    <td className="p-3 text-xs font-mono" dir="ltr">{s.StartTime?.trim()}</td>
                    <td className="p-3 text-xs font-mono" dir="ltr">{s.EndTime?.trim() || '—'}</td>
                    <td className="p-3 text-center">
                      {s.Status ? (
                        <span className="inline-flex items-center gap-1 text-emerald-500 text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> مفتوح
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                          <XCircle className="w-3.5 h-3.5" /> مغلق
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-center">{s.salesCount}</td>
                    <td className="p-3 text-left font-medium">{s.totalRevenue.toLocaleString('ar-EG')}</td>
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
