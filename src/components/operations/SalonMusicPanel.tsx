'use client';

import { OperationsMusicPlayerEnhanced } from './OperationsMusicPlayerEnhanced';
import { cn } from '@/lib/utils';

interface Props {
  expanded: boolean;
  onToggleExpand: () => void;
  className?: string;
}

export function SalonMusicPanel({ expanded, onToggleExpand, className }: Props) {
  if (!expanded) return null;

  return (
    <div
      id="salon-music-panel"
      className={cn(
        'rounded-xl border border-border/80 bg-surface-muted/30 p-2 shadow-sm md:p-3',
        className,
      )}
      role="region"
      aria-label="موسيقى الصالة"
    >
      <OperationsMusicPlayerEnhanced
        isExpanded
        onToggleExpand={onToggleExpand}
        embedded
      />
    </div>
  );
}
