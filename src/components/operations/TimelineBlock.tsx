'use client';

import { Scissors, Calendar, Users, Shield, Ticket } from 'lucide-react';

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
}

export function TimelineBlock({ item }: Props) {
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
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 25%, transparent), color-mix(in srgb, var(--primary) 10%, transparent))',
          borderColor: 'var(--primary)',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Scissors className="w-4 h-4" style={{ color: 'var(--primary)' }} />
          <span className="text-xs font-bold" style={{ color: 'var(--primary)' }}>قيد الخدمة</span>
        </div>
        <div className="text-sm font-bold text-foreground mb-1">
          {startTime} - {endTime}
        </div>
        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
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
          background: 'var(--surface)',
          borderColor: isProtected ? 'var(--primary)' : 'color-mix(in srgb, var(--primary) 30%, transparent)',
          borderWidth: isProtected ? '2px' : '1px',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-4 h-4" style={{ color: isProtected ? 'var(--primary)' : 'var(--muted-foreground)' }} />
          <span className="text-xs font-medium" style={{ color: isProtected ? 'var(--primary)' : 'var(--muted-foreground)' }}>
            {isProtected ? 'حجز محمي' : 'حجز'}
          </span>
          {isProtected && <Shield className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />}
        </div>
        <div className="text-sm font-bold text-foreground mb-1">
          {startTime} - {endTime}
        </div>
        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
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
          background: 'var(--surface-muted)',
          borderColor: 'color-mix(in srgb, var(--muted-foreground) 30%, transparent)',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Ticket className="w-4 h-4" style={{ color: 'var(--muted-foreground)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>دور</span>
          {item.ticketCode && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--primary) 20%, transparent)', color: 'var(--primary)' }}>
              {item.ticketCode}
            </span>
          )}
        </div>
        <div className="text-sm font-bold text-foreground mb-1">
          {startTime} - {endTime}
        </div>
        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          {item.label} {item.customerName ? `— ${item.customerName}` : ''}
        </div>
      </div>
    );
  }

  // Default/fallback
  return (
    <div className="p-3 rounded-xl border" style={{ background: 'var(--surface-muted)', borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)' }}>
      <div className="text-sm font-medium text-foreground">
        {startTime} - {endTime}
      </div>
      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{item.label}</div>
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
