'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Search, User, Scissors, Loader2, CheckCircle2, Zap, Clock, Users, AlertCircle, RefreshCw, ChevronLeft, Ticket } from 'lucide-react';
import { QueueTicketCreatedModal } from '@/components/queue/QueueTicketCreatedModal';
import type { QueueTicketPrintData } from '@/components/queue/QueueTicketPrint';
import { normalizeCustomersAhead } from '@/lib/queueCustomersAhead';

interface Service { ProID: number; ProName: string; SPrice: number; DurationMinutes: number | null; }
interface Client { ClientID: number; Name: string; Mobile?: string; }

interface EstimateOption {
  empId: number;
  empName: string;
  available: boolean;
  isFreeNow: boolean;
  statusText: string;
  estimatedStartTime: string;
  estimatedWaitMinutes: number;
  waitingCount: number;
  blockingQueueCount: number;
  blockingBookingCount: number;
  contextMsg: string;
}

interface EstimateResponse {
  ok: boolean;
  best: EstimateOption | null;
  alternatives: EstimateOption[];
  unavailable: Array<{ empId: number; empName: string; reason: string }>;
  contextMsg?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m} ${d.getHours() < 12 ? 'ص' : 'م'}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} دقيقة`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} ساعة`;
  return `${h} ساعة ${m} دقيقة`;
}

/** Safely extract HH:MM from a value that may be a TIME string, ISO string, or Date */
function normalizeCreatedTime(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    if (v.startsWith('1970-01-01T')) {
      const d = new Date(v);
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    }
    return v.slice(0, 5);
  }
  return '';
}

export function FindNearestQueueDrawer({ isOpen, onClose, onCreated }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showClients, setShowClients] = useState(false);
  const [quickCreating, setQuickCreating] = useState(false);

  const [services, setServices] = useState<Service[]>([]);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);

  const totalDuration = selectedServices.reduce(
    (s, svc) => s + (svc.DurationMinutes ?? 30),
    0,
  );
  const totalPrice = selectedServices.reduce((s, svc) => s + (svc.SPrice ?? 0), 0);

  const toggleService = (svc: Service) => {
    setSelectedServices((prev) =>
      prev.some((s) => s.ProID === svc.ProID)
        ? prev.filter((s) => s.ProID !== svc.ProID)
        : [...prev, svc],
    );
    setEstimate(null);
    setSelectedOption(null);
  };

  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [selectedOption, setSelectedOption] = useState<EstimateOption | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdData, setCreatedData] = useState<(QueueTicketPrintData & { ticketId: number }) | null>(null);

  // Load services on mount
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/services?active=true')
      .then(r => r.json())
      .then(d => setServices(d.services ?? d ?? []))
      .catch(() => { });
  }, [isOpen]);

  // Client search
  useEffect(() => {
    if (clientSearch.length < 1) { setClients([]); setClientSearching(false); return; }
    setClientSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?q=${encodeURIComponent(clientSearch)}`);
        const data = await res.json();
        const list: Client[] = Array.isArray(data) ? data : (data.clients ?? data.data ?? []);
        setClients(list);
        setShowClients(true);
      } catch { setClients([]); }
      finally { setClientSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [clientSearch]);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setSelectedClient(null);
      setSelectedServices([]);
      setEstimate(null);
      setSelectedOption(null);
      setError(null);
      setClientSearch('');
      setClients([]);
      setShowClients(false);
      setCreatedData(null);
    }
  }, [isOpen]);

  // Fetch estimate when service is selected
  const fetchEstimate = useCallback(async () => {
    if (!selectedServices.length) {
      setEstimate(null);
      return;
    }
    setEstimating(true);
    setEstimate(null);
    setSelectedOption(null);

    try {
      const browserNow = new Date();
      const serviceIds = selectedServices.map((s) => s.ProID);
      const estimatePayload = {
        mode: 'nearest',
        serviceIds,
        requestedAt: browserNow.toISOString(),
      };
      console.log('[estimate payload]', {
        ...estimatePayload,
        browserNowLocal: browserNow.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }),
        browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        serviceDuration: totalDuration,
      });

      const res = await fetch('/api/queue/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(estimatePayload),
      });
      const data: EstimateResponse = await res.json();
      console.log('[estimate response]', data);
      setEstimate(data);

      // Auto-select best option if available
      if (data.best?.available) {
        setSelectedOption(data.best);
      }
    } catch { /* non-fatal */ }
    finally { setEstimating(false); }
  }, [selectedServices, totalDuration]);

  useEffect(() => {
    if (step === 2 && selectedServices.length > 0) {
      fetchEstimate();
    }
  }, [step, selectedServices, fetchEstimate]);

  // Quick-create customer
  const handleQuickCreate = async () => {
    const q = clientSearch.trim();
    if (!q) return;
    setQuickCreating(true);
    try {
      const isPhone = /^[0-9+\- ]{7,}$/.test(q);
      const payload = isPhone ? { name: `عميل ${q}`, mobile: q } : { name: q };
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'خطأ'); }
      const created = await res.json();
      const newClient: Client = { ClientID: created.ClientID, Name: created.Name, Mobile: created.Mobile };
      setSelectedClient(newClient);
      setClientSearch('');
      setClients([]);
      setShowClients(false);
      // Stay on current step, just clear search and update selected client
      // Don't auto-advance - let user see the selection
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل إنشاء العميل');
    } finally {
      setQuickCreating(false);
    }
  };

  // Submit to create queue
  const handleSubmit = async () => {
    setError(null);

    if (!selectedServices.length) {
      setError('اختر خدمة واحدة على الأقل');
      return;
    }
    if (!selectedOption) {
      setError('اختر حلاقاً من القائمة');
      return;
    }

    const empId = selectedOption.empId;
    // Client is optional - use selected client or default to "عميل مباشر"
    const clientId = selectedClient?.ClientID ?? null;

    setSubmitting(true);
    try {
      // Build customer payload based on selection
      let customerPayload;
      if (selectedClient) {
        // Existing client
        customerPayload = {
          clientId: selectedClient.ClientID,
          name: selectedClient.Name,
          phone: selectedClient.Mobile || '',
        };
      } else if (clientSearch.trim()) {
        // New client from search text
        const isPhone = /^[0-9+\- ]{7,}$/.test(clientSearch.trim());
        if (isPhone) {
          customerPayload = {
            name: `عميل ${clientSearch.trim()}`,
            phone: clientSearch.trim(),
          };
        } else {
          customerPayload = {
            name: clientSearch.trim(),
            phone: '',
          };
        }
      } else {
        // No client info - use default
        customerPayload = {
          name: 'عميل مباشر',
          phone: '',
        };
      }

      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId ? Number(clientId) : null,
          empId,
          notes: null,
          services: selectedServices.map((s) => ({
            proId: s.ProID,
            proName: s.ProName,
            qty: 1,
            price: s.SPrice,
            durationMinutes: s.DurationMinutes,
          })),
          customer: customerPayload,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'خطأ'); }
      const data = await res.json();

      const t = data.ticket;
      const resolvedClientName = t?.clientName ?? selectedClient?.Name ?? customerPayload.name ?? 'عميل مباشر';
      const resolvedEmpName = t?.barberName ?? selectedOption?.empName;
      const resolvedDate = t?.queueDate ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
      const rawTime = t?.createdTime ?? new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour12: false });
      const resolvedTime = normalizeCreatedTime(rawTime);
      const resolvedEstStart = data.estimatedStartTime ?? t?.estimatedStartTime ?? null;
      const resolvedEstWait = data.estimatedWaitMinutes ?? t?.estimatedWaitMinutes ?? null;
      const resolvedWaitCount = normalizeCustomersAhead(
        data.waitingCountAtCreation ?? t?.waitingCountAtCreation,
      );

      const normalized = {
        ticketId: data.ticketId,
        ticketCode: data.ticketCode,
        clientName: resolvedClientName,
        empName: resolvedEmpName,
        services: selectedServices.map((s) => ({ name: s.ProName })),
        queueDate: resolvedDate,
        createdTime: resolvedTime,
        waitingBefore: resolvedWaitCount,
        estimatedWaitMinutes: resolvedEstWait,
        estimatedStartTime: resolvedEstStart,
      };

      setCreatedData(normalized);
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل إصدار الدور');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
        <div className="w-full max-w-lg rounded-2xl border overflow-hidden flex flex-col max-h-[90vh]"
          style={{ background: 'var(--surface)', borderColor: 'color-mix(in srgb, var(--primary) 20%, transparent)' }}>

          {/* Header */}
          <div className="px-5 py-4 border-b flex items-center justify-between"
            style={{ borderColor: 'color-mix(in srgb, var(--primary) 15%, transparent)', background: 'color-mix(in srgb, var(--primary) 5%, transparent)' }}>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5" style={{ color: 'var(--success)' }} />
              <h2 className="text-lg font-bold text-foreground">إيجاد أقرب دور</h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-muted transition-colors">
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          {/* Step indicator */}
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'color-mix(in srgb, var(--primary) 10%, transparent)' }}>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
              step === 1 ? 'bg-surface-muted text-foreground' : 'text-muted-foreground/70'
            }`}>
              <Scissors className="w-4 h-4" />
              <span>الخدمة</span>
            </div>
            <ChevronLeft className="w-4 h-4 text-muted-foreground/50" />
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
              step === 2 ? 'bg-surface-muted text-foreground' : step > 2 ? 'text-muted-foreground' : 'text-muted-foreground/70'
            }`}>
              <User className="w-4 h-4" />
              <span>الحلاق</span>
            </div>
            <ChevronLeft className="w-4 h-4 text-muted-foreground/50" />
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
              step === 3 ? 'bg-surface-muted text-foreground' : 'text-muted-foreground/70'
            }`}>
              <Ticket className="w-4 h-4" />
              <span>التأكيد</span>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {error && (
              <div className="mb-4 p-3 rounded-lg border flex items-center gap-2"
                style={{ background: 'color-mix(in srgb, var(--destructive) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--destructive) 30%, transparent)', color: 'var(--destructive)' }}>
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {/* Step 1: Select Services */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">اختر الخدمات</label>
                  {selectedServices.length > 0 && (
                    <div className="mb-3 p-3 rounded-lg border flex items-center justify-between"
                      style={{ background: 'color-mix(in srgb, var(--success) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)' }}>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {selectedServices.length} خدمة — {totalDuration} دقيقة — {totalPrice} ج.م
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {selectedServices.map((s) => s.ProName).join(' + ')}
                        </p>
                      </div>
                      <button onClick={() => { setSelectedServices([]); setEstimate(null); }}
                        className="text-xs px-2 py-1 rounded bg-surface-muted hover:bg-surface-muted/80 transition-colors text-foreground shrink-0">
                        مسح
                      </button>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
                    {services.map((svc) => {
                      const sel = selectedServices.some((s) => s.ProID === svc.ProID);
                      return (
                        <button
                          key={svc.ProID}
                          onClick={() => toggleService(svc)}
                          className={`p-3 rounded-lg border text-right transition-all flex items-center justify-between ${
                            sel ? 'border-primary/60' : 'hover:border-primary/50'
                          }`}
                          style={{ background: sel ? 'color-mix(in srgb, var(--primary) 8%, var(--surface-muted))' : 'var(--surface-muted)', borderColor: sel ? undefined : 'color-mix(in srgb, var(--primary) 15%, transparent)' }}
                        >
                          <div className="flex items-center gap-2">
                            {sel ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <Scissors className="w-4 h-4 text-muted-foreground/70" />}
                            <span className="text-sm text-foreground">{svc.ProName}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {svc.DurationMinutes ? `${svc.DurationMinutes} دقيقة` : ''}
                            {svc.SPrice ? ` — ${svc.SPrice} ج.م` : ''}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedServices.length > 0 && (
                  <button
                    onClick={() => setStep(2)}
                    className="w-full py-3 rounded-xl font-bold text-base transition-all"
                    style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                  >
                    التالي: اختيار الحلاق
                  </button>
                )}
              </div>
            )}

            {/* Step 2: Show Barber Options */}
            {step === 2 && (
              <div className="space-y-4">
                {/* Service Summary (Read-only) */}
                <div className="p-3 rounded-lg border" style={{ background: 'color-mix(in srgb, var(--primary) 5%, transparent)', borderColor: 'color-mix(in srgb, var(--primary) 15%, transparent)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">الخدمات المختارة</span>
                    <button onClick={() => setStep(1)} className="text-xs text-primary hover:underline">تغيير</button>
                  </div>
                  <p className="text-sm font-medium text-foreground mt-1">
                    {selectedServices.map((s) => s.ProName).join(' + ')}
                  </p>
                  <p className="text-xs text-muted-foreground/70">{totalDuration} دقيقة — {totalPrice} ج.م</p>
                </div>

                {/* Estimate Results */}
                {estimating && (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
                    <p className="text-sm text-muted-foreground">جاري حساب أقرب دور...</p>
                  </div>
                )}

                {estimate && !estimating && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-foreground">أقرب الخيارات المتاحة</h3>
                      <button
                        onClick={fetchEstimate}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
                        style={{ color: 'var(--primary)' }}
                      >
                        <RefreshCw className="w-3 h-3" />
                        تحديث
                      </button>
                    </div>

                    {/* Best Option */}
                    {estimate.best?.available && (
                      <div className="p-4 rounded-xl border-2 cursor-pointer transition-all"
                        onClick={() => setSelectedOption(estimate.best)}
                        style={{
                          background: selectedOption?.empId === estimate.best.empId
                            ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                            : 'color-mix(in srgb, var(--success) 5%, transparent)',
                          borderColor: selectedOption?.empId === estimate.best.empId
                            ? 'var(--success)'
                            : 'color-mix(in srgb, var(--success) 30%, transparent)',
                        }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Zap className="w-5 h-5" style={{ color: 'var(--success)' }} />
                            <span className="font-bold text-foreground">{estimate.best.empName}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: 'color-mix(in srgb, var(--success) 20%, transparent)', color: 'var(--success)' }}>
                              الأفضل
                            </span>
                          </div>
                          {selectedOption?.empId === estimate.best.empId && (
                            <CheckCircle2 className="w-5 h-5 text-success" />
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            <span>متاح {estimate.best.isFreeNow ? 'الآن' : fmtTime(estimate.best.estimatedStartTime)}</span>
                          </div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Users className="w-3.5 h-3.5" />
                            <span>{estimate.best.waitingCount} دور قبلك</span>
                          </div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Scissors className="w-3.5 h-3.5" />
                            <span>{formatDuration(totalDuration)}</span>
                          </div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{estimate.best.estimatedWaitMinutes} دقيقة انتظار</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Alternatives */}
                    {estimate.alternatives.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-medium text-muted-foreground/70">بدائل أخرى</h4>
                        {estimate.alternatives.map((alt) => (
                          <div
                            key={alt.empId}
                            onClick={() => setSelectedOption(alt)}
                            className="p-3 rounded-lg border cursor-pointer transition-all"
                            style={{
                              background: selectedOption?.empId === alt.empId
                                ? 'color-mix(in srgb, var(--primary) 15%, transparent)'
                                : 'color-mix(in srgb, var(--foreground) 2%, transparent)',
                              borderColor: selectedOption?.empId === alt.empId
                                ? 'color-mix(in srgb, var(--primary) 50%, transparent)'
                                : 'color-mix(in srgb, var(--foreground) 10%, transparent)',
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-muted-foreground/70" />
                                <span className="font-medium text-foreground">{alt.empName}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                متاح {fmtTime(alt.estimatedStartTime)}
                              </div>
                            </div>
                            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground/70">
                              <span>{alt.waitingCount} دور قبلك</span>
                              <span>{alt.estimatedWaitMinutes} دقيقة انتظار</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* No options available */}
                    {!estimate.best?.available && estimate.alternatives.length === 0 && (
                      <div className="p-6 text-center rounded-lg border"
                        style={{ background: 'color-mix(in srgb, var(--destructive) 5%, transparent)', borderColor: 'color-mix(in srgb, var(--destructive) 20%, transparent)' }}>
                        <AlertCircle className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--destructive)' }} />
                        <p className="text-sm font-medium text-foreground">لا يوجد حلاق متاح حالياً</p>
                        <p className="text-xs text-muted-foreground mt-1">جرب تحديث القائمة لاحقاً</p>
                      </div>
                    )}

                    {/* Unavailable barbers (collapsed) */}
                    {estimate.unavailable.length > 0 && (
                      <details className="mt-3">
                        <summary className="text-xs text-muted-foreground/70 cursor-pointer py-2">
                          غير متاح ({estimate.unavailable.length})
                        </summary>
                        <div className="space-y-1 mt-1">
                          {estimate.unavailable.map((u) => (
                            <div key={u.empId} className="flex items-center justify-between px-2 py-1 text-xs">
                              <span className="text-muted-foreground">{u.empName}</span>
                              <span className="text-muted-foreground/50">{u.reason}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Navigation */}
                    <div className="flex gap-2 pt-3">
                      <button
                        onClick={() => setStep(1)}
                        className="flex-1 py-3 rounded-xl font-bold text-base transition-all border"
                        style={{ borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)', color: 'var(--foreground)' }}
                      >
                        رجوع
                      </button>
                      {selectedOption && (
                        <button
                          onClick={() => setStep(3)}
                          className="flex-[2] py-3 rounded-xl font-bold text-base transition-all"
                          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                        >
                          التالي: التأكيد والعميل
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Client Info + Confirmation */}
            {step === 3 && selectedServices.length > 0 && selectedOption && (
              <div className="space-y-4">
                {/* Summary Card */}
                <div className="p-4 rounded-xl border"
                  style={{ background: 'color-mix(in srgb, var(--primary) 5%, transparent)', borderColor: 'color-mix(in srgb, var(--primary) 20%, transparent)' }}>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3">ملخص الدور</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">الخدمات</span>
                      <span className="text-sm font-medium text-foreground text-left">
                        {selectedServices.map((s) => s.ProName).join(' + ')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">الحلاق</span>
                      <span className="text-sm font-medium" style={{ color: 'var(--primary)' }}>{selectedOption.empName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">وقت البدء</span>
                      <span className="text-sm font-medium text-foreground">
                        {selectedOption.isFreeNow ? 'فوراً' : fmtTime(selectedOption.estimatedStartTime)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">مدة الخدمة</span>
                      <span className="text-sm font-medium text-foreground">{formatDuration(totalDuration)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">الأشخاص قبله</span>
                      <span className="text-sm font-medium text-foreground">{selectedOption.waitingCount}</span>
                    </div>
                  </div>
                </div>

                {/* Client Info Section */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-foreground">بيانات العميل <span className="text-muted-foreground/70 text-xs">(اختياري)</span></label>

                  {/* Selected Client Display */}
                  {selectedClient ? (
                    <div className="flex items-center justify-between p-3 rounded-lg border"
                      style={{ background: 'color-mix(in srgb, var(--success) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)' }}>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-success" />
                        <div>
                          <p className="font-medium text-foreground">{selectedClient.Name}</p>
                          {selectedClient.Mobile && <p className="text-xs text-muted-foreground">{selectedClient.Mobile}</p>}
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">عميل موجود</span>
                      </div>
                      <button onClick={() => { setSelectedClient(null); setClientSearch(''); }}
                        className="text-xs px-2 py-1 rounded bg-surface-muted hover:bg-surface-muted/80 transition-colors text-foreground">
                        تغيير
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      {/* Search Input */}
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                          <input
                            type="text"
                            value={clientSearch}
                            onChange={(e) => setClientSearch(e.target.value)}
                            placeholder="رقم الهاتف أو اسم العميل..."
                            className="w-full pr-10 pl-3 py-2.5 rounded-lg border text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary/50"
                            style={{ background: 'var(--surface-muted)', borderColor: 'color-mix(in srgb, var(--primary) 20%, transparent)' }}
                          />
                          {clientSearching && (
                            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 animate-spin" />
                          )}
                        </div>
                        {clientSearch.trim() && (
                          <button
                            onClick={handleQuickCreate}
                            disabled={quickCreating}
                            className="px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
                            style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)', color: 'var(--primary)' }}
                          >
                            {quickCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : '+ عميل جديد'}
                          </button>
                        )}
                      </div>

                      {/* Search Results Dropdown */}
                      {showClients && clients.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 rounded-lg border overflow-hidden max-h-48 overflow-y-auto"
                          style={{ background: 'var(--surface-muted)', borderColor: 'color-mix(in srgb, var(--primary) 20%, transparent)' }}>
                          {clients.map((c) => (
                            <button
                              key={c.ClientID}
                              onClick={() => {
                                setSelectedClient(c);
                                setClientSearch('');
                                setClients([]);
                                setShowClients(false);
                              }}
                              className="w-full px-3 py-2.5 text-right hover:bg-surface-muted transition-colors flex items-center gap-2"
                            >
                              <User className="w-4 h-4 text-muted-foreground/70" />
                              <div className="flex-1">
                                <p className="text-sm text-foreground">{c.Name}</p>
                                {c.Mobile && <p className="text-xs text-muted-foreground/70">{c.Mobile}</p>}
                              </div>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">عميل موجود</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* No client hint */}
                      {!clientSearch.trim() && !selectedClient && (
                        <p className="text-xs text-muted-foreground/70 mt-2">
                          يمكنك ترك الحقل فارغاً وسيتم إنشاء الدور باسم "عميل مباشر"
                        </p>
                      )}
                    </div>
                  )}

                  {/* New client hint */}
                  {clientSearch.trim() && !selectedClient && !showClients && (
                    <p className="text-xs text-primary/80">
                      عميل جديد — سيتم تسجيله عند إنشاء الدور
                    </p>
                  )}
                </div>

                {/* Error Display */}
                {error && (
                  <div className="p-3 rounded-lg border flex items-center gap-2"
                    style={{ background: 'color-mix(in srgb, var(--destructive) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--destructive) 30%, transparent)', color: 'var(--destructive)' }}>
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setStep(2)}
                    className="flex-1 py-3 rounded-xl font-bold text-base transition-all border"
                    style={{ borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)', color: 'var(--foreground)' }}
                  >
                    رجوع
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex-[2] py-3 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2"
                    style={{ background: 'var(--success)', color: 'var(--success-foreground)' }}
                  >
                    {submitting ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Zap className="w-5 h-5" />
                        تأكيد وإصدار الدور
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Success Modal */}
      {createdData && (
        <QueueTicketCreatedModal
          data={createdData}
          onNewTicket={() => {
            // Reset and allow creating another ticket
            setCreatedData(null);
            setStep(1);
            setSelectedClient(null);
            setSelectedServices([]);
            setSelectedOption(null);
            setClientSearch('');
          }}
          onClose={() => {
            setCreatedData(null);
            onClose();
          }}
        />
      )}
    </>
  );
}
