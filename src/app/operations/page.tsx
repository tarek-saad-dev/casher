'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { OperationsToolbar } from '@/components/operations/OperationsToolbar';
import { SchedulerBoard } from '@/components/operations/SchedulerBoard';
import { BottomSummaryStrip } from '@/components/operations/BottomSummaryStrip';
import { SimpleCreateQueueDrawer } from '@/components/operations/SimpleCreateQueueDrawer';

// Types matching flow-board response
interface FlowBoardBarber {
  empId: number;
  empName: string;
  status: 'working' | 'off' | 'day_off' | 'unknown';
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  nextAvailableAt: string | null;
  waitingCount: number;
  bookingsCount: number;
  inServiceCount: number;
  timeline: Array<{
    type: 'queue' | 'booking' | 'gap' | 'in_service';
    sourceId: number;
    label: string;
    startTime: string;
    endTime: string;
    status: string;
    protected?: boolean;
    customerName?: string;
    durationMinutes?: number;
    ticketCode?: string;
  }>;
}

interface FlowBoardResponse {
  ok: boolean;
  date: string;
  generatedAt: string;
  barbers: FlowBoardBarber[];
}

// Format date for display
function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  
  const dayName = days[date.getDay()];
  const dayNum = date.getDate();
  const monthName = months[date.getMonth()];
  const year = date.getFullYear();
  
  return `${dayName} ${dayNum} ${monthName} ${year}`;
}

// Get today in Cairo timezone
function getCairoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

// Add/subtract days
function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function OperationsPage() {
  const [selectedDate, setSelectedDate] = useState<string>(getCairoToday());
  const [flowBoardData, setFlowBoardData] = useState<FlowBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDrawer, setShowCreateDrawer] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Toast helper
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Fetch flow board data
  const fetchFlowBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/operations/flow-board?date=${selectedDate}`);
      const data: FlowBoardResponse = await res.json();
      
      if (!data.ok) {
        throw new Error('فشل تحميل البيانات');
      }

      // Debug logging
      console.log('=== FLOW-BOARD RESPONSE ===', data);
      data.barbers.forEach(b => {
        console.log(`Barber ${b.empName} (ID:${b.empId}):`);
        console.log(`  Status: ${b.status}, Waiting: ${b.waitingCount}, Bookings: ${b.bookingsCount}`);
        console.log(`  Timeline items: ${b.timeline?.length || 0}`);
        if (b.timeline?.length > 0) {
          console.log(`  First: ${JSON.stringify(b.timeline[0])}`);
          console.log(`  Last: ${JSON.stringify(b.timeline[b.timeline.length - 1])}`);
        }
      });

      setFlowBoardData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تحميل لوحة التشغيل');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  // Initial load and auto-refresh
  useEffect(() => {
    fetchFlowBoard();
    // Auto-refresh every 30 seconds
    refreshTimer.current = setInterval(fetchFlowBoard, 30000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [fetchFlowBoard]);

  // Navigation handlers
  const handlePrevDay = useCallback(() => {
    setSelectedDate(prev => addDays(prev, -1));
  }, []);

  const handleNextDay = useCallback(() => {
    setSelectedDate(prev => addDays(prev, 1));
  }, []);

  const handleToday = useCallback(() => {
    setSelectedDate(getCairoToday());
  }, []);

  // Calculate summary stats
  const summaryStats = useCallback(() => {
    if (!flowBoardData) return { nextAvailable: null, totalWaiting: 0, totalBookings: 0 };
    
    const workingBarbers = flowBoardData.barbers.filter(b => b.status === 'working');
    
    // Find next available barber
    let nextAvailable: { name: string; time: string } | null = null;
    for (const barber of workingBarbers) {
      if (barber.nextAvailableAt) {
        const barberTime = new Date(barber.nextAvailableAt).getTime();
        const now = Date.now();
        if (barberTime >= now || barberTime - now < 60 * 60 * 1000) { // Within 1 hour
          const timeStr = new Date(barber.nextAvailableAt).toLocaleTimeString('ar-EG', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });
          if (!nextAvailable) {
            nextAvailable = { name: barber.empName, time: timeStr };
          }
          break;
        }
      }
    }
    
    // Total waiting across all barbers
    const totalWaiting = workingBarbers.reduce((sum, b) => sum + b.waitingCount, 0);
    
    // Total bookings
    const totalBookings = workingBarbers.reduce((sum, b) => sum + b.bookingsCount, 0);
    
    return { nextAvailable, totalWaiting, totalBookings };
  }, [flowBoardData]);

  const stats = summaryStats();

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#050505' }} dir="rtl">
      {/* Top Toolbar */}
      <OperationsToolbar
        date={selectedDate}
        dateLabel={formatDateLabel(selectedDate)}
        onPrevDay={handlePrevDay}
        onNextDay={handleNextDay}
        onToday={handleToday}
        onRefresh={fetchFlowBoard}
        onCreateQueue={() => setShowCreateDrawer(true)}
        loading={loading}
      />

      {/* Main Scheduler Board */}
      <SchedulerBoard
        barbers={flowBoardData?.barbers || []}
        loading={loading}
        error={error}
        onRetry={fetchFlowBoard}
      />

      {/* Bottom Summary Strip */}
      <BottomSummaryStrip
        nextAvailableBarber={stats.nextAvailable}
        totalWaiting={stats.totalWaiting}
        totalBookings={stats.totalBookings}
      />

      {/* Create Queue Drawer */}
      {showCreateDrawer && (
        <SimpleCreateQueueDrawer
          isOpen={showCreateDrawer}
          onClose={() => setShowCreateDrawer(false)}
          onCreated={() => {
            fetchFlowBoard();
            showToast('تم إنشاء الدور بنجاح');
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-5 right-1/2 translate-x-1/2 z-[60] px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl border transition-all"
          style={{
            background: toast.ok ? '#141418' : 'rgba(239,68,68,0.15)',
            color: toast.ok ? '#F7F1E5' : '#EF4444',
            borderColor: toast.ok ? 'rgba(212,175,55,0.3)' : 'rgba(239,68,68,0.35)',
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
