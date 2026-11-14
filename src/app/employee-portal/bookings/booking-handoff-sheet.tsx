'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MaskedPortalBooking } from '@/lib/employee-portal/bookingPrivacy';

type DetailService = {
  proId: number;
  name: string;
  qty: number;
  source: 'booked' | 'added';
  selected: boolean;
};

type CatalogService = {
  proId: number;
  name: string;
  durationMinutes: number | null;
};

type AddonPreview = {
  available: boolean;
  durationMinutes: number;
  expectedEndAt: string;
  proposedEndAt: string;
  reason?: string;
  alternatives: Array<{ empId: number; empName: string; startAt: string; endAt: string }>;
};


type Props = {
  booking: MaskedPortalBooking;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
};

export default function BookingHandoffSheet({ booking, open, onClose, onSent }: Props) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalog, setCatalog] = useState<CatalogService[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [addonCandidate, setAddonCandidate] = useState<CatalogService | null>(null);
  const [addonPreview, setAddonPreview] = useState<AddonPreview | null>(null);
  const [addonChecking, setAddonChecking] = useState(false);
  const [addonCommitting, setAddonCommitting] = useState(false);
  const [lines, setLines] = useState<DetailService[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [canSend, setCanSend] = useState(true);
  const [handoffPending, setHandoffPending] = useState(booking.handoffStatus === 'pending');
  const [displayEndTime, setDisplayEndTime] = useState(booking.endTime);
  const [staffPhase, setStaffPhase] = useState(booking.staffPhase ?? 'scheduled');
  const [phaseSaving, setPhaseSaving] = useState(false);

  const selectedCount = useMemo(
    () => lines.filter((l) => l.selected).reduce((n, l) => n + l.qty, 0),
    [lines],
  );

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/employee-portal/bookings/${booking.bookingId}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      const detail = data.booking as {
        services: Array<{ proId: number; name: string; qty: number; source: 'booked' }>;
        canSend: boolean;
        readOnly: boolean;
        handoffStatus: string;
        endTime?: string;
        staffPhase?: 'scheduled' | 'arrived' | 'in_service' | 'finished';
      };
      setLines(
        (detail.services ?? []).map((s) => ({
          proId: s.proId,
          name: s.name,
          qty: s.qty,
          source: 'booked',
          selected: true,
        })),
      );
      setDisplayEndTime(detail.endTime || booking.endTime);
      setStaffPhase(detail.staffPhase ?? 'scheduled');
      setCanSend(Boolean(detail.canSend));
      setReadOnly(Boolean(detail.readOnly));
      setHandoffPending(detail.handoffStatus === 'pending');
    } catch {
      setError('تعذر تحميل تفاصيل الحجز');
    } finally {
      setLoading(false);
    }
  }, [booking.bookingId]);

  useEffect(() => {
    if (!open) return;
    void loadDetail();
    setConfirmOpen(false);
    setCatalogOpen(false);
    setAddonCandidate(null);
    setAddonPreview(null);
    setDisplayEndTime(booking.endTime);
    setStaffPhase(booking.staffPhase ?? 'scheduled');
    setToast('');
  }, [open, loadDetail]);

  const loadCatalog = useCallback(async (q: string) => {
    setCatalogLoading(true);
    try {
      const res = await fetch(
        `/api/employee-portal/services?q=${encodeURIComponent(q)}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error('failed');
      setCatalog(Array.isArray(data.services) ? data.services : []);
    } catch {
      setCatalog([]);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!catalogOpen) return;
    const id = window.setTimeout(() => void loadCatalog(catalogQuery), 200);
    return () => window.clearTimeout(id);
  }, [catalogOpen, catalogQuery, loadCatalog]);


  async function advancePhase(action: 'arrive' | 'start' | 'finish') {
    if (phaseSaving || readOnly || handoffPending) return;
    setPhaseSaving(true);
    setError('');
    try {
      const res = await fetch('/api/employee-portal/bookings/' + booking.bookingId + '/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'تعذر تحديث حالة الخدمة');
      setStaffPhase(result.phase);
      await loadDetail();
      setToast(action === 'arrive' ? 'تم تأكيد وصول العميل'
        : action === 'start' ? 'تم تسجيل بدء الخدمة'
        : 'تم تأكيد انتهاء الخدمة — جاهزة للإرسال للكاشير');
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث حالة الخدمة');
    } finally {
      setPhaseSaving(false);
    }
  }

  async function checkAddon(service: CatalogService) {
    if (readOnly || !canSend || addonChecking || addonCommitting) return;
    setError('');
    setToast('');
    setAddonCandidate(service);
    setAddonPreview(null);
    setAddonChecking(true);
    try {
      const res = await fetch(
        '/api/employee-portal/bookings/' + booking.bookingId + '/addon?proId=' + service.proId,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر التحقق من وقت الخدمة');
      setAddonPreview(data as AddonPreview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر التحقق — راجع الكاشير');
    } finally {
      setAddonChecking(false);
    }
  }

  async function confirmAddon() {
    if (!addonCandidate || !addonPreview?.available || addonCommitting) return;
    setError('');
    setAddonCommitting(true);
    try {
      const res = await fetch(
        '/api/employee-portal/bookings/' + booking.bookingId + '/addon',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proId: addonCandidate.proId,
            expectedEndAt: addonPreview.expectedEndAt,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر حجز وقت الخدمة');
      // The service is not selected until the server has saved a real slot.
      setAddonCandidate(null);
      setAddonPreview(null);
      setCatalogOpen(false);
      setCatalogQuery('');
      await loadDetail();
      setToast('تم حجز وقت الخدمة الإضافية وتحديث موعد العميل');
    } catch (err) {
      setAddonPreview(null);
      setError(err instanceof Error ? err.message : 'الوقت لم يعد متاحًا — أعد فحص الخدمة');
    } finally {
      setAddonCommitting(false);
    }
  }

  function formatCandidateTime(iso: string) {
    const date = new Date(iso);
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit',
    }).format(date);
  }

  if (!open) return null;

  const muted = readOnly || !canSend;

  async function submitHandoff() {
    setSending(true);
    setError('');
    try {
      const services = lines
        .filter((l) => l.selected)
        .map((l) => ({
          proId: l.proId,
          qty: l.qty,
          source: l.source,
        }));
      const res = await fetch(`/api/employee-portal/bookings/${booking.bookingId}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      setToast('اتبعت للكاشير');
      setConfirmOpen(false);
      setHandoffPending(true);
      onSent();
      window.setTimeout(() => onClose(), 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر الإرسال');
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" dir="rtl">
      <button type="button" aria-label="إغلاق" className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl sm:rounded-3xl">
        <header className="shrink-0 border-b border-white/10 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-extrabold tracking-wide" dir="ltr">
                {booking.startTime}
                {displayEndTime ? (
                  <span className="text-sm font-semibold text-zinc-400"> – {displayEndTime}</span>
                ) : null}
              </p>
              <p className="mt-1 text-sm font-bold text-amber-200">{booking.firstName}</p>
              {booking.branchName ? (
                <p className="mt-0.5 text-xs text-zinc-500">{booking.branchName}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-zinc-300"
            >
              رجوع
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {toast ? (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {toast}
            </p>
          ) : null}
          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
          {loading ? <p className="text-sm text-zinc-400">جاري التحميل…</p> : null}

          {!loading && readOnly ? (
            <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300">
              {booking.handoffStatus === 'charged' || readOnly
                ? 'تم التحصيل — العرض فقط'
                : 'لا يمكن إرسال هذا الحجز'}
            </p>
          ) : null}

          {!loading ? (
            <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="mb-2 text-xs font-bold text-amber-200">حالة خدمة العميل</p>
              <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
                {(['scheduled','arrived','in_service','finished'] as const).map((phase) => (
                  <span key={phase} className={
                    "rounded-lg px-2 py-1 " +
                    (phase === staffPhase ? "bg-amber-400 text-zinc-950" : "bg-white/5 text-zinc-400")
                  }>
                    {{
                      scheduled: 'محجوز', arrived: 'وصل', in_service: 'جارٍ التنفيذ',
                      finished: 'تم التنفيذ',
                    }[phase]}
                  </span>
                ))}
              </div>
              {!readOnly && !handoffPending && staffPhase !== 'finished' ? (
                <button
                  type="button"
                  disabled={phaseSaving}
                  onClick={() => void advancePhase(
                    staffPhase === 'scheduled' ? 'arrive' : staffPhase === 'arrived' ? 'start' : 'finish'
                  )}
                  className="w-full rounded-xl bg-amber-400 px-3 py-2.5 text-sm font-bold text-zinc-950 disabled:opacity-50"
                >
                  {phaseSaving ? 'جاري الحفظ…' :
                    staffPhase === 'scheduled' ? 'تأكيد وصول العميل' :
                    staffPhase === 'arrived' ? 'بدء الخدمة' : 'إنهاء الخدمة'}
                </button>
              ) : (
                <p className="text-xs text-zinc-300">
                  {staffPhase === 'finished' ? 'الخدمة منتهية — راجع الخدمات قبل إرسالها للكاشير'
                    : 'الطلب عند الكاشير بالفعل'}
                </p>
              )}
            </section>
          ) : null}

          {!loading ? (
            <section className="space-y-2">
              <h2 className="text-xs font-bold text-zinc-400">الخدمات</h2>
              {lines.length === 0 ? (
                <p className="text-sm text-zinc-500">مفيش خدمات محجوزة — أضف خدمة</p>
              ) : (
                <ul className="space-y-2">
                  {lines.map((line, idx) => (
                    <li
                      key={`${line.proId}-${idx}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-900/70 px-3 py-2"
                    >
                      <label className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={muted}
                          checked={line.selected}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setLines((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, selected: checked } : p)),
                            );
                          }}
                          className="h-4 w-4 accent-amber-400"
                        />
                        <span className="truncate text-sm font-semibold text-zinc-100">
                          {line.name}
                          {line.source === 'added' ? (
                            <span className="ms-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-200">
                              مضافة
                            </span>
                          ) : null}
                        </span>
                      </label>
                      <span className="text-xs text-zinc-500">×{line.qty}</span>
                    </li>
                  ))}
                </ul>
              )}

              {!muted ? (
                <button
                  type="button"
                  onClick={() => setCatalogOpen((v) => !v)}
                  className="w-full rounded-xl border border-dashed border-amber-500/30 px-3 py-2 text-sm font-semibold text-amber-200"
                >
                  {catalogOpen ? 'إغلاق قائمة الإضافة' : 'إضافة خدمة'}
                </button>
              ) : null}

              {catalogOpen && !muted ? (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-zinc-900/50 p-3">
                  <input
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    placeholder="بحث عن خدمة…"
                    className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/40"
                  />
                  {catalogLoading ? <p className="text-xs text-zinc-500">جاري البحث…</p> : null}
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {catalog.map((svc) => (
                      <li key={svc.proId}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-zinc-200 hover:bg-white/5"
                          disabled={addonChecking || addonCommitting}
                          onClick={() => void checkAddon(svc)}
                        >
                          <span>{svc.name}</span>
                          {svc.durationMinutes != null ? (
                            <span className="text-[11px] text-zinc-500">{svc.durationMinutes} د</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {addonCandidate ? (
                <div className="space-y-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold">{addonCandidate.name}</p>
                    <button
                      type="button"
                      onClick={() => { setAddonCandidate(null); setAddonPreview(null); }}
                      className="min-h-9 rounded-lg border border-white/10 px-3 text-xs text-zinc-300"
                    >إلغاء</button>
                  </div>
                  {addonChecking ? <p role="status" className="text-sm text-amber-200">جاري فحص وقت الخدمة والحجوزات التالية…</p> : null}
                  {addonPreview?.available ? (
                    <>
                      <p role="status" className="text-sm text-emerald-300">
                        الوقت متاح · {addonPreview.durationMinutes} دقيقة. اضغط للتأكيد وحجز الفترة الإضافية.
                      </p>
                      <button
                        type="button"
                        disabled={addonCommitting || addonChecking}
                        onClick={() => void confirmAddon()}
                        className="w-full rounded-xl bg-emerald-500 px-3 py-3 text-sm font-bold text-zinc-950 disabled:opacity-50"
                      >
                        {addonCommitting ? 'جاري حجز الوقت…' : 'تأكيد وحجز وقت الخدمة'}
                      </button>
                    </>
                  ) : null}
                  {addonPreview && !addonPreview.available ? (
                    <div role="alert" className="space-y-2">
                      <p className="text-sm font-bold text-rose-300">
                        مش متاح عندك وقت للخدمة دي — أولوية للحجوزات المؤكدة.
                      </p>
                      <p className="text-xs text-zinc-300">{addonPreview.reason}</p>
                      {addonPreview.alternatives.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-amber-200">أقرب موظفين متاحين (اقتراح غير محجوز):</p>
                          {addonPreview.alternatives.map((person) => (
                            <p key={person.empId} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-200">
                              {person.empName} · {formatCandidateTime(person.startAt)}
                            </p>
                          ))}
                        </div>
                      ) : <p className="text-xs text-zinc-400">مفيش بديل مؤكد في المواعيد القريبة.</p>}
                      <p className="rounded-xl bg-amber-500/10 p-3 text-xs font-bold text-amber-200">
                        وجّه العميل للكاشير لتأكيد نقله لموظف متاح. الخدمة لم تُضف ولم يُحجز وقتها.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-white/10 px-4 py-3">
          <p className="mb-2 text-center text-xs text-zinc-500">
            {selectedCount > 0 ? `${selectedCount} خدمات مختارة` : 'اختَر خدمة واحدةً على الأقل'}
          </p>
          <button
            type="button"
            disabled={muted || staffPhase !== 'finished' || selectedCount === 0 || sending || loading || addonCommitting || phaseSaving}
            onClick={() => setConfirmOpen(true)}
            className="w-full rounded-2xl bg-amber-400 px-4 py-3 text-sm font-black text-zinc-950 disabled:opacity-40"
          >
            {handoffPending ? 'تحديث الإرسال' : staffPhase === 'finished' ? 'إنهاء وإرسال للكاشير' : 'أنهِ الخدمة أولًا'}
          </button>
        </footer>
      </div>

      {confirmOpen ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/50 sm:items-center">
          <div className="m-3 w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900 p-4 shadow-2xl">
            <p className="text-sm font-bold text-zinc-100">
              هيتبعت للكاشير: {selectedCount} خدمات · لـ {booking.firstName} · {booking.startTime}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={sending}
                onClick={() => void submitHandoff()}
                className="flex-1 rounded-xl bg-amber-400 py-2.5 text-sm font-black text-zinc-950 disabled:opacity-50"
              >
                {sending ? 'جاري الإرسال…' : 'تأكيد الإرسال'}
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-300"
              >
                تعديل
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
