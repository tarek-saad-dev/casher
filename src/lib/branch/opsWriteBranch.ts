/**
 * Cross-branch ops writes: resolve which BranchID a queue/booking should stamp
 * when staff act from any active session (without forcing a branch switch).
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { getBranchById, listUserValidBranchAccess } from './repository';
import { BranchDomainError, type BranchRecord } from './types';
import { isEmployeeEligibleForBranchBookings } from './bookingQueueOwnership';
import { resolveEmployeeGlobalSchedule } from '@/lib/hr/employeeBranchScheduleResolver';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { listTenantLegacyBranchIds } from '@/platform/tenant/tenantContext';

export type OpsWriteBranchResult = {
  branchId: number;
  branchCode: string;
  branchName: string;
};

function parseRequestedBranchId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/**
 * Legacy TblUserBranchAccess rows may still point at branches of other tenants (pre-DRVO-013
 * grants were global), so every ops decision is intersected with the session tenant's Locations.
 */
async function sessionTenantBranchIds(tenantId: string | null | undefined): Promise<Set<number>> {
  if (!tenantId) return new Set();
  return listTenantLegacyBranchIds(tenantId);
}

/** Same visibility set as flow-board for multi-branch ops. */
export async function listUserOpsVisibleBranchIds(
  userId: number,
  tenantId: string | null | undefined,
): Promise<Set<number>> {
  const [access, tenantBranches] = await Promise.all([
    listUserValidBranchAccess(userId),
    sessionTenantBranchIds(tenantId),
  ]);
  return new Set(
    access
      .filter((a) => a.canOperate || a.canSwitch || a.canViewReports || a.isDefault)
      .map((a) => a.branchId)
      .filter((id) => tenantBranches.has(id)),
  );
}

export async function userCanWriteOpsOnBranch(
  userId: number,
  branchId: number,
  tenantId: string | null | undefined,
): Promise<boolean> {
  const [access, tenantBranches] = await Promise.all([
    listUserValidBranchAccess(userId),
    sessionTenantBranchIds(tenantId),
  ]);
  if (!tenantBranches.has(branchId)) return false;
  return access.some(
    (a) => a.branchId === branchId && (a.canOperate || a.canSwitch),
  );
}

/**
 * Employee's operational working branch for the work date (assignment / transfer).
 */
export async function resolveEmployeeWorkingBranchId(
  empId: number,
  workDate: string,
): Promise<number | null> {
  const global = await resolveEmployeeGlobalSchedule({
    empId,
    workDate,
    publicOnly: false,
  });
  const working = global.branches.find((b) => b.isWorking);
  return working?.branchId ?? null;
}

/**
 * Resolve write target for operations queue/booking.
 * Prefer client branchId (flow-board lane) when authorized + emp eligible there.
 * Else use emp's working branch for the day when authorized.
 * Else fall back to session branch (legacy).
 */
export async function resolveOpsWriteBranch(args: {
  userId: number;
  sessionBranchId: number;
  /** Session tenant; candidates outside its Locations are never written to. */
  tenantId: string | null | undefined;
  empId: number;
  workDate?: string | null;
  requestedBranchId?: unknown;
}): Promise<OpsWriteBranchResult> {
  const workDate =
    typeof args.workDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.workDate)
      ? args.workDate
      : getCairoBusinessDate();

  const requested = parseRequestedBranchId(args.requestedBranchId);
  const candidates: number[] = [];
  if (requested != null) candidates.push(requested);

  const workingId = await resolveEmployeeWorkingBranchId(args.empId, workDate);
  if (workingId != null && !candidates.includes(workingId)) {
    candidates.push(workingId);
  }
  if (!candidates.includes(args.sessionBranchId)) {
    candidates.push(args.sessionBranchId);
  }

  const tenantBranches = await sessionTenantBranchIds(args.tenantId);
  for (const branchId of candidates) {
    if (!tenantBranches.has(branchId)) continue;
    const canWrite = await userCanWriteOpsOnBranch(args.userId, branchId, args.tenantId);
    if (!canWrite && branchId !== args.sessionBranchId) continue;

    const eligible = await isEmployeeEligibleForBranchBookings({
      empId: args.empId,
      branchId,
      operationalDate: workDate,
      requireCanReceiveBookings: false,
      includeTemporaryTransfer: true,
    });
    if (!eligible) continue;

    const branch = await getBranchById(branchId);
    if (!branch || !branch.isActive) continue;

    return {
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      branchName: branch.branchName,
    };
  }

  throw new BranchDomainError(
    'NO_BRANCH_ACCESS',
    'الموظف غير متاح على فرع تملك صلاحية التشغيل عليه — تحقق من التعيين أو صلاحيات الفروع',
    403,
  );
}

export function opsWriteBranchErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof BranchDomainError) {
    return NextResponse.json(
      { ok: false, error: err.message, code: err.code },
      { status: err.status },
    );
  }
  return null;
}

/** Manage existing ticket/booking: session branch OR operable/switchable on record branch. */
export async function userCanManageOpsBranchRecord(args: {
  userId: number;
  sessionBranchId: number;
  tenantId: string | null | undefined;
  recordBranchId: number | null | undefined;
}): Promise<boolean> {
  if (args.recordBranchId == null || !Number.isFinite(args.recordBranchId)) {
    return false;
  }
  if (!(await sessionTenantBranchIds(args.tenantId)).has(args.recordBranchId)) return false;
  if (args.recordBranchId === args.sessionBranchId) return true;
  return userCanWriteOpsOnBranch(args.userId, args.recordBranchId, args.tenantId);
}

export async function loadBranchRecordOrThrow(branchId: number): Promise<BranchRecord> {
  const branch = await getBranchById(branchId);
  if (!branch || !branch.isActive) {
    throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير نشط', 403);
  }
  return branch;
}
