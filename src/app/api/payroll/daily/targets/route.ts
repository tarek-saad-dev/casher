import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  isDailyPayrollViewScope,
  resolveDailyPayrollViewScope,
} from '@/lib/payroll/dailyPayrollEmployeeScope';
import {
  EmployeeTargetValidationError,
  getEmployeeDailyTargetsForDate,
  parseWorkDateQuery,
} from '@/lib/payroll/employee-target';
import Decimal from 'decimal.js';

// GET /api/payroll/daily/targets?workDate=YYYY-MM-DD&employeeScope=all|GLEEM|CAMP_CAESAR
// employeeScope is read-only visibility — does not switch session branch.
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const viewScope = await resolveDailyPayrollViewScope(
      req.nextUrl.searchParams.get('employeeScope'),
    );
    if (!isDailyPayrollViewScope(viewScope)) return viewScope;

    const workDate = parseWorkDateQuery(req.nextUrl.searchParams.get('workDate'));

    const perBranch = await Promise.all(
      viewScope.branches.map(async (b) => {
        const data = await getEmployeeDailyTargetsForDate(workDate, null, b.branchId);
        return {
          branch: b,
          data: {
            ...data,
            employees: data.employees.map((e) => ({
              ...e,
              branchId: b.branchId,
              branchCode: b.branchCode,
              branchName: b.branchName,
            })),
          },
        };
      }),
    );

    const employees = perBranch.flatMap((p) => p.data.employees);
    employees.sort((a, b) => {
      const bc = String(a.branchCode ?? '').localeCompare(String(b.branchCode ?? ''));
      if (bc !== 0) return bc;
      return a.empName.localeCompare(b.empName, 'ar');
    });

    const planConflicts = perBranch.flatMap((p) =>
      p.data.planConflicts.map((c) => `${p.branch.branchCode}: ${c}`),
    );

    const totals = {
      eligibleEmployees: employees.length,
      notGenerated: employees.filter((e) => e.persistenceStatus === 'not_generated').length,
      generated: employees.filter((e) => e.persistenceStatus === 'generated').length,
      recalculated: employees.filter((e) => e.persistenceStatus === 'recalculated').length,
      zeroSales: employees.filter((e) => e.displayStatus === 'no_sales').length,
      belowFirstTier: employees.filter((e) => e.displayStatus === 'below_first_tier').length,
      earnedTarget: employees.filter((e) => e.displayStatus === 'earned_target').length,
      totalCurrentNetSalesAfterDiscount: moneySum(
        employees.map((e) => e.currentNetSalesAfterDiscount),
      ),
      totalCurrentMtdSales: moneySum(employees.map((e) => e.currentMtdSales ?? '0')),
      totalStoredTargetAmount: moneySum(
        employees
          .filter((e) => e.persistenceStatus !== 'not_generated')
          .map((e) => e.storedTargetAmount ?? '0'),
      ),
      totalStoredMtdTargetAmount: moneySum(
        employees
          .filter((e) => e.persistenceStatus !== 'not_generated')
          .map((e) => e.storedMtdTargetAmount ?? '0'),
      ),
    };

    const byEmp = new Map<number, Set<number>>();
    for (const e of employees) {
      if (!byEmp.has(e.empId)) byEmp.set(e.empId, new Set());
      byEmp.get(e.empId)!.add(e.branchId);
    }
    const sameDayMultiBranchEmployees = [...byEmp.entries()]
      .filter(([, branches]) => branches.size > 1)
      .map(([empId, branches]) => {
        const sample = employees.find((e) => e.empId === empId);
        return {
          empId,
          empName: sample?.empName ?? `#${empId}`,
          branchIds: [...branches].sort((a, b) => a - b),
          note: 'same_day_multi_branch_deferred',
        };
      });

    return NextResponse.json({
      workDate,
      employeeScope: viewScope.employeeScope,
      branchIds: viewScope.branchIds,
      branches: viewScope.branches,
      branchId: viewScope.branchIds[0],
      totals,
      employees,
      planConflicts,
      sameDayMultiBranchEmployees,
    });
  } catch (err: unknown) {
    if (err instanceof EmployeeTargetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'خطأ غير متوقع';
    if (message.includes('workDate') || message.includes('YYYY-MM-DD')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('[api/payroll/daily/targets] GET error:', message);
    return NextResponse.json({ error: 'تعذّر تحميل تارجت اليوم' }, { status: 500 });
  }
}

function moneySum(values: string[]): string {
  let d = new Decimal(0);
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) d = d.plus(n);
  }
  return d.toFixed(2);
}
