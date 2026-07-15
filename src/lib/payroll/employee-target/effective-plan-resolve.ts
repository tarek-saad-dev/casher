import type { EffectiveTargetPlanRow } from './employee-daily-target.repository';

export class EmployeeDailyTargetDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeDailyTargetDomainError';
  }
}

/** Pure helper — pick one plan per emp, throw on ambiguity. */
export function resolveUniqueEffectivePlans(
  plans: EffectiveTargetPlanRow[],
): Map<number, EffectiveTargetPlanRow> {
  const byEmp = new Map<number, EffectiveTargetPlanRow[]>();
  for (const plan of plans) {
    const list = byEmp.get(plan.empId) ?? [];
    list.push(plan);
    byEmp.set(plan.empId, list);
  }

  const unique = new Map<number, EffectiveTargetPlanRow>();
  const conflicts: string[] = [];
  for (const [empId, list] of byEmp) {
    if (list.length > 1) {
      const name = list[0]?.empName ?? String(empId);
      const ids = list.map((p) => p.planId).join(', ');
      conflicts.push(`${name} (EmpID=${empId}, PlanIDs=${ids})`);
      continue;
    }
    unique.set(empId, list[0]!);
  }

  if (conflicts.length > 0) {
    throw new EmployeeDailyTargetDomainError(
      `تعارض في خطط التارجت لنفس الموظف/التاريخ — يجب مراجعة: ${conflicts.join('؛ ')}`,
    );
  }
  return unique;
}
