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
    day_off:      'var(--destructive)',
    late_start:   'var(--warning)',
    early_leave:  'var(--warning)',
    block_range:  'var(--accent)',
    custom_hours: 'var(--info)',
  };
  return map[type] ?? 'var(--muted-foreground)';
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
      style={{ background: 'color-mix(in srgb, var(--background) 75%, transparent)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border shadow-2xl"
        style={{ background: 'var(--surface-elevated)', borderColor: 'var(--surface-muted)' }}
        dir="rtl"
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--surface-muted)' }}>
          <div>
            <p className="text-xs text-muted-foreground/80 mb-0.5">{modal.barber.name}</p>
            <h3 className="text-sm font-bold text-foreground">{titles[modal.type]}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={16}/>
          </button>
        </div>

        {/* Modal body */}
        <div className="px-5 py-4 space-y-4">

          {/* day_off: just reason */}
          {modal.type === 'day_off' && (
            <p className="text-sm text-muted-foreground">
              سيُقفل <span className="text-foreground font-semibold">{modal.barber.name}</span> طوال يوم <span className="text-primary">{date}</span> في الحجوزات الأونلاين.
            </p>
          )}

          {/* late_start */}
          {modal.type === 'late_start' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">وقت الوصول الفعلي</label>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm text-foreground bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
          )}

          {/* early_leave */}
          {modal.type === 'early_leave' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">وقت الخروج المبكر</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm text-foreground bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
          )}

          {/* block_range */}
          {modal.type === 'block_range' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">من</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm text-foreground bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">إلى</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm text-foreground bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>
            </div>
          )}

          {/* custom_hours */}
          {modal.type === 'custom_hours' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">بداية الشيفت</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm text-foreground bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">نهاية الشيفت</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm text-foreground bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                  style={{ borderColor: 'var(--border)' }}
                />
              </div>
            </div>
          )}

          {/* Reason (all types) */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">السبب (اختياري)</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="مثال: مرض مفاجئ..."
              className="w-full rounded-xl border px-3 py-2.5 text-sm text-foreground bg-surface placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs text-primary" style={{ background: 'color-mix(in srgb, var(--primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)' }}>
            <Shield size={13} className="mt-0.5 shrink-0"/>
            <span>هذا التعديل يطبق على الحجوزات الأونلاين فورًا ولا يغير جدول الأسبوع الأساسي.</span>
          </div>
        </div>

        {/* Modal footer */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground transition-all"
            style={{ borderColor: 'var(--surface-muted)' }}
          >
            إلغاء
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
            style={{
              background: modal.type === 'day_off' ? 'color-mix(in srgb, var(--destructive) 18%, transparent)' : 'linear-gradient(135deg,var(--primary),var(--primary-active))',
              color:      modal.type === 'day_off' ? 'var(--destructive)' : 'var(--primary-foreground)',
              border:     modal.type === 'day_off' ? '1px solid color-mix(in srgb, var(--destructive) 40%, transparent)' : 'none',
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
    { type: 'day_off',      label: 'إجازة اليوم',      icon: <CalendarOff size={13}/>,  color: 'var(--destructive)', bg: 'color-mix(in srgb, var(--destructive) 10%, transparent)' },
    { type: 'late_start',   label: 'تأخير',            icon: <Clock size={13}/>,        color: 'var(--warning)', bg: 'color-mix(in srgb, var(--warning) 10%, transparent)' },
    { type: 'early_leave',  label: 'خروج بدري',        icon: <LogOut size={13}/>,       color: 'var(--warning)', bg: 'color-mix(in srgb, var(--warning) 10%, transparent)' },
    { type: 'block_range',  label: 'قفل فترة',         icon: <Lock size={13}/>,         color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
    { type: 'custom_hours', label: 'ساعات مخصصة',      icon: <CalendarCog size={13}/>,  color: 'var(--info)', bg: 'color-mix(in srgb, var(--info) 10%, transparent)' },
  ];

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all"
      style={{
        borderColor: hasDayOff ? 'color-mix(in srgb, var(--destructive) 40%, transparent)' : active.length ? 'color-mix(in srgb, var(--primary) 35%, transparent)' : 'var(--surface-muted)',
        background:  hasDayOff ? 'color-mix(in srgb, var(--destructive) 4%, transparent)' : 'var(--surface)',
      }}
    >
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold"
            style={{
              background: hasDayOff ? 'color-mix(in srgb, var(--destructive) 15%, transparent)' : 'color-mix(in srgb, var(--primary) 12%, transparent)',
              color:      hasDayOff ? 'var(--destructive)' : 'var(--primary)',
            }}
          >
            {barber.name.slice(0, 1)}
          </div>

          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{barber.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {hasDayOff ? (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'color-mix(in srgb, var(--destructive) 15%, transparent)', color: 'var(--destructive)' }}>
                  إجازة اليوم
                </span>
              ) : active.length > 0 ? (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>
                  {active.length} تعديل نشط
                </span>
              ) : (
                <span className="text-xs text-muted-foreground/80">لا توجد تعديلات</span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => setExpanded(v => !v)}
          className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-foreground hover:bg-surface-muted transition-colors shrink-0"
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
        <div className="border-t px-4 py-3 grid grid-cols-2 gap-2 sm:grid-cols-3" style={{ borderColor: 'var(--surface-muted)' }}>
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
        className="fixed inset-0 z-[50] bg-background/60 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className="fixed top-0 left-0 h-full z-[55] flex flex-col overflow-hidden shadow-2xl"
        style={{ width: 420, background: 'var(--background)', borderRight: '1px solid var(--surface-muted)' }}
        dir="rtl"
      >
        {/* ── Drawer Header ──────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b px-5 py-4" style={{ borderColor: 'var(--surface-muted)', background: 'var(--surface-muted)' }}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)' }}>
                <Shield size={16} style={{ color: 'var(--primary)' }}/>
              </div>
              <div>
                <h2 className="text-sm font-black text-foreground">التحكم السريع في الحجز</h2>
                <p className="text-xs text-muted-foreground/80 leading-tight">تعديلات يومية بدون تغيير جدول الأسبوع</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl border text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-all"
              style={{ borderColor: 'var(--surface-muted)' }}
            >
              <X size={15}/>
            </button>
          </div>

          {/* Date selector */}
          <div className="mt-3">
            <label className="text-xs text-muted-foreground/80 mb-1 block">اليوم المحدد</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm text-foreground bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
              style={{ borderColor: 'var(--surface-muted)' }}
            />
          </div>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Active Overrides Banner */}
          {allActive.length > 0 && (
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)', background: 'color-mix(in srgb, var(--primary) 5%, transparent)' }}>
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'color-mix(in srgb, var(--primary) 20%, transparent)' }}>
                <div className="flex items-center gap-2">
                  <AlertCircle size={14} style={{ color: 'var(--primary)' }}/>
                  <span className="text-xs font-bold text-primary">تعديلات اليوم ({allActive.length})</span>
                </div>
                {allActive.length > 3 && (
                  <button
                    onClick={() => setShowAllOverrides(v => !v)}
                    className="text-xs text-muted-foreground/80 hover:text-foreground transition-colors"
                  >
                    {showAllOverrides ? 'أقل' : `عرض الكل`}
                  </button>
                )}
              </div>
              <div className="divide-y" style={{ borderColor: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}>
                {visibleTopOverrides.map(ov => (
                  <div key={ov.OverrideID} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: typeColor(ov.Type) }}/>
                      <span className="text-xs text-foreground font-medium truncate">{ov.EmpName}</span>
                      <span className="text-xs shrink-0" style={{ color: typeColor(ov.Type) }}>{fmtTypeAr(ov.Type)}</span>
                      {ov.StartTime && <span className="text-xs text-muted-foreground/80 shrink-0">{ov.StartTime}</span>}
                      {ov.EndTime   && <span className="text-xs text-muted-foreground/80 shrink-0">← {ov.EndTime}</span>}
                    </div>
                    <button
                      onClick={() => handleDelete(ov.OverrideID)}
                      disabled={deletingId === ov.OverrideID}
                      className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-destructive hover:bg-destructive/10 transition-all disabled:opacity-40 shrink-0 mr-2"
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
            <div className="h-px flex-1" style={{ background: 'var(--surface-muted)' }}/>
            <span className="text-xs text-muted-foreground/80 px-2">الموظفون</span>
            <div className="h-px flex-1" style={{ background: 'var(--surface-muted)' }}/>
          </div>

          {/* Barber cards */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={22} className="animate-spin text-primary"/>
            </div>
          ) : barbers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground/80 text-sm">لا يوجد موظفون</div>
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
          className="flex-shrink-0 px-5 py-3 border-t text-xs text-muted-foreground/60 text-center"
          style={{ borderColor: 'var(--surface-muted)' }}
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
            background:  toast.ok ? 'var(--surface)' : 'color-mix(in srgb, var(--destructive) 12%, transparent)',
            color:       toast.ok ? 'var(--foreground)' : 'var(--destructive)',
            borderColor: toast.ok ? 'var(--surface-muted)' : 'color-mix(in srgb, var(--destructive) 30%, transparent)',
          }}
        >
          {toast.ok
            ? <CheckCircle2 size={15} style={{ color: 'var(--success)' }}/>
            : <AlertCircle  size={15} style={{ color: 'var(--destructive)' }}/>
          }
          {toast.msg}
        </div>
      )}
    </>
  );
}
