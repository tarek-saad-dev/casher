'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { OverviewData, OperationAlert } from '@/lib/operationsTypes';
import { OperationsHeader } from '@/components/operations/OperationsHeader';
import { BarberStatusColumn } from '@/components/operations/BarberStatusColumn';
import { GroupedQueueBoard } from '@/components/operations/GroupedQueueBoard';
import { BookingsColumn } from '@/components/operations/BookingsColumn';
import { AlertsPanel } from '@/components/operations/AlertsPanel';
import { CreateQueueDrawer } from '@/components/operations/CreateQueueDrawer';
import { CreateBookingDrawer } from '@/components/operations/CreateBookingDrawer';
import { BookingControlDrawer } from '@/components/operations/BookingControlDrawer';
import { BUSINESS_DATE_CAIRO } from '@/lib/queueTicketNormalizer';

export default function OperationsPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [alerts, setAlerts] = useState<OperationAlert[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(true);
  // Queue tickets fetched directly from /api/queue — same source as /queue/live
  const [liveTickets, setLiveTickets] = useState<any[]>([]);
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);
  const [showBookingDrawer, setShowBookingDrawer] = useState(false);
  const [showBookingControlDrawer, setShowBookingControlDrawer] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Toast helper ────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Data fetching ────────────────────────────────────────────────────────────
  // Fetch KPIs + barbers from overview (no need for its queue list)
  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/operations/overview');
      const data = await res.json();
      if (res.ok) setOverview(data);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  // Fetch queue tickets directly from /api/queue — SAME source as /queue/live
  const fetchQueueTickets = useCallback(async () => {
    try {
      const date = BUSINESS_DATE_CAIRO();
      const res = await fetch(`/api/queue?date=${date}`);
      const data = await res.json();
      const tickets = data.tickets ?? [];
      if (process.env.NODE_ENV !== 'production') {
        console.log('[operations] queue tickets from same source', tickets);
      }
      if (res.ok) setLiveTickets(tickets);
    } catch { /* non-fatal */ }
  }, []);

  const fetchAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const res = await fetch('/api/operations/alerts');
      const data = await res.json();
      if (res.ok) setAlerts(data.alerts ?? []);
    } catch { /* non-fatal */ }
    finally { setAlertsLoading(false); }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchOverview();
    fetchQueueTickets();
    fetchAlerts();
  }, [fetchOverview, fetchQueueTickets, fetchAlerts]);

  useEffect(() => {
    fetchOverview();
    fetchQueueTickets();
    fetchAlerts();
    // Auto-refresh every 30 seconds (matches /queue/live)
    refreshTimer.current = setInterval(() => {
      fetchOverview();
      fetchQueueTickets();
      fetchAlerts();
    }, 30000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [fetchOverview, fetchQueueTickets, fetchAlerts]);

  // ── Queue ticket actions ─────────────────────────────────────────────────────
  const handleQueueAction = useCallback(async (ticketId: number, action: string, extra?: any) => {
    try {
      const statusMap: Record<string, string> = {
        call: 'called',
        start: 'in_service',
        done: 'done',
        skip: 'skipped',
        cancel: 'cancelled',
      };

      if (action === 'transfer' && extra?.newEmpId) {
        const res = await fetch(`/api/queue/${ticketId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'transfer', transferEmpId: extra.newEmpId }),
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'خطأ'); }
        showToast('تم نقل التذكرة');
        refresh();
        return;
      }

      const newStatus = statusMap[action];
      if (!newStatus) return;

      const res = await fetch(`/api/queue/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: newStatus }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'خطأ'); }

      const labels: Record<string, string> = {
        called: 'تم النداء', in_service: 'بدأت الخدمة',
        done: 'تمت الخدمة', skipped: 'تم التخطي', cancelled: 'تم الإلغاء',
      };
      showToast(labels[newStatus] ?? 'تم التحديث');
      refresh();
    } catch (e: any) {
      showToast(e.message ?? 'حدث خطأ', false);
    }
  }, [refresh, showToast]);

  // ── Booking actions ──────────────────────────────────────────────────────────
  const handleBookingAction = useCallback(async (bookingId: number, action: string) => {
    try {
      // Map UI action → API action (matches /api/bookings/[id] PATCH switch cases)
      const actionMap: Record<string, string> = {
        confirm: 'confirm',
        arrive: 'arrive',
        start: 'start_service',
        cancel: 'cancel',
      };

      if (action === 'add_queue') {
        // Find booking details from overview data
        const booking = overview?.bookings.find(b => b.BookingID === bookingId);
        if (!booking) return;
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: booking.ClientID,
            empId: booking.AssignedEmpID,
            bookingId: booking.BookingID,
            notes: null,
          }),
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'خطأ'); }
        showToast('تمت إضافة العميل للدور');
        refresh();
        return;
      }

      if (action === 'invoice') {
        showToast('سيتم تحويل الحجز لفاتورة — قريباً', true);
        return;
      }

      if (action === 'reschedule') {
        showToast('استخدم صفحة الحجوزات لإعادة الجدولة', true);
        return;
      }

      const apiAction = actionMap[action];
      if (!apiAction) return;

      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: apiAction }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'خطأ'); }

      const labels: Record<string, string> = {
        confirm: 'تم التأكيد', arrive: 'تم التسجيل',
        start_service: 'بدأت الخدمة', cancel: 'تم الإلغاء',
      };
      showToast(labels[apiAction] ?? 'تم التحديث');
      refresh();
    } catch (e: any) {
      showToast(e.message ?? 'حدث خطأ', false);
    }
  }, [overview, refresh, showToast]);

  // ── Alert actions ────────────────────────────────────────────────────────────
  const handleAlertAction = useCallback((alert: OperationAlert) => {
    // Dismiss locally
    setDismissedIds(prev => new Set([...prev, alert.id]));
    // action-specific behaviour can be expanded later
    if (alert.action === 'add_to_queue' && alert.relatedId) {
      handleBookingAction(alert.relatedId, 'add_queue');
    }
  }, [handleBookingAction]);

  // Visible alerts (not dismissed)
  const visibleAlerts = alerts.filter(a => !dismissedIds.has(a.id));

  const barbers = overview?.barbers ?? [];
  // Use directly-fetched live tickets (same source as /queue/live)
  const queueTickets = liveTickets;
  const bookings = overview?.bookings ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#0E0E12' }} dir="rtl">

      {/* Header */}
      <OperationsHeader
        data={overview}
        loading={loading}
        alertsCount={visibleAlerts.length}
        onRefresh={refresh}
        onNewQueue={() => setShowQueueDrawer(true)}
        onNewBooking={() => setShowBookingDrawer(true)}
        onBookingControl={() => setShowBookingControlDrawer(true)}
      />

      {/* Main 4-column grid */}
      <div className="flex-1 overflow-hidden grid" style={{ gridTemplateColumns: '220px 1fr 1fr 200px' }}>

        {/* Col 1: Barbers */}
        <div className="border-l overflow-hidden" style={{ borderColor: '#2A2A35' }}>
          <BarberStatusColumn barbers={barbers} loading={loading} />
        </div>

        {/* Col 2: Live Queue — grouped by barber */}
        <div className="border-l overflow-hidden" style={{ borderColor: '#2A2A35' }}>
          <GroupedQueueBoard
            tickets={queueTickets}
            barbers={barbers}
            loading={loading}
            onAction={handleQueueAction}
            onRefresh={refresh}
          />
        </div>

        {/* Col 3: Bookings */}
        <div className="border-l overflow-hidden" style={{ borderColor: '#2A2A35' }}>
          <BookingsColumn
            bookings={bookings}
            loading={loading}
            onAction={handleBookingAction}
            onRefresh={refresh}
          />
        </div>

        {/* Col 4: Alerts */}
        <div className="overflow-hidden">
          <AlertsPanel
            alerts={visibleAlerts}
            loading={alertsLoading}
            onDismiss={id => setDismissedIds(prev => new Set([...prev, id]))}
            onAction={handleAlertAction}
          />
        </div>
      </div>

      {/* Drawers */}
      {showQueueDrawer && (
        <CreateQueueDrawer
          onClose={() => setShowQueueDrawer(false)}
          onCreated={() => {
            // Immediately refresh queue tickets (same source as /queue/live)
            fetchQueueTickets();
            // Refresh KPIs
            fetchOverview();
            setShowQueueDrawer(false);
            showToast('تم إصدار رقم الانتظار');
          }}
        />
      )}
      {showBookingDrawer && (
        <CreateBookingDrawer
          onClose={() => setShowBookingDrawer(false)}
          onCreated={() => { setShowBookingDrawer(false); refresh(); showToast('تم إنشاء الحجز'); }}
        />
      )}
      {showBookingControlDrawer && (
        <BookingControlDrawer
          onClose={() => setShowBookingControlDrawer(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-5 right-1/2 translate-x-1/2 z-[60] px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl border transition-all"
          style={{
            background: toast.ok ? '#141418' : 'rgba(239,68,68,0.15)',
            color: toast.ok ? '#F7F1E5' : '#EF4444',
            borderColor: toast.ok ? '#2A2A35' : 'rgba(239,68,68,0.35)',
          }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
