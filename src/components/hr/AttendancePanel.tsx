'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Clock, CheckCircle2, AlertCircle,
  Loader2, RefreshCw, Save, CalendarDays, UserCheck,
  UserX, Coffee, Timer, UserPlus, Search, PauseCircle,
  AlertTriangle, Sunrise, ArrowLeftRight, CalendarOff,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getOperationalDate, shiftCalendarDate } from '@/lib/businessDate';
import { sqlTimeForInput } from '@/lib/timeUtils';
import {
  applyDefaultTimesToRow,
  applyNowTimesToRow,
} from '@/components/hr/attendance-row-time-fill';
import AttendanceBreaksDialog from '@/components/hr/AttendanceBreaksDialog';
import { TemporaryBranchTransferModal } from '@/components/operations/TemporaryBranchTransferModal';
import {
  detectCheckInPeriodMismatch,
  formatClockAr,
} from '@/lib/hr/attendance-checkin-period';
import {
  type AttendanceBreakInterval,
  computeNetWorkedHours,
  formatBreakMinutesLabel,
  sumBreakMinutes,
} from '@/lib/hr/attendance-breaks';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { shortBranchName } from '@/lib/hr/dailyPayrollClosingUi';
import {
  shortAttendanceBranchLabel,
  type AttendanceTransferContext,
} from '@/lib/hr/attendance-eligibility';

interface AttendanceSummary {
  total: number;
  present: number;
  late: number;
  absent: number;
  dayOff: number;
  pending: number;
  requiredCount: number;
}

interface AttendanceRow {
  EmpID: number;
  EmpName: string;
  BranchID?: number;
  BranchCode?: string;
  BranchName?: string;
  WorkDate: string;
  DayOfWeek: number;
  IsWorkingDay: boolean;
  isScheduledWorkingDay: boolean;
  isAttendanceRequired: boolean;
  isFreelance: boolean;
  expectedToday: boolean;
  displayReason: string | null;
  scheduleWarning: string | null;
  employmentTypeLabel: string | null;
  payrollMethodLabel: string | null;
  PayrollMethod?: string | null;
  dayOffPolicyLabel: string | null;
  ScheduledStartTime: string | null;
  ScheduledEndTime: string | null;
  DefaultCheckInTime: string | null;
  DefaultCheckOutTime: string | null;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string;
  LateMinutes: number;
  EarlyLeaveMinutes: number;
  Notes: string;
  HasRecord: boolean;
  BreakMinutesTotal?: number;
  Breaks?: AttendanceBreakInterval[];
  BreakTimeMinutesTotal?: number;
  BreakTimes?: AttendanceBreakInterval[];
  transfer?: AttendanceTransferContext;
}

interface TransferSummary {
  count: number;
  transferredIn: number;
  transferredOut: number;
}

interface FreelancerOption {
  EmpID: number;
  EmpName: string;
  DefaultCheckInTime: string | null;
  HasAttendanceToday: boolean;
}

interface DayOffEmployeeOption {
  EmpID: number;
  EmpName: string;
  DefaultCheckInTime: string | null;
  DayOffReason: string;
}

const STATUS_OPTIONS = [
  { value: 'Pending',    label: 'لم يسجل',       color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
  { value: 'Present',    label: 'حاضر',           color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { value: 'Late',       label: 'متأخر',          color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'Absent',     label: 'غائب',           color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  { value: 'DayOff',     label: 'إجازة',          color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'EarlyLeave', label: 'انصراف مبكر',   color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  { value: 'Excused',    label: 'إذن / بعذر',     color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { value: 'FreelanceAvailable', label: 'فري لانس', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  { value: 'NotRequired', label: 'غير مطلوب',     color: 'bg-zinc-500/10 text-zinc-500 border-zinc-600/30' },
];

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function isHourlyRow(row: AttendanceRow): boolean {
  return row.PayrollMethod === 'hourly' || row.payrollMethodLabel === 'بالساعة';
}

function rowBreaks(row: AttendanceRow): AttendanceBreakInterval[] {
  return Array.isArray(row.Breaks) ? row.Breaks : [];
}

function rowBreakTimes(row: AttendanceRow): AttendanceBreakInterval[] {
  return Array.isArray(row.BreakTimes) ? row.BreakTimes : [];
}

function getStatusConfig(status: string) {
  return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
}

function getCurrentTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function calcLate(checkIn: string | null, schedStart: string | null): number {
  if (!checkIn || !schedStart) return 0;
  const [ch, cm] = checkIn.split(':').map(Number);
  const [sh, sm] = schedStart.split(':').map(Number);
  const diff = (ch * 60 + cm) - (sh * 60 + sm);
  return diff > 0 ? diff : 0;
}

function EmploymentBadges({ row }: { row: AttendanceRow }) {
  return (
    <div className="flex flex-wrap gap-0.5 mt-0.5">
      {row.employmentTypeLabel && (
        <span className="text-[9px] px-1 py-0 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
          {row.employmentTypeLabel}
        </span>
      )}
      {row.payrollMethodLabel && (
        <span className="text-[9px] px-1 py-0 rounded bg-zinc-800/60 text-zinc-500 border border-zinc-700/50">
          {row.payrollMethodLabel}
        </span>
      )}
      {row.dayOffPolicyLabel && row.dayOffPolicyLabel !== '—' && (
        <span className="text-[9px] px-1 py-0 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          {row.dayOffPolicyLabel}
        </span>
      )}
    </div>
  );
}

type EmployeeScopeFilter = 'all' | 'GLEEM' | 'CAMP_CAESAR';

function attendanceRowKey(empId: number, branchId: number | null | undefined): string {
  return `${empId}|${branchId ?? 0}`;
}

function sameAttendanceRow(
  row: AttendanceRow,
  empId: number,
  branchId: number | null | undefined,
): boolean {
  if (row.EmpID !== empId) return false;
  if (branchId == null || !(branchId > 0)) return true;
  if (row.BranchID == null) return true;
  return Number(row.BranchID) === Number(branchId);
}

function branchTone(code: string) {
  if (code === 'GLEEM') return 'border-sky-500/25 bg-sky-500/10 text-sky-300/90';
  if (code === 'CAMP_CAESAR') return 'border-amber-500/25 bg-amber-500/10 text-amber-300/90';
  return 'border-zinc-600/40 bg-zinc-800/60 text-zinc-400';
}

function branchBadge(row: Pick<AttendanceRow, 'BranchCode' | 'BranchName'>) {
  if (!row.BranchCode && !row.BranchName) return null;
  const code = String(row.BranchCode ?? '');
  const label = shortBranchName({
    branchCode: code || '—',
    branchName: row.BranchName || code || '—',
  });
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${branchTone(code)}`}>
      {label}
    </span>
  );
}

function TodayBranchBadge({ transfer }: { transfer?: AttendanceTransferContext }) {
  if (!transfer) return null;

  if (!transfer.isTransferredToday) {
    const label = shortAttendanceBranchLabel(transfer.operationalBranch);
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${branchTone(transfer.operationalBranch.branchCode)}`}
        title="فرع اليوم"
        data-testid="attendance-today-branch-normal"
      >
        {label}
      </span>
    );
  }

  const baseLabel = shortAttendanceBranchLabel(transfer.baseBranch);
  const opLabel = shortAttendanceBranchLabel(transfer.operationalBranch);
  const windowLabel =
    transfer.transferStartTime || transfer.transferEndTime
      ? `${transfer.transferStartTime || '—'}–${transfer.transferEndTime || '—'}`
      : null;
  const scheduledTag = transfer.isScheduledTransfer ? (
    <span className="text-[9px] text-violet-300/90 font-medium">مجدول</span>
  ) : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-0.5" data-testid="attendance-today-branch-transferred">
      {scheduledTag}
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border line-through opacity-60 ${branchTone(transfer.baseBranch.branchCode)}`}
        title="الفرع الأساسي"
      >
        {baseLabel}
      </span>
      <span className="text-[10px] text-amber-400/90">→</span>
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border border-amber-500/40 bg-amber-500/15 text-amber-200"
        title="فرع اليوم"
      >
        {opLabel}
      </span>
      {windowLabel ? (
        <span className="text-[9px] text-amber-300/70">{windowLabel}</span>
      ) : null}
    </span>
  );
}

export default function AttendancePanel() {
  const [date, setDate]               = useState(getOperationalDate());
  const [employeeScope, setEmployeeScope] = useState<EmployeeScopeFilter>('all');
  const [attendance, setAttendance]   = useState<AttendanceRow[]>([]);
  const [summary, setSummary]         = useState<AttendanceSummary | null>(null);
  const [branchLabel, setBranchLabel] = useState<string | null>(null);
  const [sessionBranchId, setSessionBranchId] = useState<number | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [savingAll, setSavingAll]     = useState(false);
  const [savingKey, setSavingKey]     = useState<string | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [successMsg, setSuccessMsg]   = useState('');
  const [dirty, setDirty]             = useState<Set<string>>(new Set());
  // Row keys where the operator explicitly confirmed a morning (AM) check-in
  // for a PM-default employee, silencing the mismatch guard.
  const [periodConfirmed, setPeriodConfirmed] = useState<Set<string>>(new Set());

  const [freelanceOpen, setFreelanceOpen]       = useState(false);
  const [freelanceQuery, setFreelanceQuery]     = useState('');
  const [freelanceList, setFreelanceList]       = useState<FreelancerOption[]>([]);
  const [freelanceLoading, setFreelanceLoading] = useState(false);
  const [selectedFreelancer, setSelectedFreelancer] = useState<FreelancerOption | null>(null);
  const [freelanceCheckIn, setFreelanceCheckIn] = useState(getCurrentTime());
  const [freelanceSaving, setFreelanceSaving]   = useState(false);
  const [freelanceAmConfirmed, setFreelanceAmConfirmed] = useState(false);
  const [breaksEmpId, setBreaksEmpId]           = useState<number | null>(null);
  const [breaksBranchId, setBreaksBranchId]     = useState<number | null>(null);
  const [breakTimesEmpId, setBreakTimesEmpId]   = useState<number | null>(null);
  const [breakTimesBranchId, setBreakTimesBranchId] = useState<number | null>(null);
  const [transferOpen, setTransferOpen]         = useState(false);
  const [transferEmpId, setTransferEmpId]       = useState<number | null>(null);
  const [transferSummary, setTransferSummary]   = useState<TransferSummary | null>(null);
  const [cancellingTransferKey, setCancellingTransferKey] = useState<string | null>(null);

  const [dayOffWorkOpen, setDayOffWorkOpen]         = useState(false);
  const [dayOffWorkQuery, setDayOffWorkQuery]       = useState('');
  const [dayOffWorkList, setDayOffWorkList]         = useState<DayOffEmployeeOption[]>([]);
  const [dayOffWorkLoading, setDayOffWorkLoading]   = useState(false);
  const [selectedDayOffEmp, setSelectedDayOffEmp]   = useState<DayOffEmployeeOption | null>(null);
  const [dayOffWorkSaving, setDayOffWorkSaving]     = useState(false);

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
      setError(e instanceof Error ? e.message : 'تعذر تبديل الفرع قبل حفظ الحضور');
      return false;
    } finally {
      setSwitchingBranch(false);
    }
  }, [sessionBranchId]);

  const fetchAttendance = useCallback(async (
    targetDate: string,
    scope: EmployeeScopeFilter = employeeScope,
    opts?: { preserveFeedback?: boolean },
  ) => {
    setLoading(true);
    if (!opts?.preserveFeedback) {
      setError('');
      setSuccessMsg('');
    }
    setDirty(new Set());
    try {
      const res  = await fetch(
        `/api/admin/attendance?date=${encodeURIComponent(targetDate)}&employeeScope=${encodeURIComponent(scope)}`,
      );
      const data = await res.json();
      if (data.success) {
        setAttendance(data.attendance);
        setSummary(data.summary ?? null);
        setTransferSummary(data.transferSummary ?? null);
        if (data.employeeScope === 'all') {
          setBranchLabel('كل الفروع');
        } else {
          setBranchLabel(data.branches?.[0]?.branchCode ?? data.branchCode ?? data.branchName ?? null);
        }
        if (data.branchId != null) setSessionBranchId(Number(data.branchId));
      } else {
        setError(data.error || 'خطأ في تحميل البيانات');
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [employeeScope]);

  const handleEmployeeScopeChange = (scope: EmployeeScopeFilter) => {
    setEmployeeScope(scope);
    void fetchAttendance(date, scope);
  };

  const cancelTransfer = async (row: AttendanceRow) => {
    const key = `${row.EmpID}-${row.BranchID ?? 0}`;
    setCancellingTransferKey(key);
    setError('');
    try {
      const res = await fetch('/api/admin/hr/branch-transfer', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: row.EmpID,
          workDate: date,
          reason: 'إلغاء النقل من صفحة الحضور',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'تعذر إلغاء النقل');
      }
      await fetchAttendance(date, employeeScope, { preserveFeedback: true });
      setSuccessMsg(`تم إلغاء نقل ${row.EmpName} — تم تحديث القائمة`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'تعذر إلغاء النقل');
    } finally {
      setCancellingTransferKey(null);
    }
  };

  const searchFreelancers = useCallback(async (query: string) => {
    setFreelanceLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (query.trim()) params.set('query', query.trim());
      const res = await fetch(`/api/admin/attendance/freelancers?${params}`);
      const data = await res.json();
      if (data.success) {
        setFreelanceList(data.freelancers.filter((f: FreelancerOption) => !f.HasAttendanceToday));
      }
    } catch {
      setFreelanceList([]);
    } finally {
      setFreelanceLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchAttendance(date); }, [date, fetchAttendance]);

  useEffect(() => {
    if (!freelanceOpen) return;
    const timer = setTimeout(() => searchFreelancers(freelanceQuery), 300);
    return () => clearTimeout(timer);
  }, [freelanceOpen, freelanceQuery, searchFreelancers]);

  const openFreelanceModal = () => {
    setFreelanceQuery('');
    setSelectedFreelancer(null);
    setFreelanceCheckIn(getCurrentTime());
    setFreelanceAmConfirmed(false);
    setFreelanceOpen(true);
  };

  const freelancePeriodChk = selectedFreelancer
    ? detectCheckInPeriodMismatch(freelanceCheckIn, selectedFreelancer.DefaultCheckInTime)
    : null;
  const freelancePeriodWarned =
    !!freelancePeriodChk?.mismatch && !freelanceAmConfirmed;

  const saveFreelanceAttendance = async () => {
    if (!selectedFreelancer) return;
    if (freelancePeriodWarned) {
      setError(
        `ميعاد ${selectedFreelancer.EmpName} الافتراضي مساءً (${formatClockAr(
          freelancePeriodChk?.reference,
        )}) والمسجّل صباحًا (${formatClockAr(freelancePeriodChk?.checkIn)}). صحّح الوقت أو أكّد "صباحًا فعلاً".`,
      );
      return;
    }
    setFreelanceSaving(true); setError('');
    try {
      const res = await fetch('/api/admin/attendance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          EmpID: selectedFreelancer.EmpID,
          WorkDate: date,
          CheckInTime: freelanceCheckIn || null,
          CheckOutTime: null,
          Status: 'Present',
          Notes: '',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setFreelanceOpen(false);
        setSuccessMsg(`تم تسجيل حضور ${selectedFreelancer.EmpName}`);
        await fetchAttendance(date);
        setTimeout(() => setSuccessMsg(''), 3000);
      } else {
        setError(data.error || 'خطأ في الحفظ');
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setFreelanceSaving(false);
    }
  };

  const searchDayOffEmployees = useCallback(async (q: string) => {
    setDayOffWorkLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (q.trim()) params.set('query', q.trim());
      const res = await fetch(`/api/admin/attendance/day-off?${params}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setDayOffWorkList(data.employees || []);
      } else {
        setDayOffWorkList([]);
      }
    } catch {
      setDayOffWorkList([]);
    } finally {
      setDayOffWorkLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (!dayOffWorkOpen) return;
    const timer = setTimeout(() => searchDayOffEmployees(dayOffWorkQuery), 300);
    return () => clearTimeout(timer);
  }, [dayOffWorkOpen, dayOffWorkQuery, searchDayOffEmployees]);

  const openDayOffWorkModal = () => {
    setDayOffWorkQuery('');
    setSelectedDayOffEmp(null);
    setDayOffWorkOpen(true);
  };

  const saveDayOffWorkAttendance = async () => {
    if (!selectedDayOffEmp) return;
    setDayOffWorkSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/attendance/work-on-day-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: selectedDayOffEmp.EmpID,
          date,
          reason: 'نزل يشتغل يوم إجازته',
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDayOffWorkOpen(false);
        setSuccessMsg(`تم تسجيل حضور ${selectedDayOffEmp.EmpName} (يوم إجازة)`);
        await fetchAttendance(date);
        setTimeout(() => setSuccessMsg(''), 3500);
      } else {
        setError(data.error || 'فشل تسجيل الحضور في يوم الإجازة');
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setDayOffWorkSaving(false);
    }
  };

  const updateRow = (
    empId: number,
    branchId: number | null | undefined,
    field: string,
    value: string | null,
  ) => {
    const key = attendanceRowKey(empId, branchId);
    setAttendance(prev => prev.map(row => {
      if (!sameAttendanceRow(row, empId, branchId)) return row;
      const updated = { ...row, [field]: value };
      if (field === 'CheckInTime' && value) {
        const manualStatuses = ['Absent', 'DayOff', 'Excused'];
        if (!manualStatuses.includes(updated.Status)) {
          const late = calcLate(value, updated.ScheduledStartTime);
          updated.LateMinutes = late;
          updated.Status = late > 0 ? 'Late' : 'Present';
        }
      }
      return updated;
    }));
    setDirty(prev => new Set(prev).add(key));
    // A fresh check-in value must be re-validated: drop any prior confirmation.
    if (field === 'CheckInTime') {
      setPeriodConfirmed(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const periodCheckFor = (row: AttendanceRow) =>
    detectCheckInPeriodMismatch(
      row.CheckInTime,
      row.DefaultCheckInTime ?? row.ScheduledStartTime,
    );

  const showPeriodWarning = (row: AttendanceRow) =>
    periodCheckFor(row).mismatch &&
    !periodConfirmed.has(attendanceRowKey(row.EmpID, row.BranchID));

  const fixCheckInPeriod = (
    empId: number,
    branchId: number | null | undefined,
    suggested: string,
  ) => {
    updateRow(empId, branchId, 'CheckInTime', suggested);
  };

  const confirmMorningCheckIn = (empId: number, branchId: number | null | undefined) => {
    setPeriodConfirmed(prev => new Set(prev).add(attendanceRowKey(empId, branchId)));
  };

  const autoFillDefaultTimes = (empId: number, branchId: number | null | undefined) => {
    setAttendance(prev => prev.map(row =>
      !sameAttendanceRow(row, empId, branchId) ? row : applyDefaultTimesToRow(row)
    ));
    setDirty(prev => new Set(prev).add(attendanceRowKey(empId, branchId)));
  };

  const fillNowTimes = (empId: number, branchId: number | null | undefined) => {
    const now = getCurrentTime();
    setAttendance(prev => prev.map(row =>
      !sameAttendanceRow(row, empId, branchId) ? row : applyNowTimesToRow(row, now)
    ));
    setDirty(prev => new Set(prev).add(attendanceRowKey(empId, branchId)));
  };

  const updateBreaks = (
    empId: number,
    branchId: number | null | undefined,
    breaks: AttendanceBreakInterval[],
  ) => {
    const total = sumBreakMinutes(breaks);
    setAttendance(prev => prev.map(row =>
      !sameAttendanceRow(row, empId, branchId)
        ? row
        : { ...row, Breaks: breaks, BreakMinutesTotal: total },
    ));
    setDirty(prev => new Set(prev).add(attendanceRowKey(empId, branchId)));
  };

  const updateBreakTimes = (
    empId: number,
    branchId: number | null | undefined,
    breakTimes: AttendanceBreakInterval[],
  ) => {
    const total = sumBreakMinutes(breakTimes);
    setAttendance(prev => prev.map(row =>
      !sameAttendanceRow(row, empId, branchId)
        ? row
        : { ...row, BreakTimes: breakTimes, BreakTimeMinutesTotal: total },
    ));
    setDirty(prev => new Set(prev).add(attendanceRowKey(empId, branchId)));
  };

  const saveSingle = async (empId: number, branchId: number | null | undefined) => {
    const row = attendance.find(r => sameAttendanceRow(r, empId, branchId));
    if (!row) return;
    const key = attendanceRowKey(empId, row.BranchID ?? branchId);
    if (showPeriodWarning(row)) {
      const chk = periodCheckFor(row);
      setError(
        `ميعاد ${row.EmpName} الافتراضي مساءً (${formatClockAr(chk.reference)}) والمسجّل صباحًا (${formatClockAr(chk.checkIn)}). صحّح الوقت أو أكّد "صباحًا فعلاً".`,
      );
      return;
    }
    const targetBranchId = row.BranchID ?? sessionBranchId;
    if (targetBranchId == null) {
      setError('لا يمكن الحفظ بدون BranchID للصف');
      return;
    }
    setSavingKey(key); setError(''); setSuccessMsg('');
    try {
      const switched = await ensureSessionBranch(targetBranchId);
      if (!switched) return;
      const res  = await fetch('/api/admin/attendance', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          EmpID: row.EmpID,
          WorkDate: date,
          CheckInTime: row.CheckInTime || null,
          CheckOutTime: row.CheckOutTime || null,
          Status: row.Status,
          Notes: row.Notes || '',
          Breaks: isHourlyRow(row) ? rowBreaks(row) : [],
          BreakTimes: isHourlyRow(row) ? rowBreakTimes(row) : [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(`تم حفظ حضور ${row.EmpName}`);
        setDirty(prev => { const n = new Set(prev); n.delete(key); return n; });
        setAttendance(prev => prev.map(r =>
          sameAttendanceRow(r, empId, row.BranchID)
            ? {
                ...r,
                HasRecord: true,
                LateMinutes: data.data.LateMinutes,
                EarlyLeaveMinutes: data.data.EarlyLeaveMinutes,
                Status: data.data.Status,
                BreakMinutesTotal: data.data.BreakMinutesTotal ?? r.BreakMinutesTotal ?? 0,
                Breaks: data.data.Breaks ?? r.Breaks ?? [],
                BreakTimeMinutesTotal:
                  data.data.BreakTimeMinutesTotal ?? r.BreakTimeMinutesTotal ?? 0,
                BreakTimes: data.data.BreakTimes ?? r.BreakTimes ?? [],
              }
            : r,
        ));
        setTimeout(() => setSuccessMsg(''), 3000);
      } else {
        setError(data.error || 'خطأ في الحفظ');
      }
    } catch { setError('خطأ في الاتصال بالخادم'); }
    finally { setSavingKey(null); }
  };

  const saveAll = async () => {
    const flagged = attendance.filter(showPeriodWarning);
    if (flagged.length > 0) {
      const names = flagged.map(r => r.EmpName).join('، ');
      setError(
        `في موظفين مواعيدهم مساءً ومسجّل لهم حضور صباحًا: ${names}. صحّح الوقت أو أكّد "صباحًا فعلاً" قبل الحفظ.`,
      );
      return;
    }
    setSavingAll(true); setError(''); setSuccessMsg('');
    try {
      const byBranch = new Map<number, AttendanceRow[]>();
      for (const row of attendance) {
        const bid = row.BranchID ?? sessionBranchId;
        if (bid == null) continue;
        const list = byBranch.get(bid) ?? [];
        list.push(row);
        byBranch.set(bid, list);
      }
      if (byBranch.size === 0) {
        setError('لا توجد صفوف للحفظ');
        return;
      }

      let savedCount = 0;
      let insertedCount = 0;
      let updatedCount = 0;
      for (const [branchId, rows] of byBranch) {
        const switched = await ensureSessionBranch(branchId);
        if (!switched) return;
        const items = rows.map(row => ({
          EmpID: row.EmpID,
          CheckInTime: row.CheckInTime || null,
          CheckOutTime: row.CheckOutTime || null,
          Status: row.Status,
          Notes: row.Notes || '',
          Breaks: isHourlyRow(row) ? rowBreaks(row) : [],
          BreakTimes: isHourlyRow(row) ? rowBreakTimes(row) : [],
        }));
        const res  = await fetch('/api/admin/attendance/bulk', {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ WorkDate: date, items }),
        });
        const data = await res.json();
        if (!data.success) {
          setError(data.error || `خطأ في حفظ فرع #${branchId}`);
          return;
        }
        savedCount += Number(data.summary?.savedCount ?? 0);
        insertedCount += Number(data.summary?.insertedCount ?? 0);
        updatedCount += Number(data.summary?.updatedCount ?? 0);
      }

      setSuccessMsg(`تم الحفظ: ${savedCount} موظف (${insertedCount} جديد، ${updatedCount} تحديث)`);
      setDirty(new Set());
      await fetchAttendance(date);
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch { setError('خطأ في الاتصال بالخادم'); }
    finally { setSavingAll(false); }
  };

  const total   = summary?.total ?? attendance.length;
  const present = summary?.present ?? attendance.filter(r => r.isAttendanceRequired && r.Status === 'Present').length;
  const late    = summary?.late ?? attendance.filter(r => r.isAttendanceRequired && r.Status === 'Late').length;
  const absent  = summary?.absent ?? attendance.filter(r => r.isAttendanceRequired && r.Status === 'Absent').length;
  const dayOff  = summary?.dayOff ?? attendance.filter(r => r.Status === 'DayOff' || r.Status === 'Excused').length;
  const pending = summary?.pending ?? attendance.filter(r => r.isAttendanceRequired && r.Status === 'Pending').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <CalendarDays className="w-4 h-4 text-amber-400" />
          <span>تسجيل حضور وتأخيرات الموظفين يوميًا</span>
        </div>
        <div className="flex items-center gap-2 mr-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDate(shiftCalendarDate(date, -1))}
            disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-9 w-9 p-0"
            aria-label="اليوم السابق"
            data-testid="attendance-prev-day"
            title="اليوم السابق"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-zinc-900 border-zinc-700 text-white w-44 h-9 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setDate(shiftCalendarDate(date, 1))}
            disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-9 w-9 p-0"
            aria-label="اليوم التالي"
            data-testid="attendance-next-day"
            title="اليوم التالي"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" onClick={() => setDate(getOperationalDate())}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-9 text-xs gap-1">
            <CalendarDays className="w-3.5 h-3.5" />اليوم
          </Button>
          <Button variant="outline" onClick={() => fetchAttendance(date)} disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-9 w-9 p-0">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
          <Button onClick={openFreelanceModal} data-testid="add-freelance-attendance"
            className="h-9 text-xs gap-1 bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/30">
            <UserPlus className="w-3.5 h-3.5" />
            إضافة فري لانس للحضور
          </Button>
          <Button
            type="button"
            onClick={openDayOffWorkModal}
            data-testid="add-day-off-work-attendance"
            title="إضافة موظف أجازته اليوم ونزل يشتغل"
            className="h-9 text-xs gap-1 bg-violet-600/20 text-violet-300 border border-violet-500/30 hover:bg-violet-600/30"
          >
            <CalendarOff className="w-3.5 h-3.5" />
            إضافة موظف أجازته اليوم
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setTransferEmpId(null);
              setTransferOpen(true);
            }}
            data-testid="attendance-temporary-transfer"
            title="نقل موظف ليوم واحد لفرع آخر بدون تعديل الجدول الأسبوعي"
            className="h-9 text-xs gap-1 border-amber-500/35 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            نقل موظف اليوم
          </Button>
        </div>
      </div>

      {transferSummary && transferSummary.count > 0 ? (
        <div
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
          data-testid="attendance-transfer-banner"
        >
          <div className="flex flex-wrap items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-amber-300 shrink-0" />
            <span>
              اليوم:{' '}
              <strong className="text-white">{transferSummary.count}</strong>{' '}
              موظف{transferSummary.count === 1 ? '' : 'ين'} منقول
              {transferSummary.transferredIn > 0 ? (
                <span className="text-amber-200/90">
                  {' '}({transferSummary.transferredIn} وصل{transferSummary.transferredIn === 1 ? '' : 'وا'} لفرع آخر)
                </span>
              ) : null}
              {transferSummary.transferredOut > 0 ? (
                <span className="text-amber-200/90">
                  {' '}({transferSummary.transferredOut} في فرع تاني)
                </span>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}

      <div className="text-xs text-zinc-500 flex flex-wrap items-center gap-2">
        <span>
          {DAY_NAMES[new Date(date + 'T12:00:00Z').getDay()]} — {date}
          {branchLabel ? (
            <span className="mr-2 text-emerald-400/90">· عرض: {branchLabel}</span>
          ) : null}
          {summary?.requiredCount != null && (
            <span className="mr-2 text-zinc-600">({summary.requiredCount} مطلوب الحضور)</span>
          )}
        </span>
        <span className="text-zinc-600">|</span>
        <span className="text-zinc-500">عرض الموظفين</span>
        {(
          [
            { id: 'all' as const, label: 'كل الفروع' },
            { id: 'GLEEM' as const, label: 'جليم' },
            { id: 'CAMP_CAESAR' as const, label: 'كامب شيزار' },
          ] as const
        ).map((opt) => (
          <Button
            key={opt.id}
            type="button"
            size="sm"
            variant={employeeScope === opt.id ? 'default' : 'outline'}
            className={
              employeeScope === opt.id
                ? 'h-7 text-[11px] bg-zinc-100 text-zinc-900 hover:bg-white'
                : 'h-7 text-[11px] border-zinc-700 text-zinc-300'
            }
            disabled={loading || switchingBranch}
            onClick={() => handleEmployeeScopeChange(opt.id)}
            data-testid={`attendance-scope-${opt.id}`}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard title="إجمالي الموظفين" value={total}   icon={<Users className="w-5 h-5" />} variant="default" />
        <KpiCard title="الحاضرين"         value={present} icon={<UserCheck className="w-5 h-5" />} variant="success" />
        <KpiCard title="المتأخرين"         value={late}    icon={<Timer className="w-5 h-5" />} variant="warning" />
        <KpiCard title="الغائبين"          value={absent}  icon={<UserX className="w-5 h-5" />} variant="danger" />
        <KpiCard title="الإجازات / أذون"  value={dayOff}  icon={<Coffee className="w-5 h-5" />} variant="primary" />
        <KpiCard title="لم يسجل"          value={pending} icon={<Clock className="w-5 h-5" />} variant="default" />
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="text-sm">{successMsg}</span>
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl overflow-hidden">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/60">
              <th className="text-right px-2 py-2.5 text-[11px] text-zinc-400 font-semibold">الموظف</th>
              <th className="text-center px-1 py-2.5 text-[11px] text-zinc-400 font-semibold">حضور</th>
              <th className="text-center px-1 py-2.5 text-[11px] text-zinc-400 font-semibold">انصراف</th>
              <th className="text-center px-1 py-2.5 text-[11px] text-zinc-400 font-semibold">الحالة</th>
              <th className="text-center px-1 py-2.5 text-[11px] text-zinc-400 font-semibold">ملخص</th>
              <th className="text-right px-1 py-2.5 text-[11px] text-zinc-400 font-semibold">ملاحظات</th>
              <th className="text-center px-1 py-2.5 text-[11px] text-zinc-400 font-semibold sticky left-0 bg-zinc-950 z-10">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center p-12">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-zinc-500" />
                <p className="mt-2 text-zinc-500 text-sm">جاري تحميل البيانات...</p>
              </td></tr>
            ) : attendance.length === 0 ? (
              <tr><td colSpan={7} className="text-center p-12 text-zinc-500">لا يوجد موظفون متوقع حضورهم اليوم</td></tr>
            ) : attendance.map((row) => {
              const rowBranchId = row.BranchID ?? null;
              const key = attendanceRowKey(row.EmpID, rowBranchId);
              const statusCfg = getStatusConfig(row.Status);
              const isDirty   = dirty.has(key);
              const isSaving  = savingKey === key;
              const hourly    = isHourlyRow(row);
              const breaks    = rowBreaks(row);
              const breakMins = row.BreakMinutesTotal ?? sumBreakMinutes(breaks);
              const breakTimes = rowBreakTimes(row);
              const breakTimeMins =
                row.BreakTimeMinutesTotal ?? sumBreakMinutes(breakTimes);
              const netHours  = hourly
                ? computeNetWorkedHours(row.CheckInTime, row.CheckOutTime, breaks, breakMins)
                : null;
              const periodChk    = periodCheckFor(row);
              const periodWarned = periodChk.mismatch && !periodConfirmed.has(key);
              const isCancellingTransfer = cancellingTransferKey === key;
              return (
                <tr key={key}
                  className={`border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors ${isDirty ? 'bg-amber-500/5' : ''}`}>
                  <td className="px-2 py-2 align-top">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-semibold text-white text-sm truncate max-w-[9rem]">{row.EmpName}</span>
                        {employeeScope === 'all' ? branchBadge(row) : null}
                        <TodayBranchBadge transfer={row.transfer} />
                      </div>
                      <div className={`text-[10px] mt-0.5 ${row.scheduleWarning ? 'text-amber-500' : row.transfer?.isTransferredToday ? 'text-amber-400/90' : 'text-zinc-500'}`}>
                        {row.displayReason || (row.isScheduledWorkingDay ? 'يوم عمل' : 'إجازة') || row.scheduleWarning}
                        {(row.ScheduledStartTime || row.ScheduledEndTime) ? (
                          <span className="text-zinc-600"> · {row.ScheduledStartTime || '--:--'}–{row.ScheduledEndTime || '--:--'}</span>
                        ) : null}
                      </div>
                      <EmploymentBadges row={row} />
                    </div>
                  </td>
                  <td className="text-center px-1 py-2 align-top">
                    <Input type="time" value={sqlTimeForInput(row.CheckInTime)}
                      onChange={(e) => updateRow(row.EmpID, rowBranchId, 'CheckInTime', e.target.value || null)}
                      data-testid={`attendance-checkin-${row.EmpID}`}
                      aria-invalid={periodWarned}
                      className={`bg-zinc-800/50 text-white h-8 w-full max-w-[6.5rem] mx-auto text-center text-[11px] px-1 ${
                        periodWarned
                          ? 'border-amber-500 ring-1 ring-amber-500/40 focus-visible:ring-amber-500'
                          : 'border-zinc-700'
                      }`} />
                    {periodWarned && (
                      <div
                        data-testid={`attendance-period-warning-${row.EmpID}`}
                        className="mt-1 mx-auto max-w-[8.5rem] rounded-md border border-amber-500/40 bg-amber-500/10 p-1 text-[9px] leading-snug text-amber-300"
                      >
                        <div className="flex items-center justify-center gap-0.5 font-semibold">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>مساءً ({formatClockAr(periodChk.reference)})</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-center gap-0.5">
                          {periodChk.suggested && (
                            <button
                              type="button"
                              onClick={() => fixCheckInPeriod(row.EmpID, rowBranchId, periodChk.suggested!)}
                              data-testid={`attendance-period-fix-${row.EmpID}`}
                              className="rounded px-1 py-0.5 bg-amber-500 font-bold text-black hover:bg-amber-400"
                            >
                              {formatClockAr(periodChk.suggested)}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => confirmMorningCheckIn(row.EmpID, rowBranchId)}
                            data-testid={`attendance-period-confirm-${row.EmpID}`}
                            className="rounded border border-amber-500/40 px-1 py-0.5 text-amber-300 hover:bg-amber-500/20"
                          >
                            صباحًا
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="text-center px-1 py-2 align-top">
                    <Input type="time" value={sqlTimeForInput(row.CheckOutTime)}
                      onChange={(e) => updateRow(row.EmpID, rowBranchId, 'CheckOutTime', e.target.value || null)}
                      className="bg-zinc-800/50 border-zinc-700 text-white h-8 w-full max-w-[6.5rem] mx-auto text-center text-[11px] px-1" />
                  </td>
                  <td className="text-center px-1 py-2 align-top">
                    <Select value={row.Status} onValueChange={(val) => updateRow(row.EmpID, rowBranchId, 'Status', val)}>
                      <SelectTrigger className={`h-8 w-full max-w-[7.5rem] mx-auto text-[11px] border rounded-lg px-2 ${statusCfg.color}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-700">
                        {STATUS_OPTIONS.filter(o => !['FreelanceAvailable', 'NotRequired'].includes(o.value)).map(opt => (
                          <SelectItem key={opt.value} value={opt.value} className="text-white text-xs">{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="text-center px-1 py-2 align-top">
                    <div className="text-[10px] leading-relaxed space-y-0.5 text-zinc-400">
                      {hourly && netHours != null ? (
                        <div className="text-sky-400 font-semibold" data-testid={`net-hours-${row.EmpID}`}>{netHours.toFixed(2)} س</div>
                      ) : null}
                      {row.LateMinutes > 0 ? (
                        <div className="text-amber-400">تأخير {row.LateMinutes}د</div>
                      ) : null}
                      {row.EarlyLeaveMinutes > 0 ? (
                        <div className="text-orange-400">مبكر {row.EarlyLeaveMinutes}د</div>
                      ) : null}
                      {hourly && breakMins > 0 ? (
                        <div className="text-amber-400/80">مستقطع {formatBreakMinutesLabel(breakMins)}</div>
                      ) : null}
                      {hourly && breakTimeMins > 0 ? (
                        <div className="text-teal-400/80">بريك {formatBreakMinutesLabel(breakTimeMins)}</div>
                      ) : null}
                      {!hourly && row.LateMinutes <= 0 && row.EarlyLeaveMinutes <= 0 ? (
                        <span className="text-zinc-600">—</span>
                      ) : null}
                      {hourly && netHours == null && breakMins <= 0 && breakTimeMins <= 0 && row.LateMinutes <= 0 && row.EarlyLeaveMinutes <= 0 ? (
                        <span className="text-zinc-600">—</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-1 py-2 align-top">
                    <Input value={row.Notes || ''} onChange={(e) => updateRow(row.EmpID, rowBranchId, 'Notes', e.target.value)}
                      placeholder="…" className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-600 h-8 text-[11px] w-full min-w-0" />
                  </td>
                  <td className={`px-1 py-2 align-top sticky left-0 z-10 ${isDirty ? 'bg-amber-500/5' : 'bg-zinc-900/95'}`}>
                    <div className="flex items-center gap-0.5 justify-center flex-wrap">
                      <Button size="sm" variant="ghost" onClick={() => autoFillDefaultTimes(row.EmpID, rowBranchId)}
                        title="املأ بالوقت الافتراضي (D)"
                        data-testid={`attendance-fill-default-${row.EmpID}`}
                        disabled={!row.DefaultCheckInTime && !row.DefaultCheckOutTime}
                        className={`h-7 w-7 p-0 ${(row.DefaultCheckInTime || row.DefaultCheckOutTime) ? 'text-cyan-400 hover:bg-cyan-500/20' : 'text-zinc-600 cursor-not-allowed'}`}>
                        <span className="text-xs font-bold">D</span>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => fillNowTimes(row.EmpID, rowBranchId)}
                        title="الآن — الوقت الحالي (N)"
                        data-testid={`attendance-fill-now-${row.EmpID}`}
                        disabled={!!row.CheckInTime && !!row.CheckOutTime}
                        className={`h-7 w-7 p-0 ${(!row.CheckInTime || !row.CheckOutTime) ? 'text-indigo-400 hover:bg-indigo-500/20' : 'text-zinc-600 cursor-not-allowed'}`}>
                        <span className="text-xs font-bold">N</span>
                      </Button>
                      {hourly && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setBreaksEmpId(row.EmpID);
                            setBreaksBranchId(rowBranchId);
                          }}
                          title="وقت مستقطع"
                          data-testid={`attendance-breaks-${row.EmpID}`}
                          className={`h-7 w-7 p-0 ${breakMins > 0 ? 'text-amber-400 hover:bg-amber-500/20' : 'text-zinc-400 hover:bg-zinc-700/40'}`}
                        >
                          <PauseCircle className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {hourly && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setBreakTimesEmpId(row.EmpID);
                            setBreakTimesBranchId(rowBranchId);
                          }}
                          title="وقت البريك"
                          data-testid={`attendance-break-times-${row.EmpID}`}
                          className={`h-7 w-7 p-0 ${breakTimeMins > 0 ? 'text-teal-400 hover:bg-teal-500/20' : 'text-zinc-400 hover:bg-zinc-700/40'}`}
                        >
                          <Coffee className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => void saveSingle(row.EmpID, rowBranchId)} disabled={isSaving || !isDirty || switchingBranch} title="حفظ"
                        data-testid={`attendance-save-${row.EmpID}`}
                        className={`h-7 w-7 p-0 ${isDirty ? 'text-amber-400 hover:bg-amber-500/20' : 'text-zinc-600'}`}>
                        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setTransferEmpId(row.EmpID);
                          setTransferOpen(true);
                        }}
                        title="نقل اليوم لفرع آخر"
                        data-testid={`attendance-transfer-${row.EmpID}`}
                        className="h-7 w-7 p-0 text-amber-400/80 hover:bg-amber-500/20 hover:text-amber-300"
                      >
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                      </Button>
                      {row.transfer?.isTransferredToday && row.transfer.transferId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void cancelTransfer(row)}
                          disabled={isCancellingTransfer || switchingBranch}
                          title="إلغاء النقل"
                          data-testid={`attendance-cancel-transfer-${row.EmpID}`}
                          className="h-7 w-7 p-0 text-rose-400/80 hover:bg-rose-500/20 hover:text-rose-300"
                        >
                          {isCancellingTransfer ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <UserX className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {attendance.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            {dirty.size > 0 && <span className="text-amber-400 font-medium">{dirty.size} تعديل غير محفوظ</span>}
          </div>
          <Button onClick={saveAll} disabled={savingAll}
            className="h-11 px-8 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black font-bold rounded-xl shadow-lg">
            {savingAll
              ? <><Loader2 className="w-5 h-5 animate-spin ml-2" />جاري الحفظ...</>
              : <><Save className="w-5 h-5 ml-2" />حفظ الكل</>}
          </Button>
        </div>
      )}

      <Dialog open={freelanceOpen} onOpenChange={setFreelanceOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة فري لانس للحضور</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input
                value={freelanceQuery}
                onChange={(e) => setFreelanceQuery(e.target.value)}
                placeholder="بحث بالاسم..."
                className="pr-9 bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1 border border-zinc-800 rounded-lg p-2">
              {freelanceLoading ? (
                <div className="text-center py-4 text-zinc-500 text-sm">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </div>
              ) : freelanceList.length === 0 ? (
                <p className="text-center text-zinc-500 text-sm py-4">لا يوجد فري لانس متاح</p>
              ) : freelanceList.map((f) => (
                <button
                  key={f.EmpID}
                  type="button"
                  onClick={() => {
                    setSelectedFreelancer(f);
                    setFreelanceCheckIn(f.DefaultCheckInTime || getCurrentTime());
                    setFreelanceAmConfirmed(false);
                  }}
                  className={`w-full text-right px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedFreelancer?.EmpID === f.EmpID
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'hover:bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {f.EmpName}
                </button>
              ))}
            </div>
            {selectedFreelancer && (
              <div className="space-y-2">
                <label className="text-xs text-zinc-400">وقت الحضور</label>
                <Input
                  type="time"
                  value={freelanceCheckIn}
                  onChange={(e) => {
                    setFreelanceCheckIn(e.target.value);
                    setFreelanceAmConfirmed(false);
                  }}
                  aria-invalid={freelancePeriodWarned}
                  className={`bg-zinc-800 text-white ${
                    freelancePeriodWarned
                      ? 'border-amber-500 ring-1 ring-amber-500/40'
                      : 'border-zinc-700'
                  }`}
                />
                {freelancePeriodWarned && freelancePeriodChk && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>ميعاده الافتراضي مساءً ({formatClockAr(freelancePeriodChk.reference)})</span>
                    </div>
                    <p className="mt-0.5 text-amber-400/80">
                      اخترت صباحًا ({formatClockAr(freelancePeriodChk.checkIn)}) — متأكد؟
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      {freelancePeriodChk.suggested && (
                        <button
                          type="button"
                          onClick={() => {
                            setFreelanceCheckIn(freelancePeriodChk.suggested!);
                            setFreelanceAmConfirmed(false);
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 font-bold text-black hover:bg-amber-400"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          صحّح لـ {formatClockAr(freelancePeriodChk.suggested)}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setFreelanceAmConfirmed(true)}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-2 py-1 text-amber-300 hover:bg-amber-500/20"
                      >
                        <Sunrise className="w-3.5 h-3.5" />
                        صباحًا فعلاً
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <Button
              onClick={saveFreelanceAttendance}
              disabled={!selectedFreelancer || freelanceSaving}
              className="w-full bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              {freelanceSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'تسجيل الحضور'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dayOffWorkOpen} onOpenChange={setDayOffWorkOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة موظف أجازته اليوم</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-zinc-400 -mt-2">
            موظفو الفرع اللي أجازتهم النهارده — اختَر من نزل يشتغل يوم إجازته عشان يتسجّل حاضر ويظهر في القائمة.
          </p>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <Input
                value={dayOffWorkQuery}
                onChange={(e) => setDayOffWorkQuery(e.target.value)}
                placeholder="بحث بالاسم..."
                className="pr-9 bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1 border border-zinc-800 rounded-lg p-2">
              {dayOffWorkLoading ? (
                <div className="text-center py-4 text-zinc-500 text-sm">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </div>
              ) : dayOffWorkList.length === 0 ? (
                <p className="text-center text-zinc-500 text-sm py-4">
                  لا يوجد موظفون في إجازة لهذا اليوم
                </p>
              ) : (
                dayOffWorkList.map((emp) => (
                  <button
                    key={emp.EmpID}
                    type="button"
                    onClick={() => setSelectedDayOffEmp(emp)}
                    className={`w-full text-right px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedDayOffEmp?.EmpID === emp.EmpID
                        ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30'
                        : 'hover:bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    <span className="font-medium">{emp.EmpName}</span>
                    <span className="block text-[11px] text-zinc-500 mt-0.5">
                      {emp.DayOffReason}
                    </span>
                  </button>
                ))
              )}
            </div>
            <Button
              onClick={saveDayOffWorkAttendance}
              disabled={!selectedDayOffEmp || dayOffWorkSaving}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white"
            >
              {dayOffWorkSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'تسجيل حضور (يوم إجازة)'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {breaksEmpId != null && (() => {
        const breakRow = attendance.find((r) =>
          sameAttendanceRow(r, breaksEmpId, breaksBranchId),
        );
        if (!breakRow) return null;
        return (
          <AttendanceBreaksDialog
            open
            mode="interrupt"
            onOpenChange={(open) => {
              if (!open) {
                setBreaksEmpId(null);
                setBreaksBranchId(null);
              }
            }}
            empName={breakRow.EmpName}
            checkInTime={breakRow.CheckInTime}
            checkOutTime={breakRow.CheckOutTime}
            breaks={rowBreaks(breakRow)}
            onChange={(next) => updateBreaks(breaksEmpId, breaksBranchId, next)}
          />
        );
      })()}

      {breakTimesEmpId != null && (() => {
        const breakRow = attendance.find((r) =>
          sameAttendanceRow(r, breakTimesEmpId, breakTimesBranchId),
        );
        if (!breakRow) return null;
        return (
          <AttendanceBreaksDialog
            open
            mode="rest"
            onOpenChange={(open) => {
              if (!open) {
                setBreakTimesEmpId(null);
                setBreakTimesBranchId(null);
              }
            }}
            empName={breakRow.EmpName}
            checkInTime={breakRow.CheckInTime}
            checkOutTime={breakRow.CheckOutTime}
            breaks={rowBreakTimes(breakRow)}
            onChange={(next) => updateBreakTimes(breakTimesEmpId, breakTimesBranchId, next)}
          />
        );
      })()}

      <TemporaryBranchTransferModal
        open={transferOpen}
        onClose={() => {
          setTransferOpen(false);
          setTransferEmpId(null);
        }}
        workDate={date}
        initialEmpId={transferEmpId}
        onTransferred={async () => {
          setTransferOpen(false);
          setTransferEmpId(null);
          await fetchAttendance(date, employeeScope, { preserveFeedback: true });
          setSuccessMsg('تم النقل — تم تحديث فرع اليوم في القائمة');
          setTimeout(() => setSuccessMsg(''), 4000);
        }}
      />
    </div>
  );
}
