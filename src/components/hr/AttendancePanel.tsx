'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Clock, CheckCircle2, AlertCircle,
  Loader2, RefreshCw, Save, CalendarDays, UserCheck,
  UserX, Coffee, ShieldCheck, Timer, UserPlus, Search,
} from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getBusinessDateStr, sqlTimeForInput } from '@/lib/timeUtils';
import {
  applyDefaultTimesToRow,
  applyNowTimesToRow,
} from '@/components/hr/attendance-row-time-fill';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

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
}

interface FreelancerOption {
  EmpID: number;
  EmpName: string;
  DefaultCheckInTime: string | null;
  HasAttendanceToday: boolean;
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
    <div className="flex flex-wrap gap-1 mt-1">
      {row.employmentTypeLabel && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
          {row.employmentTypeLabel}
        </span>
      )}
      {row.payrollMethodLabel && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-500 border border-zinc-700/50">
          {row.payrollMethodLabel}
        </span>
      )}
      {row.dayOffPolicyLabel && row.dayOffPolicyLabel !== '—' && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          {row.dayOffPolicyLabel}
        </span>
      )}
    </div>
  );
}

export default function AttendancePanel() {
  const [date, setDate]               = useState(getBusinessDateStr());
  const [attendance, setAttendance]   = useState<AttendanceRow[]>([]);
  const [summary, setSummary]         = useState<AttendanceSummary | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [savingAll, setSavingAll]     = useState(false);
  const [savingId, setSavingId]       = useState<number | null>(null);
  const [successMsg, setSuccessMsg]   = useState('');
  const [dirty, setDirty]             = useState<Set<number>>(new Set());

  const [freelanceOpen, setFreelanceOpen]       = useState(false);
  const [freelanceQuery, setFreelanceQuery]     = useState('');
  const [freelanceList, setFreelanceList]       = useState<FreelancerOption[]>([]);
  const [freelanceLoading, setFreelanceLoading] = useState(false);
  const [selectedFreelancer, setSelectedFreelancer] = useState<FreelancerOption | null>(null);
  const [freelanceCheckIn, setFreelanceCheckIn] = useState(getCurrentTime());
  const [freelanceSaving, setFreelanceSaving]   = useState(false);

  const fetchAttendance = useCallback(async (targetDate: string) => {
    setLoading(true); setError(''); setSuccessMsg(''); setDirty(new Set());
    try {
      const res  = await fetch(`/api/admin/attendance?date=${targetDate}`);
      const data = await res.json();
      if (data.success) {
        setAttendance(data.attendance);
        setSummary(data.summary ?? null);
      } else {
        setError(data.error || 'خطأ في تحميل البيانات');
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

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
    setFreelanceOpen(true);
  };

  const saveFreelanceAttendance = async () => {
    if (!selectedFreelancer) return;
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

  const updateRow = (empId: number, field: string, value: string | null) => {
    setAttendance(prev => prev.map(row => {
      if (row.EmpID !== empId) return row;
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
    setDirty(prev => new Set(prev).add(empId));
  };

  const markPresent = (empId: number) => {
    const now = getCurrentTime();
    setAttendance(prev => prev.map(row => {
      if (row.EmpID !== empId) return row;
      const late = calcLate(now, row.ScheduledStartTime);
      return { ...row, CheckInTime: now, Status: late > 0 ? 'Late' : 'Present', LateMinutes: late };
    }));
    setDirty(prev => new Set(prev).add(empId));
  };

  const markAbsent = (empId: number) => {
    setAttendance(prev => prev.map(row =>
      row.EmpID !== empId ? row : { ...row, CheckInTime: null, CheckOutTime: null, Status: 'Absent', LateMinutes: 0, EarlyLeaveMinutes: 0 }
    ));
    setDirty(prev => new Set(prev).add(empId));
  };

  const markDayOff = (empId: number) => {
    setAttendance(prev => prev.map(row =>
      row.EmpID !== empId ? row : { ...row, CheckInTime: null, CheckOutTime: null, Status: 'DayOff', LateMinutes: 0, EarlyLeaveMinutes: 0 }
    ));
    setDirty(prev => new Set(prev).add(empId));
  };

  const markExcused = (empId: number) => {
    setAttendance(prev => prev.map(row =>
      row.EmpID !== empId ? row : { ...row, Status: 'Excused' }
    ));
    setDirty(prev => new Set(prev).add(empId));
  };

  const autoFillDefaultTimes = (empId: number) => {
    setAttendance(prev => prev.map(row =>
      row.EmpID !== empId ? row : applyDefaultTimesToRow(row)
    ));
    setDirty(prev => new Set(prev).add(empId));
  };

  const fillNowTimes = (empId: number) => {
    const now = getCurrentTime();
    setAttendance(prev => prev.map(row =>
      row.EmpID !== empId ? row : applyNowTimesToRow(row, now)
    ));
    setDirty(prev => new Set(prev).add(empId));
  };

  const saveSingle = async (empId: number) => {
    const row = attendance.find(r => r.EmpID === empId);
    if (!row) return;
    setSavingId(empId); setError(''); setSuccessMsg('');
    try {
      const res  = await fetch('/api/admin/attendance', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ EmpID: row.EmpID, WorkDate: date, CheckInTime: row.CheckInTime || null, CheckOutTime: row.CheckOutTime || null, Status: row.Status, Notes: row.Notes || '' }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(`تم حفظ حضور ${row.EmpName}`);
        setDirty(prev => { const n = new Set(prev); n.delete(empId); return n; });
        setAttendance(prev => prev.map(r =>
          r.EmpID === empId ? { ...r, HasRecord: true, LateMinutes: data.data.LateMinutes, EarlyLeaveMinutes: data.data.EarlyLeaveMinutes, Status: data.data.Status } : r
        ));
        setTimeout(() => setSuccessMsg(''), 3000);
      } else {
        setError(data.error || 'خطأ في الحفظ');
      }
    } catch { setError('خطأ في الاتصال بالخادم'); }
    finally { setSavingId(null); }
  };

  const saveAll = async () => {
    setSavingAll(true); setError(''); setSuccessMsg('');
    try {
      const items = attendance.map(row => ({
        EmpID: row.EmpID, CheckInTime: row.CheckInTime || null,
        CheckOutTime: row.CheckOutTime || null, Status: row.Status, Notes: row.Notes || '',
      }));
      const res  = await fetch('/api/admin/attendance/bulk', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ WorkDate: date, items }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(`تم الحفظ: ${data.summary.savedCount} موظف (${data.summary.insertedCount} جديد، ${data.summary.updatedCount} تحديث)`);
        setDirty(new Set());
        await fetchAttendance(date);
        setTimeout(() => setSuccessMsg(''), 5000);
      } else {
        setError(data.error || 'خطأ في الحفظ');
      }
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
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-zinc-900 border-zinc-700 text-white w-44 h-9 text-sm"
          />
          <Button variant="outline" onClick={() => setDate(getBusinessDateStr())}
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
        </div>
      </div>

      <div className="text-xs text-zinc-500">
        {DAY_NAMES[new Date(date + 'T12:00:00Z').getDay()]} — {date}
        {summary?.requiredCount != null && (
          <span className="mr-2 text-zinc-600">({summary.requiredCount} مطلوب الحضور)</span>
        )}
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
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-right p-3 text-zinc-400 font-semibold whitespace-nowrap">الموظف</th>
                <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">الميعاد الرسمي</th>
                <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">وقت الحضور</th>
                <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">وقت الانصراف</th>
                <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">الحالة</th>
                <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">التأخير</th>
                <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">انصراف مبكر</th>
                <th className="text-right p-3 text-zinc-400 font-semibold whitespace-nowrap">ملاحظات</th>
                <th className="text-center p-3 text-zinc-400 font-semibold whitespace-nowrap">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center p-12">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-zinc-500" />
                  <p className="mt-2 text-zinc-500 text-sm">جاري تحميل البيانات...</p>
                </td></tr>
              ) : attendance.length === 0 ? (
                <tr><td colSpan={9} className="text-center p-12 text-zinc-500">لا يوجد موظفون متوقع حضورهم اليوم</td></tr>
              ) : attendance.map((row) => {
                const statusCfg = getStatusConfig(row.Status);
                const isDirty   = dirty.has(row.EmpID);
                const isSaving  = savingId === row.EmpID;
                const subLabel = row.displayReason
                  || (row.isScheduledWorkingDay ? 'يوم عمل' : 'إجازة')
                  || row.scheduleWarning;
                return (
                  <tr key={row.EmpID}
                    className={`border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors ${isDirty ? 'bg-amber-500/5' : ''}`}>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400">
                          {row.EmpName?.charAt(0)}
                        </div>
                        <div>
                          <div className="font-semibold text-white text-sm">{row.EmpName}</div>
                          <div className={`text-[11px] ${row.scheduleWarning ? 'text-amber-500' : 'text-zinc-500'}`}>
                            {subLabel}
                          </div>
                          <EmploymentBadges row={row} />
                        </div>
                      </div>
                    </td>
                    <td className="text-center p-3">
                      <span className="text-xs text-zinc-400">
                        {row.ScheduledStartTime || '--:--'} — {row.ScheduledEndTime || '--:--'}
                      </span>
                    </td>
                    <td className="text-center p-3">
                      <Input type="time" value={sqlTimeForInput(row.CheckInTime)}
                        onChange={(e) => updateRow(row.EmpID, 'CheckInTime', e.target.value || null)}
                        className="bg-zinc-800/50 border-zinc-700 text-white h-9 w-28 mx-auto text-center text-xs" />
                    </td>
                    <td className="text-center p-3">
                      <Input type="time" value={sqlTimeForInput(row.CheckOutTime)}
                        onChange={(e) => updateRow(row.EmpID, 'CheckOutTime', e.target.value || null)}
                        className="bg-zinc-800/50 border-zinc-700 text-white h-9 w-28 mx-auto text-center text-xs" />
                    </td>
                    <td className="text-center p-3">
                      <Select value={row.Status} onValueChange={(val) => updateRow(row.EmpID, 'Status', val)}>
                        <SelectTrigger className={`h-9 w-32 mx-auto text-xs border rounded-lg ${statusCfg.color}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-700">
                          {STATUS_OPTIONS.filter(o => !['FreelanceAvailable', 'NotRequired'].includes(o.value)).map(opt => (
                            <SelectItem key={opt.value} value={opt.value} className="text-white text-xs">{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="text-center p-3">
                      {row.LateMinutes > 0
                        ? <span className="text-xs font-semibold text-amber-400">{row.LateMinutes} د</span>
                        : <span className="text-xs text-zinc-600">—</span>}
                    </td>
                    <td className="text-center p-3">
                      {row.EarlyLeaveMinutes > 0
                        ? <span className="text-xs font-semibold text-orange-400">{row.EarlyLeaveMinutes} د</span>
                        : <span className="text-xs text-zinc-600">—</span>}
                    </td>
                    <td className="p-3">
                      <Input value={row.Notes || ''} onChange={(e) => updateRow(row.EmpID, 'Notes', e.target.value)}
                        placeholder="ملاحظات..." className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-600 h-9 text-xs min-w-[120px]" />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1 justify-center flex-wrap">
                        <Button size="sm" variant="ghost" onClick={() => autoFillDefaultTimes(row.EmpID)}
                          title="املأ بالوقت الافتراضي (D)"
                          data-testid={`attendance-fill-default-${row.EmpID}`}
                          disabled={!row.DefaultCheckInTime && !row.DefaultCheckOutTime}
                          className={`h-7 w-7 p-0 ${(row.DefaultCheckInTime || row.DefaultCheckOutTime) ? 'text-cyan-400 hover:bg-cyan-500/20' : 'text-zinc-600 cursor-not-allowed'}`}>
                          <span className="text-xs font-bold">D</span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => fillNowTimes(row.EmpID)}
                          title="الآن — الوقت الحالي (N)"
                          data-testid={`attendance-fill-now-${row.EmpID}`}
                          disabled={!!row.CheckInTime && !!row.CheckOutTime}
                          className={`h-7 w-7 p-0 ${(!row.CheckInTime || !row.CheckOutTime) ? 'text-indigo-400 hover:bg-indigo-500/20' : 'text-zinc-600 cursor-not-allowed'}`}>
                          <span className="text-xs font-bold">N</span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => markPresent(row.EmpID)} title="حاضر الآن"
                          className="h-7 w-7 p-0 text-emerald-400 hover:bg-emerald-500/20"><UserCheck className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => markAbsent(row.EmpID)} title="غائب"
                          className="h-7 w-7 p-0 text-rose-400 hover:bg-rose-500/20"><UserX className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => markDayOff(row.EmpID)} title="إجازة"
                          className="h-7 w-7 p-0 text-blue-400 hover:bg-blue-500/20"><Coffee className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => markExcused(row.EmpID)} title="إذن"
                          className="h-7 w-7 p-0 text-purple-400 hover:bg-purple-500/20"><ShieldCheck className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => saveSingle(row.EmpID)} disabled={isSaving || !isDirty} title="حفظ"
                          className={`h-7 w-7 p-0 ${isDirty ? 'text-amber-400 hover:bg-amber-500/20' : 'text-zinc-600'}`}>
                          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
                  onChange={(e) => setFreelanceCheckIn(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white"
                />
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
    </div>
  );
}
