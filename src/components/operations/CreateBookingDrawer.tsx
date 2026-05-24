'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import {
  X, Search, User, Scissors, Loader2, CheckCircle2,
  Calendar, Clock, AlertTriangle, RefreshCw,
} from 'lucide-react';
import type { BookingBarberResult, BookingEstimateResponse } from '@/lib/operationsTypes';

interface Service { ProID: number; ProName: string; SPrice: number; DurationMinutes: number | null; }
interface Client { ClientID: number; Name: string; Mobile?: string; }

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

type Mode = 'nearest' | 'specific';

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return iso.slice(11, 16); }
}

export function CreateBookingDrawer({ onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('nearest');
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showClients, setShowClients] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedSvcs, setSelectedSvcs] = useState<Service[]>([]);
  const [selectedBarber, setSelectedBarber] = useState<BookingBarberResult | null>(null);
  const [bookingDate, setBookingDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [bookingTime, setBookingTime] = useState(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() + 30, 0, 0);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [notes, setNotes] = useState('');
  const [availability, setAvailability] = useState<BookingEstimateResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load services on mount
  useEffect(() => {
    fetch('/api/services?active=true')
      .then(r => r.json()).then(d => setServices(d.services ?? d ?? [])).catch(() => { });
  }, []);

  // Client search
  useEffect(() => {
    if (clientSearch.length < 2) { setClients([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(clientSearch)}`)
        .then(r => r.json())
        .then(d => { const list = Array.isArray(d) ? d : (d.clients ?? d.data ?? []); setClients(list); setShowClients(true); })
        .catch(() => { });
    }, 300);
    return () => clearTimeout(t);
  }, [clientSearch]);

  // Fetch availability for all barbers whenever date/time/services change
  const fetchAvailability = useCallback(async () => {
    if (!bookingDate || !bookingTime) return;
    setChecking(true);
    setAvailability(null);
    setSelectedBarber(null);

    const payload = {
      mode: 'all',
      serviceIds: selectedSvcs.map(s => s.ProID),
      bookingDate,
      bookingTime,
    };

    console.log('[booking availability request]', payload);

    try {
      const res = await fetch('/api/bookings/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: BookingEstimateResponse = await res.json();
      setAvailability(data);
      // In nearest mode auto-select the best barber
      if (mode === 'nearest' && data.best) {
        setSelectedBarber(data.best);
      }
      console.log('[booking availability response]', data);
    } catch { /* non-fatal */ }
    finally { setChecking(false); }
  }, [bookingDate, bookingTime, selectedSvcs, mode]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  // When mode switches to nearest, auto-select best from existing availability
  useEffect(() => {
    if (mode === 'nearest') {
      setSelectedBarber(availability?.best ?? null);
    } else {
      setSelectedBarber(null);
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleService = (svc: Service) => {
    setSelectedSvcs(prev =>
      prev.find(s => s.ProID === svc.ProID)
        ? prev.filter(s => s.ProID !== svc.ProID)
        : [...prev, svc]
    );
  };

  const endTime = (() => {
    const totalMins = selectedSvcs.reduce((sum, s) => sum + (s.DurationMinutes ?? 30), 0) || 30;
    const [h, m] = bookingTime.split(':').map(Number);
    const end = new Date(0, 0, 0, h, m + totalMins);
    return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  })();

  // Submit validation
  const chosenBarber = selectedBarber;
  const canSubmit = !!bookingDate && !!bookingTime && !!chosenBarber && chosenBarber.available && !submitting;
  const submitBlockReason = !bookingDate || !bookingTime
    ? 'اختر التاريخ والوقت'
    : !chosenBarber
      ? (mode === 'nearest' ? 'لا يوجد حلاق متاح' : 'اختر الحلاق')
      : !chosenBarber.available
        ? chosenBarber.reason ?? 'الحلاق غير متاح'
        : null;

  const handleSubmit = async () => {
    setError(null);
    if (!canSubmit || !chosenBarber) { setError(submitBlockReason ?? 'تحقق من البيانات'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient?.ClientID ?? null,
          empId: chosenBarber.empId,
          bookingDate,
          startTime: bookingTime + ':00',
          endTime: endTime + ':00',
          source: 'reception',
          notes: notes || null,
          services: selectedSvcs.map(s => ({
            proId: s.ProID, qty: 1, price: s.SPrice,
            durationMinutes: s.DurationMinutes,
          })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'خطأ');
      setSuccess(true);
      setTimeout(() => { onCreated(); onClose(); }, 1500);
    } catch (e: any) {
      setError(e.message ?? 'فشل إنشاء الحجز');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm">
        <div className="rounded-2xl border p-8 text-center space-y-3" style={{ background: '#141418', borderColor: '#2A2A35' }}>
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto" />
          <p className="font-bold text-white text-lg">تم إنشاء الحجز</p>
          <p className="text-sm text-zinc-500">{bookingDate} — {bookingTime}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-md flex flex-col shadow-2xl overflow-hidden"
        style={{ background: '#141418', borderLeft: '1px solid #2A2A35' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: '#2A2A35' }}>
          <h2 className="font-bold text-white text-base">حجز موعد جديد</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* 1. Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-zinc-400 mb-2 flex items-center gap-1">
                <Calendar size={11} /> التاريخ
              </p>
              <input
                type="date" value={bookingDate}
                onChange={e => setBookingDate(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm text-white bg-transparent outline-none"
                style={{ borderColor: '#2A2A35', colorScheme: 'dark' }}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-400 mb-2 flex items-center gap-1">
                <Clock size={11} /> الوقت
              </p>
              <input
                type="time" value={bookingTime}
                onChange={e => setBookingTime(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm text-white bg-transparent outline-none"
                style={{ borderColor: '#2A2A35', colorScheme: 'dark' }}
              />
            </div>
          </div>

          {/* 2. Services */}
          <section>
            <p className="text-xs font-semibold text-zinc-400 mb-2">
              الخدمات <span className="text-zinc-600">(اختياري — تؤثر على مدة الحجز)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {services.slice(0, 20).map(svc => {
                const sel = !!selectedSvcs.find(s => s.ProID === svc.ProID);
                return (
                  <button
                    key={svc.ProID} onClick={() => toggleService(svc)}
                    className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                    style={{
                      borderColor: sel ? '#D6A84F' : '#2A2A35',
                      color: sel ? '#D6A84F' : '#9CA3AF',
                      background: sel ? 'rgba(214,168,79,0.10)' : 'transparent',
                    }}
                  >
                    <Scissors size={10} className="inline ml-1" />
                    {svc.ProName}
                    {svc.DurationMinutes ? <span className="text-zinc-600 mr-1">({svc.DurationMinutes}د)</span> : null}
                  </button>
                );
              })}
            </div>
            {selectedSvcs.length > 0 && (
              <p className="text-xs text-zinc-600 mt-1.5">
                مدة الخدمة: {selectedSvcs.reduce((s, x) => s + (x.DurationMinutes ?? 30), 0)} دقيقة
                — ينتهي {endTime}
              </p>
            )}
          </section>

          {/* 3. Mode */}
          <div>
            <p className="text-xs font-semibold text-zinc-400 mb-2">طريقة الاختيار</p>
            <div className="grid grid-cols-2 gap-2">
              {([['nearest', 'أقرب حلاق متاح'], ['specific', 'حلاق معين']] as [Mode, string][]).map(([m, lbl]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="py-2.5 rounded-xl border text-sm font-semibold transition-all"
                  style={{
                    borderColor: mode === m ? '#D6A84F' : '#2A2A35',
                    color: mode === m ? '#D6A84F' : '#6B7280',
                    background: mode === m ? 'rgba(214,168,79,0.10)' : 'transparent',
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Barber list — loaded from availability API */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-zinc-400">
                {mode === 'specific' ? 'اختر الحلاق' : 'الحلاق المقترح'}
              </p>
              <button
                onClick={fetchAvailability}
                disabled={checking}
                className="text-zinc-600 hover:text-amber-400 disabled:opacity-40 transition-colors"
                title="تحديث التوفر"
              >
                <RefreshCw size={11} className={checking ? 'animate-spin' : ''} />
              </button>
            </div>

            {checking ? (
              <div className="flex items-center gap-2 text-sm text-zinc-500 py-3">
                <Loader2 size={14} className="animate-spin" />
                جاري فحص الحلاقين المتاحين...
              </div>
            ) : !availability ? (
              <p className="text-xs text-zinc-600 py-2">اختر التاريخ والوقت لفحص التوفر</p>
            ) : mode === 'nearest' ? (
              /* Nearest: show auto-picked barber or "none available" */
              availability.best ? (
                <div
                  className="flex items-center justify-between px-4 py-3 rounded-xl border"
                  style={{ borderColor: '#10B981', background: 'rgba(16,185,129,0.06)' }}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-white">{availability.best.empName}</span>
                    <span className="text-xs text-emerald-400">متاح في هذا الموعد</span>
                    {availability.best.workingWindow && (
                      <span className="text-[10px] text-zinc-600">مواعيده: {availability.best.workingWindow}</span>
                    )}
                  </div>
                  <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0" />
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-red-400 py-2">
                  <AlertTriangle size={14} />
                  لا يوجد حلاق متاح في هذا الوقت
                </div>
              )
            ) : (
              /* Specific: show all barbers with their status */
              <div className="space-y-2">
                {(availability.barbers ?? []).map(b => {
                  const isSelected = selectedBarber?.empId === b.empId;
                  const canSelect = b.available;
                  return (
                    <button
                      key={b.empId}
                      onClick={() => canSelect && setSelectedBarber(isSelected ? null : b)}
                      disabled={!canSelect}
                      className="w-full text-right rounded-xl border px-4 py-3 transition-all"
                      style={{
                        borderColor: isSelected
                          ? '#D6A84F'
                          : b.available ? '#1E3A2F' : '#2A2A35',
                        background: isSelected
                          ? 'rgba(214,168,79,0.08)'
                          : b.available ? 'rgba(16,185,129,0.04)' : 'transparent',
                        opacity: canSelect ? 1 : 0.7,
                        cursor: canSelect ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-sm font-semibold text-white truncate">{b.empName}</span>
                          <span
                            className="text-xs"
                            style={{ color: b.available ? '#10B981' : '#EF4444' }}
                          >
                            {b.statusText}
                          </span>
                          {!b.available && b.reason && (
                            <span className="text-[11px] text-zinc-500 leading-tight">{b.reason}</span>
                          )}
                          {!b.available && b.nextAvailableTime && (
                            <span className="text-[11px] text-amber-500">
                              أقرب وقت: {fmtTime(b.nextAvailableTime)}
                            </span>
                          )}
                          {b.workingWindow && (
                            <span className="text-[10px] text-zinc-600">مواعيده: {b.workingWindow}</span>
                          )}
                        </div>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5"
                          style={{
                            background: b.available ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)',
                            color: b.available ? '#10B981' : '#EF4444',
                          }}
                        >
                          {b.available ? 'متاح' : 'غير متاح'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* 5. Client (optional) */}
          <div className="relative">
            <p className="text-xs font-semibold text-zinc-400 mb-2">
              العميل <span className="text-zinc-600">(اختياري)</span>
            </p>
            {selectedClient ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-xl border"
                style={{ borderColor: '#10B981', background: 'rgba(16,185,129,0.08)' }}>
                <div className="flex items-center gap-2">
                  <User size={13} className="text-emerald-400" />
                  <span className="text-sm text-white">{selectedClient.Name}</span>
                </div>
                <button onClick={() => setSelectedClient(null)} className="text-zinc-500 hover:text-white">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border"
                  style={{ borderColor: '#2A2A35', background: '#1A1A20' }}>
                  <Search size={13} className="text-zinc-500" />
                  <input
                    className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
                    placeholder="ابحث بالاسم أو الهاتف..."
                    value={clientSearch}
                    onChange={e => { setClientSearch(e.target.value); setShowClients(true); }}
                  />
                </div>
                {showClients && clients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border shadow-xl z-10 overflow-hidden"
                    style={{ background: '#1E1D21', borderColor: '#2A2A35' }}>
                    {clients.slice(0, 6).map(c => (
                      <button key={c.ClientID}
                        className="w-full text-right px-4 py-2.5 hover:bg-zinc-800 transition-colors text-sm text-white"
                        onClick={() => { setSelectedClient(c); setClientSearch(''); setShowClients(false); }}>
                        {c.Name}
                        {c.Mobile && <span className="text-zinc-500 text-xs mr-2">{c.Mobile}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 6. Notes */}
          <div>
            <p className="text-xs font-semibold text-zinc-400 mb-2">ملاحظات</p>
            <textarea
              rows={2}
              className="w-full rounded-xl border px-3 py-2 text-sm text-white bg-transparent placeholder-zinc-600 outline-none resize-none"
              style={{ borderColor: '#2A2A35' }}
              placeholder="ملاحظة اختيارية..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertTriangle size={14} className="flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-4 border-t flex-shrink-0 space-y-2" style={{ borderColor: '#2A2A35' }}>
          {!canSubmit && submitBlockReason && !submitting && (
            <p className="text-xs text-center text-zinc-500">{submitBlockReason}</p>
          )}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg,#6366F1,#4F46E5)', color: '#fff' }}
          >
            {submitting
              ? <><Loader2 size={15} className="animate-spin" /> جاري الحجز...</>
              : <><CheckCircle2 size={15} /> تأكيد الحجز</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
