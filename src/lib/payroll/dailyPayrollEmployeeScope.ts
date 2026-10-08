/**
 * Read-only employee visibility scope for Daily Payroll table.
 * Does NOT mutate session branch — viewBranchIds are resolved from ACL.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import {
  isActiveBranchContext,
  requireActiveBranchContext,
} from '@/lib/branch/context';
import {
  branchNow,
  getBranchByCode,
  listUserValidBranchAccess,
} from '@/lib/branch/repository';
import { BranchDomainError } from '@/lib/branch/types';
import { hrBranchLabel, legacyHrAllScopeBranches } from '@/lib/hr/legacyHrBranchPolicy';
import { hrTenantIdForBranch } from '@/lib/hr/hrTenantScope';
import { listTenantLegacyBranchIds } from '@/platform/tenant/tenantContext';
import {
  parseDailyPayrollEmployeeScope,
  type DailyPayrollEmployeeScope,
} from '@/lib/payroll/dailyPayrollEmployeeScope.shared';

export {
  parseDailyPayrollEmployeeScope,
  type DailyPayrollEmployeeScope,
} from '@/lib/payroll/dailyPayrollEmployeeScope.shared';

export type DailyPayrollViewBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
};

/** One selectable `employeeScope` branch tab. */
export type DailyPayrollScopeOption = { code: string; label: string };

export type DailyPayrollViewScope = {
  employeeScope: DailyPayrollEmployeeScope | 'active';
  branches: DailyPayrollViewBranch[];
  branchIds: number[];
  /** Branch tabs of the caller's tenant (in branch order), shown next to 'all'. */
  scopeOptions: DailyPayrollScopeOption[];
};

function canViewPayrollBranch(a: {
  canOperate: boolean;
  canViewReports: boolean;
  isActive: boolean;
  branchIsActive: boolean;
}): boolean {
  return a.isActive && a.branchIsActive && (a.canOperate || a.canViewReports);
}

/**
 * Resolve which BranchIDs the table may show for this request.
 * `employeeScope=all|<tenant branch code>` never switches the session branch.
 * Omitted / active → caller's current operating branch only (legacy).
 */
export async function resolveDailyPayrollViewScope(
  employeeScopeParam: string | null,
  at: Date = branchNow(),
): Promise<DailyPayrollViewScope | NextResponse> {
  const ctx = await requireActiveBranchContext(at);
  if (!isActiveBranchContext(ctx)) return ctx;

  const scope = parseDailyPayrollEmployeeScope(employeeScopeParam);

  if (scope === 'active' && !ctx.canOperate && !ctx.canViewReports) {
    return NextResponse.json(
      { error: 'غير مصرح — لا تملك صلاحية عرض يوميات هذا الفرع', code: 'VIEW_NOT_ALLOWED' },
      { status: 403 },
    );
  }

  const tenantBranchIds = await listTenantLegacyBranchIds(await hrTenantIdForBranch(ctx));
  const access = await listUserValidBranchAccess(ctx.userId, at);
  const allowed = access
    .filter((a) => canViewPayrollBranch(a) && tenantBranchIds.has(a.branchId))
    .map((a) => ({
      branchId: a.branchId,
      branchCode: a.branchCode,
      branchName: a.branchName,
    }));
  const scopeOptions = legacyHrAllScopeBranches(allowed)
    .slice()
    .sort((a, b) => a.branchId - b.branchId)
    .map((b) => ({ code: b.branchCode, label: hrBranchLabel(b) }));

  if (scope === 'active') {
    return {
      employeeScope: 'active',
      branches: [
        {
          branchId: ctx.branchId,
          branchCode: ctx.branchCode,
          branchName: ctx.branchName,
        },
      ],
      branchIds: [ctx.branchId],
      scopeOptions,
    };
  }

  if (scope === 'all') {
    const branches = legacyHrAllScopeBranches(allowed);
    if (branches.length === 0) {
      return NextResponse.json(
        { error: 'لا توجد فروع مصرح بعرض يومياتها', code: 'NO_BRANCH_ACCESS' },
        { status: 403 },
      );
    }
    return {
      employeeScope: 'all',
      branches,
      branchIds: branches.map((b) => b.branchId),
      scopeOptions,
    };
  }

  try {
    const byCode = await getBranchByCode(scope);
    if (!byCode || !byCode.isActive) {
      throw new BranchDomainError('BRANCH_INACTIVE', `الفرع ${scope} غير نشط`, 404);
    }
    const hit = allowed.find((b) => b.branchId === byCode.branchId);
    if (!hit) {
      throw new BranchDomainError(
        'NO_BRANCH_ACCESS',
        `غير مصرح بعرض يوميات فرع ${scope}`,
        403,
      );
    }
    return {
      employeeScope: scope,
      branches: [hit],
      branchIds: [hit.branchId],
      scopeOptions,
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

export function isDailyPayrollViewScope(
  v: DailyPayrollViewScope | NextResponse,
): v is DailyPayrollViewScope {
  return !(v instanceof NextResponse) && Array.isArray((v as DailyPayrollViewScope).branchIds);
}
