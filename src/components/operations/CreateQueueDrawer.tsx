'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Search, User, Scissors, Loader2, CheckCircle2, Zap, Clock, Users, AlertCircle, RefreshCw } from 'lucide-react';
import type { BarberStatus, EstimateResponse } from '@/lib/operationsTypes';
import { QueueTicketCreatedModal } from '@/components/queue/QueueTicketCreatedModal';
import type { QueueTicketPrintData } from '@/components/queue/QueueTicketPrint';
import { normalizeCustomersAhead } from '@/lib/queueCustomersAhead';
import { QueueConflictDialog } from './QueueConflictDialog';

interface Service { ProID: number; ProName: string; SPrice: number; DurationMinutes: number | null; }
interface Client { ClientID: number; Name: string; Mobile?: string; }

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

type Mode = 'nearest' | 'specific';

interface SubmitState {
  canSubmit: boolean;
  reason: string | null;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m} ${d.getHours() < 12 ? 'ص' : 'م'}`;
}

/** Safely extract HH:MM from a value that may be a TIME string, ISO string, or Date */
function normalizeCreatedTime(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) {
    // mssql TIME → Date with 1970-01-01 epoch, use UTC hours/minutes
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    // If it looks like an ISO string with 1970 date, extract time part
    if (v.startsWith('1970-01-01T')) {
      const d = new Date(v);
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    }
    // Plain time string HH:MM or HH:MM:SS
    return v.slice(0, 5);
  }
  return '';
}

export function CreateQueueDrawer({ onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('nearest');
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showClients, setShowClients] = useState(false);
  const [quickCreating, setQuickCreating] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedSvcs, setSelectedSvcs] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<BarberStatus[]>([]);
  const [selectedBarber, setSelectedBarber] = useState<BarberStatus | null>(null);
  const [notes, setNotes] = useState('');
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdData, setCreatedData] = useState<(QueueTicketPrintData & { ticketId: number }) | null>(null);

  // ── Conflict dialog state ───────────────────────────────────────────────
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictData, setConflictData] = useState<{
    conflictBooking: {
      bookingId: number;
      clientName: string | null;
      startTime: string;
      endTime: string;
      status: string;
    } | null;
    availableGapMinutes: number | null;
    requiredDurationMinutes: number;
    suggestedStartAfterBooking: string | null;
    alternativeBarbers: Array<{
      empId: number;
      empName: string;
      available: boolean;
      estimatedStartTime: string;
      reason?: string;
    }>;
    message: string;
  } | null>(null);
  const [forceManualPriority, setForceManualPriority] = useState(false);

  // ── Load services + barbers on mount ──────────────────────────────────────
  useEffect(() => {
    fetch('/api/services?active=true')
      .then(r => r.json()).then(d => setServices(d.services ?? d ?? [])).catch(() => { });
    fetch('/api/barbers/available')
      .then(r => r.json()).then(d => setBarbers(d.barbers ?? [])).catch(() => { });
  }, []);

  // ── Client search — correct endpoint /api/customers?q= ─────────────────
  useEffect(() => {
    if (clientSearch.length < 1) { setClients([]); setClientSearching(false); return; }
    setClientSearching(true);
    const t = setTimeout(async () => {
      try {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[customer search] query', clientSearch);
        }
        const res = await fetch(`/api/customers?q=${encodeURIComponent(clientSearch)}`);
        const data = await res.json();
        // API returns array directly
        const list: Client[] = Array.isArray(data) ? data : (data.clients ?? data.data ?? []);
        setClients(list);
        setShowClients(true);
        if (process.env.NODE_ENV !== 'production') {
          console.log('[customer search] results', list);
        }
      } catch { setClients([]); }
      finally { setClientSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [clientSearch]);

  // ── Fetch estimate whenever relevant state changes ────────────────────────
  const fetchEstimate = useCallback(async () => {
    // In specific mode don't fetch until a barber is selected
    if (mode === 'specific' && !selectedBarber) {
      setEstimate(null);
      return;
    }
    setEstimating(true);
    setEstimate(null);

    const serviceIds = selectedSvcs.map(s => s.ProID);
    const empId = mode === 'specific' ? selectedBarber?.EmpID : undefined;

    const payload: Record<string, unknown> = {
      mode,
      serviceIds,
      requestedAt: new Date().toISOString(),
    };
    if (empId) payload.empId = empId;

    console.log('[drawer estimate request]', payload);
    console.log('[estimate drawer] selectedBarber', selectedBarber);
    console.log('[estimate drawer] selectedEmpId', empId ?? null);

    try {
      const res = await fetch('/api/queue/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: EstimateResponse = await res.json();
      setEstimate(data);

      console.log('[drawer estimate response full]', JSON.stringify(data, null, 2));
      console.log('[drawer estimate display]', {
        empName: data?.best?.empName,
        isFreeNow: data?.best?.isFreeNow,
        statusText: data?.best?.statusText,
        activeQueueCount: data?.best?.activeQueueCount ?? data?.best?.blockingQueueCount,
        waitingCount: data?.best?.waitingCount,
        contextMsg: data?.best?.contextMsg,
        estimatedStartTime: data?.best?.estimatedStartTime,
      });
    } catch { /* non-fatal */ }
    finally { setEstimating(false); }
  }, [mode, selectedBarber, selectedSvcs]);

  useEffect(() => { fetchEstimate(); }, [fetchEstimate]);

  // ── Submit state helper ───────────────────────────────────────────────────
  const getSubmitState = (): SubmitState => {
    // Client is mandatory
    if (!selectedClient) {
      return { canSubmit: false, reason: 'اختر العميل أولاً' };
    }

    if (mode === 'nearest') {
      if (!estimate?.best) {
        return { canSubmit: false, reason: estimating ? null : 'لا يوجد حلاق متاح حالياً' };
      }
      return { canSubmit: true, reason: null };
    }

    // specific mode
    if (!selectedBarber) {
      return { canSubmit: false, reason: 'يرجى اختيار الحلاق أولاً' };
    }
    if (estimating) {
      return { canSubmit: false, reason: null };
    }
    if (!estimate) {
      return { canSubmit: false, reason: 'جاري التحقق من توفر الحلاق...' };
    }
    if (!estimate.ok || !estimate.best) {
      return {
        canSubmit: false,
        reason: estimate.unavailableReason ?? 'الحلاق غير متاح في هذا الوقت',
      };
    }
    return { canSubmit: true, reason: null };
  };

  const submitState = getSubmitState();

  if (process.env.NODE_ENV !== 'production') {
    console.log('[queue drawer] submitState', submitState);
  }

  // ── Toggle service ────────────────────────────────────────────────────────
  const toggleService = (svc: Service) => {
    setSelectedSvcs(prev =>
      prev.find(s => s.ProID === svc.ProID)
        ? prev.filter(s => s.ProID !== svc.ProID)
        : [...prev, svc]
    );
  };

  // ── Quick-create customer ─────────────────────────────────────────────────
  const handleQuickCreate = async () => {
    const q = clientSearch.trim();
    if (!q) return;
    setQuickCreating(true);
    try {
      // Determine if query looks like a phone number
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
      if (process.env.NODE_ENV !== 'production') {
        console.log('[customer select] quick-created', newClient);
      }
      setSelectedClient(newClient);
      setClientSearch('');
      setClients([]);
      setShowClients(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل إنشاء العميل');
    } finally {
      setQuickCreating(false);
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setError(null);

    // Re-validate
    const { canSubmit, reason } = getSubmitState();
    if (!canSubmit) { setError(reason ?? 'تحقق من البيانات'); return; }

    // Hard guard — clientId must be a real number
    const clientId = selectedClient?.ClientID;
    if (!clientId) { setError('اختر العميل أولاً'); return; }
    if (process.env.NODE_ENV !== 'production') {
      console.log('[queue submit] clientId', clientId);
    }

    const best = estimate!.best!;
    const empId = mode === 'nearest' ? best.empId : selectedBarber!.EmpID;
    const empName = mode === 'nearest' ? best.empName : selectedBarber!.EmpName;
    if (!empId) { setError('الرجاء اختيار حلاق'); return; }

    // ── Check for booking conflicts before creating ────────────────────────────
    if (!forceManualPriority) {
      const serviceIds = selectedSvcs.map(s => s.ProID);
      const checkRes = await fetch('/api/operations/queue/check-insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId,
          serviceIds,
          mode,
          requestedAt: new Date().toISOString(),
        }),
      });

      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (!checkData.canInsertBeforeNextBooking && checkData.requiresForceFlag) {
          // Conflict detected — show dialog
          setConflictData({
            conflictBooking: checkData.conflictBooking || null,
            availableGapMinutes: checkData.availableGapMinutes || null,
            requiredDurationMinutes: checkData.requiredDurationMinutes || 0,
            suggestedStartAfterBooking: checkData.suggestedStartAfterBooking || null,
            alternativeBarbers: checkData.alternativeBarbers || [],
            message: checkData.message || 'يوجد تعارض مع حجز قادم',
          });
          setConflictDialogOpen(true);
          return; // Don't proceed yet — wait for user decision
        }
      }
      // If check fails, we'll proceed and let the server handle it
    }

    // Server recalculates estimate inside a serializable transaction — don't send from client
    const submitPayload: {
      clientId: number;
      empId: number;
      notes: string | null;
      services: Array<{ proId: number; proName: string; qty: number; price: number; durationMinutes: number | null }>;
      forceManualPriority?: boolean;
    } = {
      clientId: Number(clientId),
      empId,
      notes: notes || null,
      services: selectedSvcs.map(s => ({
        proId: s.ProID, proName: s.ProName,
        qty: 1, price: s.SPrice, durationMinutes: s.DurationMinutes,
      })),
    };

    // Add force flag if user chose to override
    if (forceManualPriority) {
      submitPayload.forceManualPriority = true;
    }

    console.log('[queue submit] payload', submitPayload);

    setSubmitting(true);
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitPayload),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'خطأ'); }
      const data = await res.json();

      if (process.env.NODE_ENV !== 'production') {
        console.log('[queue create] raw response', data);
      }

      // data.ticket now uses camelCase keys from the normalized API response
      const t = data.ticket;

      // Build services list: prefer DB services (with catalog names), fallback to form state
      const apiServices: Array<{ name: string }> =
        (t?.services ?? data.services ?? []).length > 0
          ? (t?.services ?? data.services).map((s: { ProName?: string | null; proName?: string | null }) => ({
            name: s.ProName ?? s.proName ?? '',
          })).filter((s: { name: string }) => s.name)
          : selectedSvcs.map(s => ({ name: s.ProName }));

      // Use server-returned values — these are authoritative (recalculated inside tx)
      const resolvedClientName = t?.clientName ?? selectedClient?.Name ?? null;
      const resolvedEmpName = t?.barberName ?? empName;
      const resolvedDate = t?.queueDate ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
      const rawTime = t?.createdTime ?? new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour12: false });
      const resolvedTime = normalizeCreatedTime(rawTime);
      // Prefer server-recalculated values (flat fields in response)
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
        services: apiServices,
        queueDate: resolvedDate,
        createdTime: resolvedTime,
        waitingBefore: resolvedWaitCount,
        estimatedWaitMinutes: resolvedEstWait,
        estimatedStartTime: resolvedEstStart,
      };

      console.log('[ticket modal] ticket for modal/print', normalized);

      setCreatedData(normalized);
      // Reset force flag after successful creation
      setForceManualPriority(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل إصدار الدور');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Handle conflict dialog actions ─────────────────────────────────────────
  const handlePlaceAfterBooking = () => {
    setConflictDialogOpen(false);
    setForceManualPriority(false);
    // User wants to place after booking — submit normally
    // The server will calculate the correct slot
    handleSubmit();
  };

  const handleSelectAlternativeBarber = (newEmpId: number) => {
    setConflictDialogOpen(false);
    // Switch to specific mode and select the alternative barber
    const altBarber = barbers.find(b => b.EmpID === newEmpId);
    if (altBarber) {
      setMode('specific');
      setSelectedBarber(altBarber);
      // Re-fetch estimate with new barber
      fetchEstimate();
    }
  };

  const handleForceManualPriority = () => {
    setConflictDialogOpen(false);
    setForceManualPriority(true);
    // Re-submit with force flag
    handleSubmit();
  };

  const handleCancelConflict = () => {
    setConflictDialogOpen(false);
    setForceManualPriority(false);
  };

  // ── Estimate panel content ────────────────────────────────────────────────
  const renderEstimatePanel = () => {
    if (estimating) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
          <Loader2 size={14} className="animate-spin" /> جاري حساب الوقت المتوقع...
        </div>
      );
    }

    // Specific mode — no barber selected yet
    if (mode === 'specific' && !selectedBarber) {
      return <p className="text-sm text-muted-foreground/60">اختر الحلاق لعرض التقدير</p>;
    }

    // Specific mode — barber unavailable
    if (mode === 'specific' && selectedBarber && estimate && !estimate.ok) {
      const reason = (estimate as any).unavailableReason
        ?? estimate.unavailable?.[0]?.reason
        ?? 'خارج مواعيد العمل';
      return (
        <div className="flex items-start gap-2">
          <AlertCircle size={15} className="text-destructive mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">الحلاق غير متاح</p>
            <p className="text-xs text-muted-foreground/70 mt-1">{reason}</p>
          </div>
        </div>
      );
    }

    // No estimate loaded yet (and not estimating)
    if (!estimate) {
      return <p className="text-sm text-muted-foreground/60">اختر الخدمات لعرض التقدير</p>;
    }

    // Nearest — no available barber
    if (!estimate.ok && !estimate.best && mode === 'nearest') {
      return (
        <div>
          <p className="text-sm text-muted-foreground/70 mb-2">لا يوجد حلاق متاح حالياً</p>
          {(estimate.unavailable?.length ?? 0) > 0 && (
            <div className="space-y-1 mt-2">
              {estimate.unavailable.map(u => (
                <div key={u.empId} className="flex items-center justify-between text-xs text-muted-foreground/60">
                  <span>{u.empName}</span>
                  <span className="text-destructive/70">{u.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    const best = estimate.best;
    const contextMsg = best?.contextMsg ?? (estimate as any)?.contextMsg ?? '';
    const statusText = best?.statusText ?? '';
    const isFreeNow = best?.isFreeNow ?? false;
    // activeQueueCount: read every possible field the API may have returned
    const activeQueueCount =
      (typeof best?.activeQueueCount === 'number' ? best.activeQueueCount : null) ??
      (typeof best?.blockingQueueCount === 'number' ? best.blockingQueueCount : null) ??
      (typeof best?.waitingCount === 'number' ? best.waitingCount : null) ??
      0;
    const waitingCount = activeQueueCount;

    // ── Diagnostic: log exact values used in render ─────────────────────────
    console.log('[estimate panel render source]', {
      selectedBarber: selectedBarber ? { id: selectedBarber.EmpID, name: selectedBarber.EmpName } : null,
      estimate_ok: estimate.ok,
      best_raw: best,
      displayedStatus: activeQueueCount > 0 ? 'مشغول' : (isFreeNow ? 'فاضي الآن' : statusText),
      displayedWaitingCount: activeQueueCount,
      displayedEstimatedTime: best?.estimatedStartTime,
      displayedWaitMinutes: best?.estimatedWaitMinutes,
      contextMsg,
    });

    if (best) {
      // Derive final status: activeQueueCount wins over isFreeNow/statusText
      const derivedStatus = activeQueueCount > 0 ? 'مشغول' : (isFreeNow ? 'فاضي الآن' : statusText);
      const derivedFreeNow = activeQueueCount === 0 && isFreeNow;
      const statusColor = !estimate.ok
        ? 'var(--destructive)'
        : derivedFreeNow ? 'var(--success)' : 'var(--warning)';

      return (
        <>
          {/* Barber + status row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-primary" />
              <span className="text-sm font-bold" style={{ color: 'var(--primary)' }}>
                {mode === 'nearest' ? `أفضل اختيار: ${best.empName}` : best.empName}
              </span>
            </div>
            {derivedStatus && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: statusColor + '20', color: statusColor }}>
                {derivedStatus}
              </span>
            )}
          </div>

          {/* Estimate grid */}
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground/70 flex items-center gap-1.5">
                <Clock size={11} />الوقت المتوقع للدخول
              </span>
              <span className="text-foreground font-semibold">{fmtTime(best.estimatedStartTime)}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground/70 flex items-center gap-1.5">
                <Users size={11} />أمامك
              </span>
              <span className="font-semibold" style={{ color: activeQueueCount > 0 ? 'var(--warning)' : 'var(--success)' }}>
                {activeQueueCount} {activeQueueCount === 1 ? 'عميل' : 'عملاء'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground/70 flex items-center gap-1.5">
                <Clock size={11} />الانتظار المتوقع
              </span>
              <span className="text-foreground font-semibold">
                {best.estimatedWaitMinutes > 0 ? `~${best.estimatedWaitMinutes} دقيقة` : 'فوري'}
              </span>
            </div>
          </div>

          {/* Context message — always derived from activeQueueCount, never from HR availability */}
          {(() => {
            const msg = activeQueueCount > 0
              ? `الحلاق مشغول — يوجد ${activeQueueCount} ${activeQueueCount === 1 ? 'دور' : 'أدوار'} قبلك`
              : (contextMsg || 'الحلاق فاضي الآن — سيبدأ فوراً');
            const isWarning = activeQueueCount > 0;
            return (
              <div className="mt-3 px-3 py-2 rounded-lg text-xs flex items-start gap-1.5"
                style={{
                  background: isWarning ? 'color-mix(in srgb, var(--warning) 8%, transparent)' : 'color-mix(in srgb, var(--success) 8%, transparent)',
                  border: `1px solid ${isWarning ? 'color-mix(in srgb, var(--warning) 20%, transparent)' : 'color-mix(in srgb, var(--success) 20%, transparent)'}`,
                  color: isWarning ? 'var(--primary)' : 'var(--success)',
                }}>
                <CheckCircle2 size={11} className="mt-0.5 flex-shrink-0" />
                <span>{msg}</span>
              </div>
            );
          })()}

          {/* Alternatives (nearest mode only) */}
          {mode === 'nearest' && (estimate.alternatives?.length ?? 0) > 0 && (
            <div className="mt-3 pt-3 border-t space-y-1.5" style={{ borderColor: 'var(--surface-muted)' }}>
              <p className="text-xs text-muted-foreground/70 mb-1">بدائل متاحة:</p>
              {estimate.alternatives.slice(0, 3).map(alt => {
                const altWait = (alt as any).waitingCount ?? (alt as any).blockingQueueCount ?? 0;
                return (
                  <button key={alt.empId}
                    onClick={() => {
                      const b = barbers.find(x => x.EmpID === alt.empId);
                      if (b) { setMode('specific'); setSelectedBarber(b); }
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs hover:border-muted-foreground transition-all"
                    style={{ borderColor: 'var(--surface-muted)' }}>
                    <span className="text-foreground font-medium">{alt.empName}</span>
                    <div className="flex items-center gap-2 text-muted-foreground/70">
                      <span>{altWait} أمامك</span>
                      <span>~{alt.estimatedWaitMinutes} د</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Unavailable list (nearest mode) */}
          {mode === 'nearest' && (estimate.unavailable?.length ?? 0) > 0 && (
            <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--surface-muted)' }}>
              <p className="text-xs text-muted-foreground/60 mb-1">غير متاح حالياً:</p>
              {estimate.unavailable.map(u => (
                <div key={u.empId} className="flex items-center justify-between text-xs text-muted-foreground/60 py-0.5">
                  <span>{u.empName}</span>
                  <span className="text-destructive/60">{u.reason}</span>
                </div>
              ))}
            </div>
          )}
        </>
      );
    }

    return <p className="text-sm text-muted-foreground/60">اختر الخدمات لعرض التقدير</p>;
  };

  // ── Created modal ─────────────────────────────────────────────────────────
  if (createdData) {
    return (
      <div className="fixed inset-0 z-50">
        <QueueTicketCreatedModal
          data={createdData}
          onNewTicket={() => {
            setCreatedData(null);
            setSelectedClient(null);
            setSelectedBarber(null);
            setSelectedSvcs([]);
            setNotes('');
            setEstimate(null);
          }}
          onClose={() => { onCreated(); }}
        />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-end bg-background/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md flex flex-col shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface-elevated)', borderLeft: '1px solid var(--surface-muted)' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Sticky Header ── */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: 'var(--surface-muted)' }}
        >
          <h2 className="font-bold text-foreground text-base">إصدار دور جديد</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-surface-muted transition-all"
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* 1. Mode selector */}
          <section>
            <p className="text-xs font-semibold text-muted-foreground mb-2">طريقة الاختيار</p>
            <div className="grid grid-cols-2 gap-2">
              {([['nearest', 'أقرب حلاق متاح'], ['specific', 'حلاق معين']] as [Mode, string][]).map(([m, lbl]) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setSelectedBarber(null); setEstimate(null); }}
                  className="py-2.5 rounded-xl border text-sm font-semibold transition-all"
                  style={{
                    borderColor: mode === m ? 'var(--primary)' : 'var(--surface-muted)',
                    color: mode === m ? 'var(--primary)' : 'var(--muted-foreground)',
                    background: mode === m ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </section>

          {/* 2. Client search */}
          <section className="relative">
            <p className="text-xs font-semibold text-muted-foreground mb-2">
              العميل <span className="text-destructive">*</span>
            </p>
            {selectedClient ? (
              /* ── Selected client card ── */
              <div
                className="flex items-center justify-between px-3 py-2.5 rounded-xl border"
                style={{ borderColor: 'var(--success)', background: 'color-mix(in srgb, var(--success) 8%, transparent)' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <User size={14} className="text-success flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{selectedClient.Name}</p>
                    {selectedClient.Mobile && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5">{selectedClient.Mobile}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedClient(null);
                    setClientSearch('');
                    setClients([]);
                  }}
                  className="text-xs text-muted-foreground/70 hover:text-primary transition-colors flex-shrink-0 mr-2 border border-border rounded-lg px-2 py-1"
                >
                  تغيير
                </button>
              </div>
            ) : (
              /* ── Search input + dropdown ── */
              <>
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border"
                  style={{
                    borderColor: clientSearch.length > 0 ? 'var(--primary)' : 'var(--surface-muted)',
                    background: 'var(--surface)',
                  }}
                >
                  {clientSearching
                    ? <Loader2 size={13} className="text-amber-400 animate-spin flex-shrink-0" />
                    : <Search size={13} className="text-muted-foreground/70 flex-shrink-0" />
                  }
                  <input
                    className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
                    placeholder="ابحث بالاسم أو رقم الهاتف..."
                    value={clientSearch}
                    onChange={e => { setClientSearch(e.target.value); setShowClients(true); }}
                    onFocus={() => { if (clients.length > 0) setShowClients(true); }}
                  />
                  {clientSearch && (
                    <button
                      onClick={() => { setClientSearch(''); setClients([]); setShowClients(false); }}
                      className="text-muted-foreground/60 hover:text-muted-foreground"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Dropdown results */}
                {showClients && clientSearch.length > 0 && (
                  <div
                    className="absolute top-full left-0 right-0 mt-1 rounded-xl border shadow-2xl z-20 overflow-hidden"
                    style={{ background: 'var(--surface-muted)', borderColor: 'var(--surface-muted)' }}
                  >
                    {clients.length > 0 ? (
                      <>
                        {clients.slice(0, 6).map(c => (
                          <button
                            key={c.ClientID}
                            className="w-full text-right px-4 py-2.5 hover:bg-surface-muted transition-colors flex items-center justify-between gap-2"
                            onClick={() => {
                              if (process.env.NODE_ENV !== 'production') {
                                console.log('[customer select] selectedClient', c);
                              }
                              setSelectedClient(c);
                              setClientSearch('');
                              setClients([]);
                              setShowClients(false);
                            }}
                          >
                            <span className="text-sm text-foreground font-medium">{c.Name}</span>
                            {c.Mobile && <span className="text-muted-foreground/70 text-xs">{c.Mobile}</span>}
                          </button>
                        ))}
                        <div className="border-t px-4 py-2" style={{ borderColor: 'var(--surface-muted)' }}>
                          <p className="text-[11px] text-muted-foreground/60">{clients.length} نتيجة</p>
                        </div>
                      </>
                    ) : clientSearching ? (
                      <div className="px-4 py-3 text-xs text-muted-foreground/70 flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin" /> جاري البحث...
                      </div>
                    ) : (
                      /* No results — offer quick create */
                      <div className="p-3 space-y-2">
                        <p className="text-xs text-muted-foreground/60">لا توجد نتائج لـ «{clientSearch}»</p>
                        <button
                          onClick={handleQuickCreate}
                          disabled={quickCreating}
                          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                          style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)', border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)' }}
                        >
                          {quickCreating
                            ? <Loader2 size={11} className="animate-spin" />
                            : <span>+</span>
                          }
                          {quickCreating ? 'جاري الإنشاء...' : `إضافة عميل «${clientSearch.trim()}»`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {/* 3. Barber selector — specific mode */}
          {mode === 'specific' && (
            <section>
              <p className="text-xs font-semibold text-muted-foreground mb-2">اختر الحلاق</p>
              {barbers.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">لا توجد بيانات حلاقين</p>
              ) : (
                <div className="space-y-1.5">
                  {barbers.map(b => {
                    const isSelected = selectedBarber?.EmpID === b.EmpID;
                    return (
                      <button
                        key={b.EmpID}
                        onClick={() => setSelectedBarber(isSelected ? null : b)}
                        className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm transition-all"
                        style={{
                          borderColor: isSelected ? 'var(--primary)' : 'var(--surface-muted)',
                          background: isSelected ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
                          opacity: b.IsAvailable ? 1 : 0.65,
                        }}
                      >
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="font-medium text-foreground">{b.EmpName}</span>
                          {b.WorkingStartTime && b.WorkingEndTime && (
                            <span className="text-[10px] text-muted-foreground/60">
                              {b.WorkingStartTime.slice(0, 5)} – {b.WorkingEndTime.slice(0, 5)}
                            </span>
                          )}
                        </div>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{
                            background: b.IsAvailable ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--destructive) 12%, transparent)',
                            color: b.IsAvailable ? 'var(--success)' : 'var(--destructive)',
                          }}
                        >
                          {b.IsAvailable ? 'متاح' : (b.AvailabilityReason || 'غير متاح')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* 4. Services */}
          <section>
            <p className="text-xs font-semibold text-muted-foreground mb-2">
              الخدمات <span className="text-muted-foreground/60">(اختياري)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {services.slice(0, 20).map(svc => {
                const sel = selectedSvcs.find(s => s.ProID === svc.ProID);
                return (
                  <button
                    key={svc.ProID}
                    onClick={() => toggleService(svc)}
                    className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                    style={{
                      borderColor: sel ? 'var(--primary)' : 'var(--surface-muted)',
                      color: sel ? 'var(--primary)' : 'var(--muted-foreground)',
                      background: sel ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
                    }}
                  >
                    <Scissors size={10} className="inline ml-1" />
                    {svc.ProName}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 5. Notes */}
          <section>
            <p className="text-xs font-semibold text-muted-foreground mb-2">ملاحظات</p>
            <textarea
              rows={2}
              className="w-full rounded-xl border px-3 py-2 text-sm text-foreground bg-transparent placeholder-muted-foreground outline-none resize-none"
              style={{ borderColor: 'var(--surface-muted)' }}
              placeholder="ملاحظة اختيارية..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </section>

          {/* 6. Estimate panel */}
          <section
            className="rounded-xl border p-4"
            style={{ borderColor: 'var(--surface-muted)', background: 'var(--surface)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                <Clock size={12} /> الوقت التقديري
              </p>
              <button
                onClick={fetchEstimate}
                disabled={estimating}
                className="text-muted-foreground/60 hover:text-primary disabled:opacity-40 transition-colors"
                title="تحديث التقدير"
              >
                <RefreshCw size={11} className={estimating ? 'animate-spin' : ''} />
              </button>
            </div>
            {renderEstimatePanel()}
          </section>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2">
              <AlertCircle size={14} className="flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* ── Sticky Footer ── */}
        <div className="px-5 py-4 border-t flex-shrink-0 space-y-2" style={{ borderColor: 'var(--surface-muted)' }}>
          {/* Disable reason above button */}
          {!submitState.canSubmit && submitState.reason && !submitting && (
            <p className="text-xs text-center text-muted-foreground/70">{submitState.reason}</p>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting || !submitState.canSubmit}
            className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg,var(--primary),var(--primary-active))', color: 'var(--primary-foreground)' }}
          >
            {submitting
              ? <><Loader2 size={15} className="animate-spin" /> جاري إصدار الدور...</>
              : <><CheckCircle2 size={15} /> إصدار رقم الانتظار</>
            }
          </button>
        </div>

      </div>
    </div>
  );
}
