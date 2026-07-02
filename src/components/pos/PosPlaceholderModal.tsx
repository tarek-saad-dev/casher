'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PosPlaceholderModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  primaryLabel: string;
}

export default function PosPlaceholderModal({
  open,
  onClose,
  title,
  primaryLabel,
}: PosPlaceholderModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="border-border bg-surface sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-foreground">{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            سيتم ربط بيانات وتنفيذ هذه العملية لاحقًا.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="border-border bg-surface-muted text-foreground hover:bg-surface-muted/80"
          >
            إغلاق
          </Button>
          <Button type="button" disabled className="bg-primary/40 text-primary-foreground">
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
