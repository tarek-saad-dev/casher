'use client';

import { TicketPlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  enabled: boolean;
  tooltip: string;
  loading?: boolean;
  highlighted?: boolean;
  onClick: () => void;
}

export function BarberHeaderQueueButton({
  enabled,
  tooltip,
  loading = false,
  highlighted = false,
  onClick,
}: Props) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (enabled && !loading) onClick();
      }}
      disabled={!enabled || loading}
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        'relative flex shrink-0 items-center justify-center gap-1 rounded-lg border font-semibold transition-all',
        'h-8 min-h-[32px] min-w-[32px] px-2 text-xs',
        'md:h-8 md:min-h-[32px] md:px-2.5',
        'max-md:min-h-[44px] max-md:min-w-[44px] max-md:px-3',
        enabled && !loading
          ? 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
          : 'cursor-not-allowed border-border/60 bg-surface-muted/40 text-muted-foreground opacity-60',
        highlighted && enabled && 'ring-2 ring-primary/35 shadow-sm',
      )}
    >
      {loading ? (
        <Loader2 className="size-3.5 animate-spin md:size-4" />
      ) : (
        <>
          <TicketPlus className="size-3.5 md:size-4" />
          <span className="hidden sm:inline">+ دور</span>
        </>
      )}
    </button>
  );
}
