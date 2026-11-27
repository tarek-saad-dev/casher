'use client';

import { memo } from 'react';
import { Scissors, Calendar, Ticket, GripVertical, Volume2 } from 'lucide-react';
import { formatTimeRange, getItemTypeLabel, TimelineItem } from './schedulerUtils';
import { formatServiceSummary } from '@/lib/servicePlanFormat';
import { cn } from '@/lib/utils';
import { BookingOriginBadge } from './BookingOriginBadge';

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
  draggable?: boolean;
  dragDisabledReason?: string;
  isDragging?: boolean;
  isDragPending?: boolean;
  onCardPointerDown?: (e: React.PointerEvent) => void;
  shouldSuppressClick?: () => boolean;
  onOpenTimeAdjust?: () => void;
  cutEnabled?: boolean;
  isBeingMoved?: boolean;
  isCutActive?: boolean;
  onCutClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
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

export const HourCellCard = memo(function HourCellCard({
  item,
  compact = false,
  onClick,
  voiceEnabled,
  onReannounce,
  draggable = false,
  dragDisabledReason,
  isDragging = false,
  isDragPending = false,
  onCardPointerDown,
  shouldSuppressClick,
  onOpenTimeAdjust,
  cutEnabled = false,
  isBeingMoved = false,
  isCutActive = false,
  onCutClick,
  className,
  style,
}: Props) {
  const type = item.type === 'in_service' ? 'in_service' :
               item.type === 'booking' ? 'booking' :
               item.type === 'queue' ? 'queue' : 'gap';

  const styles = getCardStyles(type);
  const Icon = getIcon(type, item.protected);
  const label = getItemTypeLabel(type, item.protected);

  // Format content for display
  const timeRange = formatTimeRange(item.startTime, item.endTime);
  const timeLabel = formatTimeLabel(item.startTime, item.endTime);
  const customerName = item.customerName || item.label || '—';
  const serviceName = item.packageName
    ? item.packageName
    : item.serviceNames?.length
      ? formatServiceSummary(item.serviceNames)
      : (item.serviceNames?.[0] || '');
  const packageDetail = item.packageName
    ? [
        item.serviceNames?.length ? `${item.serviceNames.length} خدمات` : null,
        item.durationMinutes ? `${item.durationMinutes} دقيقة` : null,
      ]
        .filter(Boolean)
        .join(' • ')
    : '';
  const serviceTooltip = item.serviceNames?.length
    ? item.serviceNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
    : serviceName;
  const ticketCode = item.ticketCode || (type === 'queue' ? item.label : '');
  const bookingCode = type === 'booking' ? `BK-${item.sourceId}` : '';

  // Calculate card height based on duration
  const cardHeight = item.durationMinutes ? getCardHeight(item.durationMinutes) : (compact ? 44 : 56);
  
  // Compact mode for short bookings (< 20 min or when compact prop is true)
  const isCompact = compact || (item.durationMinutes && item.durationMinutes < 20);

  const handleClick = () => {
    if (shouldSuppressClick?.()) return;
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
  const tooltipText = `${customerName} • ${bookingCode || ticketCode || label} • ${timeRange}${serviceName ? ` • ${serviceName}` : ''}${item.originLabel ? ` • ${item.originLabel}` : ''}`;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border px-2.5 py-1 shadow-sm transition-[box-shadow,transform,opacity] duration-100 select-none',
        onClick && !draggable ? 'cursor-pointer hover:bg-foreground/[0.04]' : '',
        draggable && 'cursor-grab touch-none active:cursor-grabbing',
        isDragPending && 'z-20 scale-[1.01] ring-2 ring-primary/70 shadow-lg',
        isDragging && 'cursor-grabbing opacity-35 ring-2 ring-primary/50 shadow-md',
        isBeingMoved && 'border-dashed opacity-70 ring-1 ring-primary/40',
        isCutActive && 'ring-2 ring-primary/60',
        className,
      )}
      onClick={handleClick}
      onPointerDown={draggable ? onCardPointerDown : undefined}
      title={draggable ? `${tooltipText} — اسحب لتغيير الوقت` : tooltipText}
      style={{
        backgroundColor: styles.background,
        borderColor: styles.borderColor,
        minHeight: `${Math.max(cardHeight, 48)}px`,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!isDragging) e.currentTarget.style.borderColor = styles.hoverBorderColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = styles.borderColor;
      }}
    >
      {/* Card controls — RTL edge: cut + drag affordance */}
      {type === 'booking' && (draggable || cutEnabled) && (
        <div className="absolute inset-y-1 end-0.5 z-20 flex items-center gap-0.5">
          {cutEnabled && onCutClick && (
            <button
              type="button"
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors',
                'hover:border-primary/40 hover:bg-primary/10 hover:text-primary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                'md:size-8',
                isCutActive && 'border-primary/50 bg-primary-soft text-foreground',
              )}
              aria-label={`نقل موعد ${customerName}`}
              title="نقل الموعد إلى وقت أو حلاق آخر"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onCutClick();
              }}
            >
              <Scissors className="size-3 md:size-4" aria-hidden />
            </button>
          )}
          {draggable && (
            <div
              className="pointer-events-none flex size-8 items-center justify-center text-muted-foreground"
              aria-hidden
            >
              <GripVertical className="size-4" />
            </div>
          )}
        </div>
      )}

      {type === 'booking' && !draggable && !cutEnabled && dragDisabledReason && (
        <span
          className="absolute inset-y-1 end-0.5 flex w-8 items-center justify-center opacity-30"
          title={dragDisabledReason}
        >
          <GripVertical className="size-4 text-muted-foreground" />
        </span>
      )}

      {type === 'booking' && onOpenTimeAdjust && (
        <button
          type="button"
          className="absolute bottom-1 end-9 z-10 rounded px-1 text-[9px] text-primary md:hidden"
          onClick={(e) => {
            e.stopPropagation();
            onOpenTimeAdjust();
          }}
        >
          تغيير الوقت
        </button>
      )}

      {/* Status stripe */}
      <div
        className="absolute inset-y-0 start-0 w-1 rounded-full"
        style={{ background: styles.statusStripe ?? styles.borderColor }}
        aria-hidden
      />

      {isBeingMoved && (
        <span className="absolute start-1 top-1 z-10 rounded bg-primary-soft px-1.5 py-0.5 text-[9px] font-medium text-foreground">
          قيد النقل
        </span>
      )}

      {type === 'booking' && (
        <div className={cn('flex h-full min-w-0 flex-col justify-center gap-0.5 ps-1', draggable && cutEnabled ? 'pe-[4rem] md:pe-[4.5rem]' : draggable || cutEnabled || dragDisabledReason ? 'pe-8' : 'pe-1')}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1">
                <div className="truncate text-[13px] font-bold leading-tight text-foreground md:text-sm" title={customerName}>
                  {customerName}
                </div>
                {isCompact && item.originLabel && (
                  <BookingOriginBadge
                    kind={item.originKind}
                    label={item.originLabel}
                    compact
                    className="shrink-0"
                  />
                )}
              </div>
              {!isCompact && serviceName && item.packageName && (
                <div className="mt-0.5 min-w-0" title={serviceTooltip}>
                  <div className="truncate text-[11px] font-semibold text-primary md:text-xs">
                    {serviceName}
                  </div>
                  {packageDetail && (
                    <div className="truncate text-[10px] text-muted-foreground">{packageDetail}</div>
                  )}
                </div>
              )}
              {!isCompact && serviceName && !item.packageName && (
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground md:text-xs" title={serviceTooltip}>
                  {serviceName}
                  {(item.serviceNames?.length ?? 0) > 1 && (
                    <span className="ms-1 text-[10px] text-primary">
                      {item.serviceNames!.length} خدمات
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0 text-end">
              <div className="text-[12px] font-bold text-primary md:text-[13px]">{timeLabel}</div>
              {!isCompact && (
                <div className="text-[10px] text-muted-foreground">{timeRange}</div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            {!isCompact && item.originLabel ? (
              <BookingOriginBadge kind={item.originKind} label={item.originLabel} />
            ) : !item.originLabel ? (
              <span className="truncate text-[11px] text-muted-foreground">{label}</span>
            ) : (
              <span />
            )}
            <div className="flex shrink-0 items-center gap-1">
              {bookingCode && (
                <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                  {bookingCode}
                </span>
              )}
              {item.protected && (
                <span className="text-[10px] text-primary" title="محمي">
                  🛡️
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Queue Card */}
      {type === 'queue' && (
        <div className="flex h-full flex-col justify-center gap-1 ps-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Icon className="size-3.5 shrink-0" style={{ color: styles.iconColor }} />
              <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
            </div>
            {ticketCode && (
              <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-foreground">
                {ticketCode}
              </span>
            )}
          </div>

          <div className="truncate text-[13px] font-bold text-foreground md:text-sm" title={customerName}>
            {customerName}
          </div>

          <div className="text-[11px] text-muted-foreground">{timeRange}</div>

          {item.needsOperatorAction && (
            <span className="inline-flex w-fit rounded-md border border-destructive/30 bg-destructive-soft px-1.5 py-0.5 text-[10px] text-destructive">
              {item.effectiveStatus === 'overdue_finish_required'
                ? `يحتاج إنهاء${(item.overdueMinutes ?? 0) > 0 ? ` (${item.overdueMinutes}د)` : ''}`
                : item.effectiveStatus === 'no_show_candidate'
                  ? 'لم يحضر محتمل'
                  : item.effectiveStatus === 'expired_candidate'
                    ? 'منتهي محتمل'
                    : 'يحتاج إجراء'}
            </span>
          )}

          {isCalled && !item.needsOperatorAction && (
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-md bg-success-soft px-1.5 py-0.5 text-[10px] text-success">
                تم النداء
              </span>
              {voiceEnabled && (
                <button
                  type="button"
                  onClick={handleReannounce}
                  className="flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
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
        <div className="flex h-full flex-col justify-center gap-1 ps-1">
          <div className="flex items-center gap-1.5">
            <Icon className="size-3.5 shrink-0 text-warning" />
            <span className="text-[11px] font-semibold text-warning">قيد الخدمة</span>
          </div>
          <div className="truncate text-[13px] font-bold text-foreground md:text-sm" title={customerName}>
            {customerName}
          </div>
          <div className="text-[11px] text-foreground">{timeRange}</div>
          {serviceName && (
            <div className="truncate text-[10px] text-muted-foreground">{serviceName}</div>
          )}
          {item.needsOperatorAction && (
            <span className="inline-flex w-fit rounded-md border border-destructive/40 bg-destructive-soft px-1.5 py-0.5 text-[10px] text-destructive">
              يحتاج إنهاء{(item.overdueMinutes ?? 0) > 0 ? ` (${item.overdueMinutes}د)` : ''}
            </span>
          )}
        </div>
      )}

      {/* Gap/Other Card */}
      {type === 'gap' && (
        <div className="flex h-full items-center justify-center ps-1">
          <span className="text-[11px] text-muted-foreground">—</span>
        </div>
      )}
    </div>
  );
});

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

// Pair every surface with theme-aware text. Status is communicated by the
// existing labels and a restrained semantic stripe, not per-employee colour.
function getCardStyles(type: string) {
  switch (type) {
    case 'booking':
      return {
        background: 'var(--card)',
        borderColor: 'var(--border)',
        hoverBorderColor: 'var(--primary)',
        iconColor: 'var(--primary)',
        statusStripe: 'var(--primary)',
      };
    case 'queue':
      return {
        background: 'var(--surface-muted)',
        borderColor: 'var(--border)',
        hoverBorderColor: 'var(--brand)',
        iconColor: 'var(--brand)',
        statusStripe: 'var(--brand)',
      };
    case 'in_service':
      return {
        background: 'var(--warning-soft)',
        borderColor: 'var(--border)',
        hoverBorderColor: 'var(--warning)',
        iconColor: 'var(--warning)',
        statusStripe: 'var(--warning)',
      };
    default:
      return {
        background: 'var(--surface-muted)',
        borderColor: 'var(--border)',
        hoverBorderColor: 'var(--muted-foreground)',
        iconColor: 'var(--muted-foreground)',
        statusStripe: 'var(--muted-foreground)',
      };
  }
}
