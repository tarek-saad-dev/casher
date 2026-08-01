import 'server-only';
import { NextResponse } from 'next/server';
import { isPartnerOnlyUser } from '@/lib/partnerAccess';
import {
  isActiveBranchContext,
  requireActiveBranchContext,
} from './context';
import { branchNow, getBranchById } from './repository';
import { validateUserBranchAccess } from './access';
import { BranchDomainError } from './types';
import {
  resolveReportBranchScope,
  type ReportBranchScope,
  type ReportScopeRequest,
} from './reportScope';

/**
 * Partners report scope.
 *
 * Partner-only users are branch-bound at login (TblUserBranchAccess default).
 * Their sole allowed page is this report, so active/linked branch access is
 * enough — CanViewReports may still be 0 from Phase 1B non-admin backfill.
 *
 * Staff roles keep the normal report-scope rules (CanViewReports required).
 */
export async function resolvePartnersReportBranchScope(
  roles: string[],
  req: ReportScopeRequest,
  at: Date = branchNow(),
): Promise<ReportBranchScope | NextResponse> {
  if (!isPartnerOnlyUser(roles)) {
    return resolveReportBranchScope(req, at);
  }

  if (req.requestedAllBranches) {
    return NextResponse.json(
      {
        error: 'غير مصرح — وضع كل الفروع غير متاح لحساب الشريك',
        code: 'ALL_BRANCHES_DENIED',
      },
      { status: 403 },
    );
  }

  const ctx = await requireActiveBranchContext(at);
  if (!isActiveBranchContext(ctx)) return ctx;

  const requested = req.requestedBranchId;
  if (requested == null || Number(requested) === Number(ctx.branchId)) {
    return {
      mode: 'single',
      branchId: ctx.branchId,
      branchCode: ctx.branchCode,
      branchName: ctx.branchName,
      shortName: ctx.shortName,
    };
  }

  try {
    const branch = await getBranchById(Number(requested));
    if (!branch || !branch.isActive) {
      throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير نشط أو غير موجود', 404);
    }
    // Confirms the partner is linked to the requested branch (any valid access row).
    await validateUserBranchAccess(ctx.userId, Number(requested), at);
    return {
      mode: 'single',
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      branchName: branch.branchName,
      shortName: branch.shortName,
    };
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    throw err;
  }
}
