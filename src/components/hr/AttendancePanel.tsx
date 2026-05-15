'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Clock, CheckCircle2, AlertCircle,
  Loader2, RefreshCw, Save, CalendarDays, UserCheck,
  UserX, Coffee, ShieldCheck, Timer,
} from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getBusinessDateStr } from '@/lib/timeUtils';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface AttendanceRow {
  EmpID: number;
  EmpName: string;
  WorkDate: string;
  DayOfWeek: number;
  IsWorkingDay: boolean;
  ScheduledStartTime: string | null;
  ScheduledEndTime: string | null;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string;
  LateMinutes: number;
  EarlyLeaveMinutes: number;
  Notes: string;
  HasRecord: boolean;
}

const STATUS_OPTIONS = [
  { value: 'Pending',    label: 'لم يسجل',       color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
  { value: 'Present',    label: 'حاضر',           color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { value: 'Late',       label: 'متأخر',          color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'Absent',     label: 'غائب',           color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  { value: 'DayOff',     label: 'إجازة',          color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'EarlyLeave', label: 'انصراف مبكر',   color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  { value: 'Excused',    label: 'إذن / بعذر',     color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
];

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function getStatusConfig(status: string) {
  return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
}
// Uses getBusinessDateStr from timeUtils — day ends at 5 AM
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

export default function AttendancePanel() {
  const [date, setDate]           = useState(getBusinessDateStr());
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [savingAll, setSavingAll] = useState(false);
  const [savingId, setSavingId]   = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [dirty, setDirty]         = useState<Set<number>>(new Set());

  const fetchAttendance = useCallback(async (targetDate: string) => {
    setLoading(true); setError(''); setSuccessMsg(''); setDirty(new Set());
    try {
      const res  = await fetch(`/api/admin/attendance?date=${targetDate}`);
      const data = await res.json();
      if (data.success) {
        setAttendance(data.attendance);
      } else {
        setError(data.error || 'خطأ في تحميل البيانات');
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAttendance(date); }, [date, fetchAttendance]);

  const updateRow = (empId: number, field: string, value: any) => {
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

  const total   = attendance.length;
  const present = attendance.filter(r => r.Status === 'Present').length;
  const late    = attendance.filter(r => r.Status === 'Late').length;
  const absent  = attendance.filter(r => r.Status === 'Absent').length;
  const dayOff  = attendance.filter(r => r.Status === 'DayOff' || r.Status === 'Excused').length;
  const pending = attendance.filter(r => r.Status === 'Pending').length;

  return (
    <div className="space-y-5">
      {/* ── Header bar ── */}
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
        </div>
      </div>

      {/* Day label */}
      <div className="text-xs text-zinc-500">
        {DAY_NAMES[new Date(date + 'T00:00:00').getDay()]} — {date}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard title="إجمالي الموظفين" value={total}   icon={<Users className="w-5 h-5" />} variant="default" />
        <KpiCard title="الحاضرين"         value={present} icon={<UserCheck className="w-5 h-5" />} variant="success" />
        <KpiCard title="المتأخرين"         value={late}    icon={<Timer className="w-5 h-5" />} variant="warning" />
        <KpiCard title="الغائبين"          value={absent}  icon={<UserX className="w-5 h-5" />} variant="danger" />
        <KpiCard title="الإجازات / أذون"  value={dayOff}  icon={<Coffee className="w-5 h-5" />} variant="primary" />
        <KpiCard title="لم يسجل"          value={pending} icon={<Clock className="w-5 h-5" />} variant="default" />
      </div>

      {/* Messages */}
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

      {/* Table */}
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
                <tr><td colSpan={9} className="text-center p-12 text-zinc-500">لا يوجد موظفون نشطون</td></tr>
              ) : attendance.map((row) => {
                const statusCfg = getStatusConfig(row.Status);
                const isDirty   = dirty.has(row.EmpID);
                const isSaving  = savingId === row.EmpID;
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
                          <div className="text-[11px] text-zinc-500">{row.IsWorkingDay ? 'يوم عمل' : 'إجازة'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-center p-3">
                      <span className="text-xs text-zinc-400">
                        {row.ScheduledStartTime || '--:--'} — {row.ScheduledEndTime || '--:--'}
                      </span>
                    </td>
                    <td className="text-center p-3">
                      <Input type="time" value={row.CheckInTime || ''}
                        onChange={(e) => updateRow(row.EmpID, 'CheckInTime', e.target.value || null)}
                        className="bg-zinc-800/50 border-zinc-700 text-white h-9 w-28 mx-auto text-center text-xs" />
                    </td>
                    <td className="text-center p-3">
                      <Input type="time" value={row.CheckOutTime || ''}
                        onChange={(e) => updateRow(row.EmpID, 'CheckOutTime', e.target.value || null)}
                        className="bg-zinc-800/50 border-zinc-700 text-white h-9 w-28 mx-auto text-center text-xs" />
                    </td>
                    <td className="text-center p-3">
                      <Select value={row.Status} onValueChange={(val) => updateRow(row.EmpID, 'Status', val)}>
                        <SelectTrigger className={`h-9 w-32 mx-auto text-xs border rounded-lg ${statusCfg.color}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-700">
                          {STATUS_OPTIONS.map(opt => (
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
                      <div className="flex items-center gap-1 justify-center">
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

      {/* Save All */}
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
    </div>
  );
}
