'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function WorkforceConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  confirming = false,
  destructive = false,
  describedById = 'workforce-confirm-desc',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirming?: boolean;
  destructive?: boolean;
  describedById?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !confirming && onCancel()}>
      <DialogContent
        className="sm:max-w-sm"
        dir="rtl"
        aria-describedby={describedById}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id={describedById}>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={confirming} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming ? 'جاري التنفيذ…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
