'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X, Clock, Calendar, ChevronDown, AlertTriangle, CheckCircle,
  Loader2, Trash2, UserX, Coffee, ArrowRight, Settings,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type OverrideType = 'day_off' | 'late_start' | 'early_leave' | 'custom_hours' | 'block_range';
type AvailStatus = 'working' | 'day_off' | 'absent' | 'not_checked_in' | 'off' | 'unknown';
type ScheduleSource = 'TblEmpWorkSchedule' | 'TblEmp.Default' | 'missing_hr_schedule' | 'invalid_hr_schedule' | 'none' | string;

interface BarberRow {
  empId: number;
  empName: string;
  defaultSchedule: { isWorkingDay: boolean; start: string | null; end: string | null; source: ScheduleSource } | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  isWorkingDay: boolean;
  isDayOff: boolean;
  isAbsent: boolean;
  isLateStart: boolean;
  isEarlyLeave: boolean;
  isCustomHours: boolean;
  dayOffReason: string | null;
  statusReasonArabic: string;
  currentAvailabilityStatus: AvailStatus;
  appliedOverride: { overrideId: number | null; type: OverrideType; startTime: string | null; endTime: string | null; reason: string | null } | null;
  attendance: { status: string | null; checkInTime: string | null; checkOutTime: string | null } | null;
  activeBookingsCount: number;
  activeQueueCount: number;
}

interface AffectedBooking {
  bookingId: number;
  bookingCode: string | null;
  startTime: string;
  endTime: string | null;
  status: string;
  clientName: string | null;
  serviceName: string | null;
  conflictReason: string;
}

interface AffectedTicket {
  ticketId: number;
  ticketCode: string;
  status: string;
  estimatedStartTime: string;
  durationMinutes: number;
  clientName: string | null;
  conflictReason: string;
}

interface ActionForm {
  type: OverrideType;
  startTime: string;
  endTime: string;
  reason: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialDate: string;
  onApplied: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(s: AvailStatus): { bg: string; text: string; border: string } {
  switch (s) {
    case 'working':       return { bg: 'rgba(16,185,129,0.12)', text: '#34d399', border: 'rgba(16,185,129,0.3)' };
    case 'day_off':       return { bg: 'rgba(139,92,246,0.12)', text: '#a78bfa', border: 'rgba(139,92,246,0.3)' };
    case 'absent':        return { bg: 'rgba(239,68,68,0.12)',  text: '#f87171', border: 'rgba(239,68,68,0.3)' };
    case 'not_checked_in':return { bg: 'rgba(245,158,11,0.12)', text: '#fbbf24', border: 'rgba(245,158,11,0.3)' };
    case 'off':           return { bg: 'rgba(107,114,128,0.12)',text: '#9ca3af', border: 'rgba(107,114,128,0.3)' };
    default:              return { bg: 'rgba(107,114,128,0.12)',text: '#9ca3af', border: 'rgba(107,114,128,0.3)' };
  }
}

const ACTION_LABELS: Record<OverrideType, string> = {
  late_start:   'تأخير بداية اليوم',
  early_leave:  'مغادرة مبكرة',
  day_off:      'غياب اليوم',
  block_range:  'غير متاح لفترة',
  custom_hours: 'تعديل وردية اليوم',
};

const ACTION_ICONS: Record<OverrideType, React.ReactNode> = {
  late_start:   <Clock size={13} />,
  early_leave:  <ArrowRight size={13} />,
  day_off:      <UserX size={13} />,
  block_range:  <Coffee size={13} />,
  custom_hours: <Settings size={13} />,
};

const DANGER_TYPES: OverrideType[] = ['day_off'];

// ── Component ─────────────────────────────────────────────────────────────────

export function ScheduleControlModal({ open, onClose, initialDate, onApplied }: Props) {
  const [date, setDate] = useState(initialDate);
  const [barbers, setBarbers] = useState<BarberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-barber action panel state
  const [activeEmpId, setActiveEmpId] = useState<number | null>(null);
  const [actionForm, setActionForm] = useState<ActionForm>({ type: 'late_start', startTime: '', endTime: '', reason: '' });

  // Preview state
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{
    safe: boolean;
    affectedBookings: AffectedBooking[];
    affectedQueueTickets: AffectedTicket[];
    warnings: string[];
    effectiveSchedulePreview: any;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Confirmation state
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // attendanceWarning is set after a day_off override is deleted but Absent lingers
  const [attendanceWarning, setAttendanceWarning] = useState<string | null>(null);

  // Today string (Cairo)
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const isToday = date === todayStr;

  // ── Load barbers ────────────────────────────────────────────────────────────

  const loadBarbers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/operations/schedule-control?date=${date}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'فشل التحميل');
      setBarbers(data.barbers ?? []);
    } catch (e: any) {
      setError(e.message ?? 'فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (open) {
      setDate(initialDate);
    }
  }, [open, initialDate]);

  useEffect(() => {
    if (open) loadBarbers();
  }, [open, loadBarbers]);

  // Reset action state when switching barber or date
  const openActionPanel = (empId: number) => {
    if (activeEmpId === empId) {
      setActiveEmpId(null);
      setPreview(null);
      setPreviewError(null);
      setConfirmed(false);
      setSaveSuccess(null);
      setSaveError(null);
      return;
    }
    setActiveEmpId(empId);
    // Default to late_start unless barber already has day_off (then use block_range as first non-conflicting choice)
    const barber = barbers.find(b => b.empId === empId);
    const defaultType: OverrideType = barber?.isDayOff ? 'day_off' : 'late_start';
    setActionForm({ type: defaultType, startTime: '', endTime: '', reason: '' });
    setPreview(null);
    setPreviewError(null);
    setConfirmed(false);
    setSaveSuccess(null);
    setSaveError(null);
    setAttendanceWarning(null);
  };

  // ── Preview ─────────────────────────────────────────────────────────────────

  const runPreview = async () => {
    if (!activeEmpId) return;
    setPreviewing(true);
    setPreview(null);
    setPreviewError(null);
    setConfirmed(false);
    try {
      const res = await fetch('/api/operations/schedule-control/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: activeEmpId,
          date,
          type: actionForm.type,
          startTime: actionForm.startTime || undefined,
          endTime: actionForm.endTime || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'فشل المعاينة');
      setPreview(data);
    } catch (e: any) {
      setPreviewError(e.message ?? 'فشل المعاينة');
    } finally {
      setPreviewing(false);
    }
  };

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async (force = false) => {
    if (!activeEmpId) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const res = await fetch('/api/operations/schedule-control/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: activeEmpId,
          date,
          type: actionForm.type,
          startTime: actionForm.startTime || undefined,
          endTime: actionForm.endTime || undefined,
          reason: actionForm.reason || undefined,
          forceApply: force || confirmed,
        }),
      });
      const data = await res.json();

      // Backend returned 409 with conflict details — populate preview so user
      // can review and check the confirmation box, then retry
      if (res.status === 409 && data.requiresForce) {
        setPreview({
          safe: false,
          affectedBookings: data.affectedBookings ?? [],
          affectedQueueTickets: data.affectedQueueTickets ?? [],
          warnings: data.warnings ?? [],
          effectiveSchedulePreview: null,
        });
        setConfirmed(false);
        setSaveError(null);
        return;
      }

      if (!res.ok) throw new Error(data.error ?? 'فشل الحفظ');
      setSaveSuccess('تم تحديث مواعيد الصنايعي بنجاح');
      setActiveEmpId(null);
      setPreview(null);
      setConfirmed(false);
      await loadBarbers();
      onApplied();
    } catch (e: any) {
      setSaveError(e.message ?? 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  // ── Remove override ──────────────────────────────────────────────────────────

  const handleRemoveOverride = async (overrideId: number) => {
    setAttendanceWarning(null);
    try {
      const res = await fetch(`/api/operations/schedule-control/override/${overrideId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'فشل الحذف');
      if (data.attendanceWarning) {
        setAttendanceWarning(data.attendanceWarning);
      }
      await loadBarbers();
      onApplied();
    } catch (e: any) {
      setError(e.message ?? 'فشل حذف التعديل');
    }
  };

  // ── Action form validity ────────────────────────────────────────────────────

  const formValid = (): boolean => {
    const t = actionForm.type;
    if (t === 'late_start')   return !!actionForm.startTime;
    if (t === 'early_leave')  return !!actionForm.endTime;
    if (t === 'block_range')  return !!actionForm.startTime && !!actionForm.endTime;
    if (t === 'custom_hours') return !!actionForm.startTime && !!actionForm.endTime;
    if (t === 'day_off')      return true;
    return false;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', paddingTop: '3vh' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-3xl mx-4 rounded-2xl flex flex-col overflow-hidden"
        style={{
          background: '#0e0e12',
          border: '1px solid rgba(212,175,55,0.18)',
          maxHeight: '94vh',
        }}
        dir="rtl"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: 'rgba(212,175,55,0.15)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">🗓️</span>
            <div>
              <h2 className="text-base font-bold text-white">إدارة مواعيد اليوم</h2>
              <p className="text-xs" style={{ color: '#6b7280' }}>
                تعديل جدول الصنايعي لتاريخ محدد
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: '#6b7280' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Date selector */}
        <div className="px-6 py-3 border-b flex items-center gap-4" style={{ borderColor: 'rgba(255,255,255,0.06)', background: '#080808' }}>
          <Calendar size={15} style={{ color: '#D4AF37', flexShrink: 0 }} />
          <label className="text-xs font-medium" style={{ color: '#9ca3af', flexShrink: 0 }}>التاريخ</label>
          <input
            type="date"
            value={date}
            onChange={e => {
              setDate(e.target.value);
              setActiveEmpId(null);
              setPreview(null);
              setSaveSuccess(null);
            }}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white outline-none border"
            style={{ background: '#1a1a1f', borderColor: 'rgba(212,175,55,0.25)', colorScheme: 'dark' }}
          />
          {isToday && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(212,175,55,0.12)', color: '#D4AF37' }}>
              اليوم
            </span>
          )}
          {!isToday && (
            <button
              onClick={() => { setDate(todayStr); setActiveEmpId(null); }}
              className="text-xs underline"
              style={{ color: '#6b7280' }}
            >
              رجوع لليوم
            </button>
          )}
        </div>

        {/* Attendance warning banner (persists after day_off delete) */}
        {attendanceWarning && (
          <div className="mx-6 mt-3 px-4 py-2 rounded-xl flex items-start gap-2 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{attendanceWarning}</span>
          </div>
        )}

        {/* Save success toast */}
        {saveSuccess && (
          <div className="mx-6 mt-3 px-4 py-2 rounded-xl flex items-center gap-2 text-sm" style={{ background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' }}>
            <CheckCircle size={15} />
            {saveSuccess}
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-3" style={{ color: '#6b7280' }}>
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">جارٍ تحميل البيانات...</span>
            </div>
          )}
          {error && (
            <div className="px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
              {error}
            </div>
          )}

          {!loading && !error && barbers.map(b => {
            const sc = statusColor(b.currentAvailabilityStatus);
            const isOpen = activeEmpId === b.empId;

            return (
              <div
                key={b.empId}
                className="rounded-xl overflow-hidden"
                style={{ border: `1px solid ${isOpen ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.07)'}`, background: isOpen ? 'rgba(212,175,55,0.04)' : '#111115' }}
              >
                {/* Barber row */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => openActionPanel(b.empId)}>
                  {/* Name + status badge */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-white">{b.empName}</span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}
                      >
                        {b.statusReasonArabic}
                      </span>
                      {b.appliedOverride && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}>
                          {ACTION_LABELS[b.appliedOverride.type]}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {/* Missing HR schedule warning */}
                      {b.defaultSchedule?.source === 'missing_hr_schedule' && (
                        <span className="text-xs flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                          <AlertTriangle size={10} />
                          لا يوجد جدول HR — يرجى ضبطه من /admin/hr
                        </span>
                      )}
                      {/* Invalid HR schedule warning */}
                      {b.defaultSchedule?.source === 'invalid_hr_schedule' && (
                        <span className="text-xs flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                          <AlertTriangle size={10} />
                          جدول HR غير مكتمل — وقت البداية أو النهاية مفقود
                        </span>
                      )}
                      {/* Default schedule + source */}
                      {b.defaultSchedule?.isWorkingDay && b.defaultSchedule.start && (
                        <span className="text-xs flex items-center gap-1" style={{ color: '#4b5563' }}>
                          <span>الجدول الأساسي: {b.defaultSchedule.start} — {b.defaultSchedule.end}</span>
                          <span className="px-1 py-0.5 rounded text-xs" style={{
                            background: b.defaultSchedule.source === 'TblEmpWorkSchedule'
                              ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.12)',
                            color: b.defaultSchedule.source === 'TblEmpWorkSchedule'
                              ? '#6ee7b7' : '#f59e0b',
                          }}>
                            {b.defaultSchedule.source === 'TblEmpWorkSchedule' ? 'HR' : 'تعريف افتراضي ⚠'}
                          </span>
                        </span>
                      )}
                      {/* Effective — only show if override is active */}
                      {b.isWorkingDay && b.effectiveStart && b.appliedOverride && (
                        <span className="text-xs flex items-center gap-1" style={{ color: '#6b7280' }}>
                          <span>الفعلي: {b.effectiveStart} — {b.effectiveEnd}</span>
                          <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}>
                            {ACTION_LABELS[b.appliedOverride.type]}
                          </span>
                        </span>
                      )}
                      {/* Effective when no override */}
                      {b.isWorkingDay && b.effectiveStart && !b.appliedOverride && (
                        <span className="text-xs" style={{ color: '#6b7280' }}>
                          الفعلي: {b.effectiveStart} — {b.effectiveEnd}
                        </span>
                      )}
                      {/* Counts */}
                      {(b.activeBookingsCount > 0 || b.activeQueueCount > 0) && (
                        <span className="text-xs" style={{ color: '#6b7280' }}>
                          {b.activeBookingsCount > 0 && `${b.activeBookingsCount} حجز`}
                          {b.activeBookingsCount > 0 && b.activeQueueCount > 0 && ' • '}
                          {b.activeQueueCount > 0 && `${b.activeQueueCount} دور`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Remove override button */}
                  {b.appliedOverride?.overrideId && (
                    <button
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors"
                      style={{ color: '#6b7280', border: '1px solid rgba(255,255,255,0.08)' }}
                      onClick={e => { e.stopPropagation(); handleRemoveOverride(b.appliedOverride!.overrideId!); }}
                      title="إلغاء التعديل"
                    >
                      <Trash2 size={12} />
                      <span>إلغاء التعديل</span>
                    </button>
                  )}

                  <ChevronDown
                    size={15}
                    style={{ color: '#4b5563', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                  />
                </div>

                {/* Action panel */}
                {isOpen && (
                  <div className="border-t px-4 pb-4 pt-3 space-y-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>

                    {/* day_off already active warning */}
                    {b.isDayOff && b.appliedOverride?.type !== 'day_off' && (
                      <div className="px-3 py-2 rounded-xl text-xs flex items-center gap-2" style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}>
                        <AlertTriangle size={12} />
                        الصنايعي لديه غياب مسجل — أزل الغياب أولاً لإضافة تعديل آخر
                      </div>
                    )}

                    {/* Action type buttons */}
                    <div>
                      <p className="text-xs font-medium mb-2" style={{ color: '#9ca3af' }}>اختر الإجراء</p>
                      <div className="flex flex-wrap gap-2">
                        {(Object.keys(ACTION_LABELS) as OverrideType[]).map(t => {
                          const isDanger = DANGER_TYPES.includes(t);
                          const isSelected = actionForm.type === t;
                          // Disable non-day_off types when a day_off override is active
                          const isDisabledByDayOff = b.isDayOff && t !== 'day_off';
                          return (
                            <button
                              key={t}
                              disabled={isDisabledByDayOff}
                              onClick={() => { if (!isDisabledByDayOff) { setActionForm(f => ({ ...f, type: t })); setPreview(null); setConfirmed(false); } }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                              style={{
                                background: isSelected
                                  ? isDanger ? 'rgba(239,68,68,0.18)' : 'rgba(212,175,55,0.18)'
                                  : 'rgba(255,255,255,0.05)',
                                color: isSelected
                                  ? isDanger ? '#f87171' : '#D4AF37'
                                  : '#9ca3af',
                                border: `1px solid ${isSelected
                                  ? isDanger ? 'rgba(239,68,68,0.4)' : 'rgba(212,175,55,0.4)'
                                  : 'rgba(255,255,255,0.08)'}`,
                              }}
                            >
                              {ACTION_ICONS[t]}
                              {ACTION_LABELS[t]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Time inputs */}
                    {(actionForm.type === 'late_start' || actionForm.type === 'block_range' || actionForm.type === 'custom_hours') && (
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-medium w-20 text-right shrink-0" style={{ color: '#9ca3af' }}>
                          {actionForm.type === 'late_start' ? 'وقت البداية الجديد' : 'من'}
                        </label>
                        <input
                          type="time"
                          value={actionForm.startTime}
                          onChange={e => setActionForm(f => ({ ...f, startTime: e.target.value }))}
                          className="rounded-lg px-3 py-1.5 text-sm text-white outline-none border"
                          style={{ background: '#1a1a1f', borderColor: 'rgba(212,175,55,0.25)', colorScheme: 'dark' }}
                        />
                      </div>
                    )}
                    {(actionForm.type === 'early_leave' || actionForm.type === 'block_range' || actionForm.type === 'custom_hours') && (
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-medium w-20 text-right shrink-0" style={{ color: '#9ca3af' }}>
                          {actionForm.type === 'early_leave' ? 'وقت المغادرة' : 'إلى'}
                        </label>
                        <input
                          type="time"
                          value={actionForm.endTime}
                          onChange={e => setActionForm(f => ({ ...f, endTime: e.target.value }))}
                          className="rounded-lg px-3 py-1.5 text-sm text-white outline-none border"
                          style={{ background: '#1a1a1f', borderColor: 'rgba(212,175,55,0.25)', colorScheme: 'dark' }}
                        />
                      </div>
                    )}

                    {/* Reason */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium w-20 text-right shrink-0" style={{ color: '#9ca3af' }}>السبب</label>
                      <input
                        type="text"
                        placeholder="اختياري"
                        value={actionForm.reason}
                        onChange={e => setActionForm(f => ({ ...f, reason: e.target.value }))}
                        className="flex-1 rounded-lg px-3 py-1.5 text-sm text-white outline-none border placeholder-gray-600"
                        style={{ background: '#1a1a1f', borderColor: 'rgba(255,255,255,0.1)' }}
                      />
                    </div>

                    {/* Preview + quick save buttons */}
                    {!preview && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={runPreview}
                          disabled={!formValid() || previewing}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                          style={{ background: 'rgba(212,175,55,0.12)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.3)' }}
                        >
                          {previewing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                          معاينة التأثير
                        </button>
                        <button
                          onClick={() => handleSave(false)}
                          disabled={!formValid() || saving}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                          style={{ background: 'rgba(255,255,255,0.05)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)' }}
                          title="حفظ مباشرة — إذا وجد تعارض سيطلب منك التأكيد"
                        >
                          {saving ? <Loader2 size={15} className="animate-spin" /> : null}
                          حفظ مباشر
                        </button>
                      </div>
                    )}

                    {previewError && (
                      <div className="px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                        {previewError}
                      </div>
                    )}

                    {/* Preview result */}
                    {preview && (
                      <div className="space-y-3">
                        {/* Safe / Warning header */}
                        <div
                          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold"
                          style={{
                            background: preview.safe ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                            color: preview.safe ? '#34d399' : '#fbbf24',
                            border: `1px solid ${preview.safe ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
                          }}
                        >
                          {preview.safe ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
                          {preview.safe ? 'لا توجد تعارضات — يمكن الحفظ مباشرة' : 'يوجد تعارض مع حجوزات أو أدوار حالية'}
                        </div>

                        {/* Affected bookings */}
                        {preview.affectedBookings.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold mb-1.5" style={{ color: '#f59e0b' }}>
                              الحجوزات المتأثرة ({preview.affectedBookings.length})
                            </p>
                            <div className="space-y-1.5 max-h-32 overflow-y-auto">
                              {preview.affectedBookings.map(bk => (
                                <div key={bk.bookingId} className="flex items-center justify-between px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold" style={{ color: '#fbbf24' }}>{bk.bookingCode ?? `#${bk.bookingId}`}</span>
                                    {bk.clientName && <span style={{ color: '#9ca3af' }}>{bk.clientName}</span>}
                                    {bk.serviceName && <span style={{ color: '#6b7280' }}>• {bk.serviceName}</span>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span style={{ color: '#9ca3af' }}>{bk.startTime}{bk.endTime ? ` - ${bk.endTime}` : ''}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Affected queue tickets */}
                        {preview.affectedQueueTickets.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold mb-1.5" style={{ color: '#f59e0b' }}>
                              الأدوار المتأثرة ({preview.affectedQueueTickets.length})
                            </p>
                            <div className="space-y-1.5 max-h-32 overflow-y-auto">
                              {preview.affectedQueueTickets.map(qt => (
                                <div key={qt.ticketId} className="flex items-center justify-between px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold" style={{ color: '#fbbf24' }}>{qt.ticketCode}</span>
                                    {qt.clientName && <span style={{ color: '#9ca3af' }}>{qt.clientName}</span>}
                                  </div>
                                  <div>
                                    <span style={{ color: '#9ca3af' }}>
                                      {new Date(qt.estimatedStartTime).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' })}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Conflict confirmation checkbox */}
                        {!preview.safe && (
                          <label className="flex items-start gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={confirmed}
                              onChange={e => setConfirmed(e.target.checked)}
                              className="mt-0.5 rounded"
                              style={{ accentColor: '#D4AF37' }}
                            />
                            <span className="text-xs" style={{ color: '#fbbf24' }}>
                              أفهم أن هذا التعديل سيؤثر على حجوزات أو أدوار حالية
                            </span>
                          </label>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => handleSave(false)}
                            disabled={saving || (!preview.safe && !confirmed)}
                            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
                            style={{
                              background: DANGER_TYPES.includes(actionForm.type)
                                ? (confirmed || preview.safe) ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.08)'
                                : 'linear-gradient(135deg,#D4AF37,#B8941F)',
                              color: DANGER_TYPES.includes(actionForm.type) ? '#f87171' : '#000',
                            }}
                          >
                            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
                            حفظ التعديل
                          </button>
                          <button
                            onClick={() => { setPreview(null); setConfirmed(false); }}
                            className="px-3 py-2 rounded-xl text-xs transition-colors"
                            style={{ color: '#6b7280', border: '1px solid rgba(255,255,255,0.08)' }}
                          >
                            تعديل
                          </button>
                        </div>

                        {saveError && (
                          <div className="px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                            {saveError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t flex justify-end" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)', color: '#9ca3af' }}
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
