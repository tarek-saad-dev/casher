'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X, Shield, CalendarOff, Clock, LogOut, Lock, CalendarCog,
  Trash2, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Barber {
  id: number;
  name: string;
  job: string;
}

interface Override {
  OverrideID: number;
  EmpID: number;
  EmpName: string;
  OverrideDate: string;
  Type: string;
  StartTime: string | null;
  EndTime: string | null;
  Reason: string | null;
  IsActive: boolean;
  CreatedAt: string;
  CreatedBy: string | null;
}

type ActionType = 'day_off' | 'late_start' | 'early_leave' | 'block_range' | 'custom_hours';

interface ModalState {
  open: boolean;
  type: ActionType | null;
  barber: Barber | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function fmtTypeAr(type: string): string {
  const map: Record<string, string> = {
    day_off:      'إجازة اليوم',
    late_start:   'تأخير',
    early_leave:  'خروج بدري',
    block_range:  'قفل فترة',
    custom_hours: 'ساعات مخصصة',
  };
  return map[type] ?? type;
}

function typeColor(type: string): string {
  const map: Record<string, string> = {
    day_off:      '#EF4444',
    late_start:   '#F59E0B',
    early_leave:  '#F97316',
    block_range:  '#8B5CF6',
    custom_hours: '#06B6D4',
  };
  return map[type] ?? '#6B7280';
}

// ── Sub-component: Action Modal ───────────────────────────────────────────────

interface ActionModalProps {
  modal: ModalState;
  date: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

function ActionModal({ modal, date, onClose, onSaved, onError }: ActionModalProps) {
  const [startTime, setStartTime] = useState('');
  const [endTime,   setEndTime]   = useState('');
  const [reason,    setReason]    = useState('');
  const [saving,    setSaving]    = useState(false);

  if (!modal.open || !modal.type || !modal.barber) return null;

  const titles: Record<ActionType, string> = {
    day_off:      'إجازة طارئة اليوم',
    late_start:   'تأخير بداية الشيفت',
    early_leave:  'خروج بدري',
    block_range:  'قفل فترة مؤقتة',
    custom_hours: 'ساعات مخصصة لهذا اليوم',
  };

  const handleSubmit = async () => {
    if (modal.type === 'late_start' && !startTime) {
      onError('وقت الوصول مطلوب'); return;
    }
    if (modal.type === 'early_leave' && !endTime) {
      onError('وقت الخروج مطلوب'); return;
    }
    if (modal.type === 'block_range' && (!startTime || !endTime)) {
      onError('وقت البداية والنهاية مطلوبان'); return;
    }
    if (modal.type === 'custom_hours' && (!startTime || !endTime)) {
      onError('وقت البداية والنهاية مطلوبان'); return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        empId: modal.barber!.id,
        date,
        type: modal.type,
        reason: reason.trim() || null,
      };
      if (startTime) body.startTime = startTime;
      if (endTime)   body.endTime   = endTime;

      const res  = await fetch('/api/admin/booking-control/overrides', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'فشل الحفظ');

      onSaved(`✓ تم تطبيق "${fmtTypeAr(modal.type!)}" على ${modal.barber!.name} — يؤثر على الحجوزات الأونلاين فورًا`);
      onClose();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border shadow-2xl"
        style={{ background: '#18181F', borderColor: '#2A2A35' }}
        dir="rtl"
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#2A2A35' }}>
          <div>
            <p className="text-xs text-zinc-500 mb-0.5">{modal.barber.name}</p>
            <h3 className="text-sm font-bold text-white">{titles[modal.type]}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
            <X size={16}/>
          </button>
        </div>

        {/* Modal body */}
        <div className="px-5 py-4 space-y-4">

          {/* day_off: just reason */}
          {modal.type === 'day_off' && (
            <p className="text-sm text-zinc-400">
              سيُقفل <span className="text-white font-semibold">{modal.barber.name}</span> طوال يوم <span className="text-amber-400">{date}</span> في الحجوزات الأونلاين.
            </p>
          )}

          {/* late_start */}
          {modal.type === 'late_start' && (
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">وقت الوصول الفعلي</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                style={{ borderColor: '#3A3A45' }}
              />
            </div>
          )}

          {/* early_leave */}
          {modal.type === 'early_leave' && (
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block">وقت الخروج المبكر</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                style={{ borderColor: '#3A3A45' }}
              />
            </div>
          )}

          {/* block_range */}
          {modal.type === 'block_range' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1.5 block">من</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  style={{ borderColor: '#3A3A45' }}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1.5 block">إلى</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  style={{ borderColor: '#3A3A45' }}
                />
              </div>
            </div>
          )}

          {/* custom_hours */}
          {modal.type === 'custom_hours' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1.5 block">بداية الشيفت</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  style={{ borderColor: '#3A3A45' }}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1.5 block">نهاية الشيفت</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  style={{ borderColor: '#3A3A45' }}
                />
              </div>
            </div>
          )}

          {/* Reason (all types) */}
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">السبب (اختياري)</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="مثال: مرض مفاجئ..."
              className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-zinc-900 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
              style={{ borderColor: '#3A3A45' }}
            />
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs text-amber-300" style={{ background: 'rgba(214,168,79,0.08)', border: '1px solid rgba(214,168,79,0.2)' }}>
            <Shield size={13} className="mt-0.5 shrink-0"/>
            <span>هذا التعديل يطبق على الحجوزات الأونلاين فورًا ولا يغير جدول الأسبوع الأساسي.</span>
          </div>
        </div>

        {/* Modal footer */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all"
            style={{ borderColor: '#2A2A35' }}
          >
            إلغاء
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
            style={{
              background: modal.type === 'day_off' ? 'rgba(239,68,68,0.18)' : 'linear-gradient(135deg,#D6A84F,#B8923A)',
              color:      modal.type === 'day_off' ? '#EF4444' : '#000',
              border:     modal.type === 'day_off' ? '1px solid rgba(239,68,68,0.4)' : 'none',
            }}
          >
            {saving ? <Loader2 size={14} className="animate-spin"/> : null}
            {saving ? 'جاري الحفظ...' : 'تأكيد'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-component: Barber Card ────────────────────────────────────────────────

interface BarberCardProps {
  barber: Barber;
  overrides: Override[];
  onAction: (barber: Barber, type: ActionType) => void;
  onDeleteOverride: (id: number) => void;
  deletingId: number | null;
}

function BarberCard({ barber, overrides, onAction, onDeleteOverride, deletingId }: BarberCardProps) {
  const [expanded, setExpanded] = useState(false);
  const active = overrides.filter(o => o.EmpID === barber.id && o.IsActive);
  const hasDayOff = active.some(o => o.Type === 'day_off');

  const ACTIONS: { type: ActionType; label: string; icon: React.ReactNode; color: string; bg: string }[] = [
    { type: 'day_off',      label: 'إجازة اليوم',      icon: <CalendarOff size={13}/>,  color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
    { type: 'late_start',   label: 'تأخير',            icon: <Clock size={13}/>,        color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
    { type: 'early_leave',  label: 'خروج بدري',        icon: <LogOut size={13}/>,       color: '#F97316', bg: 'rgba(249,115,22,0.1)' },
    { type: 'block_range',  label: 'قفل فترة',         icon: <Lock size={13}/>,         color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)' },
    { type: 'custom_hours', label: 'ساعات مخصصة',      icon: <CalendarCog size={13}/>,  color: '#06B6D4', bg: 'rgba(6,182,212,0.1)' },
  ];

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all"
      style={{
        borderColor: hasDayOff ? 'rgba(239,68,68,0.4)' : active.length ? 'rgba(214,168,79,0.35)' : '#2A2A35',
        background:  hasDayOff ? 'rgba(239,68,68,0.04)' : '#141418',
      }}
    >
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold"
            style={{
              background: hasDayOff ? 'rgba(239,68,68,0.15)' : 'rgba(214,168,79,0.12)',
              color:      hasDayOff ? '#EF4444' : '#D6A84F',
            }}
          >
            {barber.name.slice(0, 1)}
          </div>

          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{barber.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {hasDayOff ? (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>
                  إجازة اليوم
                </span>
              ) : active.length > 0 ? (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(214,168,79,0.12)', color: '#D6A84F' }}>
                  {active.length} تعديل نشط
                </span>
              ) : (
                <span className="text-xs text-zinc-500">لا توجد تعديلات</span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => setExpanded(v => !v)}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors shrink-0"
        >
          {expanded ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
        </button>
      </div>

      {/* Active overrides badges */}
      {active.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {active.map(ov => (
            <div
              key={ov.OverrideID}
              className="flex items-center gap-1.5 text-xs rounded-lg px-2 py-1 border"
              style={{ borderColor: typeColor(ov.Type) + '50', background: typeColor(ov.Type) + '15', color: typeColor(ov.Type) }}
            >
              <span>{fmtTypeAr(ov.Type)}</span>
              {ov.StartTime && <span className="opacity-70">{ov.StartTime}</span>}
              {ov.EndTime   && <span className="opacity-70">← {ov.EndTime}</span>}
              <button
                onClick={() => onDeleteOverride(ov.OverrideID)}
                disabled={deletingId === ov.OverrideID}
                className="hover:opacity-80 disabled:opacity-40 mr-0.5"
              >
                {deletingId === ov.OverrideID
                  ? <Loader2 size={11} className="animate-spin"/>
                  : <X size={11}/>
                }
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Expanded: Action buttons */}
      {expanded && (
        <div className="border-t px-4 py-3 grid grid-cols-2 gap-2 sm:grid-cols-3" style={{ borderColor: '#2A2A35' }}>
          {ACTIONS.map(act => (
            <button
              key={act.type}
              onClick={() => onAction(barber, act.type)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all hover:opacity-80 active:scale-95"
              style={{ background: act.bg, color: act.color, borderColor: act.color + '40' }}
            >
              {act.icon}
              {act.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Drawer ───────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function BookingControlDrawer({ onClose }: Props) {
  const [date,      setDate]      = useState(todayStr());
  const [barbers,   setBarbers]   = useState<Barber[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState<ModalState>({ open: false, type: null, barber: null });
  const [toast,     setToast]     = useState<{ msg: string; ok: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showAllOverrides, setShowAllOverrides] = useState(false);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Fetch barbers (once) ───────────────────────────────────────────────────
  const fetchBarbers = useCallback(async () => {
    try {
      const res  = await fetch('/api/public/booking/barbers');
      const data = await res.json();
      setBarbers(data.barbers ?? []);
    } catch { /* non-fatal */ }
  }, []);

  // ── Fetch overrides for date ───────────────────────────────────────────────
  const fetchOverrides = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/admin/booking-control/overrides?date=${d}`);
      const data = await res.json();
      setOverrides(data.overrides ?? []);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchBarbers(); }, [fetchBarbers]);
  useEffect(() => { fetchOverrides(date); }, [date, fetchOverrides]);

  // ── Delete override ────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/booking-control/overrides/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('فشل الحذف');
      showToast('تم إلغاء التعديل ✓');
      fetchOverrides(date);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'حدث خطأ', false);
    } finally {
      setDeletingId(null);
    }
  }, [date, fetchOverrides, showToast]);

  // ── After modal saves ──────────────────────────────────────────────────────
  const handleSaved = useCallback((msg: string) => {
    showToast(msg);
    fetchOverrides(date);
  }, [date, fetchOverrides, showToast]);

  const handleError = useCallback((msg: string) => {
    showToast(msg, false);
  }, [showToast]);

  // ── Active overrides (all barbers) ─────────────────────────────────────────
  const allActive = overrides.filter(o => o.IsActive);
  const visibleTopOverrides = showAllOverrides ? allActive : allActive.slice(0, 3);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[50] bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className="fixed top-0 left-0 h-full z-[55] flex flex-col overflow-hidden shadow-2xl"
        style={{ width: 420, background: '#0F0F14', borderRight: '1px solid #2A2A35' }}
        dir="rtl"
      >
        {/* ── Drawer Header ──────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b px-5 py-4" style={{ borderColor: '#2A2A35', background: '#111116' }}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(214,168,79,0.15)' }}>
                <Shield size={16} style={{ color: '#D6A84F' }}/>
              </div>
              <div>
                <h2 className="text-sm font-black text-white">التحكم السريع في الحجز</h2>
                <p className="text-xs text-zinc-500 leading-tight">تعديلات يومية بدون تغيير جدول الأسبوع</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl border text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
              style={{ borderColor: '#2A2A35' }}
            >
              <X size={15}/>
            </button>
          </div>

          {/* Date selector */}
          <div className="mt-3">
            <label className="text-xs text-zinc-500 mb-1 block">اليوم المحدد</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm text-white bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
              style={{ borderColor: '#2A2A35' }}
            />
          </div>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Active Overrides Banner */}
          {allActive.length > 0 && (
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'rgba(214,168,79,0.3)', background: 'rgba(214,168,79,0.05)' }}>
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(214,168,79,0.2)' }}>
                <div className="flex items-center gap-2">
                  <AlertCircle size={14} style={{ color: '#D6A84F' }}/>
                  <span className="text-xs font-bold text-amber-400">تعديلات اليوم ({allActive.length})</span>
                </div>
                {allActive.length > 3 && (
                  <button
                    onClick={() => setShowAllOverrides(v => !v)}
                    className="text-xs text-zinc-500 hover:text-white transition-colors"
                  >
                    {showAllOverrides ? 'أقل' : `عرض الكل`}
                  </button>
                )}
              </div>
              <div className="divide-y" style={{ borderColor: 'rgba(214,168,79,0.1)' }}>
                {visibleTopOverrides.map(ov => (
                  <div key={ov.OverrideID} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: typeColor(ov.Type) }}/>
                      <span className="text-xs text-zinc-300 font-medium truncate">{ov.EmpName}</span>
                      <span className="text-xs shrink-0" style={{ color: typeColor(ov.Type) }}>{fmtTypeAr(ov.Type)}</span>
                      {ov.StartTime && <span className="text-xs text-zinc-500 shrink-0">{ov.StartTime}</span>}
                      {ov.EndTime   && <span className="text-xs text-zinc-500 shrink-0">← {ov.EndTime}</span>}
                    </div>
                    <button
                      onClick={() => handleDelete(ov.OverrideID)}
                      disabled={deletingId === ov.OverrideID}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-all disabled:opacity-40 shrink-0 mr-2"
                    >
                      {deletingId === ov.OverrideID
                        ? <Loader2 size={13} className="animate-spin"/>
                        : <Trash2 size={13}/>
                      }
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section label */}
          <div className="flex items-center gap-2">
            <div className="h-px flex-1" style={{ background: '#2A2A35' }}/>
            <span className="text-xs text-zinc-500 px-2">الموظفون</span>
            <div className="h-px flex-1" style={{ background: '#2A2A35' }}/>
          </div>

          {/* Barber cards */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={22} className="animate-spin text-amber-400"/>
            </div>
          ) : barbers.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm">لا يوجد موظفون</div>
          ) : (
            <div className="space-y-3">
              {barbers.map(barber => (
                <BarberCard
                  key={barber.id}
                  barber={barber}
                  overrides={overrides}
                  onAction={(b, type) => setModal({ open: true, type, barber: b })}
                  onDeleteOverride={handleDelete}
                  deletingId={deletingId}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Footer note ────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 px-5 py-3 border-t text-xs text-zinc-600 text-center"
          style={{ borderColor: '#2A2A35' }}
        >
          التعديلات تؤثر فورًا على الحجوزات الأونلاين · لا تُعدَّل جداول الأسبوع
        </div>
      </div>

      {/* Action Modal */}
      <ActionModal
        modal={modal}
        date={date}
        onClose={() => setModal({ open: false, type: null, barber: null })}
        onSaved={handleSaved}
        onError={handleError}
      />

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl border flex items-center gap-2 transition-all"
          style={{
            background:  toast.ok ? '#141418' : 'rgba(239,68,68,0.12)',
            color:       toast.ok ? '#F7F1E5' : '#EF4444',
            borderColor: toast.ok ? '#2A2A35' : 'rgba(239,68,68,0.3)',
          }}
        >
          {toast.ok
            ? <CheckCircle2 size={15} style={{ color: '#10B981' }}/>
            : <AlertCircle  size={15} style={{ color: '#EF4444' }}/>
          }
          {toast.msg}
        </div>
      )}
    </>
  );
}
