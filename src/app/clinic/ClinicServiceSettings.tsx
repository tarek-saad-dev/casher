'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarDays, Clock3, RefreshCw, Search, Stethoscope, Wallet } from 'lucide-react';
import {
  clinicPriceUpdate, selectSharedServices, type ClinicSharedService,
} from '@/apps/medical-records/application/clinicSharedCatalog';

type PriceDrafts = Record<number, string>;

export default function ClinicServiceSettings() {
  const [services, setServices] = useState<ClinicSharedService[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<PriceDrafts>({});
  const [search, setSearch] = useState('');
  const [suggestedOnly, setSuggestedOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch('/api/services', { signal, cache: 'no-store' });
      const payload: unknown = await response.json();
      if (!response.ok || !Array.isArray(payload)) throw new Error('تعذر تحميل كتالوج الخدمات المشترك');
      if (signal?.aborted) return;
      const rows = payload as ClinicSharedService[];
      setServices(rows);
      setPriceDrafts(Object.fromEntries(rows.map(row => [row.ProID, String(row.SPrice1 ?? '')])));
      setError(null);
    } catch (err) {
      if (!signal?.aborted) {
        setServices([]);
        setError(err instanceof Error ? err.message : 'تعذر تحميل الخدمات');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const visible = useMemo(
    () => selectSharedServices(services, { suggestedOnly, search }),
    [services, suggestedOnly, search],
  );
  const suggestedCount = useMemo(
    () => selectSharedServices(services, { suggestedOnly: true }).length,
    [services],
  );

  async function save(service: ClinicSharedService) {
    if (savingId !== null) return;
    const parsed = clinicPriceUpdate(service, priceDrafts[service.ProID] ?? '');
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSavingId(service.ProID);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/services/${service.ProID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.value),
      });
      const payload = (await response.json()) as ClinicSharedService & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'تعذر تحديث سعر الخدمة');
      // Keep the server response as the source of truth for subsequent edits.
      setServices(current => current.map(row => row.ProID === service.ProID
        ? { ...row, ...payload } : row));
      setPriceDrafts(current => ({ ...current, [service.ProID]: String(payload.SPrice1) }));
      setNotice(`تم تحديث سعر ${service.ProNameAr || service.ProName} في كتالوج الخدمات المشترك.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ السعر');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black">
              <Wallet className="h-5 w-5 text-cyan-700" />
              خدمات الكشف وأسعارها
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              الخدمات دي جاية من كتالوج DRVO ERP المشترك. تعديل السعر هنا بيحدث نفس الخدمة
              المستخدمة في Booking وPOS، مش نسخة تانية خاصة بالعيادات.
            </p>
          </div>
          <button
            type="button"
            aria-label="تحديث خدمات العيادة"
            disabled={loading || savingId !== null}
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" /> تحديث
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[210px] flex-1">
            <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
            <input
              aria-label="بحث خدمات العيادة"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="اسم الخدمة أو رقمها..."
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-3 pr-10 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={suggestedOnly}
              onChange={event => setSuggestedOnly(event.target.checked)}
              className="accent-cyan-700"
            />
            خدمات الكشف والمتابعة المقترحة ({suggestedCount})
          </label>
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}

        {loading ? (
          <p className="mt-5 text-sm text-slate-500">جاري تحميل الأسعار…</p>
        ) : visible.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
            <p className="text-sm font-semibold">مفيش خدمات مطابقة.</p>
            <p className="mt-2 text-xs text-slate-500">لو الخدمة جديدة، ضيفها مرة واحدة في كتالوج الخدمات المشترك.</p>
            <button type="button" className="mt-3 text-xs font-bold text-cyan-700" onClick={() => { setSuggestedOnly(false); setSearch(''); }}>
              عرض كل الخدمات
            </button>
          </div>
        ) : (
          <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
            {visible.map(service => {
              const initial = Number(service.SPrice1 ?? 0);
              const draft = priceDrafts[service.ProID] ?? '';
              const changed = draft.trim() !== String(service.SPrice1 ?? '');
              return (
                <div key={service.ProID} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-[150px] flex-1">
                    <p className="text-sm font-bold text-slate-900">{service.ProNameAr || service.ProName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {service.ProNameAr ? `${service.ProName} · ` : ''}
                      {service.CatName || 'بدون تصنيف'} · #{service.ProID}
                      {service.DurationMinutes ? ` · ${service.DurationMinutes} دقيقة` : ''}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <span>السعر</span>
                    <input
                      aria-label={`سعر خدمة ${service.ProNameAr || service.ProName}`}
                      type="text"
                      inputMode="decimal"
                      value={draft}
                      onChange={event => setPriceDrafts(current => ({ ...current, [service.ProID]: event.target.value }))}
                      className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-left tabular-nums"
                      dir="ltr"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={savingId !== null || !changed}
                    onClick={() => void save(service)}
                    className="rounded-xl bg-cyan-700 px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  >{savingId === service.ProID ? 'جاري الحفظ…' : 'حفظ السعر'}</button>
                  <span className="sr-only">السعر السابق {initial}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs leading-6 text-slate-500">
          قائمة «المقترحة» مجرد فلتر بالاسم والتصنيف، مش تعريف رسمي للخدمات الطبية.
          لإضافة خدمة أو تعديل مدتها أو تصنيفها استخدم إدارة الخدمات المشتركة.
        </p>
        <Link href="/admin/services" className="mt-2 inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-xs font-bold text-cyan-800">
          <BookOpen className="h-4 w-4" /> إدارة كتالوج الخدمات الكامل
        </Link>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-black">
            <Clock3 className="h-4 w-4 text-cyan-700" /> جداول ومواعيد الأطباء
          </h3>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            ساعات العمل والإجازات وتوافر الحجز مصدرها Workforce المشترك،
            وأي تعديل بيظهر على جدول الطبيب ومحرك Booking.
          </p>
          <Link href="/admin/workforce/availability" className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-cyan-800">
            فتح جدول التوافر <CalendarDays className="h-4 w-4" />
          </Link>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-black">
            <Stethoscope className="h-4 w-4 text-cyan-700" /> الأطباء والتخصصات
          </h3>
          <p className="mt-2 text-xs leading-6 text-slate-500">
            إدارة بيانات الأطباء والتخصصات وربط حساب الطبيب من صفحة إدارة المرضى والأطباء الموجودة.
          </p>
          <Link href="/clinic/setup" className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-cyan-800">
            إدارة الأطباء
          </Link>
        </div>
      </section>
    </div>
  );
}
