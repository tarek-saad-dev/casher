/**
 * Staff (operations / admin) calls into the public booking plan → check-slot → create
 * routes. Resolves the write branch from the employee's operational location (optional
 * body.branchId) so plan tokens minted for ops match the branch create will write to.
 */
import 'server-only';
import type { NextResponse } from 'next/server';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch/context';

export type InternalOpsBookingRequest = {
  branchCode: string;
  auth: { userId: number; canOperate?: boolean };
  bookingSource: 'operations' | 'admin';
};

export function readInternalOpsBookingSource(
  body: Record<string, unknown>,
): 'operations' | 'admin' | null {
  const raw = typeof body.source === 'string' ? body.source.trim().toLowerCase() : '';
  return raw === 'operations' || raw === 'admin' ? raw : null;
}

/** Throws opsWriteBranch domain errors — map them with `opsWriteBranchErrorResponse`. */
export async function resolveInternalOpsBookingRequest(
  body: Record<string, unknown>,
  bookingSource: 'operations' | 'admin',
): Promise<InternalOpsBookingRequest | NextResponse> {
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  const empIdNum =
    typeof body.empId === 'number'
      ? body.empId
      : body.empId != null
        ? Number(body.empId)
        : NaN;
  const workDate =
    typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : undefined;

  let branchCode: string;
  if (Number.isFinite(empIdNum) && empIdNum > 0) {
    const { resolveOpsWriteBranch } = await import('@/lib/branch/opsWriteBranch');
    const target = await resolveOpsWriteBranch({
      userId: branch.userId,
      sessionBranchId: branch.branchId,
      empId: empIdNum,
      workDate,
      requestedBranchId: body.branchId ?? body.BranchID,
    });
    branchCode = target.branchCode;
  } else {
    // Nearest / no emp yet — stay on session branch (legacy).
    branchCode = branch.branchCode;
  }

  return {
    branchCode,
    auth: { userId: branch.userId, canOperate: branch.canOperate },
    bookingSource,
  };
}
