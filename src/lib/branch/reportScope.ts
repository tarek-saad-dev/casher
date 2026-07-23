import 'server-only';
import { NextResponse } from 'next/server';
import {
  isActiveBranchContext,
  requireActiveBranchContext,
} from './context';
import {
  branchNow,
  getBranchById,
  listActiveBranches,
  listUserValidBranchAccess,
} from './repository';
import { validateUserBranchAccess } from './access';
import { BranchDomainError } from './types';

export type ReportBranchRef = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
};

export type ReportBranchScope =
  | {
      mode: 'single';
      branchId: number;
      branchCode: string;
      branchName: string;
      shortName: string | null;
    }
  | {
      mode: 'all';
      branchIds: number[];
      branches: ReportBranchRef[];
    };

export type ReportScopeRequest = {
  /** Browser/query branchId — validated server-side; never trusted alone. */
  requestedBranchId?: number | null;
  /** Explicit all-branches request (`scope=all`). */
  requestedAllBranches?: boolean;
  /**
   * Caller already passed page ACL for a report that may use ALL_BRANCHES.
   * ALL_BRANCHES still requires CanViewReports on every included branch.
   * UserLevel=admin alone is not sufficient.
   */
  allowAllBranchesIfPermitted?: boolean;
};

export function reportScopeToCacheKey(scope: ReportBranchScope): string {
  if (scope.mode === 'single') {
    return `single:${scope.branchId}`;
  }
  const ids = [...scope.branchIds].sort((a, b) => a - b);
  return `all:${ids.join(',')}`;
}

export function reportScopeMetadata(scope: ReportBranchScope) {
  if (scope.mode === 'single') {
    return {
      mode: 'single' as const,
      branch: {
        BranchID: scope.branchId,
        BranchCode: scope.branchCode,
        BranchName: scope.branchName,
        ShortName: scope.shortName,
      },
    };
  }
  return {
    mode: 'all' as const,
    branches: scope.branches.map((b) => ({
      BranchID: b.branchId,
      BranchCode: b.branchCode,
      BranchName: b.branchName,
      ShortName: b.shortName,
    })),
  };
}

export async function listAuthorizedReportBranches(
  userId: number,
  at: Date = branchNow(),
): Promise<ReportBranchRef[]> {
  const access = await listUserValidBranchAccess(userId, at);
  return access
    .filter((a) => a.canViewReports && a.isActive && a.branchIsActive)
    .map((a) => ({
      branchId: a.branchId,
      branchCode: a.branchCode,
      branchName: a.branchName,
      shortName: a.shortName,
    }));
}

export async function validateRequestedReportBranch(
  userId: number,
  branchId: number,
  at: Date = branchNow(),
): Promise<ReportBranchRef> {
  const branch = await getBranchById(branchId);
  if (!branch || !branch.isActive) {
    throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير نشط أو غير موجود', 404);
  }
  const access = await validateUserBranchAccess(userId, branchId, at);
  if (!access.canViewReports) {
    throw new BranchDomainError(
      'REPORT_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تقارير هذا الفرع',
      403,
    );
  }
  return {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    shortName: branch.shortName,
  };
}

/**
 * Default: active session branch (must have CanViewReports).
 */
export async function resolveActiveBranchReportScope(
  at: Date = branchNow(),
): Promise<ReportBranchScope | NextResponse> {
  const ctx = await requireActiveBranchContext(at);
  if (!isActiveBranchContext(ctx)) return ctx;
  if (!ctx.canViewReports) {
    return NextResponse.json(
      { error: 'غير مصرح — لا تملك صلاحية تقارير هذا الفرع', code: 'REPORT_NOT_ALLOWED' },
      { status: 403 },
    );
  }
  return {
    mode: 'single',
    branchId: ctx.branchId,
    branchCode: ctx.branchCode,
    branchName: ctx.branchName,
    shortName: ctx.shortName,
  };
}

/**
 * Selected branch for privileged reports. Falls back to active branch when
 * no branchId is requested. Rejects ALL_BRANCHES (use requireAllBranchesReportAccess).
 */
export async function resolveSelectedBranchReportScope(
  req: ReportScopeRequest,
  at: Date = branchNow(),
): Promise<ReportBranchScope | NextResponse> {
  if (req.requestedAllBranches) {
    return NextResponse.json(
      {
        error: 'استخدم مسار التقارير المصرح له بكل الفروع',
        code: 'ALL_BRANCHES_NOT_ALLOWED_HERE',
      },
      { status: 403 },
    );
  }

  const ctx = await requireActiveBranchContext(at);
  if (!isActiveBranchContext(ctx)) return ctx;

  const requested = req.requestedBranchId;
  if (requested == null || Number(requested) === Number(ctx.branchId)) {
    if (!ctx.canViewReports) {
      return NextResponse.json(
        { error: 'غير مصرح — لا تملك صلاحية تقارير هذا الفرع', code: 'REPORT_NOT_ALLOWED' },
        { status: 403 },
      );
    }
    return {
      mode: 'single',
      branchId: ctx.branchId,
      branchCode: ctx.branchCode,
      branchName: ctx.branchName,
      shortName: ctx.shortName,
    };
  }

  try {
    const branch = await validateRequestedReportBranch(ctx.userId, Number(requested), at);
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

/**
 * Privileged ALL_BRANCHES read scope.
 * Requires allowAllBranchesIfPermitted + CanViewReports on every active branch included.
 * UserLevel=admin alone does not grant this.
 */
export async function requireAllBranchesReportAccess(
  req: ReportScopeRequest,
  at: Date = branchNow(),
): Promise<ReportBranchScope | NextResponse> {
  if (!req.allowAllBranchesIfPermitted || !req.requestedAllBranches) {
    return NextResponse.json(
      { error: 'غير مصرح — وضع كل الفروع غير مفعّل لهذا الطلب', code: 'ALL_BRANCHES_DENIED' },
      { status: 403 },
    );
  }

  const ctx = await requireActiveBranchContext(at);
  if (!isActiveBranchContext(ctx)) return ctx;

  const authorized = await listAuthorizedReportBranches(ctx.userId, at);
  const active = await listActiveBranches();
  const authorizedIds = new Set(authorized.map((b) => b.branchId));
  const missing = active.filter((b) => !authorizedIds.has(b.branchId));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: 'غير مصرح — يلزم صلاحية تقارير لكل الفروع النشطة للوضع الموحّد',
        code: 'ALL_BRANCHES_INCOMPLETE_ACCESS',
      },
      { status: 403 },
    );
  }
  if (authorized.length === 0) {
    return NextResponse.json(
      { error: 'لا توجد فروع مصرح بها للتقارير', code: 'NO_BRANCH_ACCESS' },
      { status: 403 },
    );
  }

  const sorted = [...authorized].sort((a, b) => a.branchId - b.branchId);
  return {
    mode: 'all',
    branchIds: sorted.map((b) => b.branchId),
    branches: sorted,
  };
}

/**
 * Resolve single or all from query for admin financial reports.
 * Default = active branch. `scope=all` requires allowAllBranchesIfPermitted.
 */
export async function resolveReportBranchScope(
  req: ReportScopeRequest,
  at: Date = branchNow(),
): Promise<ReportBranchScope | NextResponse> {
  if (req.requestedAllBranches) {
    return requireAllBranchesReportAccess(req, at);
  }
  return resolveSelectedBranchReportScope(req, at);
}

export function isReportBranchScope(
  v: ReportBranchScope | NextResponse,
): v is ReportBranchScope {
  return !(v instanceof NextResponse) && typeof (v as ReportBranchScope).mode === 'string';
}

export function parseReportScopeQuery(searchParams: URLSearchParams): {
  requestedBranchId: number | null;
  requestedAllBranches: boolean;
} {
  const scope = (searchParams.get('scope') || '').trim().toLowerCase();
  const requestedAllBranches = scope === 'all' || scope === 'all_branches';
  const raw = searchParams.get('branchId');
  let requestedBranchId: number | null = null;
  if (raw != null && raw !== '') {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) requestedBranchId = n;
  }
  return { requestedBranchId, requestedAllBranches };
}
