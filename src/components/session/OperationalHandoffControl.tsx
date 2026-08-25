'use client';

import { useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { usePermission } from '@/hooks/usePermission';
import { useOperationalToast } from '@/components/session/OperationalToast';
import HandoffBranchDialog from '@/components/session/HandoffBranchDialog';
import {
  branchDisplayName,
  mapOperationalError,
} from '@/lib/operations/viewOperationalState';

interface OperationalHandoffControlProps {
  className?: string;
  label?: string;
  onSuccess?: () => void;
}

export default function OperationalHandoffControl({
  className,
  label,
  onSuccess,
}: OperationalHandoffControlProps) {
  const {
    shift,
    branches,
    viewBranch,
    operationalBranch,
    hasOpenShift,
    viewMatchesOperational,
    handoffMyShift,
    refresh,
  } = useSession();
  const canOpenShift = usePermission('shift.open');
  const { showToast } = useOperationalToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const opLabel = branchDisplayName(operationalBranch);
  const viewLabel = branchDisplayName(viewBranch);
  const targets = branches
    .filter((b) => b.canOperate && b.branchId !== operationalBranch?.branchId)
    .map((b) => ({
      branchId: b.branchId,
      label: branchDisplayName(b),
    }));

  if (!hasOpenShift || !canOpenShift || targets.length === 0) return null;

  const buttonLabel =
    label ?? (!viewMatchesOperational ? `نقل إلى ${viewLabel}` : 'نقل التشغيل');

  async function confirm(targetBranchId: number) {
    if (!shift?.ShiftID) return;
    const target = targets.find((b) => b.branchId === targetBranchId);
    setBusy(true);
    setError('');
    try {
      await handoffMyShift({
        targetBranchId,
        shiftId: shift.ShiftID,
      });
      setOpen(false);
      showToast(`تم نقل الوردية إلى ${target?.label ?? 'الفرع'}`);
      onSuccess?.();
    } catch (err) {
      setError(mapOperationalError(err, 'فشل نقل التشغيل'));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
        className={className}
      >
        {buttonLabel}
      </button>
      <HandoffBranchDialog
        open={open}
        fromLabel={opLabel}
        targets={targets}
        defaultTargetId={!viewMatchesOperational ? viewBranch?.branchId ?? null : null}
        busy={busy}
        error={error}
        onCancel={() => {
          if (busy) return;
          setOpen(false);
          setError('');
        }}
        onConfirm={(targetBranchId) => void confirm(targetBranchId)}
      />
    </>
  );
}
