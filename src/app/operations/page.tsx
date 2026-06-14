'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { OperationsToolbar } from '@/components/operations/OperationsToolbar';
import { SchedulerBoard } from '@/components/operations/SchedulerBoard';
import { BottomSummaryStrip } from '@/components/operations/BottomSummaryStrip';
import { SimpleCreateQueueDrawer } from '@/components/operations/SimpleCreateQueueDrawer';
import { FindNearestQueueDrawer } from '@/components/operations/FindNearestQueueDrawer';
import { VoiceEnableBanner } from '@/components/operations/VoiceEnableBanner';
import { OperationsMusicPlayerEnhanced } from '@/components/operations/OperationsMusicPlayerEnhanced';
import { CreateBookingDrawer } from '@/components/operations/CreateBookingDrawer';
import { useAutoVoiceAnnounce, isVoiceEnabled, enableVoice, disableVoice } from '@/hooks/useAutoVoiceAnnounce';
import { Plus, CalendarPlus } from 'lucide-react';

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
    protected: boolean;
    customerName?: string;
    durationMinutes?: number;
    ticketCode?: string;
    // Lifecycle fields
    effectiveStatus?: string;
    actualStatus?: string;
    needsOperatorAction?: boolean;
    overdueMinutes?: number;
    expectedStartAt?: string;
    expectedEndAt?: string;
    isCountingAhead?: boolean;
    isBlockingAvailability?: boolean;
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

// Business date: if Cairo time is before 4:00 AM, we're still in the previous operational day
const BUSINESS_DAY_CUTOFF_HOUR = 4;

function getCairoBusinessDate(): string {
  const now = new Date();
  // Get Cairo hour using Intl
  const cairoHour = parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(now),
    10
  );
  if (cairoHour < BUSINESS_DAY_CUTOFF_HOUR) {
    // Still in previous operational day — return yesterday Cairo date
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return yesterday.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  }
  return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function isAfterMidnightShift(): boolean {
  const now = new Date();
  const cairoHour = parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(now),
    10
  );
  return cairoHour < BUSINESS_DAY_CUTOFF_HOUR;
}

// Add/subtract days
function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function OperationsPage() {
  const [selectedDate, setSelectedDate] = useState<string>(getCairoBusinessDate());
  const [flowBoardData, setFlowBoardData] = useState<FlowBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDrawer, setShowCreateDrawer] = useState(false);
  const [showFindNearestDrawer, setShowFindNearestDrawer] = useState(false);
  const [showBookingDrawer, setShowBookingDrawer] = useState(false);
  const [settlingExpired, setSettlingExpired] = useState(false);
  const [bookingInitialData, setBookingInitialData] = useState<{
    date?: string;
    time?: string;
    empId?: number;
    barberName?: string;
    timeRangeStart?: string;
    timeRangeEnd?: string;
  }>({});
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Toast helper - defined first to be available for voice handlers
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Voice auto-announcement state
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [musicPlayerExpanded, setMusicPlayerExpanded] = useState(false);

  // Check voice enabled status on mount
  useEffect(() => {
    setVoiceEnabled(isVoiceEnabled());
  }, []);

  // Set page title with emoji
  useEffect(() => {
    document.title = '💈 لوحة التحكم - الصالون';
  }, []);

  // Voice auto-announcement hook
  const { isPlaying: isAnnouncing, reannounce } = useAutoVoiceAnnounce({
    date: selectedDate,
    enabled: voiceEnabled,
    pollIntervalMs: 10000, // Check every 10 seconds
    onAnnouncementStart: (announcement) => {
      showToast(`نداء: ${announcement.ticketCode}`, true);
    },
    onError: (error) => {
      console.error('[Voice] Error:', error);
    },
  });

  // Handle voice enable/disable
  const handleEnableVoice = useCallback(() => {
    const success = enableVoice();
    if (success) {
      setVoiceEnabled(true);
      showToast('تم تفعيل النداء الصوتي', true);
    } else {
      showToast('فشل تفعيل النداء الصوتي - تأكد من دعم المتصفح', false);
    }
  }, [showToast]);

  const handleDisableVoice = useCallback(() => {
    disableVoice();
    setVoiceEnabled(false);
    showToast('تم إيقاف النداء الصوتي', true);
  }, [showToast]);

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

  // Settle expired tickets handler
  const handleSettleExpired = useCallback(async () => {
    if (settlingExpired) return;

    const confirmed = window.confirm(
      'هل تريد تسوية الأدوار المنتهية لهذا اليوم؟\n\nسيتم التعامل فقط مع الأدوار التي انتهى وقتها وتحتاج إجراء.'
    );

    if (!confirmed) return;

    setSettlingExpired(true);

    try {
      const res = await fetch('/api/queue/settle-expired', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate }),
      });

      const data = await res.json();

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || 'فشل تسوية الأدوار المنتهية');
      }

      showToast(
        `تمت تسوية الأدوار المنتهية بنجاح${typeof data.settled === 'number' ? ` (${data.settled})` : ''}`,
        true
      );

      await fetchFlowBoard();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'فشل تسوية الأدوار المنتهية',
        false
      );
    } finally {
      setSettlingExpired(false);
    }
  }, [settlingExpired, selectedDate, fetchFlowBoard, showToast]);

  // Navigation handlers
  const handlePrevDay = useCallback(() => {
    setSelectedDate(prev => addDays(prev, -1));
  }, []);

  const handleNextDay = useCallback(() => {
    setSelectedDate(prev => addDays(prev, 1));
  }, []);

  const handleToday = useCallback(() => {
    setSelectedDate(getCairoBusinessDate());
  }, []);

  const handleDateSelect = useCallback((date: string) => {
    setSelectedDate(date);
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

  const afterMidnight = isAfterMidnightShift();

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#050505' }} dir="rtl">
      {/* Top Toolbar */}
      <OperationsToolbar
        date={selectedDate}
        dateLabel={formatDateLabel(selectedDate)}
        onPrevDay={handlePrevDay}
        onNextDay={handleNextDay}
        onToday={handleToday}
        onDateSelect={handleDateSelect}
        onRefresh={fetchFlowBoard}
        onCreateQueue={() => setShowCreateDrawer(true)}
        onFindNearestQueue={() => setShowFindNearestDrawer(true)}
        onSettleExpired={handleSettleExpired}
        settlingExpired={settlingExpired}
        loading={loading}
      />

      {/* After-midnight banner */}
      {afterMidnight && selectedDate === getCairoBusinessDate() && (
        <div
          className="flex items-center justify-center gap-2 py-1.5 text-xs font-medium"
          style={{ background: 'rgba(139, 92, 246, 0.12)', borderBottom: '1px solid rgba(139, 92, 246, 0.25)', color: '#a78bfa' }}
        >
          <span>🌙</span>
          <span>وقت القاهرة بعد منتصف الليل — تعمل على يوم التشغيل السابق</span>
          <span style={{ opacity: 0.6 }}>|</span>
          <button
            onClick={() => setSelectedDate(getCairoToday())}
            className="underline hover:no-underline transition-all"
            style={{ color: '#c4b5fd' }}
          >
            انتقل ليوم {formatDateLabel(getCairoToday()).split(' ').slice(0, 2).join(' ')}
          </button>
        </div>
      )}

      {/* Create Booking Button + Voice Enable Banner & Music Player */}
      <div className="px-4 py-2 space-y-2">
        {/* Create Booking Button */}
        <div className="flex justify-center">
          <button
            onClick={() => {
              setBookingInitialData({ date: selectedDate });
              setShowBookingDrawer(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'linear-gradient(135deg,#D4AF37,#B8941F)', color: '#000' }}
          >
            <CalendarPlus size={18} />
            + إنشاء حجز
          </button>
        </div>
        <div className="flex justify-center">
          <VoiceEnableBanner
            enabled={voiceEnabled}
            onEnable={handleEnableVoice}
            onDisable={handleDisableVoice}
          />
        </div>
        <div className="flex justify-center">
          <div className="w-full max-w-md">
            <OperationsMusicPlayerEnhanced
              isExpanded={musicPlayerExpanded}
              onToggleExpand={() => setMusicPlayerExpanded(!musicPlayerExpanded)}
            />
          </div>
        </div>
      </div>

      {/* Main Scheduler Board */}
      <SchedulerBoard
        barbers={flowBoardData?.barbers || []}
        loading={loading}
        error={error}
        onRetry={fetchFlowBoard}
        onRefresh={fetchFlowBoard}
        voiceEnabled={voiceEnabled}
        onReannounce={reannounce}
        currentDate={selectedDate}
        addToast={(type, message) => showToast(message, type !== 'error')}
        onEmptyCellClick={(hour, barber) => {
          // Convert operational hour to time strings
          // Each cell represents a 1-hour range (e.g., 15:00 to 16:00)
          const startHour = hour >= 24 ? hour - 24 : hour;
          const endHour = startHour + 1;

          const timeRangeStart = `${String(startHour).padStart(2, '0')}:00`;
          const timeRangeEnd = `${String(endHour).padStart(2, '0')}:00`;

          setBookingInitialData({
            date: selectedDate,
            time: timeRangeStart,  // Default to start of range
            empId: barber.empId,
            barberName: barber.empName,
            timeRangeStart,
            timeRangeEnd,
          });
          setShowBookingDrawer(true);
        }}
        onFreeSegmentClick={(segment, barber) => {
          // Free segment has exact start and end times from the helper
          // Format times for the drawer
          const segmentStartDate = new Date(segment.start);
          const segmentEndDate = new Date(segment.end);

          const timeRangeStart = `${String(segmentStartDate.getHours()).padStart(2, '0')}:${String(segmentStartDate.getMinutes()).padStart(2, '0')}`;
          const timeRangeEnd = `${String(segmentEndDate.getHours()).padStart(2, '0')}:${String(segmentEndDate.getMinutes()).padStart(2, '0')}`;

          setBookingInitialData({
            date: selectedDate,
            time: timeRangeStart,  // Start at the beginning of free segment
            empId: barber.empId,
            barberName: barber.empName,
            timeRangeStart,
            timeRangeEnd,
          });
          setShowBookingDrawer(true);
        }}
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
          barbers={flowBoardData?.barbers || []}
          debugInfo={{
            source: 'flow-board',
            count: flowBoardData?.barbers?.length || 0,
            timestamp: new Date().toISOString(),
          }}
        />
      )}

      {/* Find Nearest Queue Drawer */}
      {showFindNearestDrawer && (
        <FindNearestQueueDrawer
          isOpen={showFindNearestDrawer}
          onClose={() => setShowFindNearestDrawer(false)}
          onCreated={() => {
            fetchFlowBoard();
            showToast('تم إصدار الدور بنجاح');
          }}
        />
      )}

      {/* Create Booking Drawer */}
      {showBookingDrawer && (
        <CreateBookingDrawer
          open={showBookingDrawer}
          onClose={() => setShowBookingDrawer(false)}
          initialDate={bookingInitialData.date}
          initialTime={bookingInitialData.time}
          initialEmpId={bookingInitialData.empId}
          initialBarberName={bookingInitialData.barberName}
          initialTimeRangeStart={bookingInitialData.timeRangeStart}
          initialTimeRangeEnd={bookingInitialData.timeRangeEnd}
          barbers={flowBoardData?.barbers.map(b => ({ empId: b.empId, empName: b.empName })) || []}
          onCreated={() => {
            fetchFlowBoard();
            showToast('تم إنشاء الحجز بنجاح');
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
