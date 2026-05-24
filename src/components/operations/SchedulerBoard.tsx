'use client';

import { useMemo } from 'react';
import { BarberLane } from './BarberLane';
import { TimeAxis } from './TimeAxis';

interface TimelineItem {
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
}

interface Barber {
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
  timeline: TimelineItem[];
}

interface Props {
  barbers: Barber[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

// Generate hour slots from 2 PM to 11:59 PM (or based on barber shifts)
const HOURS = [
  '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'
];

export function SchedulerBoard({ barbers, loading, error, onRetry }: Props) {
  const workingBarbers = useMemo(() => {
    return barbers.filter(b => b.status === 'working');
  }, [barbers]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#050505' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#d4af37' }} />
          <p className="text-zinc-500">جاري تحميل لوحة التشغيل...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#050505' }}>
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={onRetry}
            className="px-4 py-2 rounded-lg border hover:bg-zinc-800 transition-colors"
            style={{ borderColor: 'rgba(212, 175, 55, 0.3)', color: '#d4af37' }}
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  if (workingBarbers.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#050505' }}>
        <div className="text-center">
          <p className="text-zinc-400 mb-2">لا يوجد حلاقين متاحين اليوم</p>
          <p className="text-sm text-zinc-600">جميع الحلاقين في إجازة أو خارج ساعات العمل</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto" style={{ background: '#050505' }} dir="rtl">
      <div className="min-w-max p-6">
        {/* Scheduler Grid */}
        <div className="flex gap-4">
          {/* Time Axis */}
          <TimeAxis hours={HOURS} />

          {/* Barber Lanes */}
          <div className="flex gap-4">
            {workingBarbers.map(barber => (
              <BarberLane
                key={barber.empId}
                barber={barber}
                hours={HOURS}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
