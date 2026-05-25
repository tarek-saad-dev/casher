'use client';

import { Scissors, Calendar, Ticket, Shield, User, Clock, Volume2 } from 'lucide-react';
import { formatTimeRange, getItemTypeLabel, TimelineItem } from './schedulerUtils';

interface Props {
  item: TimelineItem;
  announcedIds?: Set<string>;
  compact?: boolean;
  onClick?: (item: TimelineItem) => void;
  voiceEnabled?: boolean;
  onReannounce?: (ticketId: number) => Promise<boolean>;
}

export function HourCellCard({ item, compact = false, onClick, voiceEnabled, onReannounce, announcedIds }: Props) {
  const type = item.type === 'in_service' ? 'in_service' :
    item.type === 'booking' ? 'booking' :
      item.type === 'queue' ? 'queue' : 'gap';

  const styles = getCardStyles(type, item.protected);
  const Icon = getIcon(type, item.protected);
  const label = getItemTypeLabel(type, item.protected);

  // Format content for display
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  const customerName = item.customerName || item.label || '—';
  const serviceName = item.serviceNames?.[0] || '';
  const ticketCode = item.ticketCode || (type === 'queue' ? item.label : '');
  const bookingCode = type === 'booking' ? `BK-${item.sourceId}` : '';

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

  // Check if called: queue via status, booking via announcedIds set
  const key = item.type === 'booking' ? `booking-${item.sourceId}` : `queue-${item.sourceId}`;
  const isCalled = item.status === 'called' || item.status === 'announced' || (!!announcedIds && announcedIds.has(key));

  return (
    <div
      className="rounded-md overflow-hidden cursor-pointer transition-all hover:shadow-lg"
      onClick={handleClick}
      style={{
        background: styles.background,
        border: `1px solid ${styles.borderColor}`,
        height: compact ? '50px' : '56px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = styles.hoverBorderColor;
        e.currentTarget.style.transform = 'scale(1.02)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = styles.borderColor;
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {/* Top bar with icon, label, and code */}
      <div
        className="flex items-center justify-between px-1.5 py-0.5"
        style={{
          background: styles.headerBg,
          borderBottom: `1px solid ${styles.borderColor}`,
        }}
      >
        <div className="flex items-center gap-1">
          <Icon className="w-3 h-3 shrink-0" style={{ color: styles.iconColor }} />
          <span
            className="text-[9px] font-medium truncate"
            style={{ color: styles.textColor }}
          >
            {label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {bookingCode && (
            <span className="text-[8px] px-1 rounded" style={{ background: styles.codeBg, color: styles.codeColor }}>
              {bookingCode}
            </span>
          )}
          {ticketCode && type === 'queue' && (
            <span className="text-[8px] px-1 rounded font-medium" style={{ background: styles.codeBg, color: styles.codeColor }}>
              {ticketCode}
            </span>
          )}
          {item.protected && type === 'booking' && (
            <Shield className="w-2.5 h-2.5 shrink-0" style={{ color: styles.iconColor }} />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-1.5 py-1 flex flex-col justify-center h-[calc(100%-22px)] gap-0.5">
        {/* Time range with icon */}
        <div className="flex items-center gap-1">
          <Clock className="w-2.5 h-2.5 shrink-0" style={{ color: styles.iconColor }} />
          <span
            className="text-[9px] font-medium"
            style={{ color: styles.textColor }}
          >
            {timeRange}
          </span>
        </div>

        {/* Customer name with icon */}
        <div className="flex items-center gap-1">
          <User className="w-2.5 h-2.5 shrink-0" style={{ color: styles.subTextColor }} />
          <span
            className="text-[9px] truncate font-medium"
            style={{ color: styles.subTextColor }}
          >
            {customerName}
          </span>
        </div>

        {/* Service name if available */}
        {serviceName && !compact && (
          <div
            className="text-[8px] truncate pl-3.5"
            style={{ color: styles.serviceColor }}
          >
            {serviceName}
          </div>
        )}

        {/* Called badge and reannounce button */}
        <div className="flex items-center justify-between mt-1">
          {isCalled && (
            <span
              className="text-[8px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: '#22c55e30', color: '#22c55e' }}
            >
              تم النداء
            </span>
          )}

          {voiceEnabled && item.type === 'queue' && (
            <button
              onClick={handleReannounce}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-medium opacity-0 hover:opacity-100 group-hover:opacity-100 transition-opacity"
              style={{
                background: isCalled ? '#22c55e20' : 'rgba(212, 175, 55, 0.15)',
                color: isCalled ? '#22c55e' : '#d4af37',
                marginRight: 'auto'
              }}
              title="إعادة النداء"
            >
              <Volume2 size={10} />
              {isCalled ? 'إعادة' : 'نداء'}
            </button>
          )}
        </div>
      </div>
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

function getCardStyles(type: string, isProtected?: boolean) {
  const base = {
    hoverBorderColor: '#d4af37',
    codeBg: 'rgba(255,255,255,0.1)',
    codeColor: '#d4af37',
    serviceColor: '#71717a',
  };

  switch (type) {
    case 'in_service':
      // Gold filled card for in-service
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
      };

    case 'booking':
      if (isProtected) {
        // Protected booking - stronger gold border
        return {
          ...base,
          background: '#1a1a1a',
          borderColor: '#d4af37',
          headerBg: 'rgba(212, 175, 55, 0.15)',
          iconColor: '#d4af37',
          textColor: '#d4af37',
          subTextColor: '#a1a1aa',
          hoverBorderColor: '#f5d547',
          codeBg: 'rgba(212, 175, 55, 0.2)',
          codeColor: '#d4af37',
          serviceColor: '#71717a',
        };
      }
      // Normal booking - dark card with gold border
      return {
        ...base,
        background: '#1a1a1a',
        borderColor: 'rgba(212, 175, 55, 0.5)',
        headerBg: 'rgba(212, 175, 55, 0.08)',
        iconColor: '#d4af37',
        textColor: '#e5e5e5',
        subTextColor: '#a1a1aa',
        hoverBorderColor: '#f5d547',
        codeBg: 'rgba(212, 175, 55, 0.15)',
        codeColor: '#d4af37',
        serviceColor: '#71717a',
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
      };
  }
}
