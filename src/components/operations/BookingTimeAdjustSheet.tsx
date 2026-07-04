'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TimelineItem } from './schedulerUtils';
import { formatTimeRange } from './schedulerUtils';

interface Props {
  open: boolean;
  item: TimelineItem | null;
  onClose: () => void;
  onAdjust: (deltaMinutes: number) => void;
}

const PRESETS = [-30, -15, 15, 30] as const;

export function BookingTimeAdjustSheet({ open, item, onClose, onAdjust }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="fixed bottom-0 top-auto max-w-lg translate-y-0 rounded-b-none rounded-t-2xl sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%] sm:rounded-b-lg">
        <DialogHeader>
          <DialogTitle>تغيير الوقت</DialogTitle>
        </DialogHeader>

        {item && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {item.customerName || item.label}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatTimeRange(item.startTime, item.endTime)}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((delta) => (
                <Button
                  key={delta}
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => {
                    onAdjust(delta);
                    onClose();
                  }}
                >
                  {delta > 0 ? `+${delta}` : delta} دقيقة
                </Button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
