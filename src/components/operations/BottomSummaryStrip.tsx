'use client';

import { Clock, Users, Calendar, Scissors, Ticket, Shield } from 'lucide-react';

interface Props {
  nextAvailableBarber?: { name: string; time: string } | null;
  totalWaiting: number;
  totalBookings: number;
}

export function BottomSummaryStrip({ nextAvailableBarber, totalWaiting, totalBookings }: Props) {
  return (
    <div
      className="flex items-center justify-between px-6 py-4 border-t"
      style={{ background: '#0a0a0a', borderColor: 'rgba(212, 175, 55, 0.15)' }}
    >
      {/* Card 1: Next Available */}
      <div className="flex items-center gap-4 px-5 py-3 rounded-xl" style={{ background: '#111', border: '1px solid rgba(212, 175, 55, 0.2)' }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(212, 175, 55, 0.15)' }}>
          <Clock className="w-5 h-5" style={{ color: '#d4af37' }} />
        </div>
        <div>
          <div className="text-xs mb-0.5" style={{ color: '#a1a1aa' }}>التالي المتاح</div>
          <div className="font-bold text-white">
            {nextAvailableBarber ? (
              <>
                {nextAvailableBarber.name} <span style={{ color: '#d4af37' }}>•</span> {nextAvailableBarber.time}
              </>
            ) : (
              <span style={{ color: '#a1a1aa' }}>لا يوجد</span>
            )}
          </div>
        </div>
      </div>

      {/* Card 2: Waiting Count */}
      <div className="flex items-center gap-4 px-5 py-3 rounded-xl" style={{ background: '#111', border: '1px solid rgba(161, 161, 170, 0.2)' }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(245, 158, 11, 0.15)' }}>
          <Users className="w-5 h-5" style={{ color: '#f59e0b' }} />
        </div>
        <div>
          <div className="text-2xl font-bold" style={{ color: '#f59e0b' }}>{totalWaiting}</div>
          <div className="text-xs" style={{ color: '#a1a1aa' }}>زبائن في قائمة الانتظار</div>
        </div>
      </div>

      {/* Card 3: Upcoming Bookings */}
      <div className="flex items-center gap-4 px-5 py-3 rounded-xl" style={{ background: '#111', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(99, 102, 241, 0.15)' }}>
          <Calendar className="w-5 h-5" style={{ color: '#818cf8' }} />
        </div>
        <div>
          <div className="text-2xl font-bold" style={{ color: '#818cf8' }}>{totalBookings}</div>
          <div className="text-xs" style={{ color: '#a1a1aa' }}>حجوزات اليوم المتبقية</div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ background: '#d4af37' }} />
          <span style={{ color: '#a1a1aa' }}>قيد الخدمة</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded border" style={{ borderColor: '#d4af37', background: 'transparent' }} />
          <span style={{ color: '#a1a1aa' }}>حجز</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ background: '#52525b' }} />
          <span style={{ color: '#a1a1aa' }}>دور انتظار</span>
        </div>
      </div>
    </div>
  );
}
