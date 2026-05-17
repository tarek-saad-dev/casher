'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, UserPlus, Scissors, Clock, Ticket, ArrowRight,
  CheckCircle2, Loader2, AlertCircle, Star,
} from 'lucide-react';
import { QueueTicketCreatedModal, type QueueTicketCreatedModalProps } from '@/components/queue/QueueTicketCreatedModal';

interface Barber {
  EmpID: number;
  EmpName: string;
  IsAvailable?: boolean;
  AvailabilityReason?: string;
  WorkingStartTime?: string | null;
  WorkingEndTime?: string | null;
}
interface Client { ClientID: number; ClientName: string; ClientMobile: string | null; }
interface Service { ProID: number; ProName: string; SPrice: number; DurationMinutes?: number; }
interface SelectedService extends Service { qty: number; }

export default function NewQueuePage() {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [barbers,  setBarbers]  = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [settings, setSettings] = useState<{ QueuePrefix: string; QueueStartNumber: number }>({ QueuePrefix: 'A', QueueStartNumber: 1 });

  // Client search — all stable, no key-based remounts
  const [clientSearch,   setClientSearch]   = useState('');
  const [clientResults,  setClientResults]  = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showNewClient,  setShowNewClient]  = useState(false);
  const [newClientName,  setNewClientName]  = useState('');
  const [newClientMobile,setNewClientMobile]= useState('');
  const [clientLoading,  setClientLoading]  = useState(false);

  const [selectedBarber,   setSelectedBarber]   = useState<Barber | null>(null);
  const [selectedServices, setSelectedServices] = useState<SelectedService[]>([]);
  const [priority, setPriority] = useState(0);
  const [notes,    setNotes]    = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [modalData,  setModalData]  = useState<QueueTicketCreatedModalProps['data'] | null>(null);

  // Estimate state
  const [estimating,            setEstimating]            = useState(false);
  const [estimateData,          setEstimateData]          = useState<{
    waitingCount: number;
    estimatedWaitMinutes: number;
    estimatedStartTime: string | null;
    message: string;
    ok: boolean;
  } | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toTimeString().slice(0, 5);
    Promise.all([
      fetch(`/api/barbers/available?date=${today}&time=${nowTime}`).then(r => r.json()).catch(() => ({ barbers: [] })),
      fetch('/api/services').then(r => r.json()),
      fetch('/api/queue/settings').then(r => r.json()),
    ]).then(([barberData, svcData, settData]) => {
      setBarbers(
        (Array.isArray(barberData.barbers) ? barberData.barbers : [])
      );
      const rawSvc = Array.isArray(svcData) ? svcData : (svcData.services ?? []);
      setServices(rawSvc.map((s: { ProID: number; ProName: string; SPrice?: number; SPrice1?: number; DurationMinutes?: number }) => ({
        ProID: s.ProID,
        ProName: s.ProName,
        SPrice: s.SPrice ?? s.SPrice1 ?? 0,
        DurationMinutes: s.DurationMinutes,
      })));
      if (settData?.settings) setSettings(settData.settings);
    }).catch(() => {/* non-fatal */});
  }, []);

  // ── Debounced customer search — does NOT touch selectedClient while typing ─
  useEffect(() => {
    if (clientSearch.length < 2) {
      setClientResults([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setClientLoading(true);
      try {
        const res  = await fetch(`/api/customers?q=${encodeURIComponent(clientSearch)}`);
        const data = await res.json();
        const raw  = Array.isArray(data) ? data : (data.clients ?? []);
        setClientResults(
          raw.map((c: { ClientID: number; Name?: string; ClientName?: string; Mobile?: string | null }) => ({
            ClientID:     c.ClientID,
            ClientName:   c.ClientName ?? c.Name ?? '',
            ClientMobile: c.Mobile ?? null,
          }))
        );
      } catch {
        // silently ignore search errors
      } finally {
        setClientLoading(false);
      }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [clientSearch]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const totalDuration = selectedServices.reduce((s, sv) => s + (sv.DurationMinutes ?? 30) * sv.qty, 0);
  const totalPrice    = selectedServices.reduce((s, sv) => s + sv.SPrice * sv.qty, 0);

  const canGoNext = (): boolean => {
    if (step === 1) return !!selectedClient || (showNewClient && newClientName.trim().length > 0);
    if (step === 2) return true; // barber is optional
    if (step === 3) return selectedServices.length > 0;
    return true;
  };

  const handleServiceToggle = (svc: Service) => {
    setSelectedServices(prev => {
      const exists = prev.find(s => s.ProID === svc.ProID);
      return exists ? prev.filter(s => s.ProID !== svc.ProID) : [...prev, { ...svc, qty: 1 }];
    });
  };

  const fetchEstimate = async (empId?: number) => {
    setEstimating(true);
    try {
      const res  = await fetch('/api/queue/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: empId ?? null,
          serviceIds: selectedServices.map(s => s.ProID),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEstimateData({
          waitingCount:         data.waitingCount       ?? 0,
          estimatedWaitMinutes: data.estimatedWaitMinutes ?? 0,
          estimatedStartTime:   data.estimatedStartTime  ?? null,
          message:              data.message             ?? '',
          ok:                   data.ok                  ?? true,
        });
      }
    } catch { /* non-fatal */ }
    finally { setEstimating(false); }
  };

  const selectClient = (c: Client) => {
    setSelectedClient(c);
    setClientSearch(c.ClientName);
    setClientResults([]);
  };

  const clearClient = () => {
    setSelectedClient(null);
    setClientSearch('');
    setClientResults([]);
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let clientId = selectedClient?.ClientID ?? null;
      if (showNewClient && newClientName.trim()) {
        const cRes  = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newClientName.trim(), mobile: newClientMobile.trim() || null }),
        });
        const cData = await cRes.json();
        clientId = cData.ClientID ?? null;
      }

      // Fetch current waiting count before creating ticket
      const today = new Date().toISOString().slice(0, 10);
      let waitingBefore: number | null = null;
      try {
        const wRes  = await fetch(`/api/queue?date=${today}&status=waiting`);
        const wData = await wRes.json();
        waitingBefore = Array.isArray(wData.tickets) ? wData.tickets.length : null;
      } catch { /* non-fatal */ }

      const res  = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          empId:    selectedBarber?.EmpID ?? null,
          priority,
          notes:    notes || null,
          services: selectedServices.map(s => ({
            proId: s.ProID, proName: s.ProName,
            qty: s.qty, price: s.SPrice, durationMinutes: s.DurationMinutes,
          })),
          estimatedStartTime:    estimateData?.estimatedStartTime    ?? null,
          estimatedWaitMinutes:  estimateData?.estimatedWaitMinutes  ?? null,
          waitingCountAtCreation: estimateData?.waitingCount         ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل إنشاء التذكرة');

      const estimatedWait = estimateData?.estimatedWaitMinutes
        ?? (selectedServices.length > 0
          ? selectedServices.reduce((s, sv) => s + (sv.DurationMinutes ?? 30) * sv.qty, 0)
          : null);

      setModalData({
        ticketId:              data.ticketId,
        ticketCode:            data.ticketCode,
        clientName:            selectedClient?.ClientName || newClientName || null,
        empName:               selectedBarber?.EmpName    || null,
        services:              selectedServices.map(s => ({ name: s.ProName, price: s.SPrice })),
        queueDate:             today,
        createdTime:           new Date().toTimeString().slice(0, 8),
        waitingBefore:         estimateData?.waitingCount         ?? waitingBefore,
        estimatedWaitMinutes:  estimatedWait,
        estimatedStartTime:    estimateData?.estimatedStartTime   ?? data.estimatedStartTime ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ غير معروف');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep(1); setSelectedClient(null); setSelectedBarber(null);
    setSelectedServices([]); setClientSearch(''); setClientResults([]);
    setModalData(null); setShowNewClient(false);
    setNewClientName(''); setNewClientMobile('');
    setNotes(''); setPriority(0); setError(null);
    setEstimateData(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="h-full flex flex-col bg-zinc-950" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/queue/live')} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all">
            <ArrowRight size={16} />
          </button>
          <div>
            <h1 className="text-base font-black text-white">تذكرة انتظار جديدة</h1>
            <p className="text-xs text-zinc-500">إضافة عميل لقائمة الانتظار</p>
          </div>
        </div>
        <div className="text-xs text-zinc-500">
          الرقم التالي: <span className="text-amber-400 font-bold">{settings.QueuePrefix}?</span>
        </div>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-6">

          {/* Step indicator */}
          {step < 4 && (
            <div className="flex items-center justify-center gap-2 mb-6">
              {[1, 2, 3].map(n => (
                <div key={n} className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                    style={step > n
                      ? { background: '#10B981', color: '#fff' }
                      : step === n
                        ? { background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }
                        : { background: '#2A2A35', color: '#6B7280' }}
                  >{step > n ? <CheckCircle2 size={14} /> : n}</div>
                  {n < 3 && <div className="w-8 h-0.5 rounded" style={{ background: step > n ? '#10B981' : '#2A2A35' }} />}
                </div>
              ))}
            </div>
          )}

          {/* ── Step 1: Client ── rendered inline, no sub-component function */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-white mb-1">اختيار العميل</h2>
                <p className="text-xs text-zinc-500">ابحث عن عميل أو أضف عميلاً جديداً</p>
              </div>

              {!showNewClient ? (
                <>
                  {/* Search input — stable DOM node, never remounted */}
                  <div className="relative">
                    <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                    <input
                      type="text"
                      autoComplete="off"
                      value={clientSearch}
                      onChange={e => setClientSearch(e.target.value)}
                      placeholder="ابحث بالاسم أو الجوال..."
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pr-9 pl-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors"
                    />
                    {clientLoading && (
                      <Loader2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 animate-spin pointer-events-none" />
                    )}
                  </div>

                  {/* Dropdown results — rendered BELOW input, never replaces it */}
                  {clientResults.length > 0 && !selectedClient && (
                    <div className="border border-zinc-700 rounded-xl overflow-hidden">
                      {clientResults.map(c => (
                        <button
                          key={c.ClientID}
                          type="button"
                          onMouseDown={e => { e.preventDefault(); selectClient(c); }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors text-right border-b border-zinc-800 last:border-0"
                        >
                          <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                            {c.ClientName.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">{c.ClientName}</p>
                            {c.ClientMobile && <p className="text-xs text-zinc-500">{c.ClientMobile}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Selected client chip */}
                  {selectedClient && (
                    <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                      <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white">{selectedClient.ClientName}</p>
                        {selectedClient.ClientMobile && <p className="text-xs text-zinc-400">{selectedClient.ClientMobile}</p>}
                      </div>
                      <button type="button" onClick={clearClient} className="text-xs text-zinc-500 hover:text-white">تغيير</button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowNewClient(true)}
                    className="flex items-center gap-2 text-sm text-amber-400 hover:text-amber-300 transition-colors"
                  >
                    <UserPlus size={14} /> إضافة عميل جديد
                  </button>
                </>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">اسم العميل *</label>
                    <input
                      type="text"
                      value={newClientName}
                      onChange={e => setNewClientName(e.target.value)}
                      placeholder="الاسم الكامل"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">رقم الجوال (اختياري)</label>
                    <input
                      type="tel"
                      value={newClientMobile}
                      onChange={e => setNewClientMobile(e.target.value)}
                      placeholder="05XXXXXXXX"
                      dir="ltr"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowNewClient(false); setNewClientName(''); setNewClientMobile(''); }}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >← العودة للبحث</button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Barber ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-white mb-1">اختيار الحلاق</h2>
                <p className="text-xs text-zinc-500">اختر الحلاق أو اترك بدون تحديد</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setSelectedBarber(null); fetchEstimate(undefined); }}
                  className="flex items-center gap-2 p-3 rounded-xl border text-right transition-all"
                  style={!selectedBarber
                    ? { borderColor: 'rgba(214,168,79,0.5)', background: 'rgba(214,168,79,0.1)', color: '#D6A84F' }
                    : { borderColor: '#2A2A35', background: 'transparent', color: '#6B7280' }}
                >
                  <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs">—</div>
                  <span className="text-sm font-medium">أي حلاق</span>
                </button>
                {barbers.map(b => {
                  const isAvail = b.IsAvailable !== false;
                  return (
                    <button
                      key={b.EmpID}
                      type="button"
                      onClick={() => { setSelectedBarber(b); fetchEstimate(b.EmpID); }}
                      className="flex items-center gap-2 p-3 rounded-xl border text-right transition-all relative"
                      style={selectedBarber?.EmpID === b.EmpID
                        ? { borderColor: 'rgba(214,168,79,0.5)', background: 'rgba(214,168,79,0.1)', color: '#D6A84F' }
                        : isAvail
                          ? { borderColor: '#2A2A35', background: 'transparent', color: '#D1D5DB' }
                          : { borderColor: 'rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.05)', color: '#9CA3AF' }}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: selectedBarber?.EmpID === b.EmpID ? 'linear-gradient(135deg,#D6A84F,#B8923A)' : '#2A2A35', color: selectedBarber?.EmpID === b.EmpID ? '#000' : '#fff' }}
                      >{b.EmpName.charAt(0)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{b.EmpName}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: isAvail ? '#34D399' : '#F87171' }}>
                          {b.AvailabilityReason ?? 'متاح'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 3: Services + priority + notes ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-white mb-1">الخدمات</h2>
                <p className="text-xs text-zinc-500">اختر الخدمات المطلوبة</p>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-luxury-v">
                {services.map(svc => {
                  const sel = selectedServices.find(s => s.ProID === svc.ProID);
                  return (
                    <button
                      key={svc.ProID}
                      type="button"
                      onClick={() => handleServiceToggle(svc)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border text-right transition-all"
                      style={sel
                        ? { borderColor: 'rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.1)' }
                        : { borderColor: '#2A2A35', background: 'rgba(255,255,255,0.02)' }}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: sel ? 'rgba(139,92,246,0.2)' : '#2A2A35' }}
                      >
                        {sel ? <CheckCircle2 size={14} className="text-purple-400" /> : <Scissors size={14} className="text-zinc-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{svc.ProName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-amber-400 font-semibold">{svc.SPrice} ر.س</span>
                          {svc.DurationMinutes && (
                            <span className="text-xs text-zinc-500 flex items-center gap-1">
                              <Clock size={10} />{svc.DurationMinutes} د
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-zinc-800 space-y-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-zinc-300 flex items-center gap-1.5">
                    <Star size={13} className="text-amber-400" /> أولوية عالية
                  </span>
                  <div
                    onClick={() => setPriority(p => (p > 0 ? 0 : 1))}
                    className="relative w-10 h-5 rounded-full transition-colors cursor-pointer"
                    style={{ background: priority > 0 ? '#D6A84F' : '#374151' }}
                  >
                    <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ right: priority > 0 ? 2 : 'auto', left: priority > 0 ? 'auto' : 2 }} />
                  </div>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="ملاحظات (اختياري)"
                  rows={2}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 resize-none"
                />
              </div>

              {selectedServices.length > 0 && (
                <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">{selectedServices.length} خدمة · {totalDuration} دقيقة تقريباً</span>
                    <span className="text-amber-400 font-bold text-sm">{totalPrice} ر.س</span>
                  </div>
                </div>
              )}

              {/* Estimate panel */}
              {(estimating || estimateData) && (
                <div
                  className="rounded-xl border p-3 space-y-1.5"
                  style={estimateData && !estimateData.ok
                    ? { borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }
                    : { borderColor: 'rgba(214,168,79,0.3)', background: 'rgba(214,168,79,0.06)' }}
                >
                  {estimating ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Loader2 size={12} className="animate-spin" /> جاري حساب وقت الانتظار...
                    </div>
                  ) : estimateData ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-400">عدد المنتظرين قبلك</span>
                        <span className="text-sm font-bold" style={{ color: '#D6A84F' }}>{estimateData.waitingCount}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-400">انتظار تقريبي</span>
                        <span className="text-sm font-bold" style={{ color: '#D6A84F' }}>~{estimateData.estimatedWaitMinutes} د</span>
                      </div>
                      <div className="text-xs font-semibold mt-1" style={{ color: estimateData.ok ? '#34D399' : '#F87171' }}>
                        {estimateData.message}
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {/* Step 4 inline block removed — success handled by modal */}

          {/* Error */}
          {error && (
            <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              <AlertCircle size={15} />{error}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-6">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}
                className="px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 text-sm hover:bg-zinc-800 transition-all"
              >السابق</button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)}
                disabled={!canGoNext()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                style={{ background: canGoNext() ? 'linear-gradient(135deg,#D6A84F,#B8923A)' : '#2A2A35', color: canGoNext() ? '#000' : '#6B7280' }}
              >التالي</button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canGoNext() || submitting}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}
              >
                {submitting
                  ? <><Loader2 size={15} className="animate-spin" /> جاري الإنشاء...</>
                  : <><Ticket size={15} /> إنشاء التذكرة</>}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>

    {/* Success modal — shown when a ticket is created */}
    {modalData && (
      <QueueTicketCreatedModal
        data={modalData}
        onNewTicket={() => { resetForm(); }}
        onClose={() => { setModalData(null); router.push('/queue/live'); }}
      />
    )}
    </>
  );
}
