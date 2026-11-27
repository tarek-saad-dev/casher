'use client';

import { useState, useEffect } from 'react';
import {
  Settings, Save, Loader2, CheckCircle2, AlertCircle,
  Hash, Clock, CalendarDays, Shield, ArrowRight, Volume2, Database,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { speakWithAzure } from '@/lib/queueVoice';
// Settings icon from lucide-react is used in Section component

interface QueueSettings {
  QueuePrefix: string;
  QueueStartNumber: number;
  ResetQueueDaily: boolean;
  DefaultServiceMinutes: number;
  BookingGracePeriod: number;
  AutoNoShowAfterMin: number;
  AllowDoubleBooking: boolean;
  BookingPriorityMode: string;
}

interface BookingBranchInfo {
  branchId: number;
  branchCode: string;
  branchName: string;
  lifecycleStatus: string;
  publicBookingEnabled: boolean;
  defaultOpenTime: string | null;
  defaultCloseTime: string | null;
}

interface BookingSettings {
  salonName: string;
  timezone: string;
  currency: string;
  bookingEnabled: boolean;
  allowSpecificBarber: boolean;
  allowNearestBarber: boolean;
  defaultMode: "nearest" | "specific";
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxBookingDaysAhead: number;
  defaultServiceDurationMinutes: number;
}

const DEFAULT_SETTINGS: QueueSettings = {
  QueuePrefix: 'A',
  QueueStartNumber: 1,
  ResetQueueDaily: true,
  DefaultServiceMinutes: 30,
  BookingGracePeriod: 15,
  AutoNoShowAfterMin: 30,
  AllowDoubleBooking: false,
  BookingPriorityMode: 'fifo',
};

const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  salonName: "الفرع الرئيسي",
  timezone: "Africa/Cairo",
  currency: "EGP",
  bookingEnabled: false,
  allowSpecificBarber: true,
  allowNearestBarber: true,
  defaultMode: "nearest",
  slotIntervalMinutes: 15,
  minNoticeMinutes: 30,
  maxBookingDaysAhead: 14,
  defaultServiceDurationMinutes: 30,
};

function Toggle({
  checked, onChange, label, description,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="relative w-11 h-6 rounded-full transition-colors shrink-0 mt-0.5"
        style={{ background: checked ? 'var(--primary)' : 'var(--muted-foreground)' }}
      >
        <span
          className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all"
          style={{ right: checked ? 4 : 'auto', left: checked ? 'auto' : 4 }}
        />
      </button>
    </div>
  );
}

function NumberInput({
  label, description, value, onChange, min = 0, max = 999, suffix = '',
}: {
  label: string; description?: string;
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; suffix?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          className="w-7 h-7 rounded-lg bg-muted border border-border text-foreground hover:bg-surface-muted transition-all flex items-center justify-center font-bold text-sm"
        >−</button>
        <span className="w-10 text-center text-sm font-bold text-foreground">{value}{suffix}</span>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          className="w-7 h-7 rounded-lg bg-muted border border-border text-foreground hover:bg-surface-muted transition-all flex items-center justify-center font-bold text-sm"
        >+</button>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-5 space-y-4" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <div className="text-warning">{icon}</div>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function QueueBookingSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<QueueSettings>(DEFAULT_SETTINGS);
  const [bookingSettings, setBookingSettings] = useState<BookingSettings>(DEFAULT_BOOKING_SETTINGS);
  const [bookingBranch, setBookingBranch] = useState<BookingBranchInfo | null>(null);
  const [bookingLoading, setBookingLoading] = useState(true);
  const [bookingSaving, setBookingSaving] = useState(false);
  const [bookingSaved, setBookingSaved] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceTesting, setVoiceTesting] = useState(false);
  const [voiceToast, setVoiceToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<{ msg: string; ok: boolean } | null>(null);

  const handleMigrate = async () => {
    setMigrating(true);
    setMigrateMsg(null);
    try {
      const res = await fetch('/api/admin/migrate-barber-schedule', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setMigrateMsg({ msg: 'تمت الميجرشن بنجاح ✅', ok: true });
      } else {
        setMigrateMsg({ msg: `خطأ: ${data.error ?? 'غير معروف'}`, ok: false });
      }
    } catch (err) {
      setMigrateMsg({ msg: `خطأ: ${err instanceof Error ? err.message : 'غير معروف'}`, ok: false });
    } finally {
      setMigrating(false);
      setTimeout(() => setMigrateMsg(null), 5000);
    }
  };

  const handleVoiceTest = async () => {
    setVoiceTesting(true);
    setVoiceToast(null);
    try {
      await speakWithAzure('عميلنا العزيز، يتفضل يتوجه إلى الموظف المتاح.');
      setVoiceToast({ msg: 'تم تشغيل النداء الصوتي بنجاح ✅', ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
      setVoiceToast({ msg: `تعذر النداء الصوتي: ${msg}`, ok: false });
    } finally {
      setVoiceTesting(false);
      setTimeout(() => setVoiceToast(null), 4000);
    }
  };

  useEffect(() => {
    // Fetch both queue and booking settings
    Promise.all([
      fetch('/api/queue/settings').then(r => r.json()),
      fetch('/api/admin/booking-settings').then(r => r.json()),
    ])
      .then(([queueData, bookingData]) => {
        if (queueData.settings) {
          setSettings({
            QueuePrefix: queueData.settings.QueuePrefix ?? 'A',
            QueueStartNumber: queueData.settings.QueueStartNumber ?? 1,
            ResetQueueDaily: !!queueData.settings.ResetQueueDaily,
            DefaultServiceMinutes: queueData.settings.DefaultServiceMinutes ?? 30,
            BookingGracePeriod: queueData.settings.BookingGracePeriod ?? 15,
            AutoNoShowAfterMin: queueData.settings.AutoNoShowAfterMin ?? 30,
            AllowDoubleBooking: !!queueData.settings.AllowDoubleBooking,
            BookingPriorityMode: queueData.settings.BookingPriorityMode ?? 'fifo',
          });
        }
        if (bookingData.ok && bookingData.settings) {
          if (bookingData.branch) setBookingBranch(bookingData.branch as BookingBranchInfo);
          setBookingSettings({
            salonName: bookingData.settings.salonName ?? DEFAULT_BOOKING_SETTINGS.salonName,
            timezone: bookingData.settings.timezone ?? DEFAULT_BOOKING_SETTINGS.timezone,
            currency: bookingData.settings.currency ?? DEFAULT_BOOKING_SETTINGS.currency,
            bookingEnabled: bookingData.settings.bookingEnabled ?? DEFAULT_BOOKING_SETTINGS.bookingEnabled,
            allowSpecificBarber: bookingData.settings.allowSpecificBarber ?? DEFAULT_BOOKING_SETTINGS.allowSpecificBarber,
            allowNearestBarber: bookingData.settings.allowNearestBarber ?? DEFAULT_BOOKING_SETTINGS.allowNearestBarber,
            defaultMode: bookingData.settings.defaultMode ?? DEFAULT_BOOKING_SETTINGS.defaultMode,
            slotIntervalMinutes: bookingData.settings.slotIntervalMinutes ?? DEFAULT_BOOKING_SETTINGS.slotIntervalMinutes,
            minNoticeMinutes: bookingData.settings.minNoticeMinutes ?? DEFAULT_BOOKING_SETTINGS.minNoticeMinutes,
            maxBookingDaysAhead: bookingData.settings.maxBookingDaysAhead ?? DEFAULT_BOOKING_SETTINGS.maxBookingDaysAhead,
            defaultServiceDurationMinutes: bookingData.settings.defaultServiceDurationMinutes ?? DEFAULT_BOOKING_SETTINGS.defaultServiceDurationMinutes,
          });
        } else if (!bookingData.ok) {
          setBookingError(bookingData.error || 'فشل تحميل إعدادات الحجز');
        }
      })
      .catch((err) => {
        setError('فشل تحميل الإعدادات');
        setBookingError('فشل تحميل إعدادات الحجز');
      })
      .finally(() => {
        setLoading(false);
        setBookingLoading(false);
      });
  }, []);

  const setBooking = <K extends keyof BookingSettings>(key: K, value: BookingSettings[K]) => {
    setBookingSettings(s => ({ ...s, [key]: value }));
    setBookingSaved(false);
  };

  const handleSaveBookingSettings = async () => {
    setBookingSaving(true);
    setBookingError(null);
    try {
      const res = await fetch('/api/admin/booking-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonName: bookingSettings.salonName,
          timezone: bookingSettings.timezone,
          currency: bookingSettings.currency,
          bookingEnabled: bookingSettings.bookingEnabled,
          allowSpecificBarber: bookingSettings.allowSpecificBarber,
          allowNearestBarber: bookingSettings.allowNearestBarber,
          defaultMode: bookingSettings.defaultMode,
          slotIntervalMinutes: bookingSettings.slotIntervalMinutes,
          minNoticeMinutes: bookingSettings.minNoticeMinutes,
          maxBookingDaysAhead: bookingSettings.maxBookingDaysAhead,
          defaultServiceDurationMinutes: bookingSettings.defaultServiceDurationMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
      setBookingSaved(true);
      setTimeout(() => setBookingSaved(false), 3000);
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setBookingSaving(false);
    }
  };

  const set = <K extends keyof QueueSettings>(key: K, value: QueueSettings[K]) => {
    setSettings(s => ({ ...s, [key]: value }));
    setSaved(false);
  };

  // Select options for booking settings
  const minNoticeOptions = [
    { value: 0, label: '0 دقيقة' },
    { value: 5, label: '5 دقائق' },
    { value: 10, label: '10 دقائق' },
    { value: 15, label: '15 دقيقة' },
    { value: 30, label: '30 دقيقة' },
    { value: 60, label: '60 دقيقة' },
  ];

  const slotIntervalOptions = [
    { value: 5, label: '5 دقائق' },
    { value: 10, label: '10 دقائق' },
    { value: 15, label: '15 دقيقة' },
    { value: 30, label: '30 دقيقة' },
  ];

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/queue/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setSaving(false);
    }
  };

  const previewCode = `${settings.QueuePrefix}${settings.QueueStartNumber}`;

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-background">
      <Loader2 className="animate-spin text-warning" size={28} />
    </div>
  );

  return (
    <div className="h-full min-h-0 min-w-0 flex flex-col bg-background" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-surface-muted text-muted-foreground hover:text-foreground transition-all">
            <ArrowRight size={16} />
          </button>
          <div>
            <h1 className="text-base font-black text-foreground">إعدادات الطابور والحجوزات</h1>
            <p className="text-xs text-muted-foreground">تخصيص نظام الانتظار والحجوزات</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
          style={{ background: saved ? 'var(--success)' : 'var(--primary)', color: saved ? 'var(--success-foreground)' : 'var(--primary-foreground)' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> :
            saved ? <CheckCircle2 size={14} /> :
              <Save size={14} />}
          {saving ? 'جاري الحفظ...' : saved ? 'تم الحفظ' : 'حفظ الإعدادات'}
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 p-3 rounded-xl bg-destructive-soft border border-destructive/30 text-destructive text-sm shrink-0">
          <AlertCircle size={14} />{error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-luxury-v">
        <div className="max-w-2xl mx-auto p-3 sm:p-6 space-y-5">

          {/* Preview */}
          <div
            className="rounded-2xl border p-5 flex items-center justify-between"
            style={{ background: 'color-mix(in srgb, var(--primary) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)' }}
          >
            <div>
              <p className="text-xs text-warning mb-1">معاينة — أول تذكرة اليوم</p>
              <p className="text-4xl font-black" style={{ color: 'var(--primary)', textShadow: 'none' }}>
                {previewCode}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">البادئة: <span className="text-foreground font-bold">{settings.QueuePrefix}</span></p>
              <p className="text-xs text-muted-foreground mt-1">يبدأ من: <span className="text-foreground font-bold">{settings.QueueStartNumber}</span></p>
            </div>
          </div>

          {/* Active branch identity, hours and public launch path */}
          {bookingBranch && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">إعدادات الفرع الحالي</p>
                <p className="font-semibold text-foreground">{bookingBranch.branchName}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  ساعات العمل: {bookingBranch.defaultOpenTime?.slice(0, 5) || 'غير محدد'} –{' '}
                  {bookingBranch.defaultCloseTime?.slice(0, 5) || 'غير محدد'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Link
                  href={`/admin/branches/${bookingBranch.branchId}`}
                  className="rounded-lg border border-border px-3 py-2 text-foreground hover:border-warning/30"
                >
                  تعديل ساعات العمل
                </Link>
                <Link
                  href={`/admin/branches/${bookingBranch.branchId}/readiness`}
                  className="rounded-lg border border-border px-3 py-2 text-foreground hover:border-warning/30"
                >
                  جاهزية الحجز العام
                </Link>
                <Link href="/admin/services" className="rounded-lg border border-border px-3 py-2 text-foreground">
                  إدارة الخدمات
                </Link>
                <Link href="/admin/employees" className="rounded-lg border border-border px-3 py-2 text-foreground">
                  إدارة الموظفين
                </Link>
              </div>
              {bookingSettings.bookingEnabled &&
                bookingBranch.publicBookingEnabled &&
                bookingBranch.lifecycleStatus === 'PUBLIC_LIVE' ? (
                  <Link
                    href={`/book/${encodeURIComponent(bookingBranch.branchCode)}`}
                    target="_blank"
                    className="inline-flex text-xs text-success underline underline-offset-4"
                  >
                    فتح صفحة حجز العملاء
                  </Link>
                ) : (
                  <p className="text-xs text-warning">
                    الحجز العام لم يُنشر بعد. اضبط الخدمات والموظفين والمواعيد، ثم أكمل مراجعة جاهزية الفرع وتفعيله.
                    تغيير زر الحجز أدناه وحده لا ينشر الفرع.
                  </p>
                )}
            </div>
          )}

          {/* Online Booking Settings */}
          <Section title="إعدادات الحجز الأونلاين" icon={<CalendarDays size={14} />}>

            {/* Booking Enabled */}
            <Toggle
              label="السماح باستقبال الحجوزات"
              description="يعمل بعد تفعيل الفرع للحجز العام؛ هذا الزر وحده لا ينشر صفحة الحجز"
              checked={bookingSettings.bookingEnabled}
              onChange={v => setBooking('bookingEnabled', v)}
            />

            {/* Booking Modes */}
            <div className="border-t border-border pt-4 mt-4">
              <p className="text-sm font-medium text-foreground mb-3">طرق الحجز المتاحة</p>
              <div className="space-y-3">
                <Toggle
                  label="السماح باختيار حلاق محدد"
                  description="العميل يختار الحلاق المفضل"
                  checked={bookingSettings.allowSpecificBarber}
                  onChange={v => setBooking('allowSpecificBarber', v)}
                />
                <Toggle
                  label="السماح بأقرب حلاق متاح"
                  description="النظام يختار أول حلاق متاح"
                  checked={bookingSettings.allowNearestBarber}
                  onChange={v => setBooking('allowNearestBarber', v)}
                />
              </div>
            </div>

            {/* Default Mode */}
            <div className="border-t border-border pt-4 mt-4">
              <p className="text-sm font-medium text-foreground mb-2">الوضع الافتراضي</p>
              <div className="flex gap-2">
                {[
                  { value: 'nearest', label: 'أقرب حلاق متاح' },
                  { value: 'specific', label: 'اختيار حلاق محدد' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setBooking('defaultMode', opt.value as 'nearest' | 'specific')}
                    className="flex-1 py-2 rounded-xl border text-xs font-medium transition-all"
                    style={bookingSettings.defaultMode === opt.value
                      ? { borderColor: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 15%, transparent)', color: 'var(--primary)' }
                      : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--muted-foreground)' }
                    }
                  >{opt.label}</button>
                ))}
              </div>
            </div>

            {/* Time Settings */}
            <div className="border-t border-border pt-4 mt-4 space-y-4">
              <p className="text-sm font-medium text-foreground">إعدادات الوقت</p>

              {/* Min Notice Minutes */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">أقل مدة قبل الحجز</p>
                <p className="text-xs text-muted-foreground mb-2">تحدد أقل وقت بين الوقت الحالي وميعاد الحجز</p>
                <div className="flex gap-2 flex-wrap">
                  {minNoticeOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setBooking('minNoticeMinutes', opt.value)}
                      className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                      style={bookingSettings.minNoticeMinutes === opt.value
                        ? { borderColor: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 15%, transparent)', color: 'var(--primary)' }
                        : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--muted-foreground)' }
                      }
                    >{opt.label}</button>
                  ))}
                </div>
              </div>

              {/* Slot Interval */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">تقسيم المواعيد</p>
                <p className="text-xs text-muted-foreground mb-2">تحدد شكل تقسيم المواعيد في صفحة الحجز</p>
                <div className="flex gap-2 flex-wrap">
                  {slotIntervalOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setBooking('slotIntervalMinutes', opt.value)}
                      className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                      style={bookingSettings.slotIntervalMinutes === opt.value
                        ? { borderColor: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 15%, transparent)', color: 'var(--primary)' }
                        : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--muted-foreground)' }
                      }
                    >{opt.label}</button>
                  ))}
                </div>
              </div>

              {/* Max Booking Days Ahead */}
              <NumberInput
                label="أقصى عدد أيام للحجز المسبق"
                description="كم يوم يمكن للعميل الحجز مقدماً"
                value={bookingSettings.maxBookingDaysAhead}
                onChange={v => setBooking('maxBookingDaysAhead', v)}
                min={1} max={60} suffix=" يوم"
              />
            </div>

            {/* Salon Info */}
            <div className="border-t border-border pt-4 mt-4 space-y-3">
              <p className="text-sm font-medium text-foreground">بيانات الصالون</p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">اسم الصالون</label>
                <input
                  type="text"
                  value={bookingSettings.salonName}
                  onChange={e => setBooking('salonName', e.target.value)}
                  className="w-full bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground block mb-1">المنطقة الزمنية</label>
                  <input
                    type="text"
                    value={bookingSettings.timezone}
                    onChange={e => setBooking('timezone', e.target.value)}
                    className="w-full bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
                    placeholder="Africa/Cairo"
                  />
                </div>
                <div className="w-24">
                  <label className="text-xs text-muted-foreground block mb-1">العملة</label>
                  <input
                    type="text"
                    value={bookingSettings.currency}
                    onChange={e => setBooking('currency', e.target.value)}
                    className="w-full bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground text-center focus:outline-none focus:border-ring"
                    placeholder="EGP"
                  />
                </div>
              </div>
            </div>

            {/* Default Duration */}
            <div className="border-t border-border pt-4 mt-4">
              <NumberInput
                label="مدة الخدمة الافتراضية"
                description="تستخدم فقط لو خدمة ليس لها مدة محددة"
                value={bookingSettings.defaultServiceDurationMinutes}
                onChange={v => setBooking('defaultServiceDurationMinutes', v)}
                min={5} max={240} suffix=" د"
              />
            </div>

            {/* Save Button */}
            <div className="border-t border-border pt-4 mt-4">
              {bookingError && (
                <div className="mb-3 p-2 rounded-lg bg-destructive-soft border border-destructive/30 text-destructive text-xs">
                  {bookingError}
                </div>
              )}
              <button
                onClick={handleSaveBookingSettings}
                disabled={bookingSaving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                style={{ background: bookingSaved ? 'var(--success)' : 'var(--primary)', color: bookingSaved ? 'var(--success-foreground)' : 'var(--primary-foreground)' }}
              >
                {bookingSaving ? (
                  <><Loader2 size={14} className="animate-spin" /> جاري حفظ إعدادات الحجز...</>
                ) : bookingSaved ? (
                  <><CheckCircle2 size={14} /> تم حفظ إعدادات الحجز بنجاح</>
                ) : (
                  <><Save size={14} /> حفظ إعدادات الحجز</>
                )}
              </button>
            </div>
          </Section>

          {/* Queue number settings */}
          <Section title="إعدادات الطابور" icon={<Hash size={14} />}>

            <div className="space-y-1 mb-2">
              <label className="text-xs text-muted-foreground">بادئة رقم الطابور</label>
              <div className="flex gap-2 flex-wrap">
                {['A', 'B', 'C', 'Q', '#'].map(p => (
                  <button
                    key={p}
                    onClick={() => set('QueuePrefix', p)}
                    className="w-10 h-10 rounded-xl border font-bold text-sm transition-all"
                    style={settings.QueuePrefix === p
                      ? { borderColor: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 15%, transparent)', color: 'var(--primary)' }
                      : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--muted-foreground)' }
                    }
                  >{p}</button>
                ))}
                <input
                  value={!['A', 'B', 'C', 'Q', '#'].includes(settings.QueuePrefix) ? settings.QueuePrefix : ''}
                  onChange={e => set('QueuePrefix', e.target.value.slice(0, 3).toUpperCase() || 'A')}
                  placeholder="مخصص"
                  maxLength={3}
                  className="w-20 bg-card border border-border rounded-xl px-3 text-sm text-foreground text-center focus:outline-none focus:border-ring"
                />
              </div>
            </div>

            <NumberInput
              label="رقم البداية"
              description="هل يبدأ الترقيم من 0 أم 1"
              value={settings.QueueStartNumber}
              onChange={v => set('QueueStartNumber', v)}
              min={0} max={100}
            />

            <Toggle
              label="إعادة ترقيم يومياً"
              description="يُعاد الترقيم من البداية كل يوم"
              checked={settings.ResetQueueDaily}
              onChange={v => set('ResetQueueDaily', v)}
            />
          </Section>

          {/* Timing */}
          <Section title="توقيتات الخدمة" icon={<Clock size={14} />}>
            <NumberInput
              label="مدة الخدمة الافتراضية"
              description="دقائق لكل خدمة إذا لم تُحدد مدتها"
              value={settings.DefaultServiceMinutes}
              onChange={v => set('DefaultServiceMinutes', v)}
              min={5} max={240} suffix=" د"
            />
            <NumberInput
              label="مهلة الحجز (تأخر مسموح)"
              description="كم دقيقة يُسمح للعميل بالتأخر قبل اعتباره لم يحضر"
              value={settings.BookingGracePeriod}
              onChange={v => set('BookingGracePeriod', v)}
              min={0} max={60} suffix=" د"
            />
            <NumberInput
              label="تحديد الغياب تلقائياً بعد"
              description="تحويل الحجز لـ«لم يحضر» بعد هذه المدة من وقت الحجز"
              value={settings.AutoNoShowAfterMin}
              onChange={v => set('AutoNoShowAfterMin', v)}
              min={0} max={120} suffix=" د"
            />
          </Section>

          {/* Booking rules */}
          <Section title="قواعد الحجز" icon={<CalendarDays size={14} />}>
            <Toggle
              label="السماح بحجز مزدوج"
              description="السماح بحجزين متعارضين لنفس الحلاق في نفس الوقت"
              checked={settings.AllowDoubleBooking}
              onChange={v => set('AllowDoubleBooking', v)}
            />

            <div>
              <p className="text-sm font-medium text-foreground mb-1">نظام الأولوية</p>
              <p className="text-xs text-muted-foreground mb-2">كيف يُرتّب الطابور عند تساوي الوقت</p>
              <div className="flex gap-2">
                {[
                  { value: 'fifo', label: 'الأول يُخدَّم أولاً' },
                  { value: 'priority', label: 'حسب الأولوية' },
                  { value: 'booking', label: 'الحجوزات أولاً' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => set('BookingPriorityMode', opt.value)}
                    className="flex-1 py-2 rounded-xl border text-xs font-medium transition-all"
                    style={settings.BookingPriorityMode === opt.value
                      ? { borderColor: 'color-mix(in srgb, var(--brand) 50%, transparent)', background: 'color-mix(in srgb, var(--brand) 12%, transparent)', color: 'var(--brand)' }
                      : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--muted-foreground)' }
                    }
                  >{opt.label}</button>
                ))}
              </div>
            </div>
          </Section>

          {/* Voice test */}
          <Section title="اختبار النداء الصوتي" icon={<Volume2 size={14} />}>
            <p className="text-xs text-muted-foreground leading-relaxed">
              يُشغَّل النداء باستخدام Azure Speech (ar-EG-SalmaNeural) عبر الخادم.
              تأكد من ضبط <span className="text-warning font-mono">AZURE_SPEECH_KEY</span> في ملف <span className="font-mono">.env.local</span>.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleVoiceTest}
                disabled={voiceTesting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all disabled:opacity-50"
                style={{ borderColor: 'color-mix(in srgb, var(--brand) 40%, transparent)', color: 'var(--brand)', background: 'color-mix(in srgb, var(--brand) 8%, transparent)' }}
              >
                {voiceTesting
                  ? <><Loader2 size={13} className="animate-spin" /> جاري التشغيل...</>
                  : <><Volume2 size={13} /> اختبار النداء الصوتي</>}
              </button>
              {voiceToast && (
                <span
                  className="text-xs font-medium px-3 py-1.5 rounded-lg"
                  style={voiceToast.ok
                    ? { background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)' }
                    : { background: 'color-mix(in srgb, var(--destructive) 10%, transparent)', color: 'var(--destructive)', border: '1px solid color-mix(in srgb, var(--destructive) 25%, transparent)' }}
                >
                  {voiceToast.msg}
                </span>
              )}
            </div>
          </Section>

          {/* Migration section */}
          <Section title="جداول قاعدة البيانات" icon={<Database size={14} />}>
            <p className="text-xs text-muted-foreground leading-relaxed">
              شغّل هذه الميجرشن مرة واحدة لإضافة أعمدة الوقت التقديري إلى جدول التذاكر وإنشاء جدول خدمات التذاكر.
              مواعيد الموظفين موجودة بالفعل في نظام الموارد البشرية. آمنة للتشغيل أكثر من مرة.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleMigrate}
                disabled={migrating}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all disabled:opacity-50"
                style={{ borderColor: 'color-mix(in srgb, var(--info) 40%, transparent)', color: 'var(--info)', background: 'color-mix(in srgb, var(--info) 8%, transparent)' }}
              >
                {migrating
                  ? <><Loader2 size={13} className="animate-spin" /> جاري التنفيذ...</>
                  : <><Database size={13} /> تشغيل الميجرشن</>}
              </button>
              {migrateMsg && (
                <span
                  className="text-xs font-medium px-3 py-1.5 rounded-lg"
                  style={migrateMsg.ok
                    ? { background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)' }
                    : { background: 'color-mix(in srgb, var(--destructive) 10%, transparent)', color: 'var(--destructive)', border: '1px solid color-mix(in srgb, var(--destructive) 25%, transparent)' }}
                >
                  {migrateMsg.msg}
                </span>
              )}
            </div>
          </Section>

          {/* Info box */}
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
            <div className="flex items-start gap-2">
              <Shield size={14} className="text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">ملاحظة</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  لا تؤثر تغييرات الإعدادات على البيانات السابقة. يُطبَّق الترقيم الجديد فقط على التذاكر التي تُنشأ بعد الحفظ.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
