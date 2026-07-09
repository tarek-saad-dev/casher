'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  CalendarDays, Loader2, Zap, Send, RefreshCw,
  CheckCircle2, AlertCircle, Users, Banknote,
  CheckCheck, Clock4, X, TrendingDown, TrendingUp,
  AlertTriangle, ShieldCheck, ClipboardList, Timer, BookOpen,
} from 'lucide-react';
import Link from 'next/link';
import KpiCard from '@/components/shared/KpiCard';
import { formatTime12h, getBusinessDateStr } from '@/lib/timeUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface PayrollRow {
  ID: number;
  EmpID: number;
  EmpName: string;
  HourlyRateSnapshot: number | null;
  WorkDate: string;
  ActualHours: number | null;
  AttendanceStatus: string | null;
  DailyWage: number;
  Status: string;
  CashMoveID: number | null;
  EmployeeIncomeCashMoveID: number | null;
  Notes: string | null;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  LateMinutes: number | null;
  RevenueExpINID: number | null;
  RevenueCatName: string | null;
  needsIncomeRepair: boolean;
}

interface Summary {
  total: number;
  totalWage: number;
  totalHours: number;
  postedCount: number;
  generatedCount: number;
  earnedCount: number;
  repairCount: number;
  totalExpenseAmount: number;
  totalEmployeeIncomeAmount: number;
}

interface MissingEmp { EmpID: number; EmpName: string; }

interface ValidationMissing {
  empId:   number;
  empName: string;
  reason:  'no_attendance' | 'missing_checkout' | 'missing_checkin' | 'no_hourly_rate';
}

const REASON_LABEL: Record<ValidationMissing['reason'], string> = {
  no_attendance:   'لم يسجل حضور',
  missing_checkout:'لم يسجل انصراف',
  missing_checkin: 'لم يسجل حضور (check-in)',
  no_hourly_rate:  'سعر الساعة غير محدد',
};

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// Uses getBusinessDateStr from timeUtils — day ends at 5 AM

function attendanceBadge(status: string | null) {
  if (!status) return <span className="text-zinc-600 text-xs">—</span>;
  const map: Record<string, string> = {
    Present: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    Late:    'bg-amber-500/15 text-amber-400 border-amber-500/30',
    Absent:  'bg-rose-500/15 text-rose-400 border-rose-500/30',
    DayOff:  'bg-blue-500/15 text-blue-400 border-blue-500/30',
    Excused: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    Pending: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    EarlyLeave: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  };
  const label: Record<string, string> = {
    Present: 'حاضر', Late: 'متأخر', Absent: 'غائب',
    DayOff: 'إجازة', Excused: 'بعذر', Pending: 'لم يسجل', EarlyLeave: 'انصراف مبكر',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${map[status] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'}`}>
      {label[status] ?? status}
    </span>
  );
}

function payrollBadge(status: string) {
  if (status === 'PostedToCashMove') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
      <CheckCheck className="w-3 h-3" /> محوّل
    </span>
  );
  if (status === 'Generated' || status === 'Earned') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-sky-500/15 text-sky-400 border-sky-500/30">
      <ShieldCheck className="w-3 h-3" /> محسوب
    </span>
  );
  if (status === 'PendingCheckout') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-orange-500/15 text-orange-400 border-orange-500/30">
      <Clock4 className="w-3 h-3" /> ناقص انصراف
    </span>
  );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-zinc-500/15 text-zinc-400 border-zinc-500/30">
      {status}
    </span>
  );
}

export default function DailyPayrollPanel() {
  const [date,               setDate]               = useState(getBusinessDateStr());
  const [rows,               setRows]               = useState<PayrollRow[]>([]);
  const [summary,            setSummary]            = useState<Summary | null>(null);
  const [missingMappingEmps, setMissingMappingEmps] = useState<MissingEmp[]>([]);
  const [loaded,             setLoaded]             = useState(false);
  const [loading,            setLoading]            = useState(false);
  const [validating,         setValidating]         = useState(false);
  const [generating,         setGenerating]         = useState(false);
  const [posting,            setPosting]            = useState(false);
  const [error,              setError]              = useState('');
  const [successMsg,         setSuccessMsg]         = useState('');

  /* Validation state */
  const [validationMissing,  setValidationMissing]  = useState<ValidationMissing[]>([]);
  const [validationDone,     setValidationDone]     = useState(false);
  const [validationOk,       setValidationOk]       = useState(false);

  /* Post confirmation dialog */
  const [confirmOpen,        setConfirmOpen]        = useState(false);
  const [dualWriteEnabled,   setDualWriteEnabled]   = useState(false);

  /* Auto-generate log for today */
  interface AutoGenLog {
    found:          boolean;
    success?:       boolean;
    workDate?:      string;
    employeesCount?: number;
    totalHours?:    number;
    totalWages?:    number;
    missing?:       ValidationMissing[];
    createdAt?:     string;
  }
  const [autoGenLog,         setAutoGenLog]         = useState<AutoGenLog | null>(null);

  const flash = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 6000); };

  const fetchAutoGenLog = useCallback(async (d: string) => {
    try {
      const res = await fetch(`/api/payroll/daily/auto-generate?workDate=${d}`);
      if (res.ok) setAutoGenLog(await res.json());
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { fetchAutoGenLog(date); }, [date, fetchAutoGenLog]);

  useEffect(() => {
    const month = date.slice(0, 7);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/hr/employee-ledger/summary?month=${month}`);
        const data = await res.json();
        if (res.ok || res.status === 503) {
          setDualWriteEnabled(Boolean(data.ledgerDualWriteEnabled));
        }
      } catch {
        setDualWriteEnabled(false);
      }
    })();
  }, [date]);

  const load = useCallback(async (d: string) => {
    setLoading(true); setError('');
    try {
      const res  = await fetch(`/api/payroll/daily?workDate=${d}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setMissingMappingEmps(data.missingMappingEmps ?? []);
      setLoaded(true);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  /* ── Step 1: Validate attendance ─────────────────────────────────────────── */
  const handleValidate = async () => {
    setValidating(true); setError(''); setValidationDone(false);
    try {
      const res  = await fetch('/api/payroll/daily/validate-attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDate: date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.alreadyPostedCount > 0) {
        setError('يوجد يوميات مرحلة للخزنة لهذا التاريخ، لا يمكن إعادة توليدها.');
        setValidationOk(false);
      } else {
        setValidationMissing(data.missing ?? []);
        setValidationOk(data.ok === true);
      }
      setValidationDone(true);
      await load(date);
    } catch (e: any) { setError(e.message); }
    finally { setValidating(false); }
  };

  /* ── Step 2: Generate payroll ────────────────────────────────────────────── */
  const handleGenerate = async () => {
    setGenerating(true); setError('');
    try {
      const res  = await fetch('/api/payroll/daily/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDate: date }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.missing?.length) {
          setValidationMissing(data.missing);
          setValidationDone(true); setValidationOk(false);
          throw new Error(data.error);
        }
        throw new Error(data.error);
      }
      flash(`تم توليد ${data.generatedCount} يومية — إجمالي الساعات: ${Number(data.totalHours).toFixed(2)} — إجمالي الأجور: ${fmt(data.totalWage)} ج.م`);
      if (data.ledgerDualWrite) {
        flash('تم تسجيل استحقاقات الموظفين في دفتر الموظفين');
      }
      setValidationDone(false); setValidationMissing([]);
      await load(date);
    } catch (e: any) { setError(e.message); }
    finally { setGenerating(false); }
  };

  /* ── Step 3: Post to cash (after dialog confirm) ─────────────────────────── */
  const handlePostToCash = async () => {
    setConfirmOpen(false);
    setPosting(true); setError('');
    try {
      const res  = await fetch('/api/payroll/daily/post-to-cash', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDate: date }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.missingEmployees
          ? `${data.error}: ${data.missingEmployees.map((e: any) => e.EmpName).join('، ')}`
          : data.error;
        throw new Error(msg);
      }
      const parts: string[] = [];
      if (data.postedCount   > 0) parts.push(`ترحيل ${data.postedCount} يومية`);
      if (data.repairedCount > 0) parts.push(`إصلاح ${data.repairedCount} سجل`);
      flash((parts.length ? parts.join(' — ') : (data.message ?? 'لا توجد بيانات')) + ' بنجاح');
      await load(date);
    } catch (e: any) { setError(e.message); }
    finally { setPosting(false); }
  };

  const handleDateChange = (val: string) => {
    setDate(val); setLoaded(false); setRows([]); setSummary(null);
    setValidationDone(false); setValidationMissing([]); setValidationOk(false);
    setAutoGenLog(null);
  };

  const generatedCount = summary?.generatedCount ?? rows.filter(r => ['Generated','Earned'].includes(r.Status)).length;
  const repairCount    = summary?.repairCount    ?? rows.filter(r => r.needsIncomeRepair).length;
  const canPost        = generatedCount > 0 || repairCount > 0;

  return (
    <div className="space-y-5" dir="rtl">

      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Banknote className="w-4 h-4 text-amber-400" />
          <span>يوميات الموظفين — فحص · توليد · ترحيل</span>
        </div>
        <div className="flex items-center gap-2 mr-auto">
          <Input type="date" value={date} onChange={e => handleDateChange(e.target.value)}
            className="bg-zinc-900 border-zinc-700 text-white w-44 h-9 text-sm" />
          <Button variant="outline" onClick={() => handleDateChange(getBusinessDateStr())}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-9 text-xs gap-1">
            <CalendarDays className="w-3.5 h-3.5" />اليوم
          </Button>
          <Button variant="outline" onClick={() => load(date)} disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-9 w-9 p-0">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
          <Link
            href="/admin/hr?tab=employee-ledger"
            className="inline-flex items-center justify-center gap-1 h-9 px-3 text-xs rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            <BookOpen className="w-3.5 h-3.5" />
            افتح دفتر الموظفين لصرف المستحقات
          </Link>
        </div>
      </div>

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')}><X className="w-4 h-4 opacity-60 hover:opacity-100" /></button>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />{successMsg}
        </div>
      )}

      {/* ── Auto-generate log banner ────────────────────────────────────────── */}
      {autoGenLog?.found && (
        autoGenLog.success ? (
          <div className="flex items-start gap-3 p-4 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sky-400 text-sm">
            <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">تم توليد اليوميات تلقائيًا ولم يتم ترحيلها للخزنة بعد</p>
              <p className="text-xs text-sky-300/70 mt-0.5">
                {autoGenLog.employeesCount} موظف · {Number(autoGenLog.totalHours ?? 0).toFixed(1)} ساعة · {fmt(autoGenLog.totalWages ?? 0)} ج.م
                {autoGenLog.createdAt ? ` · ${new Date(autoGenLog.createdAt).toLocaleTimeString('ar-EG')}` : ''}
              </p>
            </div>
            <button onClick={() => setAutoGenLog(null)}><X className="w-4 h-4 opacity-50 hover:opacity-100" /></button>
          </div>
        ) : autoGenLog.missing && autoGenLog.missing.length > 0 ? (
          <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl text-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-orange-400 font-semibold">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                لم يتم توليد اليوميات تلقائيًا بسبب نقص بيانات الحضور والانصراف
              </div>
              <button onClick={() => setAutoGenLog(null)}><X className="w-4 h-4 text-zinc-500 hover:text-zinc-300" /></button>
            </div>
            <div className="space-y-1.5">
              {autoGenLog.missing.map((m: ValidationMissing) => (
                <div key={m.empId} className="flex items-center justify-between px-3 py-1.5 bg-orange-500/5 rounded-lg border border-orange-500/20">
                  <span className="text-white text-sm">{m.empName}</span>
                  <span className="text-orange-400 text-xs">{REASON_LABEL[m.reason]}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null
      )}

      {/* ── Action buttons (workflow steps) ─────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Step 1 */}
        <Button onClick={handleValidate} disabled={validating || loading}
          variant="outline"
          className="border-sky-600/40 text-sky-400 hover:bg-sky-500/10 gap-2 h-11 px-5">
          {validating
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الفحص...</>
            : <><ClipboardList className="w-4 h-4" />فحص الحضور</>}
        </Button>

        {/* Step 2 */}
        <Button onClick={handleGenerate} disabled={generating || loading}
          className="bg-amber-600 hover:bg-amber-700 gap-2 h-11 px-6">
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري التوليد...</>
            : <><Zap className="w-4 h-4" />توليد اليوميات من الحضور</>}
        </Button>

        {/* Step 3 */}
        {canPost && (
          <Button onClick={() => setConfirmOpen(true)} disabled={posting || loading}
            className={dualWriteEnabled
              ? 'bg-zinc-700 hover:bg-zinc-600 border border-amber-500/40 gap-2 h-11 px-6'
              : 'bg-emerald-700 hover:bg-emerald-600 gap-2 h-11 px-6'}>
            <Send className="w-4 h-4" />
            ترحيل للخزنة
            {dualWriteEnabled && (
              <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] px-1.5">
                قديم
              </Badge>
            )}
            <Badge className="bg-white/20 text-white text-[10px] px-1.5 mr-1">{generatedCount}</Badge>
          </Button>
        )}

        {!loaded && (
          <Button onClick={() => load(date)} variant="outline" disabled={loading}
            className="border-zinc-700 text-zinc-300 gap-2 h-11">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            تحميل البيانات
          </Button>
        )}
      </div>

      {dualWriteEnabled && canPost && (
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <p>
              تنبيه: في النظام الجديد، اليوميات تُسجل كاستحقاق في دفتر الموظفين. ترحيل الخزنة القديم ينشئ مصروف وإيراد معادلة وقد يضخم التقارير.
            </p>
            <Link
              href="/admin/hr?tab=employee-ledger"
              className="inline-flex items-center gap-1 text-xs font-medium text-amber-200 underline underline-offset-2 hover:text-white"
            >
              <BookOpen className="w-3.5 h-3.5" />
              استخدم دفتر الموظفين لصرف المستحقات
            </Link>
          </div>
        </div>
      )}

      {/* ── Validation result card ───────────────────────────────────────────── */}
      {validationDone && (
        validationOk ? (
          <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <span>بيانات الحضور والانصراف مكتملة لجميع الموظفين — يمكنك توليد اليوميات الآن</span>
          </div>
        ) : validationMissing.length > 0 ? (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-sm">
            <div className="flex items-center gap-2 text-rose-400 font-semibold mb-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              برجاء إكمال بيانات الحضور والانصراف أولاً
            </div>
            <div className="space-y-2">
              {validationMissing.map(m => (
                <div key={m.empId} className="flex items-center justify-between px-3 py-2 bg-rose-500/5 rounded-lg border border-rose-500/20">
                  <span className="text-white font-medium text-sm">{m.empName}</span>
                  <span className="text-rose-400 text-xs">{REASON_LABEL[m.reason]}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null
      )}

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard title="إجمالي الموظفين"          value={summary.total}                                                icon={<Users className="w-5 h-5" />}       variant="default" />
          <KpiCard title="إجمالي الساعات"           value={`${Number(summary.totalHours ?? 0).toFixed(1)} س`}           icon={<Timer className="w-5 h-5" />}       variant="default" />
          <KpiCard title="إجمالي الأجور"            value={`${fmt(summary.totalWage)} ج.م`}                             icon={<Banknote className="w-5 h-5" />}    variant="primary" />
          <KpiCard title="محسوب / جاهز للترحيل"    value={summary.generatedCount}                                       icon={<ShieldCheck className="w-5 h-5" />} variant="warning" />
          <KpiCard title="محوّل للخزنة"            value={summary.postedCount}                                          icon={<CheckCheck className="w-5 h-5" />}  variant="success" />
          <KpiCard title="مصروفات محوّلة"           value={`${fmt(summary.totalExpenseAmount)} ج.م`}                    icon={<TrendingDown className="w-5 h-5" />} variant="danger" />
        </div>
      )}

      {/* ── Missing revenue-mapping warning ─────────────────────────────────── */}
      {missingMappingEmps.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">تحذير: موظفون بدون تصنيف إيراد مربوط</p>
            <p className="text-xs text-amber-300/80">لن يمكن ترحيل يومياتهم حتى يتم ربط تصنيف إيراد لكل منهم في تاب الموظفون:</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {missingMappingEmps.map(e => (
                <span key={e.EmpID} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/20 border border-amber-500/30">
                  {e.EmpName}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800/60 flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-300">يوميات {date}</h2>
          {loaded && <span className="text-xs text-zinc-500">{rows.length} سجل</span>}
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-500 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" />جاري التحميل...
            </div>
          ) : !loaded ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 gap-3">
              <CalendarDays className="w-10 h-10 opacity-30" />
              <p className="text-sm">اختر التاريخ، ثم اضغط "فحص الحضور" ثم "توليد اليوميات"</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 gap-3">
              <Users className="w-10 h-10 opacity-30" />
              <p className="text-sm">لا توجد يوميات لهذا اليوم</p>
            </div>
          ) : (
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                  <th className="px-4 py-3 text-right font-medium">الموظف</th>
                  <th className="px-4 py-3 text-center font-medium">حالة الحضور</th>
                  <th className="px-4 py-3 text-center font-medium">حضور ← انصراف</th>
                  <th className="px-4 py-3 text-center font-medium">ساعات فعلية</th>
                  <th className="px-4 py-3 text-center font-medium">سعر الساعة</th>
                  <th className="px-4 py-3 text-center font-medium">التأخير</th>
                  <th className="px-4 py-3 text-left font-medium">الأجر المحسوب</th>
                  <th className="px-4 py-3 text-center font-medium">حالة اليومية</th>
                  <th className="px-4 py-3 text-center font-medium">تصنيف الإيراد</th>
                  <th className="px-4 py-3 text-center font-medium">خزنة م.</th>
                  <th className="px-4 py-3 text-center font-medium">خزنة إ.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.ID}
                    className={`border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors ${row.Status === 'PostedToCashMove' ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 shrink-0">
                          {row.EmpName?.charAt(0)}
                        </div>
                        <span className="font-medium text-white text-sm">{row.EmpName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">{attendanceBadge(row.AttendanceStatus)}</td>
                    <td className="px-4 py-3 text-center text-zinc-400 text-xs whitespace-nowrap">
                      {row.CheckInTime
                        ? <span>{formatTime12h(row.CheckInTime)}<span className="text-zinc-600 mx-1">←</span>{row.CheckOutTime ? formatTime12h(row.CheckOutTime) : <span className="text-orange-500">؟</span>}</span>
                        : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {row.ActualHours != null
                        ? <span className="text-sky-400 font-medium">{Number(row.ActualHours).toFixed(2)} س</span>
                        : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {row.HourlyRateSnapshot != null
                        ? <span className="text-amber-400">{Number(row.HourlyRateSnapshot).toFixed(2)}</span>
                        : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {row.LateMinutes && row.LateMinutes > 0
                        ? <span className="text-amber-400 font-medium">{row.LateMinutes} د</span>
                        : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-left whitespace-nowrap">
                      <span className="font-bold text-white">{fmt(row.DailyWage)}</span>
                      <span className="text-[11px] font-normal text-zinc-500 mr-1">ج.م</span>
                      {row.HourlyRateSnapshot != null && row.ActualHours != null && (
                        <div className="text-[10px] text-zinc-600 mt-0.5">
                          {Number(row.HourlyRateSnapshot).toFixed(2)} × {Number(row.ActualHours).toFixed(2)}س
                        </div>
                      )}
                      {row.Status === 'PendingCheckout' && (
                        <div className="text-[10px] text-orange-500 mt-0.5">— ناقص انصراف</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">{payrollBadge(row.Status)}</td>
                    <td className="px-4 py-3 text-center text-xs">
                      {row.RevenueCatName
                        ? <span className="text-amber-400 text-[11px]">{row.RevenueCatName}</span>
                        : <span className="inline-flex items-center gap-1 text-rose-400 text-[11px]"><AlertTriangle className="w-3 h-3" />غير مربوط</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {row.CashMoveID ? <span className="text-rose-400 font-mono text-[11px]">#{row.CashMoveID}</span> : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {row.EmployeeIncomeCashMoveID ? <span className="text-emerald-400 font-mono text-[11px]">#{row.EmployeeIncomeCashMoveID}</span> : <span className="text-zinc-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {summary && summary.total > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-zinc-700 bg-zinc-800/30">
                    <td colSpan={3} className="px-4 py-3 text-xs font-bold text-zinc-400">
                      الإجمالي ({summary.total} موظف)
                    </td>
                    <td className="px-4 py-3 text-center text-sky-400 font-bold text-sm">
                      {Number(summary.totalHours ?? 0).toFixed(1)} س
                    </td>
                    <td />
                    <td />
                    <td className="px-4 py-3 text-left font-bold text-white text-base whitespace-nowrap">
                      {fmt(summary.totalWage)}<span className="text-xs font-normal text-zinc-500 mr-1">ج.م</span>
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>

      {/* ── Confirm Post Dialog ─────────────────────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Send className="w-5 h-5 text-emerald-400" />
              تأكيد ترحيل يوميات الموظفين للخزنة
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-800/60 rounded-lg p-3 text-center">
                <p className="text-xs text-zinc-500 mb-1">تاريخ اليوميات</p>
                <p className="text-sm font-bold text-white">{date}</p>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3 text-center">
                <p className="text-xs text-zinc-500 mb-1">عدد الموظفين</p>
                <p className="text-sm font-bold text-white">{generatedCount}</p>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3 text-center">
                <p className="text-xs text-zinc-500 mb-1">إجمالي الساعات</p>
                <p className="text-sm font-bold text-sky-400">{Number(summary?.totalHours ?? 0).toFixed(1)} س</p>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3 text-center">
                <p className="text-xs text-zinc-500 mb-1">إجمالي الأجور</p>
                <p className="text-sm font-bold text-emerald-400">{fmt(summary?.totalWage ?? 0)} ج.م</p>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>بعد الترحيل للخزنة سيتم تسجيل هذه اليوميات كمصروفات، ولا يُفضل تعديلها إلا من خلال إجراء تصحيح.</span>
            </div>

            {dualWriteEnabled && (
              <div className="flex flex-col gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs">
                <p>
                  تنبيه: في النظام الجديد، اليوميات تُسجل كاستحقاق في دفتر الموظفين. ترحيل الخزنة القديم ينشئ مصروف وإيراد معادلة وقد يضخم التقارير.
                </p>
                <Link
                  href="/admin/hr?tab=employee-ledger"
                  className="inline-flex items-center gap-1 text-amber-200 underline underline-offset-2 hover:text-white"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  استخدم دفتر الموظفين لصرف المستحقات
                </Link>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse" dir="rtl">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
              إلغاء
            </Button>
            <Button onClick={handlePostToCash} disabled={posting}
              className={dualWriteEnabled
                ? 'bg-zinc-700 hover:bg-zinc-600 border border-amber-500/40 gap-2'
                : 'bg-emerald-700 hover:bg-emerald-600 gap-2'}>
              {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {dualWriteEnabled ? 'تأكيد الترحيل القديم للخزنة' : 'تأكيد الترحيل للخزنة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
