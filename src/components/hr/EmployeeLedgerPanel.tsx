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
  EmpLedgerBranchFinancialOverall,
  EmpLedgerBranchFinancialRow,
  EmpLedgerEmployeeBranchBreakdown,
  EmpLedgerEmployeeSummaryRow,
  EmpLedgerListResponse,
  EmpLedgerSummaryResponse,
  EmpLedgerTableBranchCode,
} from '@/lib/types/employee-ledger';
import { EMP_LEDGER_REASON_LABELS, EMP_LEDGER_TABLE_BRANCH_CODES } from '@/lib/types/employee-ledger';
import EmployeePayoutModal, { type EmployeePayoutTarget } from '@/components/hr/EmployeePayoutModal';
import EmployeeFundingModal from '@/components/hr/EmployeeFundingModal';
import MonthlySalaryPostModal from '@/components/hr/MonthlySalaryPostModal';
import EmployeeDailyTargetLedgerDetailsDialog from '@/components/hr/EmployeeDailyTargetLedgerDetailsDialog';
import Link from 'next/link';
import { EMPLOYEE_LEDGER_REFRESH_EVENT } from '@/lib/cashMoveDeleteClient';
import { attachRunningBalances } from '@/lib/hr/employee-ledger-running-balance';
import {
  getCairoMonthCloseAwareMonth,
  isInMonthCloseGraceWindow,
  MONTH_CLOSE_GRACE_CUTOFF_HOUR,
} from '@/lib/businessDate';
import { cn } from '@/lib/utils';

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function currentMonthStr(): string {
  return getCairoMonthCloseAwareMonth();
}

interface EmployeeOption {
  EmpID: number;
  EmpName: string;
}

interface AccessibleBranch {
  branchId: number;
  branchCode: string;
  branchName: string;
}

function shortBranchLabel(b: { branchCode: string; branchName: string }): string {
  if (b.branchCode === 'GLEEM') return 'جليم';
  if (b.branchCode === 'CAMP_CAESAR') return 'كامب شيزار';
  return b.branchName || b.branchCode;
}

function balanceTone(n: number): string {
  if (n > 0) return 'text-emerald-400';
  if (n < 0) return 'text-rose-400';
  return 'text-zinc-400';
}

function BranchRowBadge({ code }: { code: string }) {
  const gleem = code === 'GLEEM';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold',
        gleem
          ? 'border-sky-500/35 bg-sky-500/10 text-sky-300'
          : 'border-violet-500/35 bg-violet-500/10 text-violet-300',
      )}
    >
      {shortBranchLabel({ branchCode: code, branchName: code })}
    </span>
  );
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

function BranchSummaryCard({
  title,
  row,
  highlight,
}: {
  title: string;
  row: Pick<
    EmpLedgerBranchFinancialRow,
    'accrued' | 'paid' | 'advances' | 'deductions' | 'transfers' | 'balance'
  >;
  highlight?: boolean;
}) {
  const impacting = row.advances + row.deductions + row.transfers;
  return (
    <div
      className={cn(
        'rounded-xl border p-4 space-y-3',
        highlight
          ? 'border-primary/40 bg-primary/5'
          : 'border-zinc-800 bg-zinc-900/40',
      )}
    >
      <h4 className="text-sm font-bold text-white">{title}</h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-zinc-950/50 px-2.5 py-2">
          <p className="text-zinc-500 mb-0.5">إجمالي المستحقات</p>
          <p className="font-mono text-emerald-400 font-semibold">{fmt(row.accrued)} ج.م</p>
        </div>
        <div className="rounded-lg bg-zinc-950/50 px-2.5 py-2">
          <p className="text-zinc-500 mb-0.5">المصروف / المدفوع</p>
          <p className="font-mono text-rose-400 font-semibold">{fmt(row.paid)} ج.م</p>
        </div>
        <div className="rounded-lg bg-zinc-950/50 px-2.5 py-2">
          <p className="text-zinc-500 mb-0.5">سلف / خصومات / حركات</p>
          <p className="font-mono text-amber-300 font-semibold">{fmt(impacting)} ج.م</p>
        </div>
        <div className="rounded-lg bg-zinc-950/50 px-2.5 py-2">
          <p className="text-zinc-500 mb-0.5">الرصيد الحالي</p>
          <p className="font-mono text-amber-400 font-bold">{fmt(row.balance)} ج.م</p>
        </div>
      </div>
    </div>
  );
}

export default function EmployeeLedgerPanel() {
  const [month, setMonth] = useState(currentMonthStr);
  const [empId, setEmpId] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [accessibleBranches, setAccessibleBranches] = useState<AccessibleBranch[]>([]);

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
      const params = new URLSearchParams({ month, branchId: branchFilter });
      const res = await fetch(`/api/admin/hr/employee-ledger/summary?${params}`);
      const data: EmpLedgerSummaryResponse & {
        error?: string;
        accessibleBranches?: AccessibleBranch[];
      } = await res.json();
      if (!res.ok && res.status !== 503) {
        throw new Error(data.error || 'خطأ في تحميل الملخص');
      }
      setSummary(data);
      setDualWriteEnabled(Boolean(data.ledgerDualWriteEnabled));
      if (Array.isArray(data.accessibleBranches)) {
        setAccessibleBranches(data.accessibleBranches);
      }
      if (data.error) setError(data.error);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل الملخص');
    } finally {
      setLoadingSummary(false);
    }
  }, [month, branchFilter]);

  const loadEntries = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const params = new URLSearchParams({ month, branchId: branchFilter });
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
  }, [month, empId, branchFilter]);

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
  const showBranchColumn = branchFilter === 'all';
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

  const branchFinancial = summary?.branchFinancial;
  type BranchCard = {
    key: string;
    title: string;
    row: EmpLedgerBranchFinancialRow | EmpLedgerBranchFinancialOverall;
    highlight?: boolean;
  };
  const branchCards = useMemo((): BranchCard[] => {
    if (!branchFinancial) return [];
    if (branchFilter !== 'all') {
      const only = branchFinancial.branches[0];
      if (!only) return [];
      return [{ key: String(only.branchId), title: shortBranchLabel(only), row: only }];
    }
    return [
      ...branchFinancial.branches.map((b) => ({
        key: String(b.branchId),
        title: shortBranchLabel(b),
        row: b as EmpLedgerBranchFinancialRow | EmpLedgerBranchFinancialOverall,
      })),
      {
        key: 'overall',
        title: 'الإجمالي العام',
        row: branchFinancial.overall,
        highlight: true,
      },
    ];
  }, [branchFinancial, branchFilter]);

  const openPayout = (row: EmpLedgerEmployeeSummaryRow) => {
    setPayoutTarget({
      empId: row.empId,
      empName: row.empName,
      // Filter-scoped balance (session payout still validates branch account server-side).
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
  const entryColSpan = (showRunningBalance ? 9 : 8) + (showBranchColumn ? 1 : 0);

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
          {isInMonthCloseGraceWindow() ? (
            <span className="text-[11px] text-amber-400/90 max-w-[220px] leading-snug">
              حتى {MONTH_CLOSE_GRACE_CUTOFF_HOUR}:00 صباحًا يُحسب اليوم السابق لإقفال الشهر
            </span>
          ) : null}
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
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setBranchFilter('all')}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                branchFilter === 'all'
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-border bg-surface-muted text-muted-foreground hover:text-foreground',
              )}
            >
              الكل
            </button>
            {accessibleBranches.map((b) => (
              <button
                key={b.branchId}
                type="button"
                onClick={() => setBranchFilter(String(b.branchId))}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                  branchFilter === String(b.branchId)
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-border bg-surface-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {shortBranchLabel(b)}
              </button>
            ))}
          </div>
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
          مسحوبات الموظف تُصنَّف حسب نوع القيد: أولاً{' '}
          <span className="text-amber-200">سحب الايراد</span> من تمويل/إيراد الموظف للمحل ·{' '}
          <span className="text-rose-200">سلفة</span> = سلف الخزنة المسجّلة على الموظف ·{' '}
          <span className="text-sky-100">صرف</span> = صرف مستحقات فعلي من زر «صرف مستحقات» فقط.
        </p>
        <p>الرصيد = استحقاقات + تمويل من موظف − سلف − صرف مستحقات − خصومات</p>
        <p>كل حركة تُنسب لفرع القيد الأصلي (BranchID) — ليس فرع التعيين الحالي للموظف.</p>
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

      {/* Branch financial summary */}
      {branchCards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {branchCards.map((c) => (
            <BranchSummaryCard
              key={c.key}
              title={c.title}
              row={c.row}
              highlight={c.highlight}
            />
          ))}
        </div>
      )}

      {/* KPI cards */}
      {displayTotals && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiCard title="استحقاق راتب" value={`${fmt(displayTotals.salaryCredits)} ج.م`} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
          <KpiCard title="تارجت" value={`${fmt(displayTotals.targetCredits)} ج.م`} icon={<TrendingUp className="w-5 h-5" />} variant="success" />
          <KpiCard title="تمويل من موظف" value={`${fmt(displayTotals.fundingCredits)} ج.م`} icon={<HandCoins className="w-5 h-5" />} variant="primary" />
          <KpiCard title="صرف مستحقات" value={`${fmt(displayTotals.payoutWithinDues)} ج.م`} icon={<TrendingDown className="w-5 h-5" />} variant="danger" />
          <KpiCard title="سحب الايراد" value={`${fmt(displayTotals.revenueWithdrawal)} ج.م`} icon={<TrendingDown className="w-5 h-5" />} variant="warning" />
          <KpiCard title="سلفة" value={`${fmt(displayTotals.advanceExcess)} ج.م`} icon={<TrendingDown className="w-5 h-5" />} variant="danger" />
          <KpiCard title="خصومات" value={`${fmt(displayTotals.deductionDebits)} ج.م`} icon={<TrendingDown className="w-5 h-5" />} variant="warning" />
          <KpiCard title="الرصيد" value={`${fmt(displayTotals.balance)} ج.م`} icon={<Scale className="w-5 h-5" />} variant="primary" />
        </div>
      )}

      {/* Per-employee summary — 2 rows per employee (GLEEM + CAMP_CAESAR) */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-300">أرصدة الموظفين حسب الفرع — {month}</h3>
          {loadingSummary && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-right font-medium">الموظف</th>
                <th className="px-4 py-3 text-right font-medium">الفرع</th>
                <th className="px-4 py-3 text-right font-medium">راتب</th>
                <th className="px-4 py-3 text-right font-medium">تارجت</th>
                <th className="px-4 py-3 text-right font-medium">تمويل للمحل</th>
                <th className="px-4 py-3 text-right font-medium" title="صرف مستحقات فعلي من زر صرف مستحقات فقط">صرف</th>
                <th className="px-4 py-3 text-right font-medium" title="أول ما يُسحب يُخصم من إيراد/تمويل الموظف للمحل">سحب الإيراد</th>
                <th className="px-4 py-3 text-right font-medium" title="سلف الخزنة المسجّلة على الموظف (بعد خصم التمويل)">سلفة</th>
                <th className="px-4 py-3 text-right font-medium">خصومات</th>
                <th className="px-4 py-3 text-right font-medium">رصيد الفرع</th>
                <th className="px-4 py-3 text-right font-medium">الرصيد الإجمالي</th>
                <th className="px-4 py-3 text-right font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.length === 0 && !loadingSummary && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-zinc-500 text-sm">
                    لا توجد قيود في هذا الشهر — الدفتر جاهز لاستقبال البيانات في المراحل القادمة
                  </td>
                </tr>
              )}
              {summaryRows.map((row) => {
                const branchCodes = EMP_LEDGER_TABLE_BRANCH_CODES as readonly EmpLedgerTableBranchCode[];
                const selected = empId === String(row.empId);
                const overall = row.overallBalance ?? row.balance;
                return branchCodes.map((code, idx) => {
                  const br: EmpLedgerEmployeeBranchBreakdown = row.branches?.[code] ?? {
                    branchId: 0,
                    branchCode: code,
                    branchName: code,
                    salary: 0,
                    target: 0,
                    funding: 0,
                    payout: 0,
                    revenueWithdrawal: 0,
                    advance: 0,
                    deductions: 0,
                    balance: 0,
                    salaryCredits: 0,
                    targetCredits: 0,
                    fundingCredits: 0,
                    advanceDebits: 0,
                    payoutDebits: 0,
                    deductionDebits: 0,
                  };
                  const isGleem = code === 'GLEEM';
                  return (
                    <tr
                      key={`${row.empId}-${code}`}
                      className={cn(
                        'transition-colors cursor-pointer border-b border-zinc-800/50',
                        isGleem ? 'bg-sky-950/20' : 'bg-violet-950/15',
                        selected && 'ring-1 ring-inset ring-primary/30',
                        'hover:brightness-110',
                      )}
                      onClick={() => setEmpId(String(row.empId))}
                    >
                      {idx === 0 && (
                        <td
                          rowSpan={2}
                          className="px-4 py-3 font-medium text-white align-middle border-l border-zinc-800/40"
                        >
                          {row.empName}
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <BranchRowBadge code={code} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-emerald-400">{fmt(br.salary)}</td>
                      <td className="px-4 py-2.5 font-mono text-emerald-400/80">{fmt(br.target)}</td>
                      <td className="px-4 py-2.5 font-mono text-sky-400">{fmt(br.funding)}</td>
                      <td className="px-4 py-2.5 font-mono text-rose-400/80">{fmt(br.payout)}</td>
                      <td className="px-4 py-2.5 font-mono text-amber-300">{fmt(br.revenueWithdrawal)}</td>
                      <td className="px-4 py-2.5 font-mono text-rose-400 font-semibold">{fmt(br.advance)}</td>
                      <td className="px-4 py-2.5 font-mono text-rose-300">{fmt(br.deductions)}</td>
                      <td className={cn('px-4 py-2.5 font-mono font-bold', balanceTone(br.balance))}>
                        {fmt(br.balance)}
                      </td>
                      {idx === 0 && (
                        <td
                          rowSpan={2}
                          className={cn(
                            'px-4 py-3 font-mono font-bold align-middle border-r border-zinc-800/40',
                            balanceTone(overall),
                          )}
                        >
                          {fmt(overall)}
                        </td>
                      )}
                      {idx === 0 && (
                        <td rowSpan={2} className="px-4 py-3 align-middle">
                          <div className="flex flex-wrap gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1 border-border text-xs"
                              disabled={!dualWriteEnabled || row.balance <= 0}
                              title={
                                !dualWriteEnabled
                                  ? 'يتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED'
                                  : undefined
                              }
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
                      )}
                    </tr>
                  );
                });
              })}
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
                {showBranchColumn && (
                  <th className="px-4 py-3 text-right font-medium">الفرع</th>
                )}
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
                  <td colSpan={entryColSpan} className="px-4 py-8 text-center text-zinc-500 text-sm">
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
                    {showBranchColumn && (
                      <td className="px-4 py-3 text-xs text-zinc-400">
                        {entry.branchCode || entry.branchName
                          ? shortBranchLabel({
                              branchCode: entry.branchCode ?? '',
                              branchName: entry.branchName ?? '',
                            })
                          : '—'}
                      </td>
                    )}
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
        الرصيد المعروض حسب شهر الرواتب وفلتر الفرع. الصرف يتحقق من رصيد فرع الجلسة النشط. الإجمالي العام = مجموع أرصدة الفروع بدون تكرار.
      </p>
    </div>
  );
}
