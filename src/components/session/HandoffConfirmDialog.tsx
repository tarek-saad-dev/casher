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

interface HandoffConfirmDialogProps {
  open: boolean;
  fromLabel: string;
  toLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function HandoffConfirmDialog({
  open,
  fromLabel,
  toLabel,
  busy,
  onCancel,
  onConfirm,
}: HandoffConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy} dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle>نقل التشغيل إلى {toLabel}؟</DialogTitle>
          <DialogDescription className="text-right space-y-1.5 pt-2">
            <p>أنت تعمل حاليًا في فرع {fromLabel}.</p>
            <p>
              لنقل التشغيل إلى {toLabel}
              <br />
              يجب نقل الوردية أولًا.
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">
          <Button variant="outline" onClick={onCancel} disabled={busy} className="flex-1 sm:flex-none">
            إلغاء
          </Button>
          <Button onClick={onConfirm} disabled={busy} className="flex-1 sm:flex-none">
            {busy ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
            نقل التشغيل إلى {toLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
