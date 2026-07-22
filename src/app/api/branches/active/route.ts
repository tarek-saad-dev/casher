import { NextResponse } from 'next/server';
import {
  isActiveBranchContext,
  requireActiveBranchContext,
} from '@/lib/branch/context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/branches/active — revalidated active branch context. */
export async function GET() {
  const ctx = await requireActiveBranchContext();
  if (!isActiveBranchContext(ctx)) return ctx;

  return NextResponse.json({
    activeBranch: {
      userId: ctx.userId,
      BranchID: ctx.branchId,
      BranchCode: ctx.branchCode,
      BranchName: ctx.branchName,
      ShortName: ctx.shortName,
      TimeZone: ctx.timeZone,
      BusinessDayCutoffTime: ctx.businessDayCutoffTime,
      CanOperate: ctx.canOperate,
      CanViewReports: ctx.canViewReports,
      CanSwitch: ctx.canSwitch,
    },
  });
}
