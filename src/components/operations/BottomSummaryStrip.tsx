'use client';

import { Clock, Users, Calendar } from 'lucide-react';

interface Props {
  nextAvailableBarber?: { name: string; time: string } | null;
  totalWaiting: number;
  totalBookings: number;
}

export function BottomSummaryStrip({ nextAvailableBarber, totalWaiting, totalBookings }: Props) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2 border-t"
      style={{ background: '#0a0a0a', borderColor: 'rgba(212, 175, 55, 0.15)' }}
    >
      {/* Compact Stats Row */}
      <div className="flex items-center gap-4">
        {/* Next Available */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: '#111', border: '1px solid rgba(212, 175, 55, 0.2)' }}>
          <Clock className="w-3.5 h-3.5" style={{ color: '#d4af37' }} />
          <span className="text-xs" style={{ color: '#a1a1aa' }}>التالي:</span>
          <span className="text-xs font-medium text-white">
            {nextAvailableBarber ? (
              <>{nextAvailableBarber.name} <span style={{ color: '#d4af37' }}>•</span> {nextAvailableBarber.time}</>
            ) : (
              <span style={{ color: '#52525b' }}>—</span>
            )}
          </span>
        </div>

        {/* Waiting Count */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: '#111', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
          <Users className="w-3.5 h-3.5" style={{ color: '#f59e0b' }} />
          <span className="text-xs font-bold" style={{ color: '#f59e0b' }}>{totalWaiting}</span>
          <span className="text-xs" style={{ color: '#a1a1aa' }}>منتظر</span>
        </div>

        {/* Bookings Count */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: '#111', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
          <Calendar className="w-3.5 h-3.5" style={{ color: '#818cf8' }} />
          <span className="text-xs font-bold" style={{ color: '#818cf8' }}>{totalBookings}</span>
          <span className="text-xs" style={{ color: '#a1a1aa' }}>حجز</span>
        </div>
      </div>

      {/* Compact Legend */}
      <div className="flex items-center gap-3 text-[10px]">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#d4af37' }} />
          <span style={{ color: '#a1a1aa' }}>خدمة</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm border" style={{ borderColor: '#d4af37', background: 'transparent' }} />
          <span style={{ color: '#a1a1aa' }}>حجز</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#1e293b', border: '1px solid rgba(100,116,139,0.5)' }} />
          <span style={{ color: '#a1a1aa' }}>دور</span>
        </div>
      </div>
    </div>
  );
}
