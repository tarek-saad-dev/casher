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
import {
  parseDailyPayrollEmployeeScope,
  type DailyPayrollEmployeeScope,
} from '@/lib/payroll/dailyPayrollEmployeeScope.shared';

export {
  DAILY_PAYROLL_EMPLOYEE_SCOPES,
  parseDailyPayrollEmployeeScope,
  type DailyPayrollEmployeeScope,
} from '@/lib/payroll/dailyPayrollEmployeeScope.shared';

export type DailyPayrollViewBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
};

export type DailyPayrollViewScope = {
  employeeScope: DailyPayrollEmployeeScope | 'active';
  branches: DailyPayrollViewBranch[];
  branchIds: number[];
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
 * `employeeScope=all|GLEEM|CAMP_CAESAR` never switches the session branch.
 * Omitted / active → caller's current operating branch only (legacy).
 */
export async function resolveDailyPayrollViewScope(
  employeeScopeParam: string | null,
  at: Date = branchNow(),
): Promise<DailyPayrollViewScope | NextResponse> {
  const ctx = await requireActiveBranchContext(at);
  if (!isActiveBranchContext(ctx)) return ctx;

  const scope = parseDailyPayrollEmployeeScope(employeeScopeParam);

  if (scope === 'active') {
    if (!ctx.canOperate && !ctx.canViewReports) {
      return NextResponse.json(
        { error: 'غير مصرح — لا تملك صلاحية عرض يوميات هذا الفرع', code: 'VIEW_NOT_ALLOWED' },
        { status: 403 },
      );
    }
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
    };
  }

  const access = await listUserValidBranchAccess(ctx.userId, at);
  const allowed = access
    .filter(canViewPayrollBranch)
    .map((a) => ({
      branchId: a.branchId,
      branchCode: a.branchCode,
      branchName: a.branchName,
    }));

  if (scope === 'all') {
    const preferred = allowed.filter(
      (b) => b.branchCode === 'GLEEM' || b.branchCode === 'CAMP_CAESAR',
    );
    const branches = preferred.length > 0 ? preferred : allowed;
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
