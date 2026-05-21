'use client';

import { useState, useEffect } from 'react';
import {
  Settings, Save, Loader2, CheckCircle2, AlertCircle,
  Hash, Clock, CalendarDays, Shield, ArrowRight, Volume2, Database,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
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
  salonName: "Cut Salon",
  timezone: "Africa/Cairo",
  currency: "EGP",
  bookingEnabled: true,
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
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="relative w-11 h-6 rounded-full transition-colors shrink-0 mt-0.5"
        style={{ background: checked ? '#D6A84F' : '#374151' }}
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
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-all flex items-center justify-center font-bold text-sm"
        >−</button>
        <span className="w-10 text-center text-sm font-bold text-white">{value}{suffix}</span>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-all flex items-center justify-center font-bold text-sm"
        >+</button>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-5 space-y-4" style={{ background: '#141418', borderColor: '#2A2A35' }}>
      <div className="flex items-center gap-2 pb-2 border-b border-zinc-800">
        <div className="text-amber-400">{icon}</div>
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function QueueBookingSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<QueueSettings>(DEFAULT_SETTINGS);
  const [bookingSettings, setBookingSettings] = useState<BookingSettings>(DEFAULT_BOOKING_SETTINGS);
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
      await speakWithAzure('عميلنا طارق سعد، يتفضل يتوجه إلى الأستاذ كريم.');
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
    <div className="flex items-center justify-center h-full bg-zinc-950">
      <Loader2 className="animate-spin text-amber-400" size={28} />
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-zinc-950" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all">
            <ArrowRight size={16} />
          </button>
          <div>
            <h1 className="text-base font-black text-white">إعدادات الطابور والحجوزات</h1>
            <p className="text-xs text-zinc-500">تخصيص نظام الانتظار والحجوزات</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
          style={{ background: saved ? '#10B981' : 'linear-gradient(135deg,#D6A84F,#B8923A)', color: saved ? '#fff' : '#000' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> :
            saved ? <CheckCircle2 size={14} /> :
              <Save size={14} />}
          {saving ? 'جاري الحفظ...' : saved ? 'تم الحفظ' : 'حفظ الإعدادات'}
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm shrink-0">
          <AlertCircle size={14} />{error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-luxury-v">
        <div className="max-w-2xl mx-auto p-6 space-y-5">

          {/* Preview */}
          <div
            className="rounded-2xl border p-5 flex items-center justify-between"
            style={{ background: 'rgba(214,168,79,0.08)', borderColor: 'rgba(214,168,79,0.3)' }}
          >
            <div>
              <p className="text-xs text-amber-400/70 mb-1">معاينة — أول تذكرة اليوم</p>
              <p className="text-4xl font-black" style={{ color: '#D6A84F', textShadow: '0 0 30px rgba(214,168,79,0.4)' }}>
                {previewCode}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-500">البادئة: <span className="text-white font-bold">{settings.QueuePrefix}</span></p>
              <p className="text-xs text-zinc-500 mt-1">يبدأ من: <span className="text-white font-bold">{settings.QueueStartNumber}</span></p>
            </div>
          </div>

          {/* Online Booking Settings */}
          <Section title="إعدادات الحجز الأونلاين" icon={<CalendarDays size={14} />}>

            {/* Booking Enabled */}
            <Toggle
              label="تفعيل الحجز من الموقع"
              description="عند الإيقاف، لن يستطيع العملاء إنشاء حجوزات جديدة من الموقع"
              checked={bookingSettings.bookingEnabled}
              onChange={v => setBooking('bookingEnabled', v)}
            />

            {/* Booking Modes */}
            <div className="border-t border-zinc-800 pt-4 mt-4">
              <p className="text-sm font-medium text-white mb-3">طرق الحجز المتاحة</p>
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
            <div className="border-t border-zinc-800 pt-4 mt-4">
              <p className="text-sm font-medium text-white mb-2">الوضع الافتراضي</p>
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
                      ? { borderColor: '#D6A84F', background: 'rgba(214,168,79,0.15)', color: '#D6A84F' }
                      : { borderColor: '#2A2A35', background: 'transparent', color: '#6B7280' }
                    }
                  >{opt.label}</button>
                ))}
              </div>
            </div>

            {/* Time Settings */}
            <div className="border-t border-zinc-800 pt-4 mt-4 space-y-4">
              <p className="text-sm font-medium text-white">إعدادات الوقت</p>

              {/* Min Notice Minutes */}
              <div>
                <p className="text-xs text-zinc-400 mb-2">أقل مدة قبل الحجز</p>
                <p className="text-xs text-zinc-600 mb-2">تحدد أقل وقت بين الوقت الحالي وميعاد الحجز</p>
                <div className="flex gap-2 flex-wrap">
                  {minNoticeOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setBooking('minNoticeMinutes', opt.value)}
                      className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                      style={bookingSettings.minNoticeMinutes === opt.value
                        ? { borderColor: '#D6A84F', background: 'rgba(214,168,79,0.15)', color: '#D6A84F' }
                        : { borderColor: '#2A2A35', background: 'transparent', color: '#6B7280' }
                      }
                    >{opt.label}</button>
                  ))}
                </div>
              </div>

              {/* Slot Interval */}
              <div>
                <p className="text-xs text-zinc-400 mb-2">تقسيم المواعيد</p>
                <p className="text-xs text-zinc-600 mb-2">تحدد شكل تقسيم المواعيد في صفحة الحجز</p>
                <div className="flex gap-2 flex-wrap">
                  {slotIntervalOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setBooking('slotIntervalMinutes', opt.value)}
                      className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                      style={bookingSettings.slotIntervalMinutes === opt.value
                        ? { borderColor: '#D6A84F', background: 'rgba(214,168,79,0.15)', color: '#D6A84F' }
                        : { borderColor: '#2A2A35', background: 'transparent', color: '#6B7280' }
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
            <div className="border-t border-zinc-800 pt-4 mt-4 space-y-3">
              <p className="text-sm font-medium text-white">بيانات الصالون</p>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">اسم الصالون</label>
                <input
                  type="text"
                  value={bookingSettings.salonName}
                  onChange={e => setBooking('salonName', e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-zinc-400 block mb-1">المنطقة الزمنية</label>
                  <input
                    type="text"
                    value={bookingSettings.timezone}
                    onChange={e => setBooking('timezone', e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                    placeholder="Africa/Cairo"
                  />
                </div>
                <div className="w-24">
                  <label className="text-xs text-zinc-400 block mb-1">العملة</label>
                  <input
                    type="text"
                    value={bookingSettings.currency}
                    onChange={e => setBooking('currency', e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white text-center focus:outline-none focus:border-amber-500/50"
                    placeholder="EGP"
                  />
                </div>
              </div>
            </div>

            {/* Default Duration */}
            <div className="border-t border-zinc-800 pt-4 mt-4">
              <NumberInput
                label="مدة الخدمة الافتراضية"
                description="تستخدم فقط لو خدمة ليس لها مدة محددة"
                value={bookingSettings.defaultServiceDurationMinutes}
                onChange={v => setBooking('defaultServiceDurationMinutes', v)}
                min={5} max={240} suffix=" د"
              />
            </div>

            {/* Save Button */}
            <div className="border-t border-zinc-800 pt-4 mt-4">
              {bookingError && (
                <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {bookingError}
                </div>
              )}
              <button
                onClick={handleSaveBookingSettings}
                disabled={bookingSaving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                style={{ background: bookingSaved ? '#10B981' : '#D6A84F', color: bookingSaved ? '#fff' : '#000' }}
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
              <label className="text-xs text-zinc-400">بادئة رقم الطابور</label>
              <div className="flex gap-2 flex-wrap">
                {['A', 'B', 'C', 'Q', '#'].map(p => (
                  <button
                    key={p}
                    onClick={() => set('QueuePrefix', p)}
                    className="w-10 h-10 rounded-xl border font-bold text-sm transition-all"
                    style={settings.QueuePrefix === p
                      ? { borderColor: '#D6A84F', background: 'rgba(214,168,79,0.15)', color: '#D6A84F' }
                      : { borderColor: '#2A2A35', background: 'transparent', color: '#6B7280' }
                    }
                  >{p}</button>
                ))}
                <input
                  value={!['A', 'B', 'C', 'Q', '#'].includes(settings.QueuePrefix) ? settings.QueuePrefix : ''}
                  onChange={e => set('QueuePrefix', e.target.value.slice(0, 3).toUpperCase() || 'A')}
                  placeholder="مخصص"
                  maxLength={3}
                  className="w-20 bg-zinc-900 border border-zinc-700 rounded-xl px-3 text-sm text-white text-center focus:outline-none focus:border-amber-500/50"
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
              <p className="text-sm font-medium text-white mb-1">نظام الأولوية</p>
              <p className="text-xs text-zinc-500 mb-2">كيف يُرتّب الطابور عند تساوي الوقت</p>
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
                      ? { borderColor: 'rgba(99,102,241,0.5)', background: 'rgba(99,102,241,0.12)', color: '#A5B4FC' }
                      : { borderColor: '#2A2A35', background: 'transparent', color: '#6B7280' }
                    }
                  >{opt.label}</button>
                ))}
              </div>
            </div>
          </Section>

          {/* Voice test */}
          <Section title="اختبار النداء الصوتي" icon={<Volume2 size={14} />}>
            <p className="text-xs text-zinc-500 leading-relaxed">
              يُشغَّل النداء باستخدام Azure Speech (ar-EG-SalmaNeural) عبر الخادم.
              تأكد من ضبط <span className="text-amber-400 font-mono">AZURE_SPEECH_KEY</span> في ملف <span className="font-mono">.env.local</span>.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleVoiceTest}
                disabled={voiceTesting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all disabled:opacity-50"
                style={{ borderColor: 'rgba(167,139,250,0.4)', color: '#A78BFA', background: 'rgba(167,139,250,0.08)' }}
              >
                {voiceTesting
                  ? <><Loader2 size={13} className="animate-spin" /> جاري التشغيل...</>
                  : <><Volume2 size={13} /> اختبار النداء الصوتي</>}
              </button>
              {voiceToast && (
                <span
                  className="text-xs font-medium px-3 py-1.5 rounded-lg"
                  style={voiceToast.ok
                    ? { background: 'rgba(16,185,129,0.12)', color: '#34D399', border: '1px solid rgba(16,185,129,0.25)' }
                    : { background: 'rgba(239,68,68,0.1)', color: '#F87171', border: '1px solid rgba(239,68,68,0.25)' }}
                >
                  {voiceToast.msg}
                </span>
              )}
            </div>
          </Section>

          {/* Migration section */}
          <Section title="جداول قاعدة البيانات" icon={<Database size={14} />}>
            <p className="text-xs text-zinc-500 leading-relaxed">
              شغّل هذه الميجرشن مرة واحدة لإضافة أعمدة الوقت التقديري إلى جدول التذاكر وإنشاء جدول خدمات التذاكر.
              مواعيد الموظفين موجودة بالفعل في نظام الموارد البشرية. آمنة للتشغيل أكثر من مرة.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleMigrate}
                disabled={migrating}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all disabled:opacity-50"
                style={{ borderColor: 'rgba(59,130,246,0.4)', color: '#60A5FA', background: 'rgba(59,130,246,0.08)' }}
              >
                {migrating
                  ? <><Loader2 size={13} className="animate-spin" /> جاري التنفيذ...</>
                  : <><Database size={13} /> تشغيل الميجرشن</>}
              </button>
              {migrateMsg && (
                <span
                  className="text-xs font-medium px-3 py-1.5 rounded-lg"
                  style={migrateMsg.ok
                    ? { background: 'rgba(16,185,129,0.12)', color: '#34D399', border: '1px solid rgba(16,185,129,0.25)' }
                    : { background: 'rgba(239,68,68,0.1)', color: '#F87171', border: '1px solid rgba(239,68,68,0.25)' }}
                >
                  {migrateMsg.msg}
                </span>
              )}
            </div>
          </Section>

          {/* Info box */}
          <div className="rounded-xl border p-4" style={{ borderColor: '#2A2A35', background: '#141418' }}>
            <div className="flex items-start gap-2">
              <Shield size={14} className="text-zinc-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-zinc-400 mb-1">ملاحظة</p>
                <p className="text-xs text-zinc-600 leading-relaxed">
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
