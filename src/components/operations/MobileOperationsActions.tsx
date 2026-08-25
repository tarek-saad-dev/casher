'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  onCreateQueue: () => void;
  onCreateBooking: () => void;
  className?: string;
}

export function MobileOperationsActions({ onCreateQueue, onCreateBooking, className }: Props) {
  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 z-40 border-t border-border bg-background/95 p-1 backdrop-blur-md md:hidden',
        className,
      )}
      style={{ right: 0, paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-lg gap-1">
        <Button
          type="button"
          onClick={onCreateQueue}
          className="h-7 flex-1 gap-1 rounded-md bg-primary px-2 text-[11px] text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-3" />
          إنشاء دور
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCreateBooking}
          className="h-7 flex-1 rounded-md px-2 text-[11px]"
        >
          إنشاء حجز
        </Button>
      </div>
    </div>
  );
}
