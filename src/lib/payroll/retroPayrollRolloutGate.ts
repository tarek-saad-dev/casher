/**
 * Single source of truth for initial retroactive-payroll rollout.
 * Approval requires the feature switch AND an explicitly listed employee in production.
 */
export function retroPayrollEnabledForEmployee(params: {
  empId: number;
  enabled: string | undefined;
  employeeIds: string | undefined;
  nodeEnv: string | undefined;
}): boolean {
  if (params.enabled !== 'true' || !Number.isSafeInteger(params.empId) || params.empId < 1) {
    return false;
  }
  if (params.nodeEnv !== 'production') return true;
  const allowed = String(params.employeeIds || '').split(',')
    .map(value => value.trim())
    .filter(value => /^[1-9][0-9]*$/.test(value))
    .map(Number);
  return allowed.includes(params.empId);
}
