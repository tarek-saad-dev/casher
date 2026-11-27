'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, UserPlus, Scissors, Clock, Ticket, ArrowRight,
  CheckCircle2, Loader2, AlertCircle, Star,
} from 'lucide-react';
import { QueueTicketCreatedModal, type QueueTicketCreatedModalProps } from '@/components/queue/QueueTicketCreatedModal';
import { getOperationalDate } from '@/lib/businessDate';

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
    const today = getOperationalDate();
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

      // Fetch current waiting count using business date and effective status
      const today = (() => {
        const now = new Date();
        const cairoHour = parseInt(
          new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(now), 10
        );
        if (cairoHour < 4) {
          return new Date(now.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
        }
        return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
      })();
      let waitingBefore: number | null = null;
      try {
        const wRes  = await fetch(`/api/queue?date=${today}&status=waiting`);
        const wData = await wRes.json();
        // Only count tickets that are effectively counting ahead
        waitingBefore = Array.isArray(wData.tickets)
          ? wData.tickets.filter((t: any) => t.isCountingAhead !== false).length
          : null;
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
    <div className="h-full min-h-0 min-w-0 flex flex-col bg-background" dir="rtl">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/queue/live')} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all">
            <ArrowRight size={16} />
          </button>
          <div>
            <h1 className="text-base font-black text-foreground">تذكرة انتظار جديدة</h1>
            <p className="text-xs text-muted-foreground">إضافة عميل لقائمة الانتظار</p>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          الرقم التالي: <span className="text-warning font-bold">{settings.QueuePrefix}?</span>
        </div>
      </div>

      {/* Form body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-6">

          {/* Step indicator */}
          {step < 4 && (
            <div className="flex items-center justify-center gap-2 mb-6">
              {[1, 2, 3].map(n => (
                <div key={n} className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                    style={step > n
                      ? { background: 'var(--success)', color: 'var(--success-foreground)' }
                      : step === n
                        ? { background: 'var(--primary)', color: 'var(--primary-foreground)' }
                        : { background: 'var(--border)', color: 'var(--muted-foreground)' }}
                  >{step > n ? <CheckCircle2 size={14} /> : n}</div>
                  {n < 3 && <div className="w-8 h-0.5 rounded" style={{ background: step > n ? 'var(--success)' : 'var(--border)' }} />}
                </div>
              ))}
            </div>
          )}

          {/* ── Step 1: Client ── rendered inline, no sub-component function */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-foreground mb-1">اختيار العميل</h2>
                <p className="text-xs text-muted-foreground">ابحث عن عميل أو أضف عميلاً جديداً</p>
              </div>

              {!showNewClient ? (
                <>
                  {/* Search input — stable DOM node, never remounted */}
                  <div className="relative">
                    <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      autoComplete="off"
                      value={clientSearch}
                      onChange={e => setClientSearch(e.target.value)}
                      placeholder="ابحث بالاسم أو الجوال..."
                      className="w-full bg-card border border-border rounded-xl pr-9 pl-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                    />
                    {clientLoading && (
                      <Loader2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin pointer-events-none" />
                    )}
                  </div>

                  {/* Dropdown results — rendered BELOW input, never replaces it */}
                  {clientResults.length > 0 && !selectedClient && (
                    <div className="border border-border rounded-xl overflow-hidden">
                      {clientResults.map(c => (
                        <button
                          key={c.ClientID}
                          type="button"
                          onMouseDown={e => { e.preventDefault(); selectClient(c); }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-right border-b border-border last:border-0"
                        >
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-foreground shrink-0">
                            {c.ClientName.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{c.ClientName}</p>
                            {c.ClientMobile && <p className="text-xs text-muted-foreground">{c.ClientMobile}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Selected client chip */}
                  {selectedClient && (
                    <div className="flex items-center gap-3 p-3 rounded-xl border border-success/30 bg-success-soft">
                      <CheckCircle2 size={16} className="text-success shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-foreground">{selectedClient.ClientName}</p>
                        {selectedClient.ClientMobile && <p className="text-xs text-muted-foreground">{selectedClient.ClientMobile}</p>}
                      </div>
                      <button type="button" onClick={clearClient} className="text-xs text-muted-foreground hover:text-foreground">تغيير</button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowNewClient(true)}
                    className="flex items-center gap-2 text-sm text-warning hover:text-warning transition-colors"
                  >
                    <UserPlus size={14} /> إضافة عميل جديد
                  </button>
                </>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">اسم العميل *</label>
                    <input
                      type="text"
                      value={newClientName}
                      onChange={e => setNewClientName(e.target.value)}
                      placeholder="الاسم الكامل"
                      className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">رقم الجوال (اختياري)</label>
                    <input
                      type="tel"
                      value={newClientMobile}
                      onChange={e => setNewClientMobile(e.target.value)}
                      placeholder="05XXXXXXXX"
                      dir="ltr"
                      className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowNewClient(false); setNewClientName(''); setNewClientMobile(''); }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >← العودة للبحث</button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Barber ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-foreground mb-1">اختيار الحلاق</h2>
                <p className="text-xs text-muted-foreground">اختر الحلاق أو اترك بدون تحديد</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setSelectedBarber(null); fetchEstimate(undefined); }}
                  className="flex items-center gap-2 p-3 rounded-xl border text-right transition-all"
                  style={!selectedBarber
                    ? { borderColor: 'color-mix(in srgb, var(--primary) 50%, transparent)', background: 'color-mix(in srgb, var(--primary) 10%, transparent)', color: 'var(--primary)' }
                    : { borderColor: 'var(--border)', background: 'transparent', color: 'var(--muted-foreground)' }}
                >
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs">—</div>
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
                        ? { borderColor: 'color-mix(in srgb, var(--primary) 50%, transparent)', background: 'color-mix(in srgb, var(--primary) 10%, transparent)', color: 'var(--primary)' }
                        : isAvail
                          ? { borderColor: 'var(--border)', background: 'transparent', color: 'var(--foreground)' }
                          : { borderColor: 'color-mix(in srgb, var(--destructive) 25%, transparent)', background: 'color-mix(in srgb, var(--destructive) 5%, transparent)', color: 'var(--muted-foreground)' }}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: selectedBarber?.EmpID === b.EmpID ? 'var(--primary)' : 'var(--border)', color: selectedBarber?.EmpID === b.EmpID ? 'var(--primary-foreground)' : 'var(--foreground)' }}
                      >{b.EmpName.charAt(0)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{b.EmpName}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: isAvail ? 'var(--success)' : 'var(--destructive)' }}>
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
                <h2 className="text-base font-bold text-foreground mb-1">الخدمات</h2>
                <p className="text-xs text-muted-foreground">اختر الخدمات المطلوبة</p>
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
                        ? { borderColor: 'color-mix(in srgb, var(--brand) 40%, transparent)', background: 'color-mix(in srgb, var(--brand) 10%, transparent)' }
                        : { borderColor: 'var(--border)', background: 'var(--surface-muted)' }}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: sel ? 'color-mix(in srgb, var(--brand) 20%, transparent)' : 'var(--border)' }}
                      >
                        {sel ? <CheckCircle2 size={14} className="text-brand" /> : <Scissors size={14} className="text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{svc.ProName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-warning font-semibold">{svc.SPrice} ر.س</span>
                          {svc.DurationMinutes && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock size={10} />{svc.DurationMinutes} د
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-border space-y-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-foreground flex items-center gap-1.5">
                    <Star size={13} className="text-warning" /> أولوية عالية
                  </span>
                  <div
                    onClick={() => setPriority(p => (p > 0 ? 0 : 1))}
                    className="relative w-10 h-5 rounded-full transition-colors cursor-pointer"
                    style={{ background: priority > 0 ? 'var(--primary)' : 'var(--muted)' }}
                  >
                    <div className="absolute top-0.5 w-4 h-4 rounded-full bg-card shadow transition-all" style={{ right: priority > 0 ? 2 : 'auto', left: priority > 0 ? 'auto' : 2 }} />
                  </div>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="ملاحظات (اختياري)"
                  rows={2}
                  className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring resize-none"
                />
              </div>

              {selectedServices.length > 0 && (
                <div className="rounded-xl bg-card border border-border p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{selectedServices.length} خدمة · {totalDuration} دقيقة تقريباً</span>
                    <span className="text-warning font-bold text-sm">{totalPrice} ر.س</span>
                  </div>
                </div>
              )}

              {/* Estimate panel */}
              {(estimating || estimateData) && (
                <div
                  className="rounded-xl border p-3 space-y-1.5"
                  style={estimateData && !estimateData.ok
                    ? { borderColor: 'color-mix(in srgb, var(--destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--destructive) 6%, transparent)' }
                    : { borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)', background: 'color-mix(in srgb, var(--primary) 6%, transparent)' }}
                >
                  {estimating ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 size={12} className="animate-spin" /> جاري حساب وقت الانتظار...
                    </div>
                  ) : estimateData ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">عدد المنتظرين قبلك</span>
                        <span className="text-sm font-bold" style={{ color: 'var(--primary)' }}>{estimateData.waitingCount}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">انتظار تقريبي</span>
                        <span className="text-sm font-bold" style={{ color: 'var(--primary)' }}>~{estimateData.estimatedWaitMinutes} د</span>
                      </div>
                      <div className="text-xs font-semibold mt-1" style={{ color: estimateData.ok ? 'var(--success)' : 'var(--destructive)' }}>
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
            <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-destructive-soft border border-destructive/30 text-destructive text-sm">
              <AlertCircle size={15} />{error}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-6">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}
                className="px-4 py-2.5 rounded-xl border border-border text-muted-foreground text-sm hover:bg-muted transition-all"
              >السابق</button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)}
                disabled={!canGoNext()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                style={{ background: canGoNext() ? 'var(--primary)' : 'var(--border)', color: canGoNext() ? 'var(--primary-foreground)' : 'var(--muted-foreground)' }}
              >التالي</button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canGoNext() || submitting}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
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
