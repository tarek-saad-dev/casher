'use client';

import { Scissors, Calendar, Shield, Ticket, Volume2 } from 'lucide-react';

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

interface Props {
  item: TimelineItem;
  announced?: boolean;
}

export function TimelineBlock({ item, announced }: Props) {
  const startTime = formatTime(item.startTime);
  const endTime = formatTime(item.endTime);

  // Determine block style based on type
  const isInService = item.type === 'in_service' || item.status === 'in_service';
  const isBooking = item.type === 'booking';
  const isQueue = item.type === 'queue';
  const isProtected = item.protected || (isBooking && item.status === 'confirmed');

  if (isInService) {
    return (
      <div
        className="p-3 rounded-xl border-2"
        style={{
          background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.25), rgba(212, 175, 55, 0.1))',
          borderColor: '#d4af37',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Scissors className="w-4 h-4" style={{ color: '#d4af37' }} />
          <span className="text-xs font-bold" style={{ color: '#d4af37' }}>قيد الخدمة</span>
        </div>
        <div className="text-sm font-bold text-white mb-1">
          {startTime} - {endTime}
        </div>
        <div className="text-xs" style={{ color: '#a1a1aa' }}>
          {item.label} {item.customerName ? `— ${item.customerName}` : ''}
        </div>
      </div>
    );
  }

  if (isBooking) {
    return (
      <div
        className="p-3 rounded-xl border"
        style={{
          background: '#111',
          borderColor: isProtected ? '#d4af37' : 'rgba(212, 175, 55, 0.3)',
          borderWidth: isProtected ? '2px' : '1px',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-4 h-4" style={{ color: isProtected ? '#d4af37' : '#a1a1aa' }} />
          <span className="text-xs font-medium" style={{ color: isProtected ? '#d4af37' : '#a1a1aa' }}>
            {isProtected ? 'حجز محمي' : 'حجز'}
          </span>
          {isProtected && <Shield className="w-3.5 h-3.5" style={{ color: '#d4af37' }} />}
          {announced && (
            <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(16,185,129,0.2)', color: '#10B981', border: '1px solid rgba(16,185,129,0.4)' }}>
              <Volume2 className="w-2.5 h-2.5" />
              تم النداء
            </span>
          )}
        </div>
        <div className="text-sm font-bold text-white mb-1">
          {startTime} - {endTime}
        </div>
        <div className="text-xs" style={{ color: '#a1a1aa' }}>
          {item.label} {item.customerName ? `— ${item.customerName}` : ''}
        </div>
      </div>
    );
  }

  if (isQueue) {
    return (
      <div
        className="p-3 rounded-xl border"
        style={{
          background: '#171717',
          borderColor: 'rgba(161, 161, 170, 0.3)',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Ticket className="w-4 h-4" style={{ color: '#a1a1aa' }} />
          <span className="text-xs font-medium" style={{ color: '#a1a1aa' }}>دور</span>
          {item.ticketCode && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(212, 175, 55, 0.2)', color: '#d4af37' }}>
              {item.ticketCode}
            </span>
          )}
          {announced && (
            <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(16,185,129,0.2)', color: '#10B981', border: '1px solid rgba(16,185,129,0.4)' }}>
              <Volume2 className="w-2.5 h-2.5" />
              تم النداء
            </span>
          )}
        </div>
        <div className="text-sm font-bold text-white mb-1">
          {startTime} - {endTime}
        </div>
        <div className="text-xs" style={{ color: '#a1a1aa' }}>
          {item.label} {item.customerName ? `— ${item.customerName}` : ''}
        </div>
      </div>
    );
  }

  // Default/fallback
  return (
    <div className="p-3 rounded-xl border" style={{ background: '#171717', borderColor: 'rgba(255,255,255,0.1)' }}>
      <div className="text-sm font-medium text-white">
        {startTime} - {endTime}
      </div>
      <div className="text-xs" style={{ color: '#a1a1aa' }}>{item.label}</div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const hour12 = h % 12 || 12;
  return `${hour12}:${m}`;
}
