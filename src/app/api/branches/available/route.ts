import { NextResponse } from 'next/server';
import { authenticate, isAuthResult } from '@/lib/api-auth';
import { listUserValidBranchAccess } from '@/lib/branch/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/branches/available — current user's valid active branch mappings only. */
export async function GET() {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;

  const rows = await listUserValidBranchAccess(auth.userId);
  return NextResponse.json({
    branches: rows.map((row) => ({
      BranchID: row.branchId,
      BranchCode: row.branchCode,
      BranchName: row.branchName,
      ShortName: row.shortName,
      IsDefault: row.isDefault,
      CanOperate: row.canOperate,
      CanViewReports: row.canViewReports,
      CanSwitch: row.canSwitch,
      ValidTo: row.validTo ? row.validTo.toISOString() : null,
    })),
  });
}
