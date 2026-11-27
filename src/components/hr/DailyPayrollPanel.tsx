'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CalendarDays, Loader2, Zap, Send, RefreshCw,
  CheckCircle2, AlertCircle, Users, Banknote,
  X,
  AlertTriangle, ShieldCheck, ClipboardList, Timer, BookOpen, Target,
  ChevronLeft, ChevronRight, Lock, Unlock, Wrench, CalendarClock, Moon, ArrowLeftRight,
} from 'lucide-react';
import Link from 'next/link';
import KpiCard from '@/components/shared/KpiCard';
import { getBusinessDateStr } from '@/lib/timeUtils';
import { shiftCalendarDate } from '@/lib/businessDate';
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
import DailyPayrollSmartFixModal from '@/components/hr/DailyPayrollSmartFixModal';
import SmartAttendanceFixDialog from '@/components/hr/SmartAttendanceFixDialog';
import MoveEmployeeDayBranchModal, {
  type MoveEmployeeDayBranchTarget,
} from '@/components/hr/MoveEmployeeDayBranchModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/components/providers/PermissionsProvider';
import { useSession } from '@/hooks/useSession';
import type {
  DailyPayrollDateBranchSummary,
  DailyPayrollOpenDayItem,
  DailyPayrollReadinessResult,
  SmartFixActionResult,
} from '@/lib/hr/dailyPayrollReadiness.types';
import {
  blockerMessageAr,
  employeeStatusFromReadiness,
  employeeStatusTone,
  formatWorkDateAr,
  openDayChipLabel,
  openDayChipTone,
  recommendedStateLabelAr,
  recommendedStateTone,
  selectionKey,
  shortBranchName,
  summarizeOpenDays,
  workflowSteps,
} from '@/lib/hr/dailyPayrollClosingUi';
import { hrBranchPalette, parseHrBranchOptions, type HrBranchOption } from '@/lib/hr/hrBranchUi';
interface PayrollRow {
  ID: number;
  EmpID: number;
  EmpName: string;
  BranchID: number;
  BranchCode: string;
  BranchName: string;
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
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
      {EMPLOYMENT_TYPE_LABELS[type as keyof typeof EMPLOYMENT_TYPE_LABELS]}
    </span>
  );
}

function payrollMethodBadge(method: string | null) {
  if (!method || !(method in PAYROLL_METHOD_LABELS)) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
      {PAYROLL_METHOD_LABELS[method as keyof typeof PAYROLL_METHOD_LABELS]}
    </span>
  );
}

/** 'all' or a tenant branch code from the API `scopeOptions`. */
type EmployeeScopeFilter = string;

function branchBadge(
  branchCode: string | null | undefined,
  branchName: string | null | undefined,
  branchCodes: readonly string[],
) {
  if (!branchCode && !branchName) return null;
  const code = String(branchCode ?? '');
  const label = shortBranchName({
    branchCode: code || '—',
    branchName: branchName || code || '—',
  });
  const tone = hrBranchPalette(code, branchCodes).badge;
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
        tone,
      )}
    >
      {label}
    </span>
  );
}

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// Uses getBusinessDateStr from timeUtils — day ends at 5 AM

function attendanceBadge(status: string | null) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const map: Record<string, string> = {
    Present: 'bg-success-soft text-success border-success/30',
    Late:    'bg-warning-soft text-warning border-warning/30',
    Absent:  'bg-destructive-soft text-destructive border-destructive/30',
    DayOff:  'bg-info-soft text-info border-info/30',
    Excused: 'bg-brand-soft text-brand border-brand/30',
    Pending: 'bg-muted text-muted-foreground border-border',
    EarlyLeave: 'bg-warning-soft text-warning border-warning/30',
  };
  const label: Record<string, string> = {
    Present: 'حاضر', Late: 'متأخر', Absent: 'غائب',
    DayOff: 'إجازة', Excused: 'بعذر', Pending: 'لم يسجل', EarlyLeave: 'انصراف مبكر',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${map[status] ?? 'bg-muted text-muted-foreground border-border'}`}>
      {label[status] ?? status}
    </span>
  );
}

function targetSyncBadge(
  status: MergedDailyRow['targetSyncStatus'] | TargetLikeRow['syncStatus'] | undefined,
) {
  if (status === 'pending') {
    return (
      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-warning/40 text-warning bg-warning-soft">
        التارجت يحتاج إعادة حساب
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-info/40 text-info bg-info-soft">
        جاري التحديث
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-destructive/40 text-destructive bg-destructive-soft">
        تعذر تحديث التارجت
      </span>
    );
  }
  if (status === 'up_to_date') {
    return (
      <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-success/30 text-success bg-success-soft">
        محدث
      </span>
    );
  }
  return null;
}

function targetPersistenceBadge(status: TargetLikeRow['persistenceStatus'] | undefined) {
  if (!status) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] border bg-muted text-muted-foreground border-border">
        لا يوجد تارجت
      </span>
    );
  }
  if (status === 'not_generated') {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] border bg-warning-soft text-warning border-warning/30">
        لم يتم التوليد
      </span>
    );
  }
  if (status === 'recalculated') {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] border bg-info-soft text-info border-info/30">
        أُعيد حسابه
      </span>
    );
  }
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] border bg-success-soft text-success border-success/30">
      مولَّد
    </span>
  );
}

export default function DailyPayrollPanel() {
  const searchParams = useSearchParams();
  const requestedManagerDate = searchParams.get('managerClosing') === '1'
    ? searchParams.get('date')
    : null;
  const managerClosingDate =
    requestedManagerDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedManagerDate)
      ? requestedManagerDate
      : null;
  const { user } = useSession();
  const { access, hasRole } = usePermissions();
  const canReopenPayrollDay =
    Boolean(access?.isSuperAdmin) ||
    hasRole('admin') ||
    hasRole('super_admin') ||
    user?.UserLevel === 'admin';

  const [workspaceDate, setWorkspaceDate] = useState(() => managerClosingDate ?? getBusinessDateStr());
  const [workspaceBranchId, setWorkspaceBranchId] = useState<number | null>(null);
  const [workspaceBranches, setWorkspaceBranches] = useState<
    Array<{ branchId: number; branchCode: string; branchName: string }>
  >([]);
  const [sessionBranchId, setSessionBranchId] = useState<number | null>(null);
  /** Table visibility only — never switches session branch by itself. */
  const [employeeScope, setEmployeeScope] = useState<EmployeeScopeFilter>('all');
  const [scopeOptions, setScopeOptions] = useState<HrBranchOption[]>([]);
  const scopeCodes = useMemo(() => scopeOptions.map((o) => o.code), [scopeOptions]);
  const [sameDayMultiBranchEmployees, setSameDayMultiBranchEmployees] = useState<
    Array<{ empId: number; empName: string; branchIds: number[] }>
  >([]);

  /* Open-days monitor — completely independent of workspace */
  const [openDaysItems, setOpenDaysItems] = useState<DailyPayrollOpenDayItem[]>([]);
  const [openDaysLoading, setOpenDaysLoading] = useState(false);
  const [openDaysError, setOpenDaysError] = useState('');

  /* Date-hub: readiness cards for all branches on workspaceDate */
  const [dateBranchCards, setDateBranchCards] = useState<DailyPayrollDateBranchSummary[]>([]);
  const [dateBranchesLoading, setDateBranchesLoading] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  const [readiness, setReadiness] = useState<DailyPayrollReadinessResult | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [missingMappingEmps, setMissingMappingEmps] = useState<MissingEmp[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  /* Validation state */
  const [validationMissing, setValidationMissing] = useState<ValidationMissing[]>([]);
  const [validationExcluded, setValidationExcluded] = useState<ValidationExcluded[]>([]);
  const [validationDone, setValidationDone] = useState(false);
  const [validationOk, setValidationOk] = useState(false);

  /* Post confirmation dialog */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dualWriteEnabled, setDualWriteEnabled] = useState(false);
  const [legacyPostToCashDisabled, setLegacyPostToCashDisabled] = useState(false);
  const [legacyPostToCashWarning, setLegacyPostToCashWarning] = useState<string | null>(null);

  /* Close / reopen */
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [closingDay, setClosingDay] = useState(false);
  const [reopeningDay, setReopeningDay] = useState(false);
  const [nightlyClosing, setNightlyClosing] = useState(false);
  const [bulkRangeClosing, setBulkRangeClosing] = useState(false);
  const [bulkRangeFrom, setBulkRangeFrom] = useState(() => getBusinessDateStr());
  const [bulkRangeTo, setBulkRangeTo] = useState(() => getBusinessDateStr());
  const [bulkRangeConfirmOpen, setBulkRangeConfirmOpen] = useState(false);
  const [bulkRangeResult, setBulkRangeResult] = useState<{
    ok: boolean;
    summary: {
      daysProcessed: number;
      branchesProcessed: number;
      closed: number;
      alreadyClosed: number;
      notReady: number;
      failed: number;
    };
    days: Array<{
      workDate: string;
      nightlyOk: boolean;
      nightlyError: string | null;
      branches: Array<{
        branchCode: string;
        outcome: string;
        reason: string | null;
      }>;
    }>;
    error?: string;
  } | null>(null);
  const [bulkRangeProgress, setBulkRangeProgress] = useState<{
    totalDays: number;
    dayIndex: number;
    currentDate: string | null;
    phase: string;
    closed: number;
    alreadyClosed: number;
    notReady: number;
    failed: number;
  } | null>(null);
  const [bulkRangeLogs, setBulkRangeLogs] = useState<
    Array<{ id: number; level: 'info' | 'ok' | 'warn' | 'error'; message: string }>
  >([]);
  const [bulkRangeErrors, setBulkRangeErrors] = useState<
    Array<{
      id: number;
      workDate: string;
      kind: 'pipeline' | 'notReady' | 'failed';
      branchCode: string | null;
      message: string;
    }>
  >([]);
  const bulkRangeLogSeq = useRef(0);
  const bulkRangeLogEndRef = useRef<HTMLDivElement | null>(null);
  const [smartFixOpen, setSmartFixOpen] = useState(false);
  const [generatingEmpId, setGeneratingEmpId] = useState<number | null>(null);
  const [generatingBranchId, setGeneratingBranchId] = useState<number | null>(null);
  const [rowAttendance, setRowAttendance] = useState<{
    empId: number;
    empName: string;
    branchId: number;
    workDate: string;
  } | null>(null);
  const [moveDayTarget, setMoveDayTarget] = useState<MoveEmployeeDayBranchTarget | null>(null);

  /* Auto-generate log for today */
  interface AutoGenLog {
    found: boolean;
    success?: boolean;
    workDate?: string;
    employeesCount?: number;
    totalHours?: number;
    totalWages?: number;
    missing?: ValidationMissing[];
    createdAt?: string;
  }
  const [autoGenLog, setAutoGenLog] = useState<AutoGenLog | null>(null);

  const [targetRows, setTargetRows] = useState<TargetLikeRow[]>([]);
  const [targetTotals, setTargetTotals] = useState<{
    eligibleEmployees: number;
    notGenerated: number;
    earnedTarget: number;
    totalCurrentNetSalesAfterDiscount: string;
    totalCurrentMtdSales?: string;
    totalStoredTargetAmount: string;
    totalStoredMtdTargetAmount?: string;
  } | null>(null);
  const [planConflicts, setPlanConflicts] = useState<string[]>([]);
  const [regeneratingTarget, setRegeneratingTarget] = useState(false);
  const [detailTarget, setDetailTarget] = useState<TargetLikeRow | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  /** @deprecated alias — workspace date only */
  const date = workspaceDate;
  const selectedBranchId = workspaceBranchId;

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 8000);
  };

  useEffect(() => {
    if (bulkRangeLogs.length === 0) return;
    bulkRangeLogEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [bulkRangeLogs]);

  const fetchAutoGenLog = useCallback(async (d: string) => {
    try {
      const res = await fetch(`/api/payroll/daily/auto-generate?workDate=${d}`);
      if (res.ok) setAutoGenLog(await res.json());
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadOpenDays = useCallback(async () => {
    setOpenDaysLoading(true);
    setOpenDaysError('');
    try {
      const res = await fetch('/api/admin/hr/daily-payroll/open-days?scope=current-month');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل الأيام المفتوحة');
      const items = (Array.isArray(data.items) ? data.items : []) as DailyPayrollOpenDayItem[];
      setOpenDaysItems(items);
      return items;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'فشل تحميل الأيام المفتوحة';
      setOpenDaysError(message);
      console.warn('[DailyPayrollPanel] open-days:', e);
      return [] as DailyPayrollOpenDayItem[];
    } finally {
      setOpenDaysLoading(false);
    }
  }, []);

  const loadReadiness = useCallback(async (branchId: number, workDate: string) => {
    setLoadingReadiness(true);
    try {
      const params = new URLSearchParams({
        branchId: String(branchId),
        workDate,
      });
      const res = await fetch(`/api/admin/hr/daily-payroll/readiness?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل جاهزية اليوم');
      setReadiness(data as DailyPayrollReadinessResult);
      return data as DailyPayrollReadinessResult;
    } catch (e: unknown) {
      setReadiness(null);
      console.warn('[DailyPayrollPanel] readiness:', e);
      return null;
    } finally {
      setLoadingReadiness(false);
    }
  }, []);

  const loadDateBranchCards = useCallback(async (workDate: string) => {
    setDateBranchesLoading(true);
    try {
      const res = await fetch(
        `/api/admin/hr/daily-payroll/readiness-by-date?workDate=${encodeURIComponent(workDate)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل جاهزية الفروع');
      const branches = (
        Array.isArray(data.branches) ? data.branches : []
      ) as DailyPayrollDateBranchSummary[];
      setDateBranchCards(branches);
      return branches;
    } catch (e: unknown) {
      console.warn('[DailyPayrollPanel] readiness-by-date:', e);
      setDateBranchCards([]);
      return [] as DailyPayrollDateBranchSummary[];
    } finally {
      setDateBranchesLoading(false);
    }
  }, []);

  const ensureSessionBranch = useCallback(async (branchId: number) => {
    if (sessionBranchId === branchId) return true;
    setSwitchingBranch(true);
    try {
      const res = await fetch('/api/auth/switch-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || 'تعذر تبديل الفرع');
      }
      setSessionBranchId(branchId);
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'تعذر تبديل الفرع للعمل على هذا اليوم');
      return false;
    } finally {
      setSwitchingBranch(false);
    }
  }, [sessionBranchId]);

  useEffect(() => {
    fetchAutoGenLog(workspaceDate);
  }, [workspaceDate, fetchAutoGenLog]);

  useEffect(() => {
    const month = workspaceDate.slice(0, 7);
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
  }, [workspaceDate]);

  const load = useCallback(async (d: string, scope: EmployeeScopeFilter = employeeScope) => {
    setLoading(true);
    setError('');
    try {
      const scopeQ = `employeeScope=${encodeURIComponent(scope)}`;
      const [payrollRes, targetRes] = await Promise.all([
        fetch(`/api/payroll/daily?workDate=${d}&${scopeQ}`),
        fetch(`/api/payroll/daily/targets?workDate=${d}&${scopeQ}`),
      ]);
      const payrollData = await payrollRes.json();
      const targetData = await targetRes.json();
      if (!payrollRes.ok) throw new Error(payrollData.error || 'فشل تحميل اليوميات');
      setRows(payrollData.rows ?? []);
      setSummary(payrollData.summary ?? null);
      setScopeOptions(parseHrBranchOptions(payrollData.scopeOptions));
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

      const fromApi = Array.isArray(payrollData.sameDayMultiBranchEmployees)
        ? payrollData.sameDayMultiBranchEmployees
        : [];
      const fromTargets = Array.isArray(targetData.sameDayMultiBranchEmployees)
        ? targetData.sameDayMultiBranchEmployees
        : [];
      const mergedFlags = new Map<number, { empId: number; empName: string; branchIds: number[] }>();
      for (const item of [...fromApi, ...fromTargets]) {
        const empId = Number(item.empId);
        const prev = mergedFlags.get(empId);
        const branchIds = [
          ...new Set([...(prev?.branchIds ?? []), ...(item.branchIds ?? [])]),
        ].sort((a, b) => a - b);
        mergedFlags.set(empId, {
          empId,
          empName: String(item.empName ?? prev?.empName ?? `#${empId}`),
          branchIds,
        });
      }
      setSameDayMultiBranchEmployees([...mergedFlags.values()].filter((x) => x.branchIds.length > 1));

      setLoaded(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ في التحميل');
    } finally {
      setLoading(false);
    }
  }, [employeeScope]);

  /** Workspace-only refresh (never blocks/resets open-days monitor). */
  const refreshWorkspace = useCallback(
    async (branchId: number, workDate: string) => {
      const [, nextReadiness] = await Promise.all([
        load(workDate),
        loadReadiness(branchId, workDate),
        loadDateBranchCards(workDate),
      ]);
      return nextReadiness;
    },
    [load, loadReadiness, loadDateBranchCards],
  );

  /** After successful mutations: refresh workspace, then optionally refresh monitor in background. */
  const refreshAfterMutation = useCallback(
    async (branchId: number, workDate: string) => {
      const next = await refreshWorkspace(branchId, workDate);
      void loadOpenDays();
      return next;
    },
    [refreshWorkspace, loadOpenDays],
  );

  /** Explicit transfer of an open-day into the workspace (فتح اليوم). */
  const openDayIntoWorkspace = useCallback(
    async (branchId: number, workDate: string) => {
      setValidationDone(false);
      setValidationMissing([]);
      setValidationExcluded([]);
      const ok = await ensureSessionBranch(branchId);
      if (!ok) return;
      setWorkspaceBranchId(branchId);
      setWorkspaceDate(workDate);
      await refreshWorkspace(branchId, workDate);
    },
    [ensureSessionBranch, refreshWorkspace],
  );

  // Bootstrap: workspace from active branch + business date; open-days loads separately (no auto-select)
  useEffect(() => {
    if (bootstrapped) return;
    let cancelled = false;
    void (async () => {
      try {
        const [activeRes, branchesRes] = await Promise.all([
          fetch('/api/branches/active'),
          fetch('/api/branches/available'),
        ]);
        const activeData = await activeRes.json().catch(() => ({}));
        const branchesData = await branchesRes.json().catch(() => ({}));
        const activeId =
          Number(
            activeData?.activeBranch?.BranchID ??
              activeData?.activeBranch?.branchId ??
              activeData?.branchId ??
              0,
          ) || null;

        const branches = Array.isArray(branchesData?.branches)
          ? (branchesData.branches as Array<{
              BranchID: number;
              BranchCode: string;
              BranchName: string;
            }>).map((b) => ({
              branchId: Number(b.BranchID),
              branchCode: String(b.BranchCode ?? ''),
              branchName: String(b.BranchName ?? ''),
            }))
          : [];

        if (!cancelled) {
          setWorkspaceBranches(branches);
          if (activeId) {
            setSessionBranchId(activeId);
            setWorkspaceBranchId(activeId);
          } else if (branches[0]) {
            setWorkspaceBranchId(branches[0].branchId);
          }
        }

        const d = managerClosingDate ?? getBusinessDateStr();
        const branchForWorkspace =
          activeId ?? (branches[0] ? branches[0].branchId : null);
        if (!cancelled) {
          setWorkspaceDate(d);
          if (branchForWorkspace != null) {
            await Promise.all([
              load(d),
              loadReadiness(branchForWorkspace, d),
              loadDateBranchCards(d),
            ]);
          } else {
            await Promise.all([load(d), loadDateBranchCards(d)]);
          }
        }

        // Independent monitor load — never drives workspace selection
        if (!cancelled) void loadOpenDays();
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once
  }, [bootstrapped]);

  const openDaysSummary = useMemo(() => summarizeOpenDays(openDaysItems), [openDaysItems]);
  const workflow = useMemo(() => workflowSteps(readiness), [readiness]);
  const readinessByEmp = useMemo(() => {
    const map = new Map<number, NonNullable<DailyPayrollReadinessResult['employees']>[number]>();
    for (const e of readiness?.employees ?? []) map.set(e.empId, e);
    return map;
  }, [readiness]);

  const blockersByEmp = useMemo(() => {
    const map = new Map<number, { empName: string; messages: string[] }>();
    for (const b of readiness?.blockers ?? []) {
      if (b.empId == null) continue;
      const cur = map.get(b.empId) ?? { empName: b.empName ?? `#${b.empId}`, messages: [] };
      cur.messages.push(blockerMessageAr(b.code, b.message));
      map.set(b.empId, cur);
    }
    return [...map.entries()].map(([empId, v]) => ({ empId, ...v }));
  }, [readiness]);

  const workspaceBranchMeta = useMemo(() => {
    if (readiness) {
      return {
        branchCode: readiness.branchCode,
        branchName: readiness.branchName,
      };
    }
    return workspaceBranches.find((b) => b.branchId === workspaceBranchId) ?? null;
  }, [readiness, workspaceBranches, workspaceBranchId]);

  const isDayClosed = readiness?.persistedState === 'CLOSED';
  const isDayReopened = readiness?.persistedState === 'REOPENED';
  const canCloseDay =
    Boolean(readiness?.readyToClose) &&
    readiness?.recommendedState === 'READY_TO_CLOSE' &&
    !isDayClosed &&
    workspaceBranchId != null;

  const handleCloseDay = async () => {
    if (!selectedBranchId || closingDay) return;
    setClosingDay(true);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/daily-payroll/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: selectedBranchId, workDate: date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر إقفال اليوم');
      setCloseConfirmOpen(false);
      flash('تم إقفال يوم الموظفين بنجاح');
      await refreshAfterMutation(selectedBranchId, date);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'تعذر إقفال اليوم');
    } finally {
      setClosingDay(false);
    }
  };

  const handleReopenDay = async () => {
    if (!selectedBranchId || reopeningDay) return;
    const reason = reopenReason.trim();
    if (!reason) {
      setError('سبب إعادة الفتح مطلوب');
      return;
    }
    setReopeningDay(true);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/daily-payroll/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: selectedBranchId,
          workDate: date,
          reopenReason: reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر إعادة فتح اليوم');
      setReopenConfirmOpen(false);
      setReopenReason('');
      flash('تم إعادة فتح اليوم — يمكن التصحيح ثم الإقفال مجددًا عند الجاهزية');
      await refreshAfterMutation(selectedBranchId, date);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'تعذر إعادة فتح اليوم');
    } finally {
      setReopeningDay(false);
    }
  };

  /** Same pipeline as the 02:40 Cairo cron — without WhatsApp. */
  const handleAutoNightlyClose = async () => {
    if (nightlyClosing) return;
    const workDate = date;
    if (
      !window.confirm(
        `قفل اليوم التلقائي\nيوم العمل: ${workDate}\n\n` +
          'نفس سكربت الساعة 2:40: يكمل الحضور (Default) → يوميات → تارجت لكل الفروع النشطة.\n' +
          'بدون إرسال واتساب للموظفين أو المدير.',
      )
    ) {
      return;
    }
    setNightlyClosing(true);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/nightly-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDate,
          dryRun: false,
          skipWhatsApp: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(
          data.error ||
            (Array.isArray(data.errors) ? data.errors[0] : null) ||
            'فشل قفل اليوم التلقائي',
        );
      }
      const filled =
        data.steps?.attendanceClose?.filled?.length ??
        data.steps?.attendanceClose?.closed?.length ??
        0;
      const payrollStatus = data.steps?.payroll?.status ?? '—';
      const targets = data.steps?.targets?.generated ?? 0;
      flash(
        `تم قفل اليوم التلقائي ${data.workDate ?? workDate}: DefaultFill=${filled} · يوميات ${payrollStatus} · تارجت ${targets} · بدون واتساب`,
      );
      if (selectedBranchId != null) {
        await refreshAfterMutation(selectedBranchId, workDate);
      } else {
        await load(workDate);
        void loadOpenDays();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل قفل اليوم التلقائي');
    } finally {
      setNightlyClosing(false);
    }
  };

  const handleBulkCloseRange = async () => {
    if (bulkRangeClosing) return;
    setBulkRangeConfirmOpen(false);
    setBulkRangeClosing(true);
    setError('');
    setBulkRangeResult(null);
    setBulkRangeProgress(null);
    setBulkRangeLogs([]);
    setBulkRangeErrors([]);
    bulkRangeLogSeq.current = 0;

    const pushLog = (level: 'info' | 'ok' | 'warn' | 'error', message: string) => {
      bulkRangeLogSeq.current += 1;
      const id = bulkRangeLogSeq.current;
      setBulkRangeLogs((prev) => [...prev, { id, level, message }]);
    };
    const pushError = (row: {
      workDate: string;
      kind: 'pipeline' | 'notReady' | 'failed';
      branchCode: string | null;
      message: string;
    }) => {
      bulkRangeLogSeq.current += 1;
      const id = bulkRangeLogSeq.current;
      setBulkRangeErrors((prev) => [...prev, { id, ...row }]);
    };

    try {
      const res = await fetch('/api/admin/hr/daily-payroll/bulk-close-range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({
          fromDate: bulkRangeFrom,
          toDate: bulkRangeTo,
          stream: true,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok && !contentType.includes('ndjson')) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || 'تعذر بدء قفل الرينج',
        );
      }

      if (!res.body) {
        throw new Error('لا يوجد بث تقدم من الخادم');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: typeof bulkRangeResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          const type = String(event.type ?? '');

          if (type === 'error') {
            throw new Error(String(event.error || 'فشل قفل رينج الأيام'));
          }

          if (type === 'start') {
            const totalDays = Number(event.totalDays) || 0;
            const branchCount = Number(event.branchCount) || 0;
            setBulkRangeProgress({
              totalDays,
              dayIndex: 0,
              currentDate: null,
              phase: 'بدء التشغيل',
              closed: 0,
              alreadyClosed: 0,
              notReady: 0,
              failed: 0,
            });
            pushLog(
              'info',
              `بدء الرينج ${String(event.fromDate)} → ${String(event.toDate)} · ${totalDays} يوم · ${branchCount} فرع`,
            );
          } else if (type === 'day_start') {
            const workDate = String(event.workDate);
            const dayIndex = Number(event.dayIndex) || 0;
            const totalDays = Number(event.totalDays) || 0;
            setBulkRangeProgress((prev) =>
              prev
                ? {
                    ...prev,
                    dayIndex,
                    totalDays,
                    currentDate: workDate,
                    phase: `بايبلاين ${workDate}`,
                  }
                : prev,
            );
            pushLog('info', `[${dayIndex}/${totalDays}] بدء يوم ${workDate}`);
          } else if (type === 'nightly') {
            const workDate = String(event.workDate);
            const ok = event.ok === true;
            const errMsg = event.error ? String(event.error) : null;
            if (ok) {
              pushLog('ok', `${workDate} · البايبلاين اكتمل`);
              setBulkRangeProgress((prev) =>
                prev ? { ...prev, phase: `إقفال فروع ${workDate}` } : prev,
              );
            } else {
              pushLog('error', `${workDate} · بايبلاين فشل: ${errMsg || 'خطأ'}`);
              pushError({
                workDate,
                kind: 'pipeline',
                branchCode: null,
                message: errMsg || 'فشل قفل اليوم التلقائي',
              });
              setBulkRangeProgress((prev) =>
                prev ? { ...prev, phase: `إقفال فروع ${workDate} (بعد فشل البايبلاين)` } : prev,
              );
            }
          } else if (type === 'branch') {
            const workDate = String(event.workDate);
            const branchCode = String(event.branchCode);
            const outcome = String(event.outcome);
            const reason = event.reason ? String(event.reason) : null;
            const level =
              outcome === 'closed'
                ? 'ok'
                : outcome === 'alreadyClosed'
                  ? 'info'
                  : outcome === 'notReady'
                    ? 'warn'
                    : 'error';
            pushLog(
              level,
              `${workDate} · ${branchCode}: ${outcome}${reason ? ` — ${reason}` : ''}`,
            );
            setBulkRangeProgress((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                closed: prev.closed + (outcome === 'closed' ? 1 : 0),
                alreadyClosed: prev.alreadyClosed + (outcome === 'alreadyClosed' ? 1 : 0),
                notReady: prev.notReady + (outcome === 'notReady' ? 1 : 0),
                failed: prev.failed + (outcome === 'failed' ? 1 : 0),
              };
            });
            if (outcome === 'notReady') {
              pushError({
                workDate,
                kind: 'notReady',
                branchCode,
                message: reason || 'غير جاهز للإقفال',
              });
            } else if (outcome === 'failed') {
              pushError({
                workDate,
                kind: 'failed',
                branchCode,
                message: reason || 'فشل الإقفال',
              });
            }
          } else if (type === 'day_done') {
            const workDate = String(event.workDate);
            const dayIndex = Number(event.dayIndex) || 0;
            const totalDays = Number(event.totalDays) || 0;
            pushLog('info', `[${dayIndex}/${totalDays}] انتهى يوم ${workDate}`);
            setBulkRangeProgress((prev) =>
              prev
                ? {
                    ...prev,
                    dayIndex,
                    totalDays,
                    currentDate: workDate,
                    phase:
                      dayIndex >= totalDays ? 'اكتمل الرينج' : `انتظر اليوم التالي…`,
                  }
                : prev,
            );
          } else if (type === 'done') {
            const result = event.result as NonNullable<typeof bulkRangeResult>;
            finalResult = result;
            setBulkRangeResult(result);
            setBulkRangeProgress((prev) =>
              prev
                ? {
                    ...prev,
                    dayIndex: result.summary.daysProcessed,
                    totalDays: Math.max(prev.totalDays, result.summary.daysProcessed),
                    phase: 'اكتمل',
                    closed: result.summary.closed,
                    alreadyClosed: result.summary.alreadyClosed,
                    notReady: result.summary.notReady,
                    failed: result.summary.failed,
                  }
                : prev,
            );
            pushLog(
              result.ok ? 'ok' : 'warn',
              `النتيجة النهائية — أيام ${result.summary.daysProcessed} · مقفول ${result.summary.closed} · مسبقاً ${result.summary.alreadyClosed} · غير جاهز ${result.summary.notReady} · فشل ${result.summary.failed}`,
            );
          }
        }
      }

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as Record<string, unknown>;
          if (event.type === 'error') {
            throw new Error(String(event.error || 'فشل قفل رينج الأيام'));
          }
          if (event.type === 'done' && event.result) {
            finalResult = event.result as NonNullable<typeof bulkRangeResult>;
            setBulkRangeResult(finalResult);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
            /* ignore trailing partial */
          }
        }
      }

      if (!finalResult?.summary) {
        throw new Error('انتهى البث بدون نتيجة نهائية');
      }

      const s = finalResult.summary;
      flash(
        `قفل الرينج ${bulkRangeFrom} → ${bulkRangeTo}: أيام ${s.daysProcessed} · مقفول ${s.closed} · مقفول مسبقاً ${s.alreadyClosed} · غير جاهز ${s.notReady} · فشل ${s.failed}`,
      );
      if (selectedBranchId != null) {
        await refreshAfterMutation(selectedBranchId, date);
      } else {
        await load(date);
        void loadOpenDays();
      }
      if (finalResult.error && s.daysProcessed === 0) {
        setError(finalResult.error);
      } else if (
        s.failed > 0 ||
        finalResult.days?.some((d) => !d.nightlyOk) ||
        s.notReady > 0
      ) {
        setError(
          'اكتمل الرينج مع ملاحظات — راجع السجل والأخطاء بالأسفل (لم يُفرض إقفال على الأيام غير الجاهزة)',
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل قفل رينج الأيام');
      pushLog('error', e instanceof Error ? e.message : 'فشل قفل رينج الأيام');
    } finally {
      setBulkRangeClosing(false);
    }
  };

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
      if (selectedBranchId != null) {
        await refreshAfterMutation(selectedBranchId, date);
      } else {
        await load(date);
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'خطأ في الفحص'); }
    finally { setValidating(false); }
  };

  const generatePayrollOnly = async (
    empIds?: number[],
  ): Promise<SmartFixActionResult> => {
    const res = await fetch('/api/payroll/daily/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workDate: date,
        ...(empIds?.length ? { empIds } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.missing?.length) {
        setValidationMissing(data.missing);
        setValidationDone(true); setValidationOk(false);
      }
      return {
        ok: false,
        message: data.error || 'تعذر توليد اليوميات',
        code: typeof data.code === 'string' ? data.code : null,
        missing: Array.isArray(data.missing)
          ? data.missing.map((m: { empId: number; empName: string; reason: string }) => ({
              empId: Number(m.empId),
              empName: String(m.empName ?? ''),
              reason: String(m.reason ?? ''),
            }))
          : undefined,
      };
    }
    let message = empIds?.length
      ? `تم توليد يومية الموظف (${data.generatedCount} سجل — ${fmt(data.totalWage)} ج.م)`
      : `تم توليد اليوميات بنجاح (${data.generatedCount} سجل — ${fmt(data.totalWage)} ج.م)`;
    if (data.ledgerDualWrite) {
      message += ' — سُجِّل الأساسي في دفتر الموظفين';
    }
    return { ok: true, message, code: null };
  };

  /** Uses durable recalc pipeline (enqueue + process) — same path as invoice sync. */
  const generateTargetsOnly = async (
    empIds?: number[],
  ): Promise<SmartFixActionResult> => {
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
      return {
        ok: false,
        message: data.error || 'تعذر إعادة حساب التارجت',
        code: typeof data.code === 'string' ? data.code : null,
      };
    }
    const completed = data.process?.completed ?? 0;
    const failed = data.process?.failed ?? 0;
    const claimed = data.process?.claimed ?? 0;
    if (failed > 0 && completed === 0 && claimed > 0) {
      return {
        ok: false,
        message: 'تعذر تحديث التارجت — حاول إعادة المحاولة',
        code: 'TARGET_SYNC_FAILED',
      };
    }
    return {
      ok: true,
      message: empIds?.length
        ? 'تم تحديث تارجت الموظف'
        : `تم إعادة حساب تارجت اليوم (مكتمل: ${completed || 'توليد يوم كامل'}، فشل: ${failed})`,
      code: null,
    };
  };

  const openEmployeeAttendance = (
    empId: number,
    empName: string,
    rowBranchId: number | null | undefined,
  ) => {
    const branchId = rowBranchId != null && rowBranchId > 0
      ? rowBranchId
      : selectedBranchId ?? sessionBranchId;
    if (branchId == null) {
      setError('لا يمكن فتح الحضور بدون BranchID للصف');
      return;
    }
    setRowAttendance({ empId, empName, branchId, workDate: date });
  };

  const generateEmployeePayrollAndTarget = async (
    empId: number,
    empName: string,
    rowBranchId: number | null | undefined,
  ) => {
    if (generating || regeneratingTarget || generatingEmpId != null) return;
    const branchId = rowBranchId != null && rowBranchId > 0
      ? rowBranchId
      : selectedBranchId ?? sessionBranchId;
    if (branchId == null) {
      setError('لا يمكن التوليد بدون BranchID للصف');
      return;
    }
    const rowClosed = branchId === workspaceBranchId && isDayClosed;
    if (rowClosed) return;

    setGeneratingEmpId(empId);
    setGeneratingBranchId(branchId);
    setError('');
    const messages: string[] = [];
    const failures: string[] = [];
    try {
      const ok = await ensureSessionBranch(branchId);
      if (!ok) throw new Error('تعذر تبديل الفرع قبل التوليد');
      // Keep workspace action branch aligned with the row we just acted on
      setWorkspaceBranchId(branchId);

      const payroll = await generatePayrollOnly([empId]);
      if (payroll.ok) messages.push(payroll.message);
      else failures.push(payroll.message);

      const targets = await generateTargetsOnly([empId]);
      if (targets.ok) messages.push(targets.message);
      else failures.push(targets.message);

      if (failures.length && messages.length) {
        setError(`${empName}: ${messages.join(' · ')}. ${failures.join(' · ')}`);
        flash(`${empName}: ${messages.join(' · ')}`);
      } else if (failures.length) {
        setError(`${empName}: ${failures.join(' · ')}`);
      } else {
        flash(`${empName}: ${messages.join(' · ')}`);
      }

      await refreshAfterMutation(branchId, date);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `خطأ في توليد ${empName}`);
    } finally {
      setGeneratingEmpId(null);
      setGeneratingBranchId(null);
    }
  };

  const retryEmployeeTarget = async (
    empId: number,
    rowBranchId: number | null | undefined,
  ) => {
    if (regeneratingTarget || generating || generatingEmpId != null) return;
    const branchId = rowBranchId != null && rowBranchId > 0
      ? rowBranchId
      : selectedBranchId ?? sessionBranchId;
    if (branchId == null) {
      setError('لا يمكن إعادة المحاولة بدون BranchID للصف');
      return;
    }
    setRegeneratingTarget(true);
    setError('');
    try {
      const ok = await ensureSessionBranch(branchId);
      if (!ok) throw new Error('تعذر تبديل الفرع قبل إعادة حساب التارجت');
      setWorkspaceBranchId(branchId);
      const targets = await generateTargetsOnly([empId]);
      if (!targets.ok) throw new Error(targets.message);
      flash(targets.message);
      await refreshAfterMutation(branchId, date);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ في إعادة المحاولة');
    } finally {
      setRegeneratingTarget(false);
    }
  };

  const handleEmployeeScopeChange = (scope: EmployeeScopeFilter) => {
    setEmployeeScope(scope);
    setLoaded(false);
    void load(workspaceDate, scope);
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
      if (selectedBranchId != null) await refreshAfterMutation(selectedBranchId, date);
      else await load(date);
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
      if (selectedBranchId != null) await refreshAfterMutation(selectedBranchId, date);
      else await load(date);
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
      if (selectedBranchId != null) await refreshAfterMutation(selectedBranchId, date);
      else await load(date);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'خطأ في الترحيل'); }
    finally { setPosting(false); }
  };

  const handleDateChange = (val: string) => {
    setWorkspaceDate(val);
    setLoaded(false);
    setRows([]);
    setSummary(null);
    setTargetRows([]);
    setTargetTotals(null);
    setPlanConflicts([]);
    setValidationDone(false);
    setValidationMissing([]);
    setValidationExcluded([]);
    setValidationOk(false);
    setAutoGenLog(null);
    const branchId = workspaceBranchId ?? sessionBranchId;
    if (branchId != null) {
      setWorkspaceBranchId(branchId);
      void refreshWorkspace(branchId, val);
    } else {
      void load(val);
      void loadDateBranchCards(val);
    }
  };

  const handleWorkspaceBranchChange = async (branchId: number) => {
    setValidationDone(false);
    setValidationMissing([]);
    setValidationExcluded([]);
    setValidationOk(false);
    const ok = await ensureSessionBranch(branchId);
    if (!ok) return;
    setWorkspaceBranchId(branchId);
    await refreshWorkspace(branchId, workspaceDate);
  };

  const dateHubSummary = useMemo(() => {
    let readyCount = 0;
    let reviewCount = 0;
    let closedCount = 0;
    for (const b of dateBranchCards) {
      if (b.persistedState === 'CLOSED') closedCount += 1;
      else if (b.readyToClose || b.recommendedState === 'READY_TO_CLOSE') readyCount += 1;
      else if (b.blockerCount > 0 || b.recommendedState === 'NEEDS_REVIEW') reviewCount += 1;
    }
    return { readyCount, reviewCount, closedCount, total: dateBranchCards.length };
  }, [dateBranchCards]);

  /** Bulk: validate attendance for every open branch on this date (session hop). */
  const handleBulkValidateAllBranches = async () => {
    if (bulkRunning) return;
    const targets = dateBranchCards.filter((b) => b.persistedState !== 'CLOSED');
    if (targets.length === 0) {
      flash('لا توجد فروع مفتوحة للفحص في هذا اليوم');
      return;
    }
    setBulkRunning(true);
    setError('');
    const notes: string[] = [];
    try {
      for (const branch of targets) {
        const ok = await ensureSessionBranch(branch.branchId);
        if (!ok) {
          notes.push(`${shortBranchName(branch)}: تعذر تبديل الفرع`);
          continue;
        }
        setWorkspaceBranchId(branch.branchId);
        const res = await fetch('/api/payroll/daily/validate-attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workDate: workspaceDate }),
        });
        const data = await res.json();
        if (!res.ok) {
          notes.push(`${shortBranchName(branch)}: ${data.error || 'فشل الفحص'}`);
          continue;
        }
        const missingCount = Array.isArray(data.missing) ? data.missing.length : 0;
        notes.push(
          missingCount === 0
            ? `${shortBranchName(branch)}: جاهز`
            : `${shortBranchName(branch)}: ${missingCount} نواقص`,
        );
      }
      flash(`فحص الحضور لكل الفروع — ${notes.join(' · ')}`);
      if (workspaceBranchId != null) await refreshAfterMutation(workspaceBranchId, workspaceDate);
      else await loadDateBranchCards(workspaceDate);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل الفحص المجمّع');
    } finally {
      setBulkRunning(false);
    }
  };

  /** Bulk: generate payroll+targets (+ ledger dual-write) for every non-closed branch. */
  const handleBulkGenerateAllBranches = async () => {
    if (bulkRunning) return;
    const targets = dateBranchCards.filter((b) => b.persistedState !== 'CLOSED');
    if (targets.length === 0) {
      flash('لا توجد فروع مفتوحة للتوليد في هذا اليوم');
      return;
    }
    setBulkRunning(true);
    setError('');
    const notes: string[] = [];
    try {
      for (const branch of targets) {
        const ok = await ensureSessionBranch(branch.branchId);
        if (!ok) {
          notes.push(`${shortBranchName(branch)}: تعذر تبديل الفرع`);
          continue;
        }
        setWorkspaceBranchId(branch.branchId);
        const payRes = await fetch('/api/payroll/daily/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workDate: workspaceDate }),
        });
        const payData = await payRes.json();
        if (!payRes.ok) {
          notes.push(`${shortBranchName(branch)}: ${payData.error || 'فشل التوليد'}`);
          continue;
        }
        const ledgerNote = payData.ledgerDualWrite ? '+دفتر' : '';
        notes.push(
          `${shortBranchName(branch)}: ${payData.generatedCount ?? 0} يومية${ledgerNote}`,
        );
        // Best-effort targets for the same branch/day (same path as single-branch generate)
        await fetch('/api/payroll/daily/targets/recalc-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workDate: workspaceDate,
            processNow: true,
            reason: 'manual_recalc_day',
          }),
        }).catch(() => null);
      }
      flash(`توليد اليوميات لكل الفروع — ${notes.join(' · ')}`);
      if (workspaceBranchId != null) await refreshAfterMutation(workspaceBranchId, workspaceDate);
      else await loadDateBranchCards(workspaceDate);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل التوليد المجمّع');
    } finally {
      setBulkRunning(false);
    }
  };

  /** Bulk: close every branch that is readyToClose on this date. */
  const handleBulkCloseReadyBranches = async () => {
    if (bulkRunning) return;
    const targets = dateBranchCards.filter(
      (b) => b.readyToClose && b.persistedState !== 'CLOSED',
    );
    if (targets.length === 0) {
      flash('لا يوجد فرع جاهز للإقفال في هذا اليوم');
      return;
    }
    if (
      !window.confirm(
        `إقفال ${targets.length} فرع جاهز ليوم ${formatWorkDateAr(workspaceDate)}؟`,
      )
    ) {
      return;
    }
    setBulkRunning(true);
    setError('');
    const notes: string[] = [];
    try {
      for (const branch of targets) {
        const ok = await ensureSessionBranch(branch.branchId);
        if (!ok) {
          notes.push(`${shortBranchName(branch)}: تعذر تبديل الفرع`);
          continue;
        }
        setWorkspaceBranchId(branch.branchId);
        const res = await fetch('/api/admin/hr/daily-payroll/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branchId: branch.branchId, workDate: workspaceDate }),
        });
        const data = await res.json();
        notes.push(
          res.ok
            ? `${shortBranchName(branch)}: أُقفل`
            : `${shortBranchName(branch)}: ${data.error || 'تعذر الإقفال'}`,
        );
      }
      flash(`إقفال الجاهز — ${notes.join(' · ')}`);
      if (workspaceBranchId != null) await refreshAfterMutation(workspaceBranchId, workspaceDate);
      else {
        await loadDateBranchCards(workspaceDate);
        void loadOpenDays();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل الإقفال المجمّع');
    } finally {
      setBulkRunning(false);
    }
  };

  const generatedCount = summary?.generatedCount ?? rows.filter(r => ['Generated','Earned'].includes(r.Status)).length;
  const repairCount    = summary?.repairCount    ?? rows.filter(r => r.needsIncomeRepair).length;
  const canPost        = !legacyPostToCashDisabled && (generatedCount > 0 || repairCount > 0);
  const showLegacyPost = dualWriteEnabled && !legacyPostToCashDisabled;
  const mergedRows = mergeDailyPayrollAndTargetRows(rows, targetRows);
  /** Workspace busy only — open-days loading must never disable workspace actions. */
  const workspaceBusy =
    loading ||
    loadingReadiness ||
    switchingBranch ||
    closingDay ||
    reopeningDay ||
    nightlyClosing ||
    bulkRangeClosing ||
    bulkRunning ||
    generatingEmpId != null;
  const busy = workspaceBusy;

  return (
    <div className="space-y-5" dir="rtl">

      {/* ── Date hub: all branches for one work date ───────────────────────── */}
      <div className="rounded-xl border border-border bg-background p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">مركز تقفيل اليوميات · كل الفروع</p>
            <h2 className="text-lg font-bold text-foreground">{formatWorkDateAr(workspaceDate)}</h2>
            <p className="text-[11px] text-muted-foreground">
              {dateHubSummary.total} فروع
              {dateHubSummary.readyCount > 0 ? ` · ${dateHubSummary.readyCount} جاهز` : ''}
              {dateHubSummary.reviewCount > 0 ? ` · ${dateHubSummary.reviewCount} يحتاج مراجعة` : ''}
              {dateHubSummary.closedCount > 0 ? ` · ${dateHubSummary.closedCount} مقفل` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDateChange(shiftCalendarDate(workspaceDate, -1))}
              disabled={workspaceBusy}
              className="h-9 w-9 p-0 border-border bg-background"
              aria-label="اليوم السابق"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Input
              type="date"
              value={workspaceDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="bg-background border-border text-foreground w-40 h-9 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDateChange(shiftCalendarDate(workspaceDate, 1))}
              disabled={workspaceBusy}
              className="h-9 w-9 p-0 border-border bg-background"
              aria-label="اليوم التالي"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 border-border text-foreground"
              disabled={dateBranchesLoading || workspaceBusy}
              onClick={() => void loadDateBranchCards(workspaceDate)}
            >
              {dateBranchesLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              تحديث
            </Button>
          </div>
        </div>

        {dateBranchesLoading && dateBranchCards.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل جاهزية الفروع…
          </div>
        ) : dateBranchCards.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد فروع متاحة لهذا اليوم</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {dateBranchCards.map((card) => {
              const selected = card.branchId === workspaceBranchId;
              return (
                <div
                  key={card.branchId}
                  className={cn(
                    'rounded-lg border p-3 space-y-2 text-right',
                    selected
                      ? 'border-info/50 bg-info-soft ring-1 ring-info/30'
                      : recommendedStateTone(card.recommendedState),
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground">{shortBranchName(card)}</p>
                      <p className="text-[11px] opacity-80 mt-0.5">
                        {recommendedStateLabelAr(
                          card.persistedState === 'CLOSED'
                            ? 'CLOSED'
                            : card.recommendedState,
                        )}
                        {card.blockerCount > 0 ? ` · ${card.blockerCount} مشاكل` : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      className="h-8 text-[11px]"
                      disabled={workspaceBusy}
                      onClick={() => void handleWorkspaceBranchChange(card.branchId)}
                    >
                      {selected ? 'الفرع الحالي' : 'إدارة'}
                    </Button>
                  </div>
                  {card.shortBlockerSummary ? (
                    <p className="text-[10px] opacity-80">{card.shortBlockerSummary}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-3 text-[11px] tabular-nums opacity-90">
                    <span>{card.employeeCount} موظف</span>
                    <span>{fmt(card.totalWage)} ج.م</span>
                    <span>{Number(card.totalHours).toFixed(1)} س</span>
                    <span>{card.payrollRowCount} يومية</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleBulkValidateAllBranches()}
            disabled={busy || bulkRunning || validating}
            className="border-info/40 text-info hover:bg-info-soft gap-2 h-10"
          >
            {bulkRunning || validating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ClipboardList className="w-4 h-4" />
            )}
            فحص الحضور لكل الفروع
          </Button>
          <Button
            type="button"
            onClick={() => void handleBulkGenerateAllBranches()}
            disabled={busy || bulkRunning || generating}
            className="bg-warning hover:bg-warning/85 text-warning-foreground gap-2 h-10"
          >
            {bulkRunning || generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            توليد اليوميات + الترحيل للدفتر
          </Button>
          <Button
            type="button"
            onClick={() => void handleBulkCloseReadyBranches()}
            disabled={busy || bulkRunning || dateHubSummary.readyCount === 0}
            className="bg-success hover:bg-success/85 text-success-foreground gap-2 h-10"
          >
            {bulkRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Lock className="w-4 h-4" />
            )}
            إقفال الجاهز
            {dateHubSummary.readyCount > 0 ? ` (${dateHubSummary.readyCount})` : ''}
          </Button>
        </div>
      </div>

      {/* ── Open days monitor (quick jump) ─────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] text-muted-foreground mb-1">الأيام المفتوحة</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {openDaysLoading && openDaysItems.length === 0 ? '…' : openDaysSummary.openCount}
          </p>
        </div>
        <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3">
          <p className="text-[11px] text-success mb-1">جاهزة للإقفال</p>
          <p className="text-2xl font-bold text-success tabular-nums">
            {openDaysLoading && openDaysItems.length === 0 ? '…' : openDaysSummary.readyCount}
          </p>
        </div>
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
          <p className="text-[11px] text-warning mb-1">تحتاج مراجعة</p>
          <p className="text-2xl font-bold text-warning tabular-nums">
            {openDaysLoading && openDaysItems.length === 0 ? '…' : openDaysSummary.reviewCount}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] text-muted-foreground mb-1">أقدم يوم مفتوح</p>
          <p className="text-sm font-semibold text-foreground leading-snug">
            {openDaysSummary.oldest
              ? `${formatWorkDateAr(openDaysSummary.oldest.workDate)} · ${shortBranchName(openDaysSummary.oldest)}`
              : openDaysLoading
                ? '…'
                : '—'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-bold text-foreground">أيام تحتاج إقفال</h3>
            <span className="text-[11px] text-muted-foreground">دخول سريع · الشهر الحالي</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 border-border text-foreground"
            disabled={openDaysLoading}
            onClick={() => void loadOpenDays()}
          >
            {openDaysLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            تحديث المراقبة
          </Button>
        </div>
        {openDaysError && (
          <p className="text-sm text-destructive">{openDaysError}</p>
        )}
        {openDaysLoading && openDaysItems.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل الأيام المفتوحة…
          </div>
        ) : openDaysItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد أيام غير محلولة في الشهر الحالي</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {openDaysItems.map((item) => {
              const key = selectionKey(item.branchId, item.workDate);
              return (
                <div
                  key={key}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-medium text-right space-y-1.5 min-w-[10rem]',
                    openDayChipTone(item),
                  )}
                >
                  <div>{openDayChipLabel(item)}</div>
                  {item.shortBlockerSummary ? (
                    <div className="text-[10px] opacity-80 font-normal">{item.shortBlockerSummary}</div>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 w-full text-[11px] border-border bg-background"
                    disabled={workspaceBusy}
                    onClick={() => void openDayIntoWorkspace(item.branchId, item.workDate)}
                  >
                    فتح اليوم
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── [B] Focused branch workspace ───────────────────────────────────── */}
      <div
        className={cn(
          'rounded-xl border p-4 space-y-3',
          readiness
            ? recommendedStateTone(readiness.recommendedState)
            : 'border-border bg-card',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs opacity-80">إدارة فرع محدد</p>
            <h2 className="text-lg font-bold text-foreground">
              {formatWorkDateAr(workspaceDate)}
              {workspaceBranchMeta
                ? ` · ${shortBranchName(workspaceBranchMeta)}`
                : workspaceBranchId != null
                  ? ` · فرع #${workspaceBranchId}`
                  : ''}
            </h2>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-md border border-border bg-background px-2 py-0.5">
                حالة محفوظة: {readiness ? recommendedStateLabelAr(readiness.persistedState) : '—'}
              </span>
              <span className="rounded-md border border-border bg-background px-2 py-0.5">
                توصية الجاهزية: {readiness ? recommendedStateLabelAr(readiness.recommendedState) : '—'}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              فرع الإجراءات
              <select
                value={workspaceBranchId ?? ''}
                disabled={workspaceBusy || workspaceBranches.length === 0}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (Number.isFinite(id) && id > 0) void handleWorkspaceBranchChange(id);
                }}
                className="h-9 rounded-md bg-background border border-border text-foreground text-sm px-2 min-w-[8rem]"
                title="فرع الفحص/التوليد/الإقفال — منفصل عن فلتر عرض الموظفين"
              >
                {workspaceBranches.length === 0 ? (
                  <option value="">—</option>
                ) : (
                  workspaceBranches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {shortBranchName(b)}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {workflow.map((step, idx) => (
            <div key={step.key} className="flex items-center gap-1.5">
              {idx > 0 && <span className="text-muted-foreground">→</span>}
              <span
                className={cn(
                  'rounded-md px-2 py-1 border',
                  step.done
                    ? 'border-success/40 bg-success-soft text-success'
                    : step.active
                      ? 'border-warning/40 bg-warning-soft text-warning'
                      : 'border-border bg-card text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>

        <p className="text-sm font-semibold">
          {isDayClosed
            ? '🔒 يوم الموظفين مقفل لهذا الفرع'
            : readiness?.readyToClose
              ? 'جاهز للإقفال'
              : readiness
                ? `غير جاهز للإقفال — ${readiness.summary.blockerCount} مشاكل تحتاج مراجعة`
                : loadingReadiness
                  ? 'جاري تقييم الجاهزية…'
                  : workspaceBranchId == null
                    ? 'اختر فرعًا وتاريخًا لإدارة اليوم'
                    : 'جاري تجهيز مساحة العمل…'}
        </p>

        {isDayClosed && (
          <div className="rounded-lg border border-destructive/40 bg-destructive-soft px-3 py-2 text-sm text-destructive space-y-1">
            <div className="flex items-center gap-2 font-bold">
              <Lock className="w-4 h-4" />
              مقفل — لا يمكن توليد/إعادة حساب الأجر لهذا الفرع والتاريخ
            </div>
            <p className="text-xs opacity-90">
              أُقفل بواسطة المستخدم #{readiness?.closeAudit?.closedByUserId ?? '—'}
              {readiness?.closeAudit?.closedAt
                ? ` · ${new Date(readiness.closeAudit.closedAt).toLocaleString('ar-EG')}`
                : ''}
            </p>
          </div>
        )}

        {isDayReopened && !isDayClosed && (
          <div className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning space-y-1">
            <div className="flex items-center gap-2 font-bold">
              <Unlock className="w-4 h-4" />
              تحذير: تم إعادة فتح هذا اليوم
            </div>
            {readiness?.closeAudit?.reopenReason && (
              <p className="text-xs">السبب: {readiness.closeAudit.reopenReason}</p>
            )}
            <p className="text-[11px] opacity-80">
              أُعيد فتحه بواسطة المستخدم #{readiness?.closeAudit?.reopenedByUserId ?? '—'}
              {readiness?.closeAudit?.reopenedAt
                ? ` · ${new Date(readiness.closeAudit.reopenedAt).toLocaleString('ar-EG')}`
                : ''}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {readiness?.recommendedState === 'NEEDS_REVIEW' && !isDayClosed && (
            <Button
              type="button"
              onClick={() => setSmartFixOpen(true)}
              disabled={busy}
              className="bg-warning hover:bg-warning/85 text-warning-foreground gap-2 h-10"
            >
              <Wrench className="w-4 h-4" />
              حل المشاكل
              {(readiness.summary.blockerCount ?? 0) > 0
                ? ` (${readiness.summary.blockerCount})`
                : ''}
            </Button>
          )}
          {canCloseDay && (
            <Button
              type="button"
              onClick={() => setCloseConfirmOpen(true)}
              disabled={busy || closingDay}
              className="bg-success hover:bg-success/85 text-success-foreground gap-2 h-10"
            >
              <Lock className="w-4 h-4" />
              إقفال يوم الموظفين
            </Button>
          )}
          {isDayClosed && canReopenPayrollDay && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setReopenReason('');
                setReopenConfirmOpen(true);
              }}
              disabled={busy || reopeningDay}
              className="border-warning/40 text-warning hover:bg-warning-soft gap-2 h-10"
            >
              <Unlock className="w-4 h-4" />
              إعادة فتح اليوم
            </Button>
          )}
          {canReopenPayrollDay && (
            <Button
              type="button"
              onClick={() => void handleAutoNightlyClose()}
              disabled={busy || nightlyClosing || bulkRangeClosing}
              className="bg-brand hover:bg-brand/85 text-brand-foreground gap-2 h-10"
              title="مثل سكربت الساعة 2:40 — حضور Default + يوميات + تارجت لكل الفروع، بدون واتساب"
            >
              {nightlyClosing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
              قفل اليوم التلقائي
            </Button>
          )}
        </div>
      </div>

      {canReopenPayrollDay && (
        <div className="rounded-xl border border-brand/25 bg-brand-soft p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-brand">قفل رينج أيام تلقائياً</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                لكل يوم بالترتيب: إكمال حضور ناقص → توليد يوميات + تارجت + ترحيل الدفتر (كل الفروع
                النشطة) → محاولة إقفال الفروع الجاهزة فقط. الحد الأقصى 31 يومًا · بدون واتساب · بدون
                إجبار إقفال.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">من تاريخ</label>
              <Input
                type="date"
                value={bulkRangeFrom}
                onChange={(e) => setBulkRangeFrom(e.target.value)}
                disabled={busy || bulkRangeClosing}
                className="bg-background border-border h-10 w-[160px]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">إلى تاريخ</label>
              <Input
                type="date"
                value={bulkRangeTo}
                onChange={(e) => setBulkRangeTo(e.target.value)}
                disabled={busy || bulkRangeClosing}
                className="bg-background border-border h-10 w-[160px]"
              />
            </div>
            <Button
              type="button"
              onClick={() => setBulkRangeConfirmOpen(true)}
              disabled={
                busy ||
                bulkRangeClosing ||
                !bulkRangeFrom ||
                !bulkRangeTo ||
                bulkRangeFrom > bulkRangeTo
              }
              className="bg-warning hover:bg-warning/85 text-warning-foreground font-semibold gap-2 h-10"
            >
              {bulkRangeClosing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CalendarDays className="w-4 h-4" />
              )}
              قفل رينج أيام تلقائياً
            </Button>
          </div>
          {bulkRangeProgress && (
            <div className="rounded-lg border border-brand/30 bg-background p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <p className="text-foreground font-medium">
                  {bulkRangeClosing ? 'جاري التنفيذ…' : 'التقدم'}
                  {bulkRangeProgress.currentDate
                    ? ` · ${bulkRangeProgress.currentDate}`
                    : ''}
                  <span className="text-muted-foreground font-normal mr-2">
                    — {bulkRangeProgress.phase}
                  </span>
                </p>
                <p className="tabular-nums text-muted-foreground">
                  {bulkRangeProgress.dayIndex}/{bulkRangeProgress.totalDays || '—'} يوم
                  {' · '}
                  <span className="text-success">{bulkRangeProgress.closed} مقفول</span>
                  {' · '}
                  <span className="text-muted-foreground">{bulkRangeProgress.alreadyClosed} مسبقاً</span>
                  {' · '}
                  <span className="text-warning">{bulkRangeProgress.notReady} غير جاهز</span>
                  {' · '}
                  <span className="text-destructive">{bulkRangeProgress.failed} فشل</span>
                </p>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-300',
                    bulkRangeClosing ? 'bg-warning' : 'bg-success',
                  )}
                  style={{
                    width: `${
                      bulkRangeProgress.totalDays > 0
                        ? Math.min(
                            100,
                            Math.round(
                              (bulkRangeProgress.dayIndex / bulkRangeProgress.totalDays) * 100,
                            ),
                          )
                        : bulkRangeClosing
                          ? 4
                          : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {(bulkRangeLogs.length > 0 || bulkRangeClosing) && (
            <div className="rounded-lg border border-border bg-background p-3 space-y-2">
              <p className="text-[11px] font-semibold text-foreground">سجل التنفيذ (Logs)</p>
              <div className="max-h-48 overflow-y-auto space-y-1 text-[11px] font-mono leading-relaxed">
                {bulkRangeLogs.length === 0 ? (
                  <p className="text-muted-foreground">في انتظار أول حدث…</p>
                ) : (
                  bulkRangeLogs.map((log) => (
                    <div
                      key={log.id}
                      className={cn(
                        'border-b border-border pb-1 last:border-0',
                        log.level === 'ok' && 'text-success',
                        log.level === 'warn' && 'text-warning',
                        log.level === 'error' && 'text-destructive',
                        log.level === 'info' && 'text-muted-foreground',
                      )}
                    >
                      {log.message}
                    </div>
                  ))
                )}
                <div ref={bulkRangeLogEndRef} />
              </div>
            </div>
          )}

          {bulkRangeErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/35 bg-destructive-soft p-3 space-y-2">
              <p className="text-[11px] font-semibold text-destructive">
                الأخطاء والملاحظات ({bulkRangeErrors.length})
              </p>
              <div className="max-h-44 overflow-y-auto space-y-2 text-xs">
                {Object.entries(
                  bulkRangeErrors.reduce<
                    Record<string, typeof bulkRangeErrors>
                  >((acc, row) => {
                    (acc[row.workDate] ??= []).push(row);
                    return acc;
                  }, {}),
                ).map(([workDate, rows]) => (
                  <div key={workDate} className="border-t border-destructive/20 pt-2 first:border-0 first:pt-0">
                    <p className="tabular-nums text-destructive font-medium mb-1">{workDate}</p>
                    <ul className="space-y-1 text-foreground">
                      {rows.map((row) => (
                        <li key={row.id} className="flex flex-wrap gap-x-2 gap-y-0.5">
                          <span
                            className={cn(
                              'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                              row.kind === 'pipeline' && 'bg-destructive-soft text-destructive',
                              row.kind === 'notReady' && 'bg-warning-soft text-warning',
                              row.kind === 'failed' && 'bg-destructive-soft text-destructive',
                            )}
                          >
                            {row.kind === 'pipeline'
                              ? 'بايبلاين'
                              : row.kind === 'notReady'
                                ? 'غير جاهز'
                                : 'فشل'}
                          </span>
                          {row.branchCode ? (
                            <span className="text-foreground font-medium">{row.branchCode}</span>
                          ) : null}
                          <span className="text-muted-foreground">{row.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {bulkRangeResult && !bulkRangeClosing && (
            <div className="rounded-lg border border-border bg-background p-3 text-xs space-y-2 max-h-40 overflow-y-auto">
              <p className="text-foreground font-medium">
                ملخص نهائي — أيام {bulkRangeResult.summary.daysProcessed} · فروع{' '}
                {bulkRangeResult.summary.branchesProcessed} · مقفول {bulkRangeResult.summary.closed}{' '}
                · مسبقاً {bulkRangeResult.summary.alreadyClosed} · غير جاهز{' '}
                {bulkRangeResult.summary.notReady} · فشل {bulkRangeResult.summary.failed}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-destructive-soft border border-destructive/30 rounded-xl text-destructive text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')}><X className="w-4 h-4 opacity-60 hover:opacity-100" /></button>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-success-soft border border-success/30 rounded-xl text-success text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />{successMsg}
        </div>
      )}

      {/* ── Blockers / warnings from readiness engine ─────────────────────── */}
      {blockersByEmp.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive-soft p-4 space-y-2">
          <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
            <AlertCircle className="w-4 h-4" />
            موانع الإقفال ({readiness?.summary.blockerCount ?? blockersByEmp.length})
          </div>
          <ul className="space-y-1.5 text-sm">
            {blockersByEmp.map((row) => (
              <li key={row.empId} className="flex flex-wrap gap-x-2 gap-y-0.5 text-destructive">
                <span className="font-medium text-foreground">{row.empName}</span>
                <span className="text-destructive">— {row.messages.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(readiness?.warnings?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground font-semibold text-sm">
            <AlertTriangle className="w-4 h-4" />
            تنبيهات (ليست موانع إقفال)
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {readiness!.warnings.map((w, idx) => (
              <li key={`${w.empId ?? 'x'}-${w.code}-${idx}`}>
                {w.empName ? `${w.empName} — ` : ''}
                {REASON_LABEL[w.code as PayrollValidationReason] ?? w.message ?? w.code}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Auto-generate log banner ────────────────────────────────────────── */}
      {autoGenLog?.found && (
        autoGenLog.success ? (
          <div className="flex items-start gap-3 p-4 bg-info-soft border border-info/30 rounded-xl text-info text-sm">
            <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">تم توليد اليوميات تلقائيًا ولم يتم ترحيلها للخزنة بعد</p>
              <p className="text-xs text-info mt-0.5">
                {autoGenLog.employeesCount} موظف · {Number(autoGenLog.totalHours ?? 0).toFixed(1)} ساعة · {fmt(autoGenLog.totalWages ?? 0)} ج.م
                {autoGenLog.createdAt ? ` · ${new Date(autoGenLog.createdAt).toLocaleTimeString('ar-EG')}` : ''}
              </p>
            </div>
            <button onClick={() => setAutoGenLog(null)}><X className="w-4 h-4 opacity-50 hover:opacity-100" /></button>
          </div>
        ) : autoGenLog.missing && autoGenLog.missing.length > 0 ? (
          <div className="p-4 bg-warning-soft border border-warning/30 rounded-xl text-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-warning font-semibold">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                لم يتم توليد اليوميات تلقائيًا بسبب نقص بيانات الحضور والانصراف
              </div>
              <button onClick={() => setAutoGenLog(null)}><X className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="space-y-1.5">
              {autoGenLog.missing.map((m: ValidationMissing) => (
                <div key={m.empId} className="flex items-center justify-between px-3 py-1.5 bg-warning-soft rounded-lg border border-warning/20">
                  <span className="text-foreground text-sm">{m.empName}</span>
                  <span className="text-warning text-xs">{REASON_LABEL[m.reason]}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null
      )}

      {/* ── Action buttons (workflow steps) ─────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        {!isDayClosed && (
          <>
        <Button onClick={handleValidate} disabled={validating || busy}
          variant="outline"
          className="border-info/40 text-info hover:bg-info-soft gap-2 h-11 px-5">
          {validating
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الفحص...</>
            : <><ClipboardList className="w-4 h-4" />فحص الحضور</>}
        </Button>

        <Button onClick={handleGenerate} disabled={generating || regeneratingTarget || busy}
          className="bg-warning hover:bg-warning/85 text-warning-foreground gap-2 h-11 px-6">
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري التوليد...</>
            : <><Zap className="w-4 h-4" />{dualWriteEnabled ? 'توليد اليوميات + الترحيل للدفتر' : 'توليد اليوميات والتارجت'}</>}
        </Button>

        <Button
          onClick={handleRecalculateTargets}
          disabled={generating || regeneratingTarget || busy}
          variant="outline"
          className="border-brand/40 text-brand hover:bg-brand-soft gap-2 h-11 px-5"
        >
          {regeneratingTarget
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري إعادة حساب التارجت...</>
            : <><Target className="w-4 h-4" />إعادة حساب التارجت فقط</>}
        </Button>
          </>
        )}

        {isDayClosed && (
          <p className="text-xs text-muted-foreground">
            توليد اليوميات وإعادة حساب التارجت مخفيان لأن اليوم مقفل.
          </p>
        )}

        {canPost && (
          <Button onClick={() => setConfirmOpen(true)} disabled={posting || busy}
            className={showLegacyPost
              ? 'bg-muted hover:bg-surface-muted border border-warning/40 gap-2 h-11 px-6'
              : 'bg-success hover:bg-success/85 text-success-foreground gap-2 h-11 px-6'}>
            <Send className="w-4 h-4" />
            {showLegacyPost ? 'ترحيل قديم للخزنة' : 'ترحيل للخزنة'}
            {showLegacyPost && (
              <Badge className="bg-warning-soft text-warning border border-warning/30 text-[10px] px-1.5">
                قديم
              </Badge>
            )}
            <Badge className="bg-muted text-foreground text-[10px] px-1.5 mr-1">{generatedCount}</Badge>
          </Button>
        )}

        <Link
          href="/admin/hr?tab=employee-ledger"
          className="inline-flex items-center justify-center gap-1 h-11 px-3 text-xs rounded-md border border-border text-foreground hover:bg-surface-muted"
        >
          <BookOpen className="w-3.5 h-3.5" />
          دفتر الموظفين
        </Link>
      </div>

      {legacyPostToCashDisabled && (
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 bg-info-soft border border-info/30 rounded-xl text-info text-sm">
          <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <p>
              تم إيقاف الترحيل القديم لمنع تضخم الإيرادات والمصروفات. استخدم دفتر الموظفين لصرف المستحقات.
            </p>
            <Link
              href="/admin/hr?tab=employee-ledger"
              className="inline-flex items-center gap-1 text-xs font-medium text-info underline underline-offset-2 hover:text-foreground"
            >
              <BookOpen className="w-3.5 h-3.5" />
              فتح دفتر الموظفين
            </Link>
          </div>
        </div>
      )}

      {showLegacyPost && canPost && (
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 bg-warning-soft border border-warning/30 rounded-xl text-warning text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <p>
              {legacyPostToCashWarning ??
                'هذا الإجراء ينشئ حركات خزنة وقد يضخم التقارير. في النظام الجديد، استخدم دفتر الموظفين لصرف المستحقات.'}
            </p>
            <Link
              href="/admin/hr?tab=employee-ledger"
              className="inline-flex items-center gap-1 text-xs font-medium text-warning underline underline-offset-2 hover:text-foreground"
            >
              <BookOpen className="w-3.5 h-3.5" />
              استخدم دفتر الموظفين لصرف المستحقات
            </Link>
          </div>
        </div>
      )}

      {!legacyPostToCashDisabled && dualWriteEnabled && !canPost && (
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 bg-muted border border-border rounded-xl text-muted-foreground text-sm">
          <BookOpen className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="flex-1">
            اليوميات المُولَّدة تُسجَّل كاستحقاق في دفتر الموظفين. استخدم «صرف مستحقات» من الدفتر للصرف الفعلي.
          </p>
        </div>
      )}

      {/* ── Validation result card ───────────────────────────────────────────── */}
      {validationDone && (
        validationOk ? (
          <div className="flex items-center gap-3 p-4 bg-success-soft border border-success/30 rounded-xl text-success text-sm">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <span>بيانات الحضور والانصراف مكتملة لجميع الموظفين — يمكنك توليد اليوميات الآن</span>
          </div>
        ) : validationMissing.length > 0 ? (
          <div className="p-4 bg-destructive-soft border border-destructive/30 rounded-xl text-sm">
            <div className="flex items-center gap-2 text-destructive font-semibold mb-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              برجاء إكمال بيانات الحضور والانصراف أولاً
            </div>
            <div className="space-y-2">
              {validationMissing.map(m => (
                <div key={m.empId} className="flex items-center justify-between px-3 py-2 bg-destructive-soft rounded-lg border border-destructive/20">
                  <span className="text-foreground font-medium text-sm">{m.empName}</span>
                  <span className="text-destructive text-xs">{REASON_LABEL[m.reason]}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null
      )}

      {validationDone && validationExcluded.length > 0 && (
        <div className="p-4 bg-muted border border-border rounded-xl text-sm">
          <div className="flex items-center gap-2 text-muted-foreground font-semibold mb-3">
            <Users className="w-5 h-5 shrink-0" />
            مستثنون من اليوميات (ليس خطأ)
          </div>
          <div className="space-y-2">
            {validationExcluded.map(m => (
              <div key={m.empId} className="flex items-center justify-between px-3 py-2 bg-muted rounded-lg border border-border">
                <span className="text-foreground text-sm">{m.empName}</span>
                <span className="text-muted-foreground text-xs">{REASON_LABEL[m.reason]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Compact metrics (status is primary; keep essentials only) ──────── */}
      {(summary || targetTotals) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summary && (
            <>
              <KpiCard title="الأساسي اليومي" value={`${fmt(summary.totalWage)} ج.م`} icon={<Banknote className="w-5 h-5" />} variant="primary" />
              <KpiCard title="الساعات" value={`${Number(summary.totalHours ?? 0).toFixed(1)} س`} icon={<Timer className="w-5 h-5" />} variant="default" />
            </>
          )}
          {targetTotals && (
            <>
              <KpiCard title="فرق تارجت اليوم" value={`${fmt(Number(targetTotals.totalStoredTargetAmount))} ج.م`} icon={<Target className="w-5 h-5" />} variant="default" />
              <KpiCard title="لم يُولَّد تارجتهم" value={targetTotals.notGenerated} icon={<AlertTriangle className="w-5 h-5" />} variant="warning" />
            </>
          )}
        </div>
      )}

      {planConflicts.length > 0 && (
        <div className="p-4 bg-destructive-soft border border-destructive/30 rounded-xl text-destructive text-sm">
          <p className="font-semibold mb-1">تعارض خطط تارجت يحتاج مراجعة</p>
          <ul className="text-xs space-y-1 list-disc pr-4">
            {planConflicts.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}

      {/* ── Missing revenue-mapping warning ─────────────────────────────────── */}
      {missingMappingEmps.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-warning-soft border border-warning/30 rounded-xl text-warning text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">تحذير: موظفون بدون تصنيف إيراد مربوط</p>
            <p className="text-xs text-warning">لن يمكن ترحيل يومياتهم حتى يتم ربط تصنيف إيراد لكل منهم في تاب الموظفون:</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {missingMappingEmps.map(e => (
                <span key={e.EmpID} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-warning-soft border border-warning/30">
                  {e.EmpName}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {sameDayMultiBranchEmployees.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-brand-soft border border-brand/30 rounded-xl text-brand text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">تنبيه: بيانات على أكثر من فرع لنفس اليوم</p>
            <p className="text-xs text-brand mb-2">
              الجدول يعرض صفًا واحدًا لكل موظف حسب فرع الحضور/اليومية الفعلي لذلك اليوم.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sameDayMultiBranchEmployees.map((e) => (
                <span
                  key={e.empId}
                  className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-brand-soft border border-brand/30"
                >
                  {e.empName} · فروع {e.branchIds.join(', ')}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-foreground">يوميات وتارجت {date}</h2>
            <p className="text-[11px] text-muted-foreground">
              فلتر العرض منفصل عن فرع الإجراءات — لا يبدّل الجلسة
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">عرض الموظفين</span>
            {[
              { id: 'all', label: 'كل الموظفين' },
              ...scopeOptions.map((o) => ({ id: o.code, label: o.label })),
            ].map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                variant={employeeScope === opt.id ? 'default' : 'outline'}
                className={cn(
                  'h-8 text-[11px]',
                  employeeScope === opt.id
                    ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
                    : 'border-border text-foreground',
                )}
                disabled={loading}
                onClick={() => handleEmployeeScopeChange(opt.id)}
              >
                {opt.label}
              </Button>
            ))}
            {loaded && <span className="text-xs text-muted-foreground mr-1">{mergedRows.length} صف</span>}
          </div>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
              <Loader2 className="w-6 h-6 animate-spin" />جاري التحميل...
            </div>
          ) : !loaded ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <CalendarDays className="w-10 h-10 opacity-30" />
              <p className="text-sm">اختر يومًا من «أيام تحتاج إقفال» أو غيّر التاريخ</p>
            </div>
          ) : mergedRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Users className="w-10 h-10 opacity-30" />
              <p className="text-sm">لا توجد يوميات أو خطط تارجت لهذا اليوم</p>
            </div>
          ) : (
            <table className="w-full text-sm" dir="rtl">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-3 text-right font-medium">الموظف</th>
                  <th className="px-3 py-3 text-center font-medium">الحالة</th>
                  <th className="px-3 py-3 text-center font-medium">حالة الحضور</th>
                  <th className="px-3 py-3 text-center font-medium">عدد الساعات</th>
                  <th className="px-3 py-3 text-left font-medium">الأساسي اليومي</th>
                  <th className="px-3 py-3 text-left font-medium">مبيعات اليوم / تراكمي الشهر</th>
                  <th className="px-3 py-3 text-center font-medium">نظام التارجت</th>
                  <th className="px-3 py-3 text-left font-medium">تارجت حتى الآن / فرق اليوم</th>
                  <th className="px-3 py-3 text-center font-medium">حالة التوليد</th>
                  <th className="px-3 py-3 text-center font-medium">مزامنة التارجت</th>
                  <th className="px-3 py-3 text-center font-medium">التفاصيل</th>
                  <th className="px-3 py-3 text-center font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {mergedRows.map((merged) => {
                  const row = merged.payroll as PayrollRow | null;
                  const target = merged.target;
                  const sync = merged.targetSyncStatus ?? target?.syncStatus;
                  const rowBranchId =
                    merged.branchId ??
                    row?.BranchID ??
                    target?.branchId ??
                    null;
                  const status =
                    rowBranchId != null &&
                    workspaceBranchId != null &&
                    rowBranchId === workspaceBranchId
                      ? employeeStatusFromReadiness(readinessByEmp.get(merged.empId))
                      : { key: 'needs_review' as const, label: '—' };
                  const rowBusy =
                    generatingEmpId === merged.empId &&
                    (generatingBranchId == null || generatingBranchId === rowBranchId);
                  const rowClosed =
                    rowBranchId != null &&
                    rowBranchId === workspaceBranchId &&
                    isDayClosed;
                  const rowKey = `${merged.empId}|${rowBranchId ?? 'x'}`;
                  return (
                    <tr
                      key={rowKey}
                      className={`border-b border-border hover:bg-surface-muted transition-colors ${row?.Status === 'PostedToCashMove' ? 'opacity-60' : ''}`}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                            {merged.empName?.charAt(0)}
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-foreground text-sm">{merged.empName}</span>
                              {branchBadge(
                                merged.branchCode ?? row?.BranchCode ?? target?.branchCode,
                                merged.branchName ?? row?.BranchName ?? target?.branchName,
                                scopeCodes,
                              )}
                              {merged.sameDayMultiBranch ? (
                                <span className="text-[10px] text-brand">متعدد الفروع</span>
                              ) : null}
                            </div>
                            {row && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {employmentBadge(row.EmploymentType)}
                                {payrollMethodBadge(row.PayrollMethod)}
                                {row.PayrollMethod === 'monthly' ? (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                                    شهري — لا يُغلق على اليوميات
                                  </span>
                                ) : null}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={cn(
                            'inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border',
                            employeeStatusTone(status.key),
                          )}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {row ? attendanceBadge(row.AttendanceStatus) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="px-3 py-3 text-center text-xs">
                        {row?.ActualHours != null
                          ? <span className="text-info font-medium">{Number(row.ActualHours).toFixed(2)} س</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-3 text-left whitespace-nowrap">
                        {row ? (
                          <>
                            <span className="font-bold text-foreground">{fmt(row.DailyWage)}</span>
                            <span className="text-[11px] font-normal text-muted-foreground mr-1">ج.م</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-left text-xs">
                        {target ? (
                          <div className="space-y-0.5">
                            <span className="text-info font-medium">
                              {fmt(Number(target.currentNetSalesAfterDiscount))}
                            </span>
                            {target.currentMtdSales != null && (
                              <div className="text-[10px] text-muted-foreground">
                                تراكمي {fmt(Number(target.currentMtdSales))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center text-[11px] text-foreground max-w-[140px]">
                        {target ? target.planSummary : 'لا يوجد تارجت'}
                      </td>
                      <td className="px-3 py-3 text-left whitespace-nowrap">
                        {!target && <span className="text-muted-foreground">—</span>}
                        {target?.persistenceStatus === 'not_generated' && (
                          <span className="text-warning text-xs">لم يتم التوليد</span>
                        )}
                        {target && target.persistenceStatus !== 'not_generated' && (
                          <div className="space-y-0.5">
                            <button
                              type="button"
                              className="font-bold text-brand hover:underline"
                              onClick={() => setDetailTarget(target)}
                            >
                              {fmt(
                                Number(
                                  target.storedMtdTargetAmount ??
                                    target.previewMtdTargetAmount ??
                                    target.storedTargetAmount ??
                                    0,
                                ),
                              )}
                              <span className="text-[10px] font-normal text-muted-foreground mr-1">
                                حتى الآن
                              </span>
                            </button>
                            <div className="text-[10px] text-muted-foreground">
                              فرق اليوم {fmt(Number(target.storedTargetAmount ?? 0))}
                            </div>
                            {target.displayStatus === 'below_first_tier' && (
                              <div>
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-warning/30 text-warning bg-warning-soft">
                                  لسه متحسبلهوش تارجت
                                </span>
                              </div>
                            )}
                            {target.displayStatus === 'earned_target' && (
                              <div>
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-success/30 text-success bg-success-soft">
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
                          {(sync === 'failed' || sync === 'pending') && target && !rowClosed && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] border-warning/40 text-warning"
                              disabled={regeneratingTarget || generating}
                              onClick={() => void retryEmployeeTarget(merged.empId, rowBranchId)}
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
                            className="h-7 text-[11px] border-border"
                            onClick={() => setDetailTarget(target)}
                          >
                            تفاصيل
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-stretch gap-1 min-w-[7.5rem]">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] border-info/40 text-info gap-1"
                            disabled={busy || switchingBranch}
                            onClick={() =>
                              openEmployeeAttendance(merged.empId, merged.empName, rowBranchId)
                            }
                          >
                            <CalendarClock className="w-3 h-3" />
                            حضور اليوم
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] border-success/40 text-success gap-1"
                            disabled={
                              busy ||
                              generating ||
                              regeneratingTarget ||
                              rowClosed ||
                              row?.Status === 'PostedToCashMove'
                            }
                            onClick={() =>
                              void generateEmployeePayrollAndTarget(
                                merged.empId,
                                merged.empName,
                                rowBranchId,
                              )
                            }
                          >
                            {rowBusy ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Zap className="w-3 h-3" />
                            )}
                            يومية + تارجت
                          </Button>
                          {canReopenPayrollDay && rowBranchId != null && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] border-brand/40 text-brand gap-1"
                              disabled={
                                busy ||
                                rowClosed ||
                                row?.Status === 'PostedToCashMove'
                              }
                              title="نقل حضور/يومية/تارجت هذا اليوم لفرع آخر (تصحيح فرع غلط)"
                              onClick={() =>
                                setMoveDayTarget({
                                  empId: merged.empId,
                                  empName: merged.empName,
                                  workDate: date,
                                  fromBranchId: rowBranchId,
                                  fromBranchName:
                                    merged.branchName ??
                                    row?.BranchName ??
                                    undefined,
                                })
                              }
                            >
                              <ArrowLeftRight className="w-3 h-3" />
                              نقل لفرع آخر
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {(summary || targetTotals) && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted">
                    <td className="px-3 py-3 text-xs font-bold text-muted-foreground" colSpan={3}>
                      الإجماليات (منفصلة)
                    </td>
                    <td className="px-3 py-3 text-center text-info font-bold text-sm">
                      {summary ? `${Number(summary.totalHours ?? 0).toFixed(1)} س` : '—'}
                    </td>
                    <td className="px-3 py-3 text-left font-bold text-foreground whitespace-nowrap">
                      {summary ? `${fmt(summary.totalWage)} ج.م` : '—'}
                      <div className="text-[10px] text-muted-foreground font-normal">أساسي فقط</div>
                    </td>
                    <td className="px-3 py-3 text-left text-info font-bold text-sm">
                      {targetTotals ? fmt(Number(targetTotals.totalCurrentNetSalesAfterDiscount)) : '—'}
                    </td>
                    <td />
                    <td className="px-3 py-3 text-left font-bold text-brand whitespace-nowrap">
                      {targetTotals
                        ? `${fmt(Number(targetTotals.totalStoredMtdTargetAmount ?? targetTotals.totalStoredTargetAmount))} ج.م`
                        : '—'}
                      <div className="text-[10px] text-muted-foreground font-normal">حتى الآن</div>
                      {targetTotals && (
                        <div className="text-[10px] text-muted-foreground font-normal">
                          فرق اليوم {fmt(Number(targetTotals.totalStoredTargetAmount))}
                        </div>
                      )}
                    </td>
                    <td colSpan={3} />
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

      <MoveEmployeeDayBranchModal
        open={moveDayTarget != null}
        target={moveDayTarget}
        onClose={() => setMoveDayTarget(null)}
        onSuccess={(msg) => {
          flash(msg);
          if (selectedBranchId != null) {
            void refreshAfterMutation(selectedBranchId, date);
          } else {
            void load(date);
            void loadOpenDays();
          }
        }}
      />

      {/* ── Confirm Post Dialog ─────────────────────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Send className="w-5 h-5 text-success" />
              تأكيد ترحيل يوميات الموظفين للخزنة
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">تاريخ اليوميات</p>
                <p className="text-sm font-bold text-foreground">{date}</p>
              </div>
              <div className="bg-muted rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">عدد الموظفين</p>
                <p className="text-sm font-bold text-foreground">{generatedCount}</p>
              </div>
              <div className="bg-muted rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">إجمالي الساعات</p>
                <p className="text-sm font-bold text-info">{Number(summary?.totalHours ?? 0).toFixed(1)} س</p>
              </div>
              <div className="bg-muted rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">إجمالي الأجور</p>
                <p className="text-sm font-bold text-success">{fmt(summary?.totalWage ?? 0)} ج.م</p>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 bg-warning-soft border border-warning/30 rounded-lg text-warning text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>بعد الترحيل للخزنة سيتم تسجيل هذه اليوميات كمصروفات، ولا يُفضل تعديلها إلا من خلال إجراء تصحيح.</span>
            </div>

            {showLegacyPost && (
              <div className="flex flex-col gap-2 p-3 bg-destructive-soft border border-destructive/30 rounded-lg text-destructive text-xs">
                <p>
                  {legacyPostToCashWarning ??
                    'هذا الإجراء ينشئ حركات خزنة وقد يضخم التقارير. في النظام الجديد، استخدم دفتر الموظفين لصرف المستحقات.'}
                </p>
                <Link
                  href="/admin/hr?tab=employee-ledger"
                  className="inline-flex items-center gap-1 text-warning underline underline-offset-2 hover:text-foreground"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  استخدم دفتر الموظفين لصرف المستحقات
                </Link>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse" dir="rtl">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}
              className="border-border text-foreground hover:bg-surface-muted">
              إلغاء
            </Button>
            <Button onClick={handlePostToCash} disabled={posting}
              className={showLegacyPost
                ? 'bg-muted hover:bg-surface-muted border border-warning/40 gap-2'
                : 'bg-success hover:bg-success/85 text-success-foreground gap-2'}>
              {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {showLegacyPost ? 'تأكيد الترحيل القديم للخزنة' : 'تأكيد الترحيل للخزنة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Lock className="w-5 h-5 text-success" />
              تأكيد إقفال يوم الموظفين
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              سيتم قفل توليد/إعادة حساب الأجر لهذا الفرع والتاريخ فقط. فروع أخرى في نفس التاريخ تبقى مستقلة.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-foreground space-y-1 py-2">
            <p>الفرع: {readiness ? shortBranchName(readiness) : selectedBranchId}</p>
            <p>التاريخ: {formatWorkDateAr(date)}</p>
          </div>
          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse" dir="rtl">
            <Button variant="outline" onClick={() => setCloseConfirmOpen(false)} disabled={closingDay}
              className="border-border text-foreground hover:bg-surface-muted">
              إلغاء
            </Button>
            <Button onClick={() => void handleCloseDay()} disabled={closingDay}
              className="bg-success hover:bg-success/85 text-success-foreground gap-2">
              {closingDay ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              تأكيد الإقفال
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkRangeConfirmOpen}
        onOpenChange={(open) => {
          if (!bulkRangeClosing) setBulkRangeConfirmOpen(open);
        }}
      >
        <DialogContent className="bg-card border-border text-foreground max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <CalendarDays className="w-5 h-5 text-warning" />
              تأكيد قفل رينج أيام
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-relaxed">
              العملية قد تقفل أيامًا نهائيًا لكل الفروع النشطة. لا يُفرض إقفال على يوم/فرع غير جاهز،
              ويمكن إعادة التشغيل لنفس الرينج بأمان (idempotent).
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-foreground space-y-2 py-2">
            <p>
              من <span className="tabular-nums font-medium text-foreground">{bulkRangeFrom}</span> إلى{' '}
              <span className="tabular-nums font-medium text-foreground">{bulkRangeTo}</span>
            </p>
            <ul className="text-xs text-muted-foreground list-disc pr-4 space-y-1">
              <li>لكل يوم: بايبلاين قفل اليوم التلقائي (بدون واتساب) ثم محاولة إقفال الفروع</li>
              <li>الحد الأقصى 31 يومًا · بدون تواريخ مستقبلية</li>
              <li>فشل يوم/فرع لا يوقف باقي الرينج</li>
            </ul>
          </div>
          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse" dir="rtl">
            <Button
              variant="outline"
              onClick={() => setBulkRangeConfirmOpen(false)}
              disabled={bulkRangeClosing}
              className="border-border text-foreground hover:bg-surface-muted"
            >
              إلغاء
            </Button>
            <Button
              onClick={() => void handleBulkCloseRange()}
              disabled={bulkRangeClosing}
              className="bg-warning hover:bg-warning/85 text-warning-foreground font-semibold gap-2"
            >
              {bulkRangeClosing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CalendarDays className="w-4 h-4" />
              )}
              تأكيد وتشغيل الرينج
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenConfirmOpen} onOpenChange={setReopenConfirmOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Unlock className="w-5 h-5 text-warning" />
              إعادة فتح يوم الموظفين
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              مطلوب سبب إلزامي. بعد إعادة الفتح يمكن التصحيح والتوليد، ولن يُقفل تلقائيًا.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-xs text-muted-foreground">سبب إعادة الفتح</label>
            <Input
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              maxLength={500}
              placeholder="مثال: تصحيح حضور ناقص"
              className="bg-muted border-border text-foreground"
            />
          </div>
          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse" dir="rtl">
            <Button variant="outline" onClick={() => setReopenConfirmOpen(false)} disabled={reopeningDay}
              className="border-border text-foreground hover:bg-surface-muted">
              إلغاء
            </Button>
            <Button
              onClick={() => void handleReopenDay()}
              disabled={reopeningDay || !reopenReason.trim()}
              className="bg-warning hover:bg-warning/85 text-warning-foreground gap-2"
            >
              {reopeningDay ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
              تأكيد إعادة الفتح
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DailyPayrollSmartFixModal
        open={smartFixOpen}
        onOpenChange={setSmartFixOpen}
        readiness={readiness}
        isDayClosed={isDayClosed}
        ensureSessionBranch={ensureSessionBranch}
        onRefreshAfterFix={async () => {
          if (selectedBranchId == null) return null;
          return refreshAfterMutation(selectedBranchId, date);
        }}
        generatePayrollOnly={generatePayrollOnly}
        generateTargetsOnly={generateTargetsOnly}
      />

      {rowAttendance && (
        <SmartAttendanceFixDialog
          open={Boolean(rowAttendance)}
          onOpenChange={(o) => {
            if (!o) setRowAttendance(null);
          }}
          branchId={rowAttendance.branchId}
          workDate={rowAttendance.workDate}
          empId={rowAttendance.empId}
          empName={rowAttendance.empName}
          ensureSessionBranch={ensureSessionBranch}
          onSaved={() => {
            setRowAttendance(null);
            flash('تم حفظ الحضور');
            if (selectedBranchId != null) void refreshAfterMutation(selectedBranchId, date);
            else void load(date);
          }}
        />
      )}

    </div>
  );
}
