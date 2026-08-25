'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import MobileBottomSheet from '@/components/pos/mobile/MobileBottomSheet';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/useSession';
import { performBranchSwitch } from '@/lib/branch/postSwitchClient';
import {
  branchDisplayName,
  formatShiftElapsed,
  formatShiftStartTime,
  mapOperationalError,
} from '@/lib/operations/viewOperationalState';
import CloseShiftConfirmDialog from '@/components/session/CloseShiftConfirmDialog';
import OperationalHandoffControl from '@/components/session/OperationalHandoffControl';
import { useOperationalToast } from '@/components/session/OperationalToast';

interface OperationalMobileSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function OperationalMobileSheet({ open, onClose }: OperationalMobileSheetProps) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    viewBranch,
    operationalBranch,
    shift,
    day,
    hasOpenShift,
    viewMatchesOperational,
    closeMyShift,
    refresh,
  } = useSession();
  const { showToast } = useOperationalToast();
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);

  useEffect(() => {
    if (!open || !hasOpenShift) return;
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [open, hasOpenShift]);

  const viewLabel = branchDisplayName(viewBranch);
  const opLabel = branchDisplayName(operationalBranch);
  const startedAt = formatShiftStartTime(shift?.StartDate, shift?.StartTime);
  const elapsed = formatShiftElapsed(shift?.StartDate, shift?.StartTime, now);
  const dayLabel = day?.NewDay
    ? new Date(day.NewDay).toLocaleDateString('ar-EG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : '—';

  async function confirmClose() {
    if (!shift) return;
    setBusy(true);
    setError('');
    try {
      await closeMyShift(shift.ID);
      setCloseOpen(false);
      onClose();
      showToast(`تم إنهاء وردية ${opLabel}`);
    } catch (err) {
      setError(mapOperationalError(err));
    } finally {
      setBusy(false);
    }
  }

  async function returnToOperational() {
    if (!operationalBranch) return;
    setBusy(true);
    setError('');
    try {
      const result = await performBranchSwitch({
        branchId: operationalBranch.branchId,
        targetLabel: opLabel,
        currentPathname: pathname,
        onSoftSwitch: async () => {
          await refresh();
          router.refresh();
        },
      });
      if (!result.ok && result.error !== 'CANCELLED') {
        setError(result.message);
        return;
      }
      onClose();
    } catch (err) {
      setError(mapOperationalError(err, 'فشل الرجوع إلى الفرع التشغيلي'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <MobileBottomSheet open={open} onClose={onClose} title="الحالة التشغيلية">
        <div className="space-y-4 text-sm" dir="rtl">
          <Row label="الفرع المعروض" value={viewLabel} />
          <Row
            label="الفرع التشغيلي"
            value={hasOpenShift ? opLabel : 'لا توجد وردية مفتوحة'}
            strong={hasOpenShift}
            success={hasOpenShift && viewMatchesOperational}
            warn={hasOpenShift && !viewMatchesOperational}
          />
          <Row label="اليوم التشغيلي" value={dayLabel} />
          {hasOpenShift ? (
            <>
              <Row label="وقت بداية الوردية" value={startedAt || '—'} />
              <Row label="مدة الوردية" value={elapsed || '—'} />
            </>
          ) : null}

          {error ? (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-xs">
              {error}
            </div>
          ) : null}

          <div className="space-y-2 pt-1">
            <Button variant="outline" className="h-11 w-full" onClick={onClose}>
              تغيير الفرع المعروض
            </Button>

            {hasOpenShift && !viewMatchesOperational ? (
              <Button
                variant="outline"
                className="h-11 w-full"
                disabled={busy}
                onClick={() => void returnToOperational()}
              >
                {busy ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
                الرجوع إلى {opLabel}
              </Button>
            ) : null}

            <OperationalHandoffControl
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              onSuccess={onClose}
            />

            {hasOpenShift ? (
              <Button
                variant="destructive"
                className="h-11 w-full"
                disabled={busy}
                onClick={() => setCloseOpen(true)}
              >
                إغلاق الوردية
              </Button>
            ) : null}
          </div>
        </div>
      </MobileBottomSheet>

      <CloseShiftConfirmDialog
        open={closeOpen}
        branchLabel={opLabel}
        startedAt={startedAt}
        elapsed={elapsed}
        busy={busy}
        onCancel={() => setCloseOpen(false)}
        onConfirm={() => void confirmClose()}
      />
    </>
  );
}

function Row({
  label,
  value,
  strong,
  success,
  warn,
}: {
  label: string;
  value: string;
  strong?: boolean;
  success?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          success
            ? 'font-semibold text-success'
            : warn
              ? 'font-semibold text-amber-600 dark:text-amber-400'
              : strong
                ? 'font-semibold text-foreground'
                : 'text-foreground'
        }
      >
        {value}
      </span>
    </div>
  );
}
