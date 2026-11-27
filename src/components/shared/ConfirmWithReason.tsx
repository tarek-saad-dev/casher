'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * Confirmation that requires a written reason (DRVO UI kit) — for deleting an
 * invoice, reversing a cash move, voiding a ledger entry and other actions
 * that must leave an audit trail. The confirm button stays disabled until the
 * reason is long enough, shows progress, and keeps the dialog open on error.
 */
export interface ConfirmWithReasonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  minReasonLength?: number;
  tone?: 'danger' | 'default';
  onConfirm: (reason: string) => Promise<void> | void;
}

export default function ConfirmWithReason({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'تأكيد',
  reasonLabel = 'السبب',
  reasonPlaceholder = 'اكتب سبب واضح — بيتسجل في سجل التدقيق',
  minReasonLength = 3,
  tone = 'danger',
  onConfirm,
}: ConfirmWithReasonProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setReason('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length < minReasonLength;

  const submit = async () => {
    if (tooShort || busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ العملية');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!busy ? onOpenChange(next) : undefined)}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-foreground">{reasonLabel}</span>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            rows={3}
            autoFocus
            disabled={busy}
          />
          {tooShort && reason.length > 0 ? (
            <span className="text-xs text-muted-foreground">السبب لازم يكون {minReasonLength} حروف على الأقل</span>
          ) : null}
        </label>

        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            إلغاء
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'default'}
            onClick={() => void submit()}
            disabled={tooShort}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
