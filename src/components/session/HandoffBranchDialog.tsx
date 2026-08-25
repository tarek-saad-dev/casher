'use client';

import { useEffect, useState } from 'react';
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
import { cn } from '@/lib/utils';

export type HandoffTargetBranch = {
  branchId: number;
  label: string;
};

interface HandoffBranchDialogProps {
  open: boolean;
  fromLabel: string;
  targets: HandoffTargetBranch[];
  defaultTargetId: number | null;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (targetBranchId: number) => void;
}

export default function HandoffBranchDialog({
  open,
  fromLabel,
  targets,
  defaultTargetId,
  busy,
  error,
  onCancel,
  onConfirm,
}: HandoffBranchDialogProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const preferred =
      defaultTargetId && targets.some((t) => t.branchId === defaultTargetId)
        ? defaultTargetId
        : targets[0]?.branchId ?? null;
    setSelectedId(preferred);
  }, [open, defaultTargetId, targets]);

  const selected = targets.find((t) => t.branchId === selectedId) ?? null;
  const toLabel = selected?.label ?? 'الفرع';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy} dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle>نقل التشغيل</DialogTitle>
          <DialogDescription className="text-right space-y-1.5 pt-2">
            <p>تعمل حالياً في {fromLabel}.</p>
            <p>اختر الفرع الذي تريد العمل فيه.</p>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {targets.map((branch) => (
            <button
              key={branch.branchId}
              type="button"
              disabled={busy}
              onClick={() => setSelectedId(branch.branchId)}
              className={cn(
                'flex h-11 w-full items-center justify-between rounded-lg border px-3 text-sm transition-colors',
                selectedId === branch.branchId
                  ? 'border-primary bg-primary/10 font-semibold text-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted/60',
              )}
            >
              <span>{branch.label}</span>
              {selectedId === branch.branchId ? (
                <span className="text-xs text-primary">المحدد</span>
              ) : null}
            </button>
          ))}
        </div>

        {selected ? (
          <p className="text-sm text-muted-foreground">
            سيتم إنهاء وردية {fromLabel} وبدء وردية جديدة في {toLabel}.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">لا توجد فروع أخرى متاحة للنقل.</p>
        )}

        {error ? (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
        ) : null}

        <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">
          <Button variant="outline" onClick={onCancel} disabled={busy} className="flex-1 sm:flex-none">
            إلغاء
          </Button>
          <Button
            onClick={() => selected && onConfirm(selected.branchId)}
            disabled={busy || !selected}
            className="flex-1 sm:flex-none"
          >
            {busy ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
            نقل التشغيل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
