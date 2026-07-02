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
      className="relative overflow-hidden rounded-md border px-2 py-1 cursor-pointer transition-all hover:bg-foreground/[0.04] hover:shadow-md"
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
              <div className="min-w-0 truncate text-[12px] font-bold text-foreground" title={customerName}>
                {customerName}
              </div>
              <div className="shrink-0 text-[11px] font-bold text-primary">
                {timeLabel}
              </div>
            </div>
          ) : (
            /* Normal Mode: 2-row grid */
            <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1">
              {/* Row 1: Customer Name | Time */}
              <div className="min-w-0 truncate text-[12px] font-bold text-foreground leading-tight" title={customerName}>
                {customerName}
              </div>
              <div className="shrink-0 text-[11px] font-bold text-primary leading-tight">
                {timeLabel}
              </div>

              {/* Row 2: Service | Code */}
              <div className="min-w-0 truncate text-[10px] text-muted-foreground leading-tight" title={serviceName}>
                {serviceName || label}
              </div>
              {bookingCode && (
                <div className="shrink-0 rounded bg-background/20 px-1.5 py-0.5 text-[9px] font-medium text-foreground leading-tight">
                  {bookingCode}
                </div>
              )}
              {item.protected && (
                <div className="shrink-0 text-[9px] text-primary/80" title="محمي">
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
              <span className="text-[9px] font-medium text-muted-foreground">{label}</span>
            </div>
            {ticketCode && (
              <span className="text-[9px] px-1 rounded bg-surface-muted/50 text-foreground">
                {ticketCode}
              </span>
            )}
          </div>
          
          {/* Customer */}
          <div className="text-[11px] font-bold text-foreground truncate" title={customerName}>
            {customerName}
          </div>
          
          {/* Time */}
          <div className="text-[10px] text-muted-foreground">
            {timeRange}
          </div>

          {/* Overdue / Needs action badge */}
          {item.needsOperatorAction && (
            <div className="flex items-center mt-0.5">
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive border border-destructive/30">
                {item.effectiveStatus === 'overdue_finish_required'
                  ? `يحتاج إنهاء${(item.overdueMinutes ?? 0) > 0 ? ` (${item.overdueMinutes}د)` : ''}`
                  : item.effectiveStatus === 'no_show_candidate'
                    ? 'لم يحضر محتمل'
                    : item.effectiveStatus === 'expired_candidate'
                      ? 'منتهي محتمل'
                      : 'يحتاج إجراء'}
              </span>
            </div>
          )}

          {/* Called badge */}
          {isCalled && !item.needsOperatorAction && (
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-success/20 text-success">
                تم النداء
              </span>
              {voiceEnabled && (
                <button
                  onClick={handleReannounce}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
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
          {item.needsOperatorAction && (
            <div className="flex items-center mt-0.5">
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-destructive/40 text-destructive-foreground border border-destructive/50">
                يحتاج إنهاء{(item.overdueMinutes ?? 0) > 0 ? ` (${item.overdueMinutes}د)` : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Gap/Other Card */}
      {type === 'gap' && (
        <div className="h-full flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground/60">—</span>
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
  // Default to primary theme accent if no barber color provided
  const accent = barberColor || {
    bg: 'color-mix(in srgb, var(--primary) 12%, transparent)',
    border: 'color-mix(in srgb, var(--primary) 55%, transparent)',
    text: 'var(--primary)',
    dot: 'var(--primary)',
    label: 'primary'
  };

  // Common readable text colors
  const readable = {
    timeColor: 'var(--primary)',
    timeIconColor: 'var(--primary)',
    codeBorder: accent.border,
  };

  const base = {
    hoverBorderColor: accent.border,
    codeBg: accent.bg,
    codeColor: accent.text,
    serviceColor: 'var(--muted-foreground)',
    ...readable,
  };

  switch (type) {
    case 'in_service':
      // Gold filled card for in-service (always gold)
      return {
        ...base,
        background: 'linear-gradient(135deg, #d4af37 0%, #b8941f 100%)',
        borderColor: '#d4af37',
        headerBg: 'color-mix(in srgb, var(--background) 15%, transparent)',
        iconColor: '#1a1a1a',
        textColor: '#1a1a1a',
        subTextColor: 'color-mix(in srgb, #1a1a1a 80%, transparent)',
        hoverBorderColor: '#f5d547',
        codeBg: 'color-mix(in srgb, var(--background) 20%, transparent)',
        codeColor: '#1a1a1a',
        serviceColor: 'color-mix(in srgb, #1a1a1a 70%, transparent)',
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
        textColor: 'var(--foreground)',
        subTextColor: 'var(--muted-foreground)',
        // Time accent
        timeColor: 'var(--primary)',
        timeIconColor: 'var(--primary)',
        // Code badge subtle
        codeBg: 'color-mix(in srgb, var(--background) 20%, transparent)',
        codeBorder: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
        codeColor: 'var(--muted-foreground)',
        hoverBorderColor: accent.text,
        serviceColor: 'var(--foreground)',
      };

    case 'queue':
      // Queue - dark blue-gray card
      return {
        ...base,
        background: '#1e293b',
        borderColor: 'rgba(100, 116, 139, 0.5)',
        headerBg: 'rgba(100, 116, 139, 0.2)',
        iconColor: 'var(--muted-foreground)',
        textColor: 'var(--foreground)',
        subTextColor: 'var(--muted-foreground)',
        hoverBorderColor: '#60a5fa',
        codeBg: 'rgba(100, 116, 139, 0.3)',
        codeColor: 'var(--muted-foreground)',
        serviceColor: 'var(--muted-foreground)',
        timeColor: 'var(--foreground)',
        timeIconColor: 'var(--muted-foreground)',
        codeBorder: 'rgba(100, 116, 139, 0.5)',
      };

    default:
      // Gap or unknown - muted
      return {
        ...base,
        background: 'color-mix(in srgb, var(--foreground) 5%, transparent)',
        borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
        headerBg: 'color-mix(in srgb, var(--foreground) 3%, transparent)',
        iconColor: 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)',
        textColor: 'var(--muted-foreground)',
        subTextColor: 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)',
        hoverBorderColor: 'var(--muted-foreground)',
        codeBg: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
        codeColor: 'var(--muted-foreground)',
        serviceColor: 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)',
        timeColor: 'var(--muted-foreground)',
        timeIconColor: 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)',
        codeBorder: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
      };
  }
}
