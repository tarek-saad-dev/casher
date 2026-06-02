'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Search, User, Scissors, Loader2, CheckCircle2, Zap, Clock, Users, AlertCircle, RefreshCw, ChevronLeft, Ticket } from 'lucide-react';
import { QueueTicketCreatedModal } from '@/components/queue/QueueTicketCreatedModal';
import type { QueueTicketPrintData } from '@/components/queue/QueueTicketPrint';

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
  const [selectedService, setSelectedService] = useState<Service | null>(null);

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
      setSelectedService(null);
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
    if (!selectedService) {
      setEstimate(null);
      return;
    }
    setEstimating(true);
    setEstimate(null);
    setSelectedOption(null);

    try {
      const browserNow = new Date();
      const estimatePayload = {
        mode: 'nearest',
        serviceIds: [selectedService.ProID],
        requestedAt: browserNow.toISOString(),
      };
      console.log('[estimate payload]', {
        ...estimatePayload,
        browserNowLocal: browserNow.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }),
        browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        serviceName: selectedService.ProName,
        serviceDuration: selectedService.DurationMinutes,
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
  }, [selectedService]);

  // Fetch estimate when going to step 2
  useEffect(() => {
    if (step === 2 && selectedService) {
      fetchEstimate();
    }
  }, [step, selectedService, fetchEstimate]);

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

    if (!selectedService) {
      setError('اختر الخدمة أولاً');
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
          services: [{
            proId: selectedService.ProID,
            proName: selectedService.ProName,
            qty: 1,
            price: selectedService.SPrice,
            durationMinutes: selectedService.DurationMinutes,
          }],
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
      const resolvedWaitCount = data.waitingCountAtCreation ?? t?.waitingCountAtCreation ?? null;

      const normalized = {
        ticketId: data.ticketId,
        ticketCode: data.ticketCode,
        clientName: resolvedClientName,
        empName: resolvedEmpName,
        services: [{ name: selectedService.ProName }],
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
          style={{ background: '#0a0a0a', borderColor: 'rgba(212,175,55,0.2)' }}>

          {/* Header */}
          <div className="px-5 py-4 border-b flex items-center justify-between"
            style={{ borderColor: 'rgba(212,175,55,0.15)', background: 'rgba(212,175,55,0.05)' }}>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5" style={{ color: '#22c55e' }} />
              <h2 className="text-lg font-bold text-white">إيجاد أقرب دور</h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-800 transition-colors">
              <X className="w-5 h-5 text-zinc-400" />
            </button>
          </div>

          {/* Step indicator */}
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'rgba(212,175,55,0.1)' }}>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
              step === 1 ? 'bg-zinc-800 text-white' : 'text-zinc-500'
            }`}>
              <Scissors className="w-4 h-4" />
              <span>الخدمة</span>
            </div>
            <ChevronLeft className="w-4 h-4 text-zinc-600" />
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
              step === 2 ? 'bg-zinc-800 text-white' : step > 2 ? 'text-zinc-400' : 'text-zinc-500'
            }`}>
              <User className="w-4 h-4" />
              <span>الحلاق</span>
            </div>
            <ChevronLeft className="w-4 h-4 text-zinc-600" />
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
              step === 3 ? 'bg-zinc-800 text-white' : 'text-zinc-500'
            }`}>
              <Ticket className="w-4 h-4" />
              <span>التأكيد</span>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {error && (
              <div className="mb-4 p-3 rounded-lg border flex items-center gap-2"
                style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}>
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {/* Step 1: Select Service */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">اختر الخدمة</label>
                  {selectedService ? (
                    <div className="flex items-center justify-between p-3 rounded-lg border"
                      style={{ background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)' }}>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                        <div>
                          <p className="font-medium text-white">{selectedService.ProName}</p>
                          <p className="text-xs text-zinc-400">
                            {selectedService.DurationMinutes ? `${selectedService.DurationMinutes} دقيقة` : 'مدة غير محددة'}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => { setSelectedService(null); setEstimate(null); }}
                        className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors text-zinc-300">
                        تغيير
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
                      {services.map((svc) => (
                        <button
                          key={svc.ProID}
                          onClick={() => { setSelectedService(svc); }}
                          className="p-3 rounded-lg border text-right hover:border-amber-500/50 transition-all flex items-center justify-between"
                          style={{ background: '#111', borderColor: 'rgba(212,175,55,0.15)' }}
                        >
                          <div className="flex items-center gap-2">
                            <Scissors className="w-4 h-4 text-zinc-500" />
                            <span className="text-sm text-white">{svc.ProName}</span>
                          </div>
                          <div className="text-xs text-zinc-400">
                            {svc.DurationMinutes ? `${svc.DurationMinutes} دقيقة` : ''}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedService && (
                  <button
                    onClick={() => setStep(2)}
                    className="w-full py-3 rounded-xl font-bold text-base transition-all"
                    style={{ background: '#d4af37', color: '#050505' }}
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
                <div className="p-3 rounded-lg border" style={{ background: 'rgba(212,175,55,0.05)', borderColor: 'rgba(212,175,55,0.15)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">الخدمة المختارة</span>
                    <button onClick={() => setStep(1)} className="text-xs text-amber-500 hover:underline">تغيير</button>
                  </div>
                  <p className="text-sm font-medium text-white mt-1">{selectedService?.ProName}</p>
                  <p className="text-xs text-zinc-500">{selectedService?.DurationMinutes ? `${selectedService.DurationMinutes} دقيقة` : ''}</p>
                </div>

                {/* Estimate Results */}
                {estimating && (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 text-amber-500 animate-spin mb-3" />
                    <p className="text-sm text-zinc-400">جاري حساب أقرب دور...</p>
                  </div>
                )}

                {estimate && !estimating && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white">أقرب الخيارات المتاحة</h3>
                      <button
                        onClick={fetchEstimate}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
                        style={{ color: '#d4af37' }}
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
                            ? 'rgba(34,197,94,0.15)'
                            : 'rgba(34,197,94,0.05)',
                          borderColor: selectedOption?.empId === estimate.best.empId
                            ? '#22c55e'
                            : 'rgba(34,197,94,0.3)',
                        }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Zap className="w-5 h-5" style={{ color: '#22c55e' }} />
                            <span className="font-bold text-white">{estimate.best.empName}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(34,197,94,0.2)', color: '#22c55e' }}>
                              الأفضل
                            </span>
                          </div>
                          {selectedOption?.empId === estimate.best.empId && (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-1 text-zinc-400">
                            <Clock className="w-3.5 h-3.5" />
                            <span>متاح {estimate.best.isFreeNow ? 'الآن' : fmtTime(estimate.best.estimatedStartTime)}</span>
                          </div>
                          <div className="flex items-center gap-1 text-zinc-400">
                            <Users className="w-3.5 h-3.5" />
                            <span>{estimate.best.waitingCount} دور قبلك</span>
                          </div>
                          <div className="flex items-center gap-1 text-zinc-400">
                            <Scissors className="w-3.5 h-3.5" />
                            <span>{formatDuration(selectedService?.DurationMinutes ?? 30)}</span>
                          </div>
                          <div className="flex items-center gap-1 text-zinc-400">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{estimate.best.estimatedWaitMinutes} دقيقة انتظار</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Alternatives */}
                    {estimate.alternatives.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-medium text-zinc-500">بدائل أخرى</h4>
                        {estimate.alternatives.map((alt) => (
                          <div
                            key={alt.empId}
                            onClick={() => setSelectedOption(alt)}
                            className="p-3 rounded-lg border cursor-pointer transition-all"
                            style={{
                              background: selectedOption?.empId === alt.empId
                                ? 'rgba(212,175,55,0.15)'
                                : 'rgba(255,255,255,0.02)',
                              borderColor: selectedOption?.empId === alt.empId
                                ? 'rgba(212,175,55,0.5)'
                                : 'rgba(255,255,255,0.1)',
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-zinc-500" />
                                <span className="font-medium text-white">{alt.empName}</span>
                              </div>
                              <div className="text-xs text-zinc-400">
                                متاح {fmtTime(alt.estimatedStartTime)}
                              </div>
                            </div>
                            <div className="flex items-center gap-4 mt-1 text-xs text-zinc-500">
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
                        style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}>
                        <AlertCircle className="w-8 h-8 mx-auto mb-2" style={{ color: '#ef4444' }} />
                        <p className="text-sm font-medium text-white">لا يوجد حلاق متاح حالياً</p>
                        <p className="text-xs text-zinc-400 mt-1">جرب تحديث القائمة لاحقاً</p>
                      </div>
                    )}

                    {/* Unavailable barbers (collapsed) */}
                    {estimate.unavailable.length > 0 && (
                      <details className="mt-3">
                        <summary className="text-xs text-zinc-500 cursor-pointer py-2">
                          غير متاح ({estimate.unavailable.length})
                        </summary>
                        <div className="space-y-1 mt-1">
                          {estimate.unavailable.map((u) => (
                            <div key={u.empId} className="flex items-center justify-between px-2 py-1 text-xs">
                              <span className="text-zinc-400">{u.empName}</span>
                              <span className="text-zinc-600">{u.reason}</span>
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
                        style={{ borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }}
                      >
                        رجوع
                      </button>
                      {selectedOption && (
                        <button
                          onClick={() => setStep(3)}
                          className="flex-[2] py-3 rounded-xl font-bold text-base transition-all"
                          style={{ background: '#d4af37', color: '#050505' }}
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
            {step === 3 && selectedService && selectedOption && (
              <div className="space-y-4">
                {/* Summary Card */}
                <div className="p-4 rounded-xl border"
                  style={{ background: 'rgba(212,175,55,0.05)', borderColor: 'rgba(212,175,55,0.2)' }}>
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">ملخص الدور</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">الخدمة</span>
                      <span className="text-sm font-medium text-white">{selectedService.ProName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">الحلاق</span>
                      <span className="text-sm font-medium" style={{ color: '#d4af37' }}>{selectedOption.empName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">وقت البدء</span>
                      <span className="text-sm font-medium text-white">
                        {selectedOption.isFreeNow ? 'فوراً' : fmtTime(selectedOption.estimatedStartTime)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">مدة الخدمة</span>
                      <span className="text-sm font-medium text-white">{formatDuration(selectedService.DurationMinutes ?? 30)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">الأشخاص قبله</span>
                      <span className="text-sm font-medium text-white">{selectedOption.waitingCount}</span>
                    </div>
                  </div>
                </div>

                {/* Client Info Section */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-zinc-300">بيانات العميل <span className="text-zinc-500 text-xs">(اختياري)</span></label>

                  {/* Selected Client Display */}
                  {selectedClient ? (
                    <div className="flex items-center justify-between p-3 rounded-lg border"
                      style={{ background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)' }}>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                        <div>
                          <p className="font-medium text-white">{selectedClient.Name}</p>
                          {selectedClient.Mobile && <p className="text-xs text-zinc-400">{selectedClient.Mobile}</p>}
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">عميل موجود</span>
                      </div>
                      <button onClick={() => { setSelectedClient(null); setClientSearch(''); }}
                        className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors text-zinc-300">
                        تغيير
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      {/* Search Input */}
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                          <input
                            type="text"
                            value={clientSearch}
                            onChange={(e) => setClientSearch(e.target.value)}
                            placeholder="رقم الهاتف أو اسم العميل..."
                            className="w-full pr-10 pl-3 py-2.5 rounded-lg border text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-amber-500/50"
                            style={{ background: '#111', borderColor: 'rgba(212,175,55,0.2)' }}
                          />
                          {clientSearching && (
                            <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 animate-spin" />
                          )}
                        </div>
                        {clientSearch.trim() && (
                          <button
                            onClick={handleQuickCreate}
                            disabled={quickCreating}
                            className="px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
                            style={{ background: 'rgba(212,175,55,0.15)', color: '#d4af37' }}
                          >
                            {quickCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : '+ عميل جديد'}
                          </button>
                        )}
                      </div>

                      {/* Search Results Dropdown */}
                      {showClients && clients.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 rounded-lg border overflow-hidden max-h-48 overflow-y-auto"
                          style={{ background: '#111', borderColor: 'rgba(212,175,55,0.2)' }}>
                          {clients.map((c) => (
                            <button
                              key={c.ClientID}
                              onClick={() => {
                                setSelectedClient(c);
                                setClientSearch('');
                                setClients([]);
                                setShowClients(false);
                              }}
                              className="w-full px-3 py-2.5 text-right hover:bg-zinc-800 transition-colors flex items-center gap-2"
                            >
                              <User className="w-4 h-4 text-zinc-500" />
                              <div className="flex-1">
                                <p className="text-sm text-white">{c.Name}</p>
                                {c.Mobile && <p className="text-xs text-zinc-500">{c.Mobile}</p>}
                              </div>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">عميل موجود</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* No client hint */}
                      {!clientSearch.trim() && !selectedClient && (
                        <p className="text-xs text-zinc-500 mt-2">
                          يمكنك ترك الحقل فارغاً وسيتم إنشاء الدور باسم "عميل مباشر"
                        </p>
                      )}
                    </div>
                  )}

                  {/* New client hint */}
                  {clientSearch.trim() && !selectedClient && !showClients && (
                    <p className="text-xs text-amber-500/80">
                      عميل جديد — سيتم تسجيله عند إنشاء الدور
                    </p>
                  )}
                </div>

                {/* Error Display */}
                {error && (
                  <div className="p-3 rounded-lg border flex items-center gap-2"
                    style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}>
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setStep(2)}
                    className="flex-1 py-3 rounded-xl font-bold text-base transition-all border"
                    style={{ borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }}
                  >
                    رجوع
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex-[2] py-3 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2"
                    style={{ background: '#22c55e', color: '#fff' }}
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
            setSelectedService(null);
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
