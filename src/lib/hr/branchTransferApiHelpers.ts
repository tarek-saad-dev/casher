import type { AuthResult } from '@/lib/api-auth';
import { getBranchByCode, listUserValidBranchAccess } from '@/lib/branch/repository';

export async function resolveTransferAccessFlags(
  auth: AuthResult,
  fromBranchId: number | null,
  toBranchId: number,
) {
  const access = await listUserValidBranchAccess(auth.userId);
  const canOperateOrSwitch = (branchId: number) =>
    access.some((a) => a.branchId === branchId && (a.canOperate || a.canSwitch));
  const canOperateAnywhere = access.some((a) => a.canOperate || a.canSwitch);
  return {
    callerHasSourceAccess:
      auth.isSuperAdmin === true ||
      fromBranchId == null ||
      canOperateOrSwitch(fromBranchId),
    callerHasDestinationAccess:
      auth.isSuperAdmin === true ||
      canOperateOrSwitch(toBranchId) ||
      canOperateAnywhere,
  };
}

export async function resolveDestinationBranchId(body: {
  toBranchId?: unknown;
  toBranchCode?: unknown;
}): Promise<number | null> {
  let toBranchId = body.toBranchId != null ? Number(body.toBranchId) : null;
  const toBranchCode = body.toBranchCode
    ? String(body.toBranchCode).toUpperCase()
    : null;
  if (!toBranchId && toBranchCode) {
    const b = await getBranchByCode(toBranchCode);
    toBranchId = b?.branchId ?? null;
  }
  return toBranchId != null && Number.isFinite(toBranchId) ? toBranchId : null;
}
