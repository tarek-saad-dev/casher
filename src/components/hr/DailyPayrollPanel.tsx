'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  CalendarDays, Loader2, Zap, Send, RefreshCw,
  CheckCircle2, AlertCircle, Users, Banknote,
  X,
  AlertTriangle, ShieldCheck, ClipboardList, Timer, BookOpen, Target,
  ChevronLeft, ChevronRight, Lock, Unlock, Wrench, CalendarClock,
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

type EmployeeScopeFilter = 'all' | 'GLEEM' | 'CAMP_CAESAR';

function branchBadge(branchCode: string | null | undefined, branchName?: string | null) {
  if (!branchCode && !branchName) return null;
  const code = String(branchCode ?? '');
  const label = shortBranchName({
    branchCode: code || '—',
    branchName: branchName || code || '—',
  });
  const tone =
    code === 'GLEEM'
      ? 'border-sky-500/25 bg-sky-500/10 text-sky-300/90'
      : code === 'CAMP_CAESAR'
        ? 'border-amber-500/25 bg-amber-500/10 text-amber-300/90'
        : 'border-zinc-600/40 bg-zinc-800/60 text-zinc-400';
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
  const { user } = useSession();
  const { access, hasRole } = usePermissions();
  const canReopenPayrollDay =
    Boolean(access?.isSuperAdmin) ||
    hasRole('admin') ||
    hasRole('super_admin') ||
    user?.UserLevel === 'admin';

  const [workspaceDate, setWorkspaceDate] = useState(getBusinessDateStr());
  const [workspaceBranchId, setWorkspaceBranchId] = useState<number | null>(null);
  const [workspaceBranches, setWorkspaceBranches] = useState<
    Array<{ branchId: number; branchCode: string; branchName: string }>
  >([]);
  const [sessionBranchId, setSessionBranchId] = useState<number | null>(null);
  /** Table visibility only — never switches session branch by itself. */
  const [employeeScope, setEmployeeScope] = useState<EmployeeScopeFilter>('all');
  const [sameDayMultiBranchEmployees, setSameDayMultiBranchEmployees] = useState<
    Array<{ empId: number; empName: string; branchIds: number[] }>
  >([]);

  /* Open-days monitor — completely independent of workspace */
  const [openDaysItems, setOpenDaysItems] = useState<DailyPayrollOpenDayItem[]>([]);
  const [openDaysLoading, setOpenDaysLoading] = useState(false);
  const [openDaysError, setOpenDaysError] = useState('');

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
  const [smartFixOpen, setSmartFixOpen] = useState(false);
  const [generatingEmpId, setGeneratingEmpId] = useState<number | null>(null);
  const [generatingBranchId, setGeneratingBranchId] = useState<number | null>(null);
  const [rowAttendance, setRowAttendance] = useState<{
    empId: number;
    empName: string;
    branchId: number;
    workDate: string;
  } | null>(null);

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
      ]);
      return nextReadiness;
    },
    [load, loadReadiness],
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

        const d = getBusinessDateStr();
        const branchForWorkspace =
          activeId ?? (branches[0] ? branches[0].branchId : null);
        if (!cancelled) {
          setWorkspaceDate(d);
          if (branchForWorkspace != null) {
            await Promise.all([load(d), loadReadiness(branchForWorkspace, d)]);
          } else {
            await load(d);
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
    generatingEmpId != null;
  const busy = workspaceBusy;

  return (
    <div className="space-y-5" dir="rtl">

      {/* ── [A] Open days monitor (read-only, independent) ─────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/50 px-4 py-3">
          <p className="text-[11px] text-zinc-500 mb-1">الأيام المفتوحة</p>
          <p className="text-2xl font-bold text-white tabular-nums">
            {openDaysLoading && openDaysItems.length === 0 ? '…' : openDaysSummary.openCount}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <p className="text-[11px] text-emerald-500/80 mb-1">جاهزة للإقفال</p>
          <p className="text-2xl font-bold text-emerald-300 tabular-nums">
            {openDaysLoading && openDaysItems.length === 0 ? '…' : openDaysSummary.readyCount}
          </p>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-[11px] text-amber-500/80 mb-1">تحتاج مراجعة</p>
          <p className="text-2xl font-bold text-amber-300 tabular-nums">
            {openDaysLoading && openDaysItems.length === 0 ? '…' : openDaysSummary.reviewCount}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/50 px-4 py-3">
          <p className="text-[11px] text-zinc-500 mb-1">أقدم يوم مفتوح</p>
          <p className="text-sm font-semibold text-zinc-200 leading-snug">
            {openDaysSummary.oldest
              ? `${formatWorkDateAr(openDaysSummary.oldest.workDate)} · ${shortBranchName(openDaysSummary.oldest)}`
              : openDaysLoading
                ? '…'
                : '—'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-bold text-zinc-200">أيام تحتاج إقفال</h3>
            <span className="text-[11px] text-zinc-500">مراقبة فقط · الشهر الحالي</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 border-zinc-700 text-zinc-300"
            disabled={openDaysLoading}
            onClick={() => void loadOpenDays()}
          >
            {openDaysLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            تحديث المراقبة
          </Button>
        </div>
        {openDaysError && (
          <p className="text-sm text-rose-400">{openDaysError}</p>
        )}
        {openDaysLoading && openDaysItems.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500 py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل الأيام المفتوحة…
          </div>
        ) : openDaysItems.length === 0 ? (
          <p className="text-sm text-zinc-500">لا توجد أيام غير محلولة في الشهر الحالي</p>
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
                    className="h-7 w-full text-[11px] border-white/20 bg-black/20"
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

      {/* ── [B] Daily payroll workspace (manual branch + date) ─────────────── */}
      <div
        className={cn(
          'rounded-xl border p-4 space-y-3',
          readiness
            ? recommendedStateTone(readiness.recommendedState)
            : 'border-zinc-800 bg-zinc-900/40',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs opacity-80">إدارة يوم محدد</p>
            <h2 className="text-lg font-bold text-white">
              {formatWorkDateAr(workspaceDate)}
              {workspaceBranchMeta
                ? ` · ${shortBranchName(workspaceBranchMeta)}`
                : workspaceBranchId != null
                  ? ` · فرع #${workspaceBranchId}`
                  : ''}
            </h2>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-md border border-white/10 bg-black/20 px-2 py-0.5">
                حالة محفوظة: {readiness ? recommendedStateLabelAr(readiness.persistedState) : '—'}
              </span>
              <span className="rounded-md border border-white/10 bg-black/20 px-2 py-0.5">
                توصية الجاهزية: {readiness ? recommendedStateLabelAr(readiness.recommendedState) : '—'}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              فرع الإجراءات
              <select
                value={workspaceBranchId ?? ''}
                disabled={workspaceBusy || workspaceBranches.length === 0}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (Number.isFinite(id) && id > 0) void handleWorkspaceBranchChange(id);
                }}
                className="h-9 rounded-md bg-black/30 border border-white/15 text-white text-sm px-2 min-w-[8rem]"
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
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDateChange(shiftCalendarDate(workspaceDate, -1))}
              disabled={workspaceBusy}
              className="h-9 w-9 p-0 border-white/15 bg-black/20"
              aria-label="اليوم السابق"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Input
              type="date"
              value={workspaceDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="bg-black/30 border-white/15 text-white w-40 h-9 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDateChange(shiftCalendarDate(workspaceDate, 1))}
              disabled={workspaceBusy}
              className="h-9 w-9 p-0 border-white/15 bg-black/20"
              aria-label="اليوم التالي"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {workflow.map((step, idx) => (
            <div key={step.key} className="flex items-center gap-1.5">
              {idx > 0 && <span className="text-zinc-500">→</span>}
              <span
                className={cn(
                  'rounded-md px-2 py-1 border',
                  step.done
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                    : step.active
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-100'
                      : 'border-zinc-600/40 bg-zinc-900/40 text-zinc-500',
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
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 space-y-1">
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
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 space-y-1">
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
              className="bg-amber-700 hover:bg-amber-600 gap-2 h-10"
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
              className="bg-emerald-700 hover:bg-emerald-600 gap-2 h-10"
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
              className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10 gap-2 h-10"
            >
              <Unlock className="w-4 h-4" />
              إعادة فتح اليوم
            </Button>
          )}
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

      {/* ── Blockers / warnings from readiness engine ─────────────────────── */}
      {blockersByEmp.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
            <AlertCircle className="w-4 h-4" />
            موانع الإقفال ({readiness?.summary.blockerCount ?? blockersByEmp.length})
          </div>
          <ul className="space-y-1.5 text-sm">
            {blockersByEmp.map((row) => (
              <li key={row.empId} className="flex flex-wrap gap-x-2 gap-y-0.5 text-rose-100/90">
                <span className="font-medium text-white">{row.empName}</span>
                <span className="text-rose-300/90">— {row.messages.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(readiness?.warnings?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-zinc-600/50 bg-zinc-900/40 p-4 space-y-2">
          <div className="flex items-center gap-2 text-zinc-400 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4" />
            تنبيهات (ليست موانع إقفال)
          </div>
          <ul className="space-y-1 text-xs text-zinc-400">
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
        {!isDayClosed && (
          <>
        <Button onClick={handleValidate} disabled={validating || busy}
          variant="outline"
          className="border-sky-600/40 text-sky-400 hover:bg-sky-500/10 gap-2 h-11 px-5">
          {validating
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري الفحص...</>
            : <><ClipboardList className="w-4 h-4" />فحص الحضور</>}
        </Button>

        <Button onClick={handleGenerate} disabled={generating || regeneratingTarget || busy}
          className="bg-amber-600 hover:bg-amber-700 gap-2 h-11 px-6">
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري التوليد...</>
            : <><Zap className="w-4 h-4" />توليد اليوميات والتارجت</>}
        </Button>

        <Button
          onClick={handleRecalculateTargets}
          disabled={generating || regeneratingTarget || busy}
          variant="outline"
          className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10 gap-2 h-11 px-5"
        >
          {regeneratingTarget
            ? <><Loader2 className="w-4 h-4 animate-spin" />جاري إعادة حساب التارجت...</>
            : <><Target className="w-4 h-4" />إعادة حساب التارجت فقط</>}
        </Button>
          </>
        )}

        {isDayClosed && (
          <p className="text-xs text-zinc-400">
            توليد اليوميات وإعادة حساب التارجت مخفيان لأن اليوم مقفل.
          </p>
        )}

        {canPost && (
          <Button onClick={() => setConfirmOpen(true)} disabled={posting || busy}
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

        <Link
          href="/admin/hr?tab=employee-ledger"
          className="inline-flex items-center justify-center gap-1 h-11 px-3 text-xs rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >
          <BookOpen className="w-3.5 h-3.5" />
          دفتر الموظفين
        </Link>
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

      {sameDayMultiBranchEmployees.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-violet-500/10 border border-violet-500/30 rounded-xl text-violet-200 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">تنبيه: موظفون بنفس اليوم على أكثر من فرع</p>
            <p className="text-xs text-violet-200/80 mb-2">
              لم يتم دمج صفوف الفروع — كل BranchID يظهر مستقلًا. تقسيم اليوم داخل الفرع مؤجّل.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sameDayMultiBranchEmployees.map((e) => (
                <span
                  key={e.empId}
                  className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-500/20 border border-violet-500/30"
                >
                  {e.empName} · فروع {e.branchIds.join(', ')}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800/60 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-zinc-300">يوميات وتارجت {date}</h2>
            <p className="text-[11px] text-zinc-500">
              فلتر العرض منفصل عن فرع الإجراءات — لا يبدّل الجلسة
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-500">عرض الموظفين</span>
            {(
              [
                { id: 'all' as const, label: 'كل الموظفين' },
                { id: 'GLEEM' as const, label: 'جليم' },
                { id: 'CAMP_CAESAR' as const, label: 'كامب شيزار' },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                variant={employeeScope === opt.id ? 'default' : 'outline'}
                className={cn(
                  'h-8 text-[11px]',
                  employeeScope === opt.id
                    ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                    : 'border-zinc-700 text-zinc-300',
                )}
                disabled={loading}
                onClick={() => handleEmployeeScopeChange(opt.id)}
              >
                {opt.label}
              </Button>
            ))}
            {loaded && <span className="text-xs text-zinc-500 mr-1">{mergedRows.length} صف</span>}
          </div>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-500 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" />جاري التحميل...
            </div>
          ) : !loaded ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 gap-3">
              <CalendarDays className="w-10 h-10 opacity-30" />
              <p className="text-sm">اختر يومًا من «أيام تحتاج إقفال» أو غيّر التاريخ</p>
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
                      className={`border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors ${row?.Status === 'PostedToCashMove' ? 'opacity-60' : ''}`}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 shrink-0">
                            {merged.empName?.charAt(0)}
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-white text-sm">{merged.empName}</span>
                              {branchBadge(
                                merged.branchCode ?? row?.BranchCode ?? target?.branchCode,
                                merged.branchName ?? row?.BranchName ?? target?.branchName,
                              )}
                              {merged.sameDayMultiBranch ? (
                                <span className="text-[10px] text-violet-300/90">متعدد الفروع</span>
                              ) : null}
                            </div>
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
                        {target ? (
                          <div className="space-y-0.5">
                            <span className="text-sky-300 font-medium">
                              {fmt(Number(target.currentNetSalesAfterDiscount))}
                            </span>
                            {target.currentMtdSales != null && (
                              <div className="text-[10px] text-zinc-500">
                                تراكمي {fmt(Number(target.currentMtdSales))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
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
                              {fmt(
                                Number(
                                  target.storedMtdTargetAmount ??
                                    target.previewMtdTargetAmount ??
                                    target.storedTargetAmount ??
                                    0,
                                ),
                              )}
                              <span className="text-[10px] font-normal text-zinc-500 mr-1">
                                حتى الآن
                              </span>
                            </button>
                            <div className="text-[10px] text-zinc-400">
                              فرق اليوم {fmt(Number(target.storedTargetAmount ?? 0))}
                            </div>
                            {target.displayStatus === 'below_first_tier' && (
                              <div>
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] border border-amber-500/30 text-amber-400 bg-amber-500/10">
                                  لسه متحسبلهوش تارجت
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
                          {(sync === 'failed' || sync === 'pending') && target && !rowClosed && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] border-amber-500/40 text-amber-200"
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
                            className="h-7 text-[11px] border-zinc-700"
                            onClick={() => setDetailTarget(target)}
                          >
                            تفاصيل
                          </Button>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-stretch gap-1 min-w-[7.5rem]">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] border-sky-500/40 text-sky-200 gap-1"
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
                            className="h-7 text-[10px] border-emerald-500/40 text-emerald-200 gap-1"
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {(summary || targetTotals) && (
                <tfoot>
                  <tr className="border-t-2 border-zinc-700 bg-zinc-800/30">
                    <td className="px-3 py-3 text-xs font-bold text-zinc-400" colSpan={3}>
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
                      {targetTotals
                        ? `${fmt(Number(targetTotals.totalStoredMtdTargetAmount ?? targetTotals.totalStoredTargetAmount))} ج.م`
                        : '—'}
                      <div className="text-[10px] text-zinc-500 font-normal">حتى الآن</div>
                      {targetTotals && (
                        <div className="text-[10px] text-zinc-500 font-normal">
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

      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Lock className="w-5 h-5 text-emerald-400" />
              تأكيد إقفال يوم الموظفين
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm">
              سيتم قفل توليد/إعادة حساب الأجر لهذا الفرع والتاريخ فقط. فروع أخرى في نفس التاريخ تبقى مستقلة.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-zinc-300 space-y-1 py-2">
            <p>الفرع: {readiness ? shortBranchName(readiness) : selectedBranchId}</p>
            <p>التاريخ: {formatWorkDateAr(date)}</p>
          </div>
          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse" dir="rtl">
            <Button variant="outline" onClick={() => setCloseConfirmOpen(false)} disabled={closingDay}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
              إلغاء
            </Button>
            <Button onClick={() => void handleCloseDay()} disabled={closingDay}
              className="bg-emerald-700 hover:bg-emerald-600 gap-2">
              {closingDay ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              تأكيد الإقفال
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenConfirmOpen} onOpenChange={setReopenConfirmOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Unlock className="w-5 h-5 text-amber-400" />
              إعادة فتح يوم الموظفين
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm">
              مطلوب سبب إلزامي. بعد إعادة الفتح يمكن التصحيح والتوليد، ولن يُقفل تلقائيًا.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-xs text-zinc-400">سبب إعادة الفتح</label>
            <Input
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              maxLength={500}
              placeholder="مثال: تصحيح حضور ناقص"
              className="bg-zinc-800 border-zinc-600 text-white"
            />
          </div>
          <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse" dir="rtl">
            <Button variant="outline" onClick={() => setReopenConfirmOpen(false)} disabled={reopeningDay}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
              إلغاء
            </Button>
            <Button
              onClick={() => void handleReopenDay()}
              disabled={reopeningDay || !reopenReason.trim()}
              className="bg-amber-700 hover:bg-amber-600 gap-2"
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
