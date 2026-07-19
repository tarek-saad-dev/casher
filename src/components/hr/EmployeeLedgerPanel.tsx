'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen, Loader2, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Scale, Wallet, HandCoins, CalendarDays,
} from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type {
  EmpLedgerEmployeeSummaryRow,
  EmpLedgerListResponse,
  EmpLedgerSummaryResponse,
} from '@/lib/types/employee-ledger';
import { EMP_LEDGER_REASON_LABELS } from '@/lib/types/employee-ledger';
import EmployeePayoutModal, { type EmployeePayoutTarget } from '@/components/hr/EmployeePayoutModal';
import EmployeeFundingModal from '@/components/hr/EmployeeFundingModal';
import MonthlySalaryPostModal from '@/components/hr/MonthlySalaryPostModal';
import EmployeeDailyTargetLedgerDetailsDialog from '@/components/hr/EmployeeDailyTargetLedgerDetailsDialog';
import Link from 'next/link';
import { EMPLOYEE_LEDGER_REFRESH_EVENT } from '@/lib/cashMoveDeleteClient';
import { attachRunningBalances } from '@/lib/hr/employee-ledger-running-balance';

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface EmployeeOption {
  EmpID: number;
  EmpName: string;
}

function directionBadge(direction: string) {
  if (direction === 'credit') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
        <TrendingUp className="w-3 h-3" />
        دائن
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-400">
      <TrendingDown className="w-3 h-3" />
      مدين
    </span>
  );
}

export default function EmployeeLedgerPanel() {
  const [month, setMonth] = useState(currentMonthStr);
  const [empId, setEmpId] = useState<string>('all');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const [summary, setSummary] = useState<EmpLedgerSummaryResponse | null>(null);
  const [ledger, setLedger] = useState<EmpLedgerListResponse | null>(null);

  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [dualWriteEnabled, setDualWriteEnabled] = useState(false);
  const [payoutTarget, setPayoutTarget] = useState<EmployeePayoutTarget | null>(null);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [monthlySalaryOpen, setMonthlySalaryOpen] = useState(false);
  const [targetDetailsId, setTargetDetailsId] = useState<number | null>(null);

  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/employees');
      const data = await res.json();
      if (!res.ok) return;
      setEmployees(
        Array.isArray(data)
          ? data.map((e: { EmpID: number; EmpName: string }) => ({
              EmpID: e.EmpID,
              EmpName: e.EmpName,
            }))
          : [],
      );
    } catch {
      /* optional */
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const res = await fetch(`/api/admin/hr/employee-ledger/summary?month=${month}`);
      const data: EmpLedgerSummaryResponse & { error?: string } = await res.json();
      if (!res.ok && res.status !== 503) {
        throw new Error(data.error || 'خطأ في تحميل الملخص');
      }
      setSummary(data);
      setDualWriteEnabled(Boolean(data.ledgerDualWriteEnabled));
      if (data.error) setError(data.error);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل الملخص');
    } finally {
      setLoadingSummary(false);
    }
  }, [month]);

  const loadEntries = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const params = new URLSearchParams({ month });
      if (empId !== 'all') params.set('empId', empId);
      const res = await fetch(`/api/admin/hr/employee-ledger?${params.toString()}`);
      const data: EmpLedgerListResponse & { error?: string } = await res.json();
      if (!res.ok && res.status !== 503) {
        throw new Error(data.error || 'خطأ في تحميل القيود');
      }
      setLedger(data);
      if (data.error) setError(data.error);
      else setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل القيود');
    } finally {
      setLoadingEntries(false);
    }
  }, [month, empId]);

  const refresh = useCallback(async () => {
    setError('');
    await Promise.all([loadSummary(), loadEntries()]);
  }, [loadSummary, loadEntries]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onExternalRefresh = () => {
      void refresh();
    };
    window.addEventListener(EMPLOYEE_LEDGER_REFRESH_EVENT, onExternalRefresh);
    return () => {
      window.removeEventListener(EMPLOYEE_LEDGER_REFRESH_EVENT, onExternalRefresh);
    };
  }, [refresh]);

  const summaryRows = useMemo(() => {
    if (!summary) return [] as EmpLedgerEmployeeSummaryRow[];
    if (empId === 'all') return summary.employees;
    const id = parseInt(empId, 10);
    return summary.employees.filter((row) => row.empId === id);
  }, [summary, empId]);

  const entries = ledger?.entries ?? [];
  const showRunningBalance = empId !== 'all';
  const entriesWithBalance = useMemo(
    () => (showRunningBalance ? attachRunningBalances(entries) : entries.map((e) => ({ ...e, runningBalance: null as number | null }))),
    [entries, showRunningBalance],
  );
  const displayTotals = empId === 'all'
    ? summary?.totals
    : summaryRows[0]
      ? {
          salaryCredits: summaryRows[0].salaryCredits,
          targetCredits: summaryRows[0].targetCredits,
          fundingCredits: summaryRows[0].fundingCredits,
          advanceDebits: summaryRows[0].advanceDebits,
          payoutDebits: summaryRows[0].payoutDebits,
          deductionDebits: summaryRows[0].deductionDebits,
          balance: summaryRows[0].balance,
          revenue: summaryRows[0].revenue,
          payoutWithinDues: summaryRows[0].payoutWithinDues,
          revenueWithdrawal: summaryRows[0].revenueWithdrawal,
          advanceExcess: summaryRows[0].advanceExcess,
        }
      : null;

  const openPayout = (row: EmpLedgerEmployeeSummaryRow) => {
    setPayoutTarget({
      empId: row.empId,
      empName: row.empName,
      monthBalance: row.balance,
    });
    setPayoutOpen(true);
  };

  const handlePayoutSuccess = (message: string) => {
    setSuccessMsg(message);
    void refresh();
  };

  const handleFundingSuccess = (message: string) => {
    setSuccessMsg(message);
    void refresh();
  };

  const handleMonthlySalarySuccess = (message: string) => {
    setSuccessMsg(message);
    void refresh();
  };

  const loading = loadingSummary || loadingEntries;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="w-4 h-4 text-primary" />
          <span>دفتر حساب الموظفين — استحقاقات · سلف · صرف</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mr-auto">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40 h-9 text-sm bg-surface border-border"
          />
          <Select value={empId} onValueChange={setEmpId}>
            <SelectTrigger className="w-44 h-9 text-sm bg-surface border-border text-foreground">
              <SelectValue placeholder="الموظف" />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border max-h-64">
              <SelectItem value="all" className="text-foreground text-sm">كل الموظفين</SelectItem>
              {employees.map((e) => (
                <SelectItem key={e.EmpID} value={String(e.EmpID)} className="text-foreground text-sm">
                  {e.EmpName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={refresh}
            disabled={loading}
            variant="outline"
            className="h-9 gap-2 border-border"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            تحديث
          </Button>
          <Button
            onClick={() => setMonthlySalaryOpen(true)}
            disabled={!dualWriteEnabled}
            variant="outline"
            className="h-9 gap-2 border-border"
            title={!dualWriteEnabled ? 'يتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED' : undefined}
          >
            <CalendarDays className="w-4 h-4" />
            ترحيل الرواتب الشهرية للدفتر
          </Button>
          <Button
            onClick={() => setFundingOpen(true)}
            disabled={!dualWriteEnabled}
            variant="outline"
            className="h-9 gap-2 border-border"
            title={!dualWriteEnabled ? 'يتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED' : undefined}
          >
            <HandCoins className="w-4 h-4" />
            تمويل من موظف
          </Button>
        </div>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 text-sm">
          {successMsg}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-sky-200/90 space-y-1">
        <p>
          مسحوبات الموظف تُغطّى بالترتيب: أولاً{' '}
          <span className="text-amber-200">سحب الايراد</span> من إيراد/تمويل الموظف للمحل · ثم{' '}
          <span className="text-sky-100">صرف</span> من الاستحقاقات (راتب + تارجت) · وما يتبقّى{' '}
          <span className="text-rose-200">سلفة</span> على الموظف.
        </p>
        <p>الرصيد = استحقاقات + تمويل من موظف − سلف − صرف مستحقات − خصومات</p>
        <p>تمويل الموظف يزيد الخزنة ويُسجَّل التزاماً في الدفتر — ليس إيراد مبيعات.</p>
        <p>أي إيراد يُسجَّل على تصنيف مربوط بالموظف من «الربط المالي» يُضاف تلقائياً كتمويل في الدفتر.</p>
        <p>الصرف الحقيقي يتم من زر &quot;صرف مستحقات&quot; — الزر اليدوي «تمويل من موظف» للحالات غير المربوطة فقط.</p>
        <Link
          href="/admin/hr?tab=employee-ledger-reconciliation"
          className="inline-flex items-center gap-1 text-xs text-sky-300 underline underline-offset-2 hover:text-white mt-1"
        >
          مراجعة تطابق الدفتر مع اليوميات والخزنة
        </Link>
      </div>

      {/* KPI cards */}
      {displayTotals && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiCard title="استحقاق راتب" value={`${fmt(displayTotals.salaryCredits)} ج.م`} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
          <KpiCard title="تارجت" value={`${fmt(displayTotals.targetCredits)} ج.م`} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
          <KpiCard title="تمويل من موظف" value={`${fmt(displayTotals.fundingCredits)} ج.م`} icon={<HandCoins className="w-5 h-5" />} variant="primary" />
          <KpiCard title="صرف (ضمن الاستحقاقات)" value={`${fmt(displayTotals.payoutWithinDues)} ج.م`} icon={<TrendingDown className="w-5 h-5" />} variant="danger" />
          <KpiCard title="سحب الايراد" value={`${fmt(displayTotals.revenueWithdrawal)} ج.م`} icon={<TrendingDown className="w-5 h-5" />} variant="warning" />
          <KpiCard title="سلفة" value={`${fmt(displayTotals.advanceExcess)} ج.م`} icon={<TrendingDown className="w-5 h-5" />} variant="danger" />
          <KpiCard title="خصومات" value={`${fmt(displayTotals.deductionDebits)} ج.م`} icon={<TrendingDown className="w-5 h-5" />} variant="warning" />
          <KpiCard title="الرصيد" value={`${fmt(displayTotals.balance)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="primary" />
        </div>
      )}

      {/* Per-employee summary */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-300">أرصدة الموظفين — {month}</h3>
          {loadingSummary && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-right font-medium">الموظف</th>
                <th className="px-4 py-3 text-right font-medium">راتب</th>
                <th className="px-4 py-3 text-right font-medium">تارجت</th>
                <th className="px-4 py-3 text-right font-medium">تمويل للمحل</th>
                <th className="px-4 py-3 text-right font-medium" title="المسحوب المتبقي بعد تغطية الإيراد — ضمن الاستحقاقات (راتب + تارجت)">صرف</th>
                <th className="px-4 py-3 text-right font-medium" title="أول ما يُسحب يُخصم من إيراد/تمويل الموظف للمحل">سحب الايراد</th>
                <th className="px-4 py-3 text-right font-medium" title="ما تجاوز (الإيراد + راتب + تارجت)">سلفة</th>
                <th className="px-4 py-3 text-right font-medium">خصومات</th>
                <th className="px-4 py-3 text-right font-medium">الرصيد</th>
                <th className="px-4 py-3 text-right font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {summaryRows.length === 0 && !loadingSummary && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-zinc-500 text-sm">
                    لا توجد قيود في هذا الشهر — الدفتر جاهز لاستقبال البيانات في المراحل القادمة
                  </td>
                </tr>
              )}
              {summaryRows.map((row) => (
                <tr
                  key={row.empId}
                  className={`hover:bg-zinc-800/30 transition-colors cursor-pointer ${
                    empId === String(row.empId) ? 'bg-primary/5' : ''
                  }`}
                  onClick={() => setEmpId(String(row.empId))}
                >
                  <td className="px-4 py-3 font-medium text-white">{row.empName}</td>
                  <td className="px-4 py-3 font-mono text-emerald-400">{fmt(row.salaryCredits)}</td>
                  <td className="px-4 py-3 font-mono text-emerald-400/80">{fmt(row.targetCredits)}</td>
                  <td className="px-4 py-3 font-mono text-sky-400">{fmt(row.fundingCredits)}</td>
                  <td className="px-4 py-3 font-mono text-rose-400/80">{fmt(row.payoutWithinDues)}</td>
                  <td className="px-4 py-3 font-mono text-amber-300">{fmt(row.revenueWithdrawal)}</td>
                  <td className="px-4 py-3 font-mono text-rose-400 font-semibold">{fmt(row.advanceExcess)}</td>
                  <td className="px-4 py-3 font-mono text-rose-300">{fmt(row.deductionDebits)}</td>
                  <td className="px-4 py-3 font-mono font-bold text-amber-400">{fmt(row.balance)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 border-border text-xs"
                        disabled={!dualWriteEnabled || row.balance <= 0}
                        title={!dualWriteEnabled ? 'يتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED' : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          openPayout(row);
                        }}
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        صرف مستحقات
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ledger entries */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-300">
            قيود الدفتر
            {ledger && (
              <span className="text-zinc-500 font-normal mr-2">
                ({entries.length} قيد — دائن {fmt(ledger.totalCredits)} / مدين {fmt(ledger.totalDebits)})
              </span>
            )}
          </h3>
          {loadingEntries && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                <th className="px-4 py-3 text-right font-medium">الموظف</th>
                <th className="px-4 py-3 text-right font-medium">الاتجاه</th>
                <th className="px-4 py-3 text-right font-medium">السبب</th>
                <th className="px-4 py-3 text-right font-medium">المبلغ</th>
                {showRunningBalance && (
                  <th className="px-4 py-3 text-right font-medium" title="الرصيد بعد كل قيد حسب ترتيب التاريخ">
                    الرصيد التراكمي
                  </th>
                )}
                <th className="px-4 py-3 text-right font-medium">شهر الرواتب</th>
                <th className="px-4 py-3 text-right font-medium">مرجع</th>
                <th className="px-4 py-3 text-right font-medium">ملاحظات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {entriesWithBalance.length === 0 && !loadingEntries && (
                <tr>
                  <td colSpan={showRunningBalance ? 9 : 8} className="px-4 py-8 text-center text-zinc-500 text-sm">
                    لا توجد قيود مسجّلة بعد
                  </td>
                </tr>
              )}
              {entriesWithBalance.map((entry) => {
                const isDailyTarget =
                  entry.entryReason === 'target' &&
                  entry.refType === 'TblEmpDailyTarget' &&
                  entry.refId != null;
                const reasonLabel =
                  entry.entryReason === 'target'
                    ? 'تارجت يومي'
                    : entry.entryReason === 'commission'
                      ? 'عمولة أخرى'
                      : EMP_LEDGER_REASON_LABELS[entry.entryReason] ?? entry.entryReason;

                return (
                  <tr
                    key={entry.id}
                    className={`hover:bg-zinc-800/30 transition-colors ${
                      isDailyTarget ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => {
                      if (isDailyTarget) setTargetDetailsId(entry.refId);
                    }}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{entry.entryDate}</td>
                    <td className="px-4 py-3 text-white">{entry.empName}</td>
                    <td className="px-4 py-3">{directionBadge(entry.entryDirection)}</td>
                    <td className="px-4 py-3 text-zinc-300">{reasonLabel}</td>
                    <td className={`px-4 py-3 font-mono font-medium ${
                      entry.entryDirection === 'credit' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {fmt(entry.amount)}
                    </td>
                    {showRunningBalance && entry.runningBalance != null && (
                      <td className={`px-4 py-3 font-mono font-bold ${
                        entry.runningBalance >= 0 ? 'text-amber-400' : 'text-rose-400'
                      }`}>
                        {fmt(entry.runningBalance)}
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{entry.payrollMonth ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {entry.refType ? `${entry.refType}${entry.refId ? ` #${entry.refId}` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500 max-w-[200px] truncate">
                      {entry.notes ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <EmployeePayoutModal
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        employee={payoutTarget}
        dualWriteEnabled={dualWriteEnabled}
        onSuccess={handlePayoutSuccess}
      />

      <EmployeeFundingModal
        open={fundingOpen}
        onClose={() => setFundingOpen(false)}
        employees={employees}
        dualWriteEnabled={dualWriteEnabled}
        onSuccess={handleFundingSuccess}
      />

      <MonthlySalaryPostModal
        open={monthlySalaryOpen}
        onClose={() => setMonthlySalaryOpen(false)}
        defaultMonth={month}
        dualWriteEnabled={dualWriteEnabled}
        onSuccess={handleMonthlySalarySuccess}
      />

      <EmployeeDailyTargetLedgerDetailsDialog
        open={targetDetailsId != null}
        dailyTargetId={targetDetailsId}
        onClose={() => setTargetDetailsId(null)}
      />

      {!dualWriteEnabled && (
        <p className="text-xs text-amber-500/80 px-1">
          صرف المستحقات وتمويل الموظف معطّل — فعّل <code className="text-amber-400">EMP_LEDGER_DUAL_WRITE_ENABLED=true</code> لتسجيل الحركات في الدفتر والخزنة.
        </p>
      )}

      <p className="text-xs text-zinc-600 px-1">
        الرصيد المعروض في الجدول حسب شهر الرواتب المحدد. عند اختيار موظف يظهر «الرصيد التراكمي» بعد كل قيد. عند الصرف يُتحقق من الرصيد الإجمالي (كل القيود غير الملغاة).
      </p>
    </div>
  );
}
