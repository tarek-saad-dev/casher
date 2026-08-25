'use client';

import { Globe, Monitor, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BookingOriginKind } from '@/lib/booking/bookingOriginDisplay';

type BadgeSize = 'sm' | 'md';

const KIND_CLASS: Record<BookingOriginKind, string> = {
  website: 'bg-sky-500/18 text-sky-200 ring-1 ring-inset ring-sky-400/35',
  user: 'bg-amber-500/18 text-amber-200 ring-1 ring-inset ring-amber-400/40',
  system: 'bg-zinc-500/20 text-zinc-300 ring-1 ring-inset ring-zinc-400/30',
};

function OriginIcon({
  kind,
  className,
}: {
  kind: BookingOriginKind;
  className?: string;
}) {
  if (kind === 'website') return <Globe className={className} aria-hidden />;
  if (kind === 'user') return <UserRound className={className} aria-hidden />;
  return <Monitor className={className} aria-hidden />;
}

export function BookingOriginBadge({
  kind,
  label,
  compact = false,
  size = 'sm',
  className,
}: {
  kind?: BookingOriginKind | null;
  label?: string | null;
  compact?: boolean;
  size?: BadgeSize;
  className?: string;
}) {
  if (!label) return null;
  const resolvedKind: BookingOriginKind = kind ?? 'system';
  const iconClass = size === 'md' ? 'size-3.5 shrink-0' : 'size-2.5 shrink-0';

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 rounded-full font-semibold tracking-wide',
        compact ? 'px-1 py-px text-[9px] leading-none' : 'px-1.5 py-0.5 text-[10px] leading-tight',
        size === 'md' && 'gap-1 px-2 py-1 text-xs',
        KIND_CLASS[resolvedKind],
        className,
      )}
      title={label}
    >
      <OriginIcon kind={resolvedKind} className={iconClass} />
      <span className={cn('truncate', compact ? 'max-w-[4.5rem]' : 'max-w-[7.5rem]')}>
        {label}
      </span>
    </span>
  );
}
