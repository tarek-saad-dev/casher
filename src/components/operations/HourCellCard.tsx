'use client';

import { Scissors, Calendar, Ticket, Shield, Clock, Volume2 } from 'lucide-react';
import { formatTimeRange, getItemTypeLabel, TimelineItem } from './schedulerUtils';

interface BarberColor {
  bg: string;
  border: string;
  text: string;
  dot: string;
  label: string;
}

interface Props {
  item: TimelineItem;
  compact?: boolean;
  onClick?: (item: TimelineItem) => void;
  voiceEnabled?: boolean;
  onReannounce?: (ticketId: number) => Promise<boolean>;
  barberColor?: BarberColor;
}

// Get card height based on duration
function getCardHeight(durationMinutes: number): number {
  // Base height for very short bookings
  if (durationMinutes <= 15) return 44;
  if (durationMinutes <= 30) return 56;
  if (durationMinutes <= 45) return 68;
  return 80;
}

// Format time label (short)
function formatTimeLabel(start: string, end: string): string {
  const startTime = new Date(start).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', hour12: true });
  return startTime;
}

export function HourCellCard({ item, compact = false, onClick, voiceEnabled, onReannounce, barberColor }: Props) {
  const type = item.type === 'in_service' ? 'in_service' :
               item.type === 'booking' ? 'booking' :
               item.type === 'queue' ? 'queue' : 'gap';

  const styles = getCardStyles(type, item.protected, barberColor);
  const Icon = getIcon(type, item.protected);
  const label = getItemTypeLabel(type, item.protected);

  // Format content for display
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  const timeLabel = formatTimeLabel(item.startTime, item.endTime);
  const customerName = item.customerName || item.label || '—';
  const serviceName = item.serviceNames?.[0] || '';
  const ticketCode = item.ticketCode || (type === 'queue' ? item.label : '');
  const bookingCode = type === 'booking' ? `BK-${item.sourceId}` : '';

  // Calculate card height based on duration
  const cardHeight = item.durationMinutes ? getCardHeight(item.durationMinutes) : (compact ? 44 : 56);
  
  // Compact mode for short bookings (< 20 min or when compact prop is true)
  const isCompact = compact || (item.durationMinutes && item.durationMinutes < 20);

  const handleClick = () => {
    if (onClick) {
      onClick(item);
    }
  };

  const handleReannounce = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onReannounce && item.type === 'queue') {
      await onReannounce(item.sourceId);
    }
  };

  // Check if this queue item is called/announced
  const isCalled = item.status === 'called' || item.status === 'announced';

  // Tooltip with full details
  const tooltipText = `${customerName} • ${bookingCode || ticketCode || label} • ${timeRange}${serviceName ? ` • ${serviceName}` : ''}`;

  return (
    <div
      className="relative overflow-hidden rounded-md border px-2 py-1 cursor-pointer transition-all hover:bg-white/[0.04] hover:shadow-md"
      onClick={handleClick}
      title={tooltipText}
      style={{
        backgroundColor: styles.background,
        borderColor: styles.borderColor,
        minHeight: `${cardHeight}px`,
        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = styles.hoverBorderColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = styles.borderColor;
      }}
    >
      {/* Booking Card - Premium Compact Design */}
      {type === 'booking' && (
        <div className="h-full flex flex-col justify-center gap-1">
          {/* Compact Mode: Name + Time only */}
          {isCompact ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-[12px] font-bold text-white" title={customerName}>
                {customerName}
              </div>
              <div className="shrink-0 text-[11px] font-bold text-yellow-300">
                {timeLabel}
              </div>
            </div>
          ) : (
            /* Normal Mode: 2-row grid */
            <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1">
              {/* Row 1: Customer Name | Time */}
              <div className="min-w-0 truncate text-[12px] font-bold text-white leading-tight" title={customerName}>
                {customerName}
              </div>
              <div className="shrink-0 text-[11px] font-bold text-yellow-300 leading-tight">
                {timeLabel}
              </div>

              {/* Row 2: Service | Code */}
              <div className="min-w-0 truncate text-[10px] text-slate-400 leading-tight" title={serviceName}>
                {serviceName || label}
              </div>
              {bookingCode && (
                <div className="shrink-0 rounded bg-black/20 px-1.5 py-0.5 text-[9px] font-medium text-slate-300 leading-tight">
                  {bookingCode}
                </div>
              )}
              {item.protected && (
                <div className="shrink-0 text-[9px] text-yellow-500/80" title="محمي">
                  🛡️
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Queue Card */}
      {type === 'queue' && (
        <div className="h-full flex flex-col justify-center gap-0.5">
          {/* Header: Icon + Code */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Icon className="w-3 h-3 shrink-0" style={{ color: styles.iconColor }} />
              <span className="text-[9px] font-medium text-slate-400">{label}</span>
            </div>
            {ticketCode && (
              <span className="text-[9px] px-1 rounded bg-slate-700/50 text-slate-300">
                {ticketCode}
              </span>
            )}
          </div>
          
          {/* Customer */}
          <div className="text-[11px] font-bold text-white truncate" title={customerName}>
            {customerName}
          </div>
          
          {/* Time */}
          <div className="text-[10px] text-slate-400">
            {timeRange}
          </div>

          {/* Called badge */}
          {isCalled && (
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                تم النداء
              </span>
              {voiceEnabled && (
                <button
                  onClick={handleReannounce}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-medium bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                  title="إعادة النداء"
                >
                  <Volume2 size={10} />
                  نداء
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* In Service Card */}
      {type === 'in_service' && (
        <div className="h-full flex flex-col justify-center gap-0.5">
          <div className="flex items-center gap-1">
            <Icon className="w-3 h-3 shrink-0 text-amber-900" />
            <span className="text-[9px] font-medium text-amber-900">قيد الخدمة</span>
          </div>
          <div className="text-[11px] font-bold text-amber-900 truncate" title={customerName}>
            {customerName}
          </div>
          <div className="text-[10px] text-amber-800/80">
            {timeRange}
          </div>
          {serviceName && (
            <div className="text-[9px] text-amber-800/70 truncate">
              {serviceName}
            </div>
          )}
        </div>
      )}

      {/* Gap/Other Card */}
      {type === 'gap' && (
        <div className="h-full flex items-center justify-center">
          <span className="text-[10px] text-slate-600">—</span>
        </div>
      )}
    </div>
  );
}

function getIcon(type: string, isProtected?: boolean) {
  switch (type) {
    case 'in_service':
      return Scissors;
    case 'booking':
      return Calendar;
    case 'queue':
      return Ticket;
    default:
      return Calendar;
  }
}

function getCardStyles(type: string, isProtected?: boolean, barberColor?: BarberColor) {
  // Default to gold if no barber color provided
  const accent = barberColor || {
    bg: 'rgba(212, 175, 55, 0.12)',
    border: 'rgba(212, 175, 55, 0.55)',
    text: '#d4af37',
    dot: '#d4af37',
    label: 'gold'
  };

  // Common readable text colors
  const readable = {
    timeColor: '#FACC15',
    timeIconColor: '#FDE68A',
    codeBorder: accent.border,
  };

  const base = {
    hoverBorderColor: accent.border,
    codeBg: accent.bg,
    codeColor: accent.text,
    serviceColor: '#71717a',
    ...readable,
  };

  switch (type) {
    case 'in_service':
      // Gold filled card for in-service (always gold)
      return {
        ...base,
        background: 'linear-gradient(135deg, #d4af37 0%, #b8941f 100%)',
        borderColor: '#d4af37',
        headerBg: 'rgba(0,0,0,0.15)',
        iconColor: '#1a1a1a',
        textColor: '#1a1a1a',
        subTextColor: 'rgba(26,26,26,0.8)',
        hoverBorderColor: '#f5d547',
        codeBg: 'rgba(0,0,0,0.2)',
        codeColor: '#1a1a1a',
        serviceColor: 'rgba(26,26,26,0.7)',
        timeColor: '#1a1a1a',
        timeIconColor: '#1a1a1a',
        codeBorder: '#d4af37',
      };

    case 'booking':
      // Booking cards: clean dark card with barber accent on border only
      // No header bar - all content in body
      return {
        ...base,
        // Dark clean background (not barber color)
        background: '#0f172a',
        // Barber color only on border
        borderColor: accent.border,
        // No header for bookings
        headerBg: 'transparent',
        // Icons only if needed
        iconColor: accent.text,
        // Text colors fixed for readability
        textColor: '#F8FAFC',
        subTextColor: '#94a3b8',
        // Time accent
        timeColor: '#FACC15',
        timeIconColor: '#FDE68A',
        // Code badge subtle
        codeBg: 'rgba(0,0,0,0.2)',
        codeBorder: 'rgba(255,255,255,0.1)',
        codeColor: '#94a3b8',
        hoverBorderColor: accent.text,
        serviceColor: '#CBD5E1',
      };

    case 'queue':
      // Queue - dark blue-gray card
      return {
        ...base,
        background: '#1e293b',
        borderColor: 'rgba(100, 116, 139, 0.5)',
        headerBg: 'rgba(100, 116, 139, 0.2)',
        iconColor: '#94a3b8',
        textColor: '#e2e8f0',
        subTextColor: '#94a3b8',
        hoverBorderColor: '#60a5fa',
        codeBg: 'rgba(100, 116, 139, 0.3)',
        codeColor: '#94a3b8',
        serviceColor: '#64748b',
        timeColor: '#e2e8f0',
        timeIconColor: '#94a3b8',
        codeBorder: 'rgba(100, 116, 139, 0.5)',
      };

    default:
      // Gap or unknown - muted
      return {
        ...base,
        background: 'rgba(255,255,255,0.05)',
        borderColor: 'rgba(255,255,255,0.1)',
        headerBg: 'rgba(255,255,255,0.03)',
        iconColor: '#52525b',
        textColor: '#71717a',
        subTextColor: '#52525b',
        hoverBorderColor: '#a1a1aa',
        codeBg: 'rgba(255,255,255,0.08)',
        codeColor: '#71717a',
        serviceColor: '#52525b',
        timeColor: '#a1a1aa',
        timeIconColor: '#52525b',
        codeBorder: 'rgba(255,255,255,0.1)',
      };
  }
}
