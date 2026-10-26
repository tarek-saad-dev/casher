import { describe, expect, it } from 'vitest';
import { retroPayrollEnabledForEmployee } from '@/lib/payroll/retroPayrollRolloutGate';

describe('Payroll retroactive production release gate', () => {
  const base = { empId: 12, enabled: 'true', employeeIds: '12', nodeEnv: 'production' };
  it('allows Ziad only when the switch and employee allowlist both match', () => {
    expect(retroPayrollEnabledForEmployee(base)).toBe(true);
    expect(retroPayrollEnabledForEmployee({ ...base, empId: 2261 })).toBe(false);
    expect(retroPayrollEnabledForEmployee({ ...base, employeeIds: '' })).toBe(false);
    expect(retroPayrollEnabledForEmployee({ ...base, employeeIds: '2261' })).toBe(false);
    expect(retroPayrollEnabledForEmployee({ ...base, enabled: 'false' })).toBe(false);
  });
  it('ignores invalid ID tokens and supports explicit lists', () => {
    expect(retroPayrollEnabledForEmployee({ ...base, employeeIds: '2261, 12, -1, abc' })).toBe(true);
    expect(retroPayrollEnabledForEmployee({ ...base, empId: 0 })).toBe(false);
  });
  it('permits non-production test execution only when enabled', () => {
    expect(retroPayrollEnabledForEmployee({
      ...base, nodeEnv: 'test', employeeIds: undefined,
    })).toBe(true);
  });
});
