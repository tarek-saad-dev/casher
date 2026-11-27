'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen, Loader2, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Scale, Wallet, HandCoins, CalendarDays, Gift, ArrowLeftRight, Banknote,
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
  EmpLedgerTableBranch,
} from '@/lib/types/employee-ledger';
import { EMP_LEDGER_REASON_LABELS } from '@/lib/types/employee-ledger';
import { hrBranchLabel } from '@/lib/hr/legacyHrBranchPolicy';
import EmployeePayoutModal, { type EmployeePayoutTarget } from '@/components/hr/EmployeePayoutModal';
import EmployeeFundingModal from '@/components/hr/EmployeeFundingModal';
import EmployeeAdvanceRepaymentModal, {
  type EmployeeAdvanceRepaymentTarget,
} from '@/components/hr/EmployeeAdvanceRepaymentModal';
import EmployeeAdditionalTargetModal from '@/components/hr/EmployeeAdditionalTargetModal';
import EmployeeInterBranchSettlementModal, {
  type InterBranchSettlementTarget,
} from '@/components/hr/EmployeeInterBranchSettlementModal';
import MonthlySalaryPostModal from '@/components/hr/MonthlySalaryPostModal';
import EmployeeDailyTargetLedgerDetailsDialog from '@/components/hr/EmployeeDailyTargetLedgerDetailsDialog';
import Link from 'next/link';
import { EMPLOYEE_LEDGER_REFRESH_EVENT } from '@/lib/cashMoveDeleteClient';
import { attachRunningBalances } from '@/lib/hr/employee-ledger-running-balance';
import { calculateBranchLedgerLiquidity } from '@/lib/hr/employee-ledger-liquidity';
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
  return hrBranchLabel(b);
}

/** Row tint + badge per ledger table branch, by index in `tableBranches`. */
const LEDGER_BRANCH_TONES = [
  { row: 'bg-info-soft', badge: 'border-info/35 bg-info-soft text-info' },
  { row: 'bg-brand-soft', badge: 'border-brand/35 bg-brand-soft text-brand' },
  { row: 'bg-warning-soft', badge: 'border-warning/35 bg-warning-soft text-warning' },
  { row: 'bg-success-soft', badge: 'border-success/35 bg-success-soft text-success' },
  { row: 'bg-destructive-soft', badge: 'border-destructive/35 bg-destructive-soft text-destructive' },
] as const;

function ledgerBranchTone(idx: number) {
  return LEDGER_BRANCH_TONES[idx % LEDGER_BRANCH_TONES.length]!;
}

function balanceTone(n: number): string {
  if (n > 0) return 'text-success';
  if (n < 0) return 'text-destructive';
  return 'text-muted-foreground';
}

function BranchRowBadge({ branch, idx }: { branch: EmpLedgerTableBranch; idx: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold',
        ledgerBranchTone(idx).badge,
      )}
    >
      {branch.label || shortBranchLabel(branch)}
    </span>
  );
}

function directionBadge(direction: string) {
  if (direction === 'credit') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <TrendingUp className="w-3 h-3" />
        دائن
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
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
          : 'border-border bg-card',
      )}
    >
      <h4 className="text-sm font-bold text-foreground">{title}</h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-background px-2.5 py-2">
          <p className="text-muted-foreground mb-0.5">إجمالي المستحقات</p>
          <p className="font-mono text-success font-semibold">{fmt(row.accrued)} ج.م</p>
        </div>
        <div className="rounded-lg bg-background px-2.5 py-2">
          <p className="text-muted-foreground mb-0.5">المصروف / المدفوع</p>
          <p className="font-mono text-destructive font-semibold">{fmt(row.paid)} ج.م</p>
        </div>
        <div className="rounded-lg bg-background px-2.5 py-2">
          <p className="text-muted-foreground mb-0.5">سلف / خصومات / حركات</p>
          <p className="font-mono text-warning font-semibold">{fmt(impacting)} ج.م</p>
        </div>
        <div className="rounded-lg bg-background px-2.5 py-2">
          <p className="text-muted-foreground mb-0.5">الرصيد الحالي</p>
          <p className="font-mono text-warning font-bold">{fmt(row.balance)} ج.م</p>
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
  const [operatingBranch, setOperatingBranch] = useState<AccessibleBranch | null>(null);

  const [summary, setSummary] = useState<EmpLedgerSummaryResponse | null>(null);
  const [ledger, setLedger] = useState<EmpLedgerListResponse | null>(null);

  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [dualWriteEnabled, setDualWriteEnabled] = useState(false);
  const [payoutTarget, setPayoutTarget] = useState<EmployeePayoutTarget | null>(null);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [repayTarget, setRepayTarget] = useState<EmployeeAdvanceRepaymentTarget | null>(null);
  const [repayOpen, setRepayOpen] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [additionalTargetOpen, setAdditionalTargetOpen] = useState(false);
  const [settlementTarget, setSettlementTarget] = useState<InterBranchSettlementTarget | null>(null);
  const [settlementOpen, setSettlementOpen] = useState(false);
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
        operatingBranch?: AccessibleBranch | null;
      } = await res.json();
      if (!res.ok && res.status !== 503) {
        throw new Error(data.error || 'خطأ في تحميل الملخص');
      }
      setSummary(data);
      setDualWriteEnabled(Boolean(data.ledgerDualWriteEnabled));
      if (Array.isArray(data.accessibleBranches)) {
        setAccessibleBranches(data.accessibleBranches);
      }
      if (data.operatingBranch && data.operatingBranch.branchId > 0) {
        setOperatingBranch(data.operatingBranch);
      } else {
        setOperatingBranch(null);
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

  const tableBranches = summary?.tableBranches ?? [];
  /** Active roster plus anyone who appears in this month's summary (incl. inactive with ledger activity). */
  const employeeOptions = useMemo(() => {
    const byId = new Map<number, EmployeeOption>();
    for (const e of employees) {
      byId.set(e.EmpID, e);
    }
    for (const row of summary?.employees ?? []) {
      if (!byId.has(row.empId)) {
        byId.set(row.empId, { EmpID: row.empId, EmpName: row.empName });
      }
    }
    return [...byId.values()].sort((a, b) => a.EmpName.localeCompare(b.EmpName, 'ar'));
  }, [employees, summary?.employees]);

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

  // Cash forecast is for every employee, even if an employee is selected in the ledger table.
  // Never offset one employee's negative account against another's positive dues.
  const branchLiquidity = useMemo(() => {
    if (!summary || (summary.month && summary.month !== month)) return [];
    const allBranches = calculateBranchLedgerLiquidity(summary.tableBranches ?? [], summary.employees ?? []);
    return branchFilter === 'all'
      ? allBranches
      : allBranches.filter((row) => String(row.branchId) === branchFilter);
  }, [summary, branchFilter, month]);
  const totalCashRequired = Math.round(
    branchLiquidity.reduce((sum, row) => sum + row.cashRequired, 0) * 100,
  ) / 100;

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

  const operatingBranchLabel = operatingBranch ? shortBranchLabel(operatingBranch) : null;
  const branchViewMatchesOperating =
    operatingBranch != null
    && branchFilter !== 'all'
    && Number(branchFilter) === operatingBranch.branchId;

  const openPayout = (
    row: EmpLedgerEmployeeSummaryRow,
    branchBreakdown: EmpLedgerEmployeeBranchBreakdown,
  ) => {
    if (!operatingBranch || !branchViewMatchesOperating) return;
    if (branchBreakdown.branchId !== operatingBranch.branchId) return;
    if (branchBreakdown.balance <= 0) return;
    setPayoutTarget({
      empId: row.empId,
      empName: row.empName,
      payrollMonth: month,
      branchId: operatingBranch.branchId,
      branchLabel: operatingBranchLabel ?? shortBranchLabel(operatingBranch),
      monthBalance: branchBreakdown.balance,
    });
    setPayoutOpen(true);
  };

  const openAdvanceRepayment = (
    row: EmpLedgerEmployeeSummaryRow,
    branchBreakdown: EmpLedgerEmployeeBranchBreakdown,
  ) => {
    // Any accessible branch row — API stamps Cash IN / ledger on body.branchId after ops ACL.
    if (!dualWriteEnabled) return;
    if (!branchBreakdown.branchId || branchBreakdown.branchId <= 0) return;
    setRepayTarget({
      empId: row.empId,
      empName: row.empName,
      branchId: branchBreakdown.branchId,
      branchLabel: shortBranchLabel(branchBreakdown),
      // Modal loads all-time debt (incl. carry-forward); month balance is only a hint.
      outstandingDebt: Math.max(0, -branchBreakdown.balance),
    });
    setRepayOpen(true);
  };

  const handlePayoutSuccess = (message: string) => {
    setSuccessMsg(message);
    void refresh();
  };

  const handleFundingSuccess = (message: string) => {
    setSuccessMsg(message);
    void refresh();
  };

  const handleRepaySuccess = (message: string) => {
    setSuccessMsg(message);
    void refresh();
  };

  const handleAdditionalTargetSuccess = (message: string) => {
    setSuccessMsg(message);
    void refresh();
  };

  const handleSettlementSuccess = (message: string) => {
    setSuccessMsg(message);
    void refresh();
  };

  function employeeHasCrossBranchSettlementOpportunity(row: EmpLedgerEmployeeSummaryRow): boolean {
    const parts = Object.values(row.branches ?? {});
    const hasPos = parts.some((p) => p.balance > 0);
    const hasNeg = parts.some((p) => p.balance < 0);
    return hasPos && hasNeg;
  }

  const handleMonthlySalarySuccess = (message: string) => {
    setSuccessMsg(message);
    void refresh();
  };

  const additionalTargetDefaultEmpId =
    empId !== 'all' && Number.isFinite(Number(empId)) ? Number(empId) : null;
  const additionalTargetDefaultBranchId =
    branchFilter !== 'all' && Number.isFinite(Number(branchFilter))
      ? Number(branchFilter)
      : null;

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
            <span className="text-[11px] text-warning max-w-[220px] leading-snug">
              حتى {MONTH_CLOSE_GRACE_CUTOFF_HOUR}:00 صباحًا يُحسب اليوم السابق لإقفال الشهر
            </span>
          ) : null}
          <Select value={empId} onValueChange={setEmpId}>
            <SelectTrigger className="w-44 h-9 text-sm bg-surface border-border text-foreground">
              <SelectValue placeholder="الموظف" />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border max-h-64">
              <SelectItem value="all" className="text-foreground text-sm">كل الموظفين</SelectItem>
              {employeeOptions.map((e) => (
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
          <Button
            onClick={() => setAdditionalTargetOpen(true)}
            disabled={!dualWriteEnabled}
            variant="outline"
            className="h-9 gap-2 border-border"
            title={
              !dualWriteEnabled
                ? 'يتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED'
                : 'إضافة تارجت إضافي (بونص) لموظف في فرع معيّن'
            }
          >
            <Gift className="w-4 h-4" />
            تارجت إضافي
          </Button>
        </div>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-success/30 bg-success-soft text-success text-sm">
          {successMsg}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-warning/30 bg-warning-soft text-warning text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-lg border border-info/20 bg-info-soft p-4 text-sm text-info space-y-1">
        <p>
          مسحوبات الموظف تُصنَّف حسب نوع القيد: أولاً{' '}
          <span className="text-warning">سحب الايراد</span> من تمويل/إيراد الموظف للمحل ·{' '}
          <span className="text-destructive">سلفة</span> = سلف الخزنة المسجّلة على الموظف ·{' '}
          <span className="text-info">صرف</span> = صرف مستحقات فعلي من زر «صرف مستحقات» فقط.
        </p>
        <p>الرصيد = استحقاقات + تمويل من موظف − سلف − صرف مستحقات − خصومات</p>
        <p>كل حركة تُنسب لفرع القيد الأصلي (BranchID) — ليس فرع التعيين الحالي للموظف.</p>
        <p>تمويل الموظف يزيد الخزنة ويُسجَّل التزاماً في الدفتر — ليس إيراد مبيعات.</p>
        <p>أي إيراد يُسجَّل على تصنيف مربوط بالموظف من «الربط المالي» يُضاف تلقائياً كتمويل في الدفتر.</p>
        <p>الصرف الحقيقي يتم من زر &quot;صرف مستحقات&quot; — الزر اليدوي «تمويل من موظف» للحالات غير المربوطة فقط.</p>
        <Link
          href="/admin/hr?tab=employee-ledger-reconciliation"
          className="inline-flex items-center gap-1 text-xs text-info underline underline-offset-2 hover:text-foreground mt-1"
        >
          مراجعة تطابق الدفتر مع اليوميات والخزنة
        </Link>
      </div>

      {/* Cash required to settle positive employee balances per branch (selected month). */}
      {branchLiquidity.length > 0 && (
        <section
          className="overflow-hidden rounded-xl border border-success/25 bg-card"
          aria-label="إجمالي أرصدة الفروع واحتياج السيولة"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Wallet className="h-4 w-4 text-success" />
              إجمالي أرصدة كل فرع — احتياج السيولة
            </h3>
            <span className="text-xs text-muted-foreground">شهر {month} · كل الموظفين</span>
          </div>
          <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {branchLiquidity.map((row) => (
              <div key={row.branchId} className="rounded-lg border border-border bg-background p-4">
                <p className="mb-3 text-sm font-semibold text-foreground">
                  {row.label || shortBranchLabel(row)}
                </p>
                <p className="text-xs text-muted-foreground">المطلوب سحبه من سيولة الفرع</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-success">
                  {fmt(row.cashRequired)} <span className="text-sm font-medium">ج.م</span>
                </p>
                <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">رصيد الفرع (الصافي)</span>
                    <span className={cn('font-mono font-semibold', balanceTone(row.netBalance))}>
                      {fmt(row.netBalance)} ج.م
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">سلف / أرصدة سالبة على الموظفين</span>
                    <span className="font-mono text-destructive">{fmt(row.employeeDebt)} ج.م</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-success-soft px-4 py-3">
            <span className="text-sm font-medium text-foreground">
              إجمالي المطلوب من سيولة {branchFilter === 'all' ? 'الفروع' : 'الفرع'}
            </span>
            <strong className="font-mono text-xl tabular-nums text-success">
              {fmt(totalCashRequired)} ج.م
            </strong>
          </div>
          <p className="px-4 pb-3 pt-2 text-xs leading-relaxed text-muted-foreground">
            مجموع الأرصدة الموجبة لكل موظف في كل فرع خلال الشهر المحدد.
            الأرصدة السالبة لا تقلل المبلغ المطلوب للصرف، وتظهر منفصلة.
            هذا تقدير للمستحقات وليس رصيد الخزنة الفعلي.
          </p>
        </section>
      )}

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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
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

      {/* Per-employee summary — one row per tenant branch (summary.tableBranches) */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-card flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">أرصدة الموظفين حسب الفرع — {month}</h3>
          {loadingSummary && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
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
                  <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    لا توجد قيود في هذا الشهر — الدفتر جاهز لاستقبال البيانات في المراحل القادمة
                  </td>
                </tr>
              )}
              {summaryRows.map((row) => {
                const selected = empId === String(row.empId);
                const overall = row.overallBalance ?? row.balance;
                const rowSpan = Math.max(tableBranches.length, 1);
                return tableBranches.map((tb, idx) => {
                  const code = tb.branchCode;
                  const br: EmpLedgerEmployeeBranchBreakdown = row.branches?.[code] ?? {
                    branchId: 0,
                    branchCode: code,
                    branchName: tb.branchName,
                    salary: 0,
                    target: 0,
                    funding: 0,
                    payout: 0,
                    revenueWithdrawal: 0,
                    advance: 0,
                    deductions: 0,
                    settlementNet: 0,
                    balance: 0,
                    salaryCredits: 0,
                    targetCredits: 0,
                    fundingCredits: 0,
                    repaymentCredits: 0,
                    settlementCredits: 0,
                    advanceDebits: 0,
                    payoutDebits: 0,
                    deductionDebits: 0,
                    settlementDebits: 0,
                  };
                  return (
                    <tr
                      key={`${row.empId}-${code}`}
                      className={cn(
                        'transition-colors cursor-pointer border-b border-border',
                        ledgerBranchTone(idx).row,
                        selected && 'ring-1 ring-inset ring-primary/30',
                        'hover:brightness-110',
                      )}
                      onClick={() => setEmpId(String(row.empId))}
                    >
                      {idx === 0 && (
                        <td
                          rowSpan={rowSpan}
                          className="px-4 py-3 font-medium text-foreground align-middle border-l border-border"
                        >
                          {row.empName}
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <BranchRowBadge branch={tb} idx={idx} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-success">{fmt(br.salary)}</td>
                      <td className="px-4 py-2.5 font-mono text-success">{fmt(br.target)}</td>
                      <td className="px-4 py-2.5 font-mono text-info">{fmt(br.funding)}</td>
                      <td className="px-4 py-2.5 font-mono text-destructive">{fmt(br.payout)}</td>
                      <td className="px-4 py-2.5 font-mono text-warning">{fmt(br.revenueWithdrawal)}</td>
                      <td className="px-4 py-2.5 font-mono text-destructive font-semibold">{fmt(br.advance)}</td>
                      <td className="px-4 py-2.5 font-mono text-destructive">{fmt(br.deductions)}</td>
                      <td className={cn('px-4 py-2.5 font-mono font-bold', balanceTone(br.balance))}>
                        {fmt(br.balance)}
                      </td>
                      {idx === 0 && (
                        <td
                          rowSpan={rowSpan}
                          className={cn(
                            'px-4 py-3 font-mono font-bold align-middle border-r border-border',
                            balanceTone(overall),
                          )}
                        >
                          {fmt(overall)}
                        </td>
                      )}
                      <td className="px-4 py-3 align-middle">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1 border-border text-xs"
                            disabled={
                              !dualWriteEnabled
                              || !branchViewMatchesOperating
                              || br.branchId !== operatingBranch?.branchId
                              || br.balance <= 0
                            }
                            title={
                              !dualWriteEnabled
                                ? 'يتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED'
                                : !operatingBranch
                                  ? 'تعذر تحديد الفرع التشغيلي النشط'
                                  : branchFilter === 'all'
                                    ? `اختر الفرع التشغيلي النشط (${operatingBranchLabel}) وحدّث رصيد الشهر — لا يُستخدم الرصيد المجمّع`
                                    : !branchViewMatchesOperating
                                      ? `هذا الفلتر ليس الفرع التشغيلي النشط (${operatingBranchLabel}). اختره ثم حدّث رصيد الشهر قبل التأكيد`
                                      : br.branchId !== operatingBranch.branchId
                                        ? 'صرف هذا الصف متاح فقط لصف الفرع التشغيلي النشط'
                                        : br.balance <= 0
                                          ? 'لا يوجد مستحقات موجبة في هذا الفرع'
                                          : undefined
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              openPayout(row, br);
                            }}
                          >
                            <Wallet className="w-3.5 h-3.5" />
                            صرف مستحقات
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn(
                              'h-8 gap-1 text-xs',
                              br.balance < 0
                                ? 'border-success/60 text-success'
                                : 'border-border text-muted-foreground',
                            )}
                            disabled={!dualWriteEnabled || !(br.branchId > 0)}
                            title={
                              !dualWriteEnabled
                                ? 'يتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED'
                                : !(br.branchId > 0)
                                  ? 'فرع الصف غير معروف'
                                  : `استلام رد سلفة في خزينة ${shortBranchLabel(tb)} (مديونية فعلية شاملة المرحّل)`
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              openAdvanceRepayment(row, br);
                            }}
                          >
                            <Banknote className="w-3.5 h-3.5" />
                            رد سلفة
                          </Button>
                          {idx === 0 && employeeHasCrossBranchSettlementOpportunity(row) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1 border-border text-xs"
                              disabled={!dualWriteEnabled}
                              title={
                                !dualWriteEnabled
                                  ? 'يتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED'
                                  : 'تسوية رصيد موجب في فرع مع مديونية في فرع آخر'
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                setSettlementTarget({
                                  empId: row.empId,
                                  empName: row.empName,
                                });
                                setSettlementOpen(true);
                              }}
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                              تسوية بين الفروع
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ledger entries */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            قيود الدفتر
            {ledger && (
              <span className="text-muted-foreground font-normal mr-2">
                ({entries.length} قيد — دائن {fmt(ledger.totalCredits)} / مدين {fmt(ledger.totalDebits)})
              </span>
            )}
          </h3>
          {loadingEntries && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
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
            <tbody className="divide-y divide-border">
              {entriesWithBalance.length === 0 && !loadingEntries && (
                <tr>
                  <td colSpan={entryColSpan} className="px-4 py-8 text-center text-muted-foreground text-sm">
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
                    className={`hover:bg-surface-muted transition-colors ${
                      isDailyTarget ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => {
                      if (isDailyTarget) setTargetDetailsId(entry.refId);
                    }}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{entry.entryDate}</td>
                    <td className="px-4 py-3 text-foreground">{entry.empName}</td>
                    {showBranchColumn && (
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {entry.branchCode || entry.branchName
                          ? shortBranchLabel({
                              branchCode: entry.branchCode ?? '',
                              branchName: entry.branchName ?? '',
                            })
                          : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3">{directionBadge(entry.entryDirection)}</td>
                    <td className="px-4 py-3 text-foreground">{reasonLabel}</td>
                    <td className={`px-4 py-3 font-mono font-medium ${
                      entry.entryDirection === 'credit' ? 'text-success' : 'text-destructive'
                    }`}>
                      {fmt(entry.amount)}
                    </td>
                    {showRunningBalance && entry.runningBalance != null && (
                      <td className={`px-4 py-3 font-mono font-bold ${
                        entry.runningBalance >= 0 ? 'text-warning' : 'text-destructive'
                      }`}>
                        {fmt(entry.runningBalance)}
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{entry.payrollMonth ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {entry.refType ? `${entry.refType}${entry.refId ? ` #${entry.refId}` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
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

      <EmployeeAdvanceRepaymentModal
        open={repayOpen}
        onClose={() => {
          setRepayOpen(false);
          setRepayTarget(null);
        }}
        employee={repayTarget}
        dualWriteEnabled={dualWriteEnabled}
        onSuccess={handleRepaySuccess}
      />

      <EmployeeAdditionalTargetModal
        open={additionalTargetOpen}
        onClose={() => setAdditionalTargetOpen(false)}
        employees={employees}
        branches={accessibleBranches}
        dualWriteEnabled={dualWriteEnabled}
        defaultEmpId={additionalTargetDefaultEmpId}
        defaultBranchId={additionalTargetDefaultBranchId}
        onSuccess={handleAdditionalTargetSuccess}
      />

      <EmployeeInterBranchSettlementModal
        open={settlementOpen}
        onClose={() => {
          setSettlementOpen(false);
          setSettlementTarget(null);
        }}
        employee={settlementTarget}
        payrollMonth={month}
        dualWriteEnabled={dualWriteEnabled}
        onSuccess={handleSettlementSuccess}
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
        <p className="text-xs text-warning px-1">
          صرف المستحقات وتمويل الموظف والتارجت الإضافي معطّل — فعّل <code className="text-warning">EMP_LEDGER_DUAL_WRITE_ENABLED=true</code> لتسجيل الحركات في الدفتر.
        </p>
      )}

      <p className="text-xs text-warning px-1" data-testid="dues-settlement-branch-rule">
        {branchViewMatchesOperating
          ? `صرف المستحقات يُسوّي رصيد شهر ${month} للفرع التشغيلي النشط فقط (${operatingBranchLabel}) بعد تحديث هذا العرض. لا يُستخدم رصيد فرع آخر ولا الرصيد المجمّع.`
          : `صرف المستحقات متوقف حتى تختار الفرع التشغيلي النشط${operatingBranchLabel ? ` (${operatingBranchLabel})` : ''} ويُحدَّث رصيد شهره. عرض «الكل» أو فرع غير فرع الجلسة لا يُسوّي الرصيد المعروض.`}
      </p>
      <p className="text-xs text-success px-1" data-testid="advance-repayment-branch-rule">
        رد السلفة متاح لكل صف فرع مصرح به: الاستلام يُسجَّل في خزينة ذلك الفرع فقط، والمديونية تُجلب من الخادم (شاملة المرحّل) دون تجاوزها.
      </p>
      <p className="text-xs text-muted-foreground px-1">
        الرصيد المعروض حسب شهر الرواتب وفلتر الفرع. الإجمالي العام = مجموع أرصدة الفروع بدون تكرار.
      </p>
    </div>
  );
}
