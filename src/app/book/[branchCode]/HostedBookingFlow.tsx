'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HostedBookingPageData } from '@/lib/booking/hostedBookingPage';

type Service = {
  serviceId: number;
  nameAr: string;
  price: number;
  durationMinutes: number;
  categoryNameAr: string;
};

type Slot = { time: string; dayOffset: 0 | 1 };

type Step = 'service' | 'slot' | 'details' | 'confirm' | 'done';

const STEPS: Array<{ key: Exclude<Step, 'done'>; label: string }> = [
  { key: 'service', label: 'الخدمة' },
  { key: 'slot', label: 'الموعد' },
  { key: 'details', label: 'بياناتك' },
  { key: 'confirm', label: 'التأكيد' },
];

const DAYS_AHEAD = 7;

function ymdInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function upcomingDates(timeZone: string): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = 0; i < DAYS_AHEAD; i++) out.push(ymdInZone(new Date(now + i * 86_400_000), timeZone));
  return [...new Set(out)];
}

function formatDateAr(ymd: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(
      new Date(`${ymd}T12:00:00Z`),
    );
  } catch {
    return ymd;
  }
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message || 'حدث خطأ، حاول مرة أخرى';
  } catch {
    return 'حدث خطأ، حاول مرة أخرى';
  }
}

export default function HostedBookingFlow({ data }: { data: HostedBookingPageData }) {
  const primary = data.brand.primaryColor ?? '#1f2937';
  const accent = data.brand.accentColor ?? primary;
  const dates = useMemo(() => upcomingDates(data.timezone), [data.timezone]);

  const [step, setStep] = useState<Step>('service');
  const [services, setServices] = useState<Service[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [date, setDate] = useState(dates[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestId] = useState(newRequestId);
  const [bookingCode, setBookingCode] = useState<string | null>(null);

  const branchQuery = `branchCode=${encodeURIComponent(data.branchCode)}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/public/booking/services?${branchQuery}`, { cache: 'no-store' });
      if (cancelled) return;
      if (!res.ok) {
        setError(await readError(res));
        setServices([]);
        return;
      }
      const body = (await res.json()) as { services?: Service[] };
      if (!cancelled) setServices(body.services ?? []);
    })().catch(() => {
      if (!cancelled) {
        setError('تعذر تحميل الخدمات');
        setServices([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [branchQuery]);

  const loadSlots = useCallback(
    async (forDate: string) => {
      setSlots(null);
      setSlot(null);
      setError(null);
      const qs = `${branchQuery}&date=${forDate}&serviceIds=${selected.join(',')}`;
      try {
        const res = await fetch(`/api/public/booking/available-slots?${qs}`, { cache: 'no-store' });
        if (!res.ok) {
          setError(await readError(res));
          setSlots([]);
          return;
        }
        const body = (await res.json()) as { slots?: Slot[]; messageAr?: string | null };
        setSlots(body.slots ?? []);
        if (!body.slots?.length && body.messageAr) setError(body.messageAr);
      } catch {
        setError('تعذر تحميل المواعيد');
        setSlots([]);
      }
    },
    [branchQuery, selected],
  );

  useEffect(() => {
    if (step === 'slot') void loadSlots(date);
  }, [step, date, loadSlots]);

  const chosen = (services ?? []).filter((s) => selected.includes(s.serviceId));
  const totalPrice = chosen.reduce((sum, s) => sum + s.price, 0);
  const totalMinutes = chosen.reduce((sum, s) => sum + s.durationMinutes, 0);
  const detailsValid = name.trim().length >= 2 && /^[0-9+\s-]{8,20}$/.test(phone.trim());

  async function confirm() {
    if (!slot) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/public/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
        body: JSON.stringify({
          branchCode: data.branchCode,
          date,
          time: slot.time,
          dayOffset: slot.dayOffset,
          serviceIds: selected,
          mode: 'any_barber',
          customer: { name: name.trim(), phone: phone.trim() },
          clientRequestId: requestId,
        }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const body = (await res.json()) as { booking?: { code?: string } };
      setBookingCode(body.booking?.code ?? null);
      setStep('done');
    } catch {
      setError('تعذر إتمام الحجز');
    } finally {
      setLoading(false);
    }
  }

  const button = (enabled: boolean) => ({
    backgroundColor: enabled ? primary : '#9ca3af',
    color: '#fff',
  });

  return (
    <div dir="rtl" lang="ar" className="min-h-[100dvh] overflow-y-auto bg-gray-50 text-gray-900">
      <header className="px-4 py-5 text-white" style={{ backgroundColor: primary }}>
        <div className="mx-auto flex max-w-xl items-center gap-3">
          {data.brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.brand.logoUrl} alt={data.brand.displayName} className="h-12 w-12 rounded-full bg-white object-contain" />
          ) : null}
          <div>
            <h1 className="text-xl font-bold">{data.brand.displayName}</h1>
            <p className="text-sm opacity-90">{data.branchName}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 p-4">
        {step !== 'done' ? (
          <ol className="flex justify-between text-xs">
            {STEPS.map((s) => (
              <li
                key={s.key}
                className="flex-1 border-b-4 pb-1 text-center"
                style={{ borderColor: s.key === step ? accent : '#e5e7eb' }}
              >
                {s.label}
              </li>
            ))}
          </ol>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {step === 'service' ? (
          <section className="space-y-2">
            <h2 className="font-semibold">اختر الخدمة</h2>
            {services === null ? <p className="text-sm text-gray-500">جارٍ التحميل…</p> : null}
            {services?.map((s) => {
              const on = selected.includes(s.serviceId);
              return (
                <label
                  key={s.serviceId}
                  className="flex cursor-pointer items-center justify-between rounded-lg border bg-white p-3"
                  style={{ borderColor: on ? accent : '#e5e7eb' }}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSelected((cur) => (on ? cur.filter((x) => x !== s.serviceId) : [...cur, s.serviceId]))
                      }
                    />
                    <span>{s.nameAr}</span>
                  </span>
                  <span className="text-sm text-gray-600">
                    {s.price} ج.م · {s.durationMinutes} د
                  </span>
                </label>
              );
            })}
            <button
              type="button"
              disabled={!selected.length}
              onClick={() => setStep('slot')}
              className="w-full rounded-lg py-3 font-semibold"
              style={button(selected.length > 0)}
            >
              التالي
            </button>
          </section>
        ) : null}

        {step === 'slot' ? (
          <section className="space-y-3">
            <h2 className="font-semibold">اختر اليوم والوقت</h2>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {dates.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDate(d)}
                  className="shrink-0 rounded-lg border px-3 py-2 text-sm"
                  style={d === date ? { borderColor: accent, color: accent } : undefined}
                >
                  {formatDateAr(d)}
                </button>
              ))}
            </div>
            {slots === null ? <p className="text-sm text-gray-500">جارٍ التحميل…</p> : null}
            {slots?.length === 0 && !error ? <p className="text-sm text-gray-500">لا توجد مواعيد متاحة في هذا اليوم</p> : null}
            <div className="grid grid-cols-4 gap-2">
              {slots?.map((s) => {
                const on = slot?.time === s.time && slot.dayOffset === s.dayOffset;
                return (
                  <button
                    key={`${s.dayOffset}-${s.time}`}
                    type="button"
                    onClick={() => setSlot(s)}
                    className="rounded-md border bg-white py-2 text-sm"
                    style={on ? { backgroundColor: accent, color: '#fff', borderColor: accent } : undefined}
                  >
                    {s.time}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep('service')} className="flex-1 rounded-lg border py-3">
                رجوع
              </button>
              <button
                type="button"
                disabled={!slot}
                onClick={() => setStep('details')}
                className="flex-1 rounded-lg py-3 font-semibold"
                style={button(Boolean(slot))}
              >
                التالي
              </button>
            </div>
          </section>
        ) : null}

        {step === 'details' ? (
          <section className="space-y-3">
            <h2 className="font-semibold">بياناتك</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="الاسم"
              autoComplete="name"
              className="w-full rounded-lg border bg-white p-3"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="رقم الموبايل"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              className="w-full rounded-lg border bg-white p-3 text-right"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep('slot')} className="flex-1 rounded-lg border py-3">
                رجوع
              </button>
              <button
                type="button"
                disabled={!detailsValid}
                onClick={() => setStep('confirm')}
                className="flex-1 rounded-lg py-3 font-semibold"
                style={button(detailsValid)}
              >
                التالي
              </button>
            </div>
          </section>
        ) : null}

        {step === 'confirm' && slot ? (
          <section className="space-y-3">
            <h2 className="font-semibold">تأكيد الحجز</h2>
            <dl className="space-y-1 rounded-lg border bg-white p-3 text-sm">
              <div className="flex justify-between"><dt>الفرع</dt><dd>{data.branchName}</dd></div>
              <div className="flex justify-between"><dt>الخدمات</dt><dd>{chosen.map((s) => s.nameAr).join('، ')}</dd></div>
              <div className="flex justify-between"><dt>الموعد</dt><dd>{formatDateAr(date)} — {slot.time}</dd></div>
              <div className="flex justify-between"><dt>المدة</dt><dd>{totalMinutes} دقيقة</dd></div>
              <div className="flex justify-between"><dt>الإجمالي</dt><dd>{totalPrice} ج.م</dd></div>
              <div className="flex justify-between"><dt>الاسم</dt><dd>{name}</dd></div>
              <div className="flex justify-between"><dt>الموبايل</dt><dd dir="ltr">{phone}</dd></div>
            </dl>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep('details')} className="flex-1 rounded-lg border py-3">
                رجوع
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void confirm()}
                className="flex-1 rounded-lg py-3 font-semibold"
                style={button(!loading)}
              >
                {loading ? 'جارٍ الحجز…' : 'تأكيد الحجز'}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'done' ? (
          <section className="space-y-2 rounded-lg border bg-white p-4 text-center">
            <h2 className="text-lg font-bold" style={{ color: accent }}>تم تأكيد حجزك</h2>
            {bookingCode ? (
              <p>
                رقم الحجز: <strong dir="ltr">{bookingCode}</strong>
              </p>
            ) : null}
            <p className="text-sm text-gray-600">
              {formatDateAr(date)} — {slot?.time} · {data.branchName}
            </p>
            {data.phone ? <p className="text-sm text-gray-600">للاستفسار: <span dir="ltr">{data.phone}</span></p> : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
