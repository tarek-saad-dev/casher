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
        'fixed bottom-0 left-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur-md md:hidden',
        className,
      )}
      style={{ right: 0, paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-lg gap-2">
        <Button
          type="button"
          onClick={onCreateQueue}
          className="h-11 flex-1 gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          إنشاء دور
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCreateBooking}
          className="h-11 flex-1 rounded-xl"
        >
          إنشاء حجز
        </Button>
      </div>
    </div>
  );
}
