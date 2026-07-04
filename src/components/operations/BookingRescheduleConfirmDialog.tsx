'use client';

import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  label: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BookingRescheduleConfirmDialog({
  open,
  label,
  confirming = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !confirming && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>تأكيد نقل الموعد</DialogTitle>
          <DialogDescription>
            نقل الموعد من {label}؟
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={confirming}
          >
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                جاري النقل…
              </>
            ) : (
              'تأكيد النقل'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
