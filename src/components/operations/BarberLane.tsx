'use client';

import { User, Clock, Users, Shield } from 'lucide-react';
import { TimelineBlock } from './TimelineBlock';

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
  barber: Barber;
  hours: string[];
}

export function BarberLane({ barber, hours }: Props) {
  const hasItems = barber.timeline.length > 0;

  return (
    <div className="flex flex-col w-56 shrink-0">
      {/* Header */}
      <div
        className="p-4 rounded-t-2xl border"
        style={{
          background: '#111',
          borderColor: 'rgba(212, 175, 55, 0.2)',
          borderBottom: 'none',
        }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(212, 175, 55, 0.15)' }}
          >
            <User className="w-5 h-5" style={{ color: '#d4af37' }} />
          </div>
          <div>
            <h3 className="font-bold text-white">{barber.empName}</h3>
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: '#22c55e' }}
              />
              <span style={{ color: '#a1a1aa' }}>نشط</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs">
          {barber.waitingCount > 0 && (
            <div className="flex items-center gap-1" style={{ color: '#a1a1aa' }}>
              <Users className="w-3.5 h-3.5" />
              <span>{barber.waitingCount} منتظر</span>
            </div>
          )}
          {barber.nextAvailableAt && (
            <div className="flex items-center gap-1" style={{ color: '#d4af37' }}>
              <Clock className="w-3.5 h-3.5" />
              <span>متاح {formatTime(barber.nextAvailableAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Lane Content */}
      <div
        className="flex-1 rounded-b-2xl border p-2 space-y-2"
        style={{
          background: '#0a0a0a',
          borderColor: 'rgba(212, 175, 55, 0.2)',
          minHeight: `${hours.length * 6}rem`,
        }}
      >
        {hasItems ? (
          barber.timeline
            .filter(item => item.type !== 'gap')
            .map((item, idx) => (
              <TimelineBlock key={idx} item={item} />
            ))
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm" style={{ color: '#a1a1aa' }}>متاح الآن</p>
              <p className="text-xs mt-1" style={{ color: '#52525b' }}>لا توجد مواعيد</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? 'ص' : 'م';
  return `${hour12}:${m} ${ampm}`;
}
