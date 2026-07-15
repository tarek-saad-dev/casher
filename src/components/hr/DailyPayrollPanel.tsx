'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  CalendarDays, Loader2, Zap, Send, RefreshCw,
  CheckCircle2, AlertCircle, Users, Banknote,
  CheckCheck, X, TrendingDown, TrendingUp,
  AlertTriangle, ShieldCheck, ClipboardList, Timer, BookOpen, Target,
} from 'lucide-react';
import Link from 'next/link';
import KpiCard from '@/components/shared/KpiCard';
import { getBusinessDateStr } from '@/lib/timeUtils';
import {
  PAYROLL_VALIDATION_REASON_LABELS,
  type PayrollValidationReason,
} from '@/lib/payroll/dailyPayrollHrRules';
import {
  EMPLOYMENT_TYPE_LABELS,
  PAYROLL_METHOD_LABELS,
} from '@/lib/hr/employee-hr-model';
import {
  mergeDailyPayrollAndTargetRows,
  type MergedDailyRow,
  type TargetLikeRow,
} from '@/lib/payroll/employee-target/merge-daily-payroll-target-rows';
import DailyTargetDetailsDialog from '@/components/hr/DailyTargetDetailsDialog';
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
  EmploymentType: string | null;
  PayrollMethod: string | null;
  HourlyRateSnapshot: number | null;
  DailyRate: number | null;
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
  empId: number;
  empName: string;
  reason: PayrollValidationReason;
}

interface ValidationExcluded {
  empId: number;
  empName: string;
  reason: PayrollValidationReason;
}

const REASON_LABEL = PAYROLL_VALIDATION_REASON_LABELS;

function employmentBadge(type: string | null) {
  if (!type || !(type in EMPLOYMENT_TYPE_LABELS)) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
      {EMPLOYMENT_TYPE_LABELS[type as keyof typeof EMPLOYMENT_TYPE_LABELS]}
    </span>
  );
}

function payrollMethodBadge(method: string | null) {
  if (!method || !(method in PAYROLL_METHOD_LABELS)) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-500 border border-zinc-700/50">
      {PAYROLL_METHOD_LABELS[method as keyof typeof PAYROLL_METHOD_LABELS]}
    </span>
  );
}

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

function targetSyncBadge(
  status: MergedDailyRow['targetSyncStatus'] | TargetLikeRow['syncStatus'] | undefined,
) {
  if (status === 'pending') {
    return (
      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-amber-500/40 text-amber-300 bg-amber-500/10">
        التارجت يحتاج إعادة حساب
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-sky-500/40 text-sky-300 bg-sky-500/10">
        جاري التحديث
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-rose-500/40 text-rose-300 bg-rose-500/10">
        تعذر تحديث التارجت
      </span>
    );
  }
  if (status === 'up_to_date') {
    return (
      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
        محدث
      </span>
    );
  }
  return null;
}

function targetPersistenceBadge(status: TargetLikeRow['persistenceStatus'] | undefined) {
  if (!status) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] border bg-zinc-500/15 text-zinc-500 border-zinc-600/40">
        لا يوجد تارجت
      </span>
    );
  }
  if (status === 'not_generated') {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] border bg-amber-500/15 text-amber-400 border-amber-500/30">
        لم يتم التوليد
      </span>
    );
  }
  if (status === 'recalculated') {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] border bg-sky-500/15 text-sky-400 border-sky-500/30">
        أُعيد حسابه
      </span>
    );
  }
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
      مولَّد
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
  const [validationExcluded, setValidationExcluded] = useState<ValidationExcluded[]>([]);
  const [validationDone,     setValidationDone]     = useState(false);
  const [validationOk,       setValidationOk]       = useState(false);

  /* Post confirmation dialog */
  const [confirmOpen,        setConfirmOpen]        = useState(false);
  const [dualWriteEnabled,   setDualWriteEnabled]   = useState(false);
  const [legacyPostToCashDisabled, setLegacyPostToCashDisabled] = useState(false);
  const [legacyPostToCashWarning, setLegacyPostToCashWarning] = useState<string | null>(null);

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

  const [targetRows, setTargetRows] = useState<TargetLikeRow[]>([]);
  const [targetTotals, setTargetTotals] = useState<{
    eligibleEmployees: number;
    notGenerated: number;
    earnedTarget: number;
    totalCurrentNetSalesAfterDiscount: string;
    totalStoredTargetAmount: string;
  } | null>(null);
  const [planConflicts, setPlanConflicts] = useState<string[]>([]);
  const [regeneratingTarget, setRegeneratingTarget] = useState(false);
  const [detailTarget, setDetailTarget] = useState<TargetLikeRow | null>(null);

  const flash = (msg: string) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 8000); };

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
          setLegacyPostToCashDisabled(Boolean(data.legacyPostToCashDisabled));
          setLegacyPostToCashWarning(data.legacyPostToCashWarning ?? null);
        }
      } catch {
        setDualWriteEnabled(false);
      }
    })();
  }, [date]);

  const load = useCallback(async (d: string) => {
    setLoading(true); setError('');
    try {
      const [payrollRes, targetRes] = await Promise.all([
        fetch(`/api/payroll/daily?workDate=${d}`),
        fetch(`/api/payroll/daily/targets?workDate=${d}`),
      ]);
      const payrollData = await payrollRes.json();
      const targetData = await targetRes.json();
      if (!payrollRes.ok) throw new Error(payrollData.error || 'فشل تحميل اليوميات');
      setRows(payrollData.rows ?? []);
      setSummary(payrollData.summary ?? null);
      setMissingMappingEmps(payrollData.missingMappingEmps ?? []);

      if (targetRes.ok) {
        setTargetRows(Array.isArray(targetData.employees) ? targetData.employees : []);
        setTargetTotals(targetData.totals ?? null);
        setPlanConflicts(Array.isArray(targetData.planConflicts) ? targetData.planConflicts : []);
      } else {
        setTargetRows([]);
        setTargetTotals(null);
        setPlanConflicts([]);
        if (targetData.error) {
          console.warn('[DailyPayrollPanel] target load:', targetData.error);
        }
      }
      setLoaded(true);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'خطأ في التحميل'); }
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
        setValidationExcluded(data.excluded ?? []);
        setValidationOk(data.ok === true);
      }
      setValidationDone(true);
      await load(date);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'خطأ في الفحص'); }
    finally { setValidating(false); }
  };

  const generatePayrollOnly = async (): Promise<{ ok: boolean; message: string }> => {
    const res = await fetch('/api/payroll/daily/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workDate: date }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.missing?.length) {
        setValidationMissing(data.missing);
        setValidationDone(true); setValidationOk(false);
      }
      return { ok: false, message: data.error || 'تعذر توليد اليوميات' };
    }
    let message = `تم توليد اليوميات بنجاح (${data.generatedCount} سجل — ${fmt(data.totalWage)} ج.م)`;
    if (data.ledgerDualWrite) {
      message += ' — سُجِّل الأساسي في دفتر الموظفين';
    }
    return { ok: true, message };
  };

  /** Uses durable recalc pipeline (enqueue + process) — same path as invoice sync. */
  const generateTargetsOnly = async (
    empIds?: number[],
  ): Promise<{ ok: boolean; message: string }> => {
    const res = await fetch('/api/payroll/daily/targets/recalc-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workDate: date,
        processNow: true,
        reason: empIds?.length ? 'manual_retry_employee' : 'manual_recalc_day',
        ...(empIds?.length ? { empIds } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, message: data.error || 'تعذر إعادة حساب التارجت' };
    }
    const completed = data.process?.completed ?? 0;
    const failed = data.process?.failed ?? 0;
    const claimed = data.process?.claimed ?? 0;
    if (failed > 0 && completed === 0 && claimed > 0) {
      return { ok: false, message: 'تعذر تحديث التارجت — حاول إعادة المحاولة' };
    }
    return {
      ok: true,
      message: empIds?.length
        ? 'تم تحديث تارجت الموظف'
        : `تم إعادة حساب تارجت اليوم (مكتمل: ${completed || 'توليد يوم كامل'}، فشل: ${failed})`,
    };
  };

  const retryEmployeeTarget = async (empId: number) => {
    if (regeneratingTarget || generating) return;
    setRegeneratingTarget(true);
    setError('');
    try {
      const targets = await generateTargetsOnly([empId]);
      if (!targets.ok) throw new Error(targets.message);
      flash(targets.message);
      await load(date);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ في إعادة المحاولة');
    } finally {
      setRegeneratingTarget(false);
    }
  };

  /* ── Step 2: Generate payroll + targets (independent calls) ─────────────── */
  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true); setError('');
    const messages: string[] = [];
    const failures: string[] = [];
    try {
      const payroll = await generatePayrollOnly();
      if (payroll.ok) messages.push(payroll.message);
      else failures.push(payroll.message);

      const targets = await generateTargetsOnly();
      if (targets.ok) messages.push(targets.message);
      else failures.push(targets.message);

      if (failures.length && messages.length) {
        setError(`${messages.join(' · ')}. ${failures.join(' · ')}`);
        flash(messages.join(' · '));
      } else if (failures.length) {
        setError(failures.join(' · '));
      } else {
        flash(messages.join(' · '));
      }

      setValidationDone(false); setValidationMissing([]); setValidationExcluded([]);
      await load(date);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'خطأ في التوليد'); }
    finally { setGenerating(false); }
  };

  /* Secondary: recalculate targets only — never touches DailyPayroll */
  const handleRecalculateTargets = async () => {
    if (regeneratingTarget || generating) return;
    setRegeneratingTarget(true); setError('');
    try {
      const targets = await generateTargetsOnly();
      if (!targets.ok) throw new Error(targets.message);
      flash(targets.message);
      await load(date);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'خطأ في إعادة حساب التارجت'); }
    finally { setRegeneratingTarget(false); }
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
        if (data.legacyPostToCashDisabled) {
          setError(data.message ?? 'تم إيقاف ترحيل اليوميات القديم.');
          return;
        }
        const msg = data.missingEmployees
          ? `${data.error}: ${(data.missingEmployees as Array<{ EmpName: string }>).map((e) => e.EmpName).join('، ')}`
          : (data.error ?? data.message);
        throw new Error(msg);
      }
      const parts: string[] = [];
      if (data.postedCount   > 0) parts.push(`ترحيل ${data.postedCount} يومية`);
      if (data.repairedCount > 0) parts.push(`إصلاح ${data.repairedCount} سجل`);
      flash((parts.length ? parts.join(' — ') : (data.message ?? 'لا توجد بيانات')) + ' بنجاح');
      await load(date);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'خطأ في الترحيل'); }
    finally { setPosting(false); }
  };

  const handleDateChange = (val: string) => {
    setDate(val); setLoaded(false); setRows([]); setSummary(null);
    setTargetRows([]); setTargetTotals(null); setPlanConflicts([]);
    setValidationDone(false); setValidationMissing([]); setValidationExcluded([]); setValidationOk(false);
    setAutoGenLog(null);
  };

  const generatedCount = summary?.generatedCount ?? rows.filter(r => ['Generated','Earned'].includes(r.Status)).length;
  const repairCount    = summary?.repairCount    ?? rows.filter(r => r.needsIncomeRepair).length;
  const canPost        = !legacyPostToCashDisabled && (generatedCount > 0 || repairCount > 0);
  const showLegacyPost = dualWriteEnabled && !legacyPostToCashDisabled;
  const mergedRows = mergeDailyPayrollAndTargetRows(rows, targetRows);

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

        {/* Step 2: payroll + targets (independent) */}
        <Button onClick={handleGenerate} disabled={generating || regeneratingTarget || loading}
          className="bg-amber-600 hover:bg-amber-700 gap-2 h-11 px-6">
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري التوليد...</>
            : <><Zap className="w-4 h-4" />توليد اليوميات والتارجت</>}
        </Button>

        <Button
          onClick={handleRecalculateTargets}
          disabled={generating || regeneratingTarget || loading}
          variant="outline"
          className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10 gap-2 h-11 px-5"
        >
          {regeneratingTarget
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري إعادة حساب التارجت...</>
            : <><Target className="w-4 h-4" />إعادة حساب التارجت فقط</>}
        </Button>

        {/* Step 3 */}
        {canPost && (
          <Button onClick={() => setConfirmOpen(true)} disabled={posting || loading}
            className={showLegacyPost
              ? 'bg-zinc-700 hover:bg-zinc-600 border border-amber-500/40 gap-2 h-11 px-6'
              : 'bg-emerald-700 hover:bg-emerald-600 gap-2 h-11 px-6'}>
            <Send className="w-4 h-4" />
            {showLegacyPost ? 'ترحيل قديم للخزنة' : 'ترحيل للخزنة'}
            {showLegacyPost && (
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

      {legacyPostToCashDisabled && (
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sky-300 text-sm">
          <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <p>
              تم إيقاف الترحيل القديم لمنع تضخم الإيرادات والمصروفات. استخدم دفتر الموظفين لصرف المستحقات.
            </p>
            <Link
              href="/admin/hr?tab=employee-ledger"
              className="inline-flex items-center gap-1 text-xs font-medium text-sky-200 underline underline-offset-2 hover:text-white"
            >
              <BookOpen className="w-3.5 h-3.5" />
              فتح دفتر الموظفين
            </Link>
          </div>
        </div>
      )}

      {showLegacyPost && canPost && (
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <p>
              {legacyPostToCashWarning ??
                'هذا الإجراء ينشئ حركات خزنة وقد يضخم التقارير. في النظام الجديد، استخدم دفتر الموظفين لصرف المستحقات.'}
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

      {!legacyPostToCashDisabled && dualWriteEnabled && !canPost && (
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 bg-zinc-800/40 border border-zinc-700/50 rounded-xl text-zinc-400 text-sm">
          <BookOpen className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="flex-1">
            اليوميات المُولَّدة تُسجَّل كاستحقاق في دفتر الموظفين. استخدم «صرف مستحقات» من الدفتر للصرف الفعلي.
          </p>
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

      {validationDone && validationExcluded.length > 0 && (
        <div className="p-4 bg-zinc-800/40 border border-zinc-700/50 rounded-xl text-sm">
          <div className="flex items-center gap-2 text-zinc-400 font-semibold mb-3">
            <Users className="w-5 h-5 shrink-0" />
            مستثنون من اليوميات (ليس خطأ)
          </div>
          <div className="space-y-2">
            {validationExcluded.map(m => (
              <div key={m.empId} className="flex items-center justify-between px-3 py-2 bg-zinc-800/30 rounded-lg border border-zinc-700/40">
                <span className="text-zinc-300 text-sm">{m.empName}</span>
                <span className="text-zinc-500 text-xs">{REASON_LABEL[m.reason]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── KPI Cards (payroll + target kept separate — no combined total) ── */}
      {(summary || targetTotals) && (
        <div className="space-y-3">
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard title="إجمالي موظفي اليومية" value={summary.total} icon={<Users className="w-5 h-5" />} variant="default" />
              <KpiCard title="إجمالي الساعات" value={`${Number(summary.totalHours ?? 0).toFixed(1)} س`} icon={<Timer className="w-5 h-5" />} variant="default" />
              <KpiCard title="إجمالي الأساسي اليومي" value={`${fmt(summary.totalWage)} ج.م`} icon={<Banknote className="w-5 h-5" />} variant="primary" />
              <KpiCard title="محسوب / جاهز للترحيل" value={summary.generatedCount} icon={<ShieldCheck className="w-5 h-5" />} variant="warning" />
              <KpiCard title="محوّل للخزنة" value={summary.postedCount} icon={<CheckCheck className="w-5 h-5" />} variant="success" />
              <KpiCard title="مصروفات محوّلة" value={`${fmt(summary.totalExpenseAmount)} ج.م`} icon={<TrendingDown className="w-5 h-5" />} variant="danger" />
            </div>
          )}
          {targetTotals && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard title="موظفو التارجت" value={targetTotals.eligibleEmployees} icon={<Target className="w-5 h-5" />} variant="default" />
              <KpiCard title="مبيعات موظفي التارجت" value={`${fmt(Number(targetTotals.totalCurrentNetSalesAfterDiscount))} ج.م`} icon={<TrendingUp className="w-5 h-5" />} variant="default" />
              <KpiCard title="إجمالي تارجت اليوم" value={`${fmt(Number(targetTotals.totalStoredTargetAmount))} ج.م`} icon={<Target className="w-5 h-5" />} variant="primary" />
              <KpiCard title="استحقوا تارجت" value={targetTotals.earnedTarget} icon={<CheckCircle2 className="w-5 h-5" />} variant="success" />
              <KpiCard title="لم يُولَّد تارجتهم" value={targetTotals.notGenerated} icon={<AlertTriangle className="w-5 h-5" />} variant="warning" />
            </div>
          )}
        </div>
      )}

      {planConflicts.length > 0 && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-sm">
          <p className="font-semibold mb-1">تعارض خطط تارجت يحتاج مراجعة</p>
          <ul className="text-xs space-y-1 list-disc pr-4">
            {planConflicts.map((c) => <li key={c}>{c}</li>)}
          </ul>
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
          <h2 className="text-sm font-bold text-zinc-300">يوميات وتارجت {date}</h2>
          {loaded && <span className="text-xs text-zinc-500">{mergedRows.length} صف</span>}
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-500 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" />جاري التحميل...
            </div>
          ) : !loaded ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 gap-3">
              <CalendarDays className="w-10 h-10 opacity-30" />
              <p className="text-sm">اختر التاريخ، ثم اضغط «فحص الحضور» ثم «توليد اليوميات والتارجت»</p>
            </div>
          ) : mergedRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 gap-3">
              <Users className="w-10 h-10 opacity-30" />
              <p className="text-sm">لا توجد يوميات أو خطط تارجت لهذا اليوم</p>
            </div>
          ) : (
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                  <th className="px-3 py-3 text-right font-medium">الموظف</th>
                  <th className="px-3 py-3 text-center font-medium">حالة الحضور</th>
                  <th className="px-3 py-3 text-center font-medium">عدد الساعات</th>
                  <th className="px-3 py-3 text-left font-medium">الأساسي اليومي</th>
                  <th className="px-3 py-3 text-left font-medium">مبيعات التارجت بعد الخصم</th>
                  <th className="px-3 py-3 text-center font-medium">نظام التارجت</th>
                  <th className="px-3 py-3 text-left font-medium">تارجت اليوم</th>
                  <th className="px-3 py-3 text-center font-medium">حالة التوليد</th>
                  <th className="px-3 py-3 text-center font-medium">مزامنة التارجت</th>
                  <th className="px-3 py-3 text-center font-medium">التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {mergedRows.map((merged) => {
                  const row = merged.payroll as PayrollRow | null;
                  const target = merged.target;
                  const sync = merged.targetSyncStatus ?? target?.syncStatus;
                  return (
                    <tr
                      key={merged.empId}
                      className={`border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors ${row?.Status === 'PostedToCashMove' ? 'opacity-60' : ''}`}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 shrink-0">
                            {merged.empName?.charAt(0)}
                          </div>
                          <div>
                            <span className="font-medium text-white text-sm">{merged.empName}</span>
                            {row && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {employmentBadge(row.EmploymentType)}
                                {payrollMethodBadge(row.PayrollMethod)}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {row ? attendanceBadge(row.AttendanceStatus) : <span className="text-zinc-600 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-3 text-center text-xs">
                        {row?.ActualHours != null
                          ? <span className="text-sky-400 font-medium">{Number(row.ActualHours).toFixed(2)} س</span>
                          : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-3 text-left whitespace-nowrap">
                        {row ? (
                          <>
                            <span className="font-bold text-white">{fmt(row.DailyWage)}</span>
                            <span className="text-[11px] font-normal text-zinc-500 mr-1">ج.م</span>
                          </>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-left text-xs">
                        {target
                          ? <span className="text-sky-300 font-medium">{fmt(Number(target.currentNetSalesAfterDiscount))}</span>
                          : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-3 text-center text-[11px] text-zinc-300 max-w-[140px]">
                        {target ? target.planSummary : 'لا يوجد تارجت'}
                      </td>
                      <td className="px-3 py-3 text-left whitespace-nowrap">
                        {!target && <span className="text-zinc-600">—</span>}
                        {target?.persistenceStatus === 'not_generated' && (
                          <span className="text-amber-400 text-xs">لم يتم التوليد</span>
                        )}
                        {target && target.persistenceStatus !== 'not_generated' && (
                          <div className="space-y-0.5">
                            <button
                              type="button"
                              className="font-bold text-violet-300 hover:underline"
                              onClick={() => setDetailTarget(target)}
                            >
                              {fmt(Number(target.storedTargetAmount ?? 0))}
                            </button>
                            {target.displayStatus === 'below_first_tier' && (
                              <div>
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-amber-500/30 text-amber-400 bg-amber-500/10">
                                  أقل من بداية التارجت
                                </span>
                              </div>
                            )}
                            {target.displayStatus === 'earned_target' && (
                              <div>
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                                  مستحق
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {targetPersistenceBadge(target?.persistenceStatus)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          {targetSyncBadge(sync)}
                          {(sync === 'failed' || sync === 'pending') && target && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] border-amber-500/40 text-amber-200"
                              disabled={regeneratingTarget || generating}
                              onClick={() => void retryEmployeeTarget(merged.empId)}
                            >
                              إعادة المحاولة
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {target ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] border-zinc-700"
                            onClick={() => setDetailTarget(target)}
                          >
                            تفاصيل
                          </Button>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {(summary || targetTotals) && (
                <tfoot>
                  <tr className="border-t-2 border-zinc-700 bg-zinc-800/30">
                    <td className="px-3 py-3 text-xs font-bold text-zinc-400" colSpan={2}>
                      الإجماليات (منفصلة)
                    </td>
                    <td className="px-3 py-3 text-center text-sky-400 font-bold text-sm">
                      {summary ? `${Number(summary.totalHours ?? 0).toFixed(1)} س` : '—'}
                    </td>
                    <td className="px-3 py-3 text-left font-bold text-white whitespace-nowrap">
                      {summary ? `${fmt(summary.totalWage)} ج.م` : '—'}
                      <div className="text-[10px] text-zinc-500 font-normal">أساسي فقط</div>
                    </td>
                    <td className="px-3 py-3 text-left text-sky-300 font-bold text-sm">
                      {targetTotals ? fmt(Number(targetTotals.totalCurrentNetSalesAfterDiscount)) : '—'}
                    </td>
                    <td />
                    <td className="px-3 py-3 text-left font-bold text-violet-300 whitespace-nowrap">
                      {targetTotals ? `${fmt(Number(targetTotals.totalStoredTargetAmount))} ج.م` : '—'}
                      <div className="text-[10px] text-zinc-500 font-normal">تارجت فقط</div>
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>

      <DailyTargetDetailsDialog
        open={!!detailTarget}
        onClose={() => setDetailTarget(null)}
        workDate={date}
        target={detailTarget}
      />

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

            {showLegacyPost && (
              <div className="flex flex-col gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs">
                <p>
                  {legacyPostToCashWarning ??
                    'هذا الإجراء ينشئ حركات خزنة وقد يضخم التقارير. في النظام الجديد، استخدم دفتر الموظفين لصرف المستحقات.'}
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
              className={showLegacyPost
                ? 'bg-zinc-700 hover:bg-zinc-600 border border-amber-500/40 gap-2'
                : 'bg-emerald-700 hover:bg-emerald-600 gap-2'}>
              {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {showLegacyPost ? 'تأكيد الترحيل القديم للخزنة' : 'تأكيد الترحيل للخزنة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
