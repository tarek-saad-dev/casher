'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CloseShiftConfirmDialogProps {
  open: boolean;
  branchLabel: string;
  startedAt: string | null;
  elapsed: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function CloseShiftConfirmDialog({
  open,
  branchLabel,
  startedAt,
  elapsed,
  busy,
  onCancel,
  onConfirm,
}: CloseShiftConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy} dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle>إنهاء وردية {branchLabel}؟</DialogTitle>
          <DialogDescription className="text-right space-y-1.5 pt-2">
            {startedAt ? <p>بدأت: {startedAt}</p> : null}
            {elapsed ? <p>المدة: {elapsed}</p> : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">
          <Button variant="outline" onClick={onCancel} disabled={busy} className="flex-1 sm:flex-none">
            إلغاء
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            {busy ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
            إنهاء الوردية
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
