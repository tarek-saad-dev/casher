import { describe, expect, it } from 'vitest';
import { buildSalonOnboardingPreset } from '../onboardingPreset';

describe('Salon Pack onboarding tenant isolation', () => {
  it('starts an independent real salon with booking settings but no CUT catalog or staff', () => {
    const actual = buildSalonOnboardingPreset({ branchCode: 'NOVA_MAIN', startMode: 'real' });
    expect(actual.booking).toEqual([expect.objectContaining({
      branchCode: 'NOVA_MAIN',
      defaultMode: 'nearest',
      slotIntervalMinutes: 15,
      maxBookingDaysAhead: 14,
    })]);
    expect(actual.services).toEqual([]);
    expect(actual.employees).toEqual([]);
    expect(JSON.stringify(actual)).not.toMatch(/GLEEM|CAMP_CAESAR|CASHER_BOOT|CUT_SALON/);
  });

  it('binds each demo employee to that tenant\'s own branch and never copies legacy IDs', () => {
    const first = buildSalonOnboardingPreset({ branchCode: 'ALPHA_MAIN', startMode: 'demo' });
    const second = buildSalonOnboardingPreset({ branchCode: 'BETA_MAIN', startMode: 'demo' });
    expect(first.services).toHaveLength(4);
    expect(first.employees).toHaveLength(2);
    expect(first.employees.every((employee) => employee.primaryBranchCode === 'ALPHA_MAIN')).toBe(true);
    expect(second.employees.every((employee) => employee.primaryBranchCode === 'BETA_MAIN')).toBe(true);
    expect(first.booking[0].branchCode).toBe('ALPHA_MAIN');
    expect(second.booking[0].branchCode).toBe('BETA_MAIN');
    expect(first.employees.every((employee) => !('EmpID' in employee))).toBe(true);
    expect(first.services.every((service) => !('ProID' in service))).toBe(true);
  });

  it('does not share mutable records between separate tenant provision requests', () => {
    const first = buildSalonOnboardingPreset({ branchCode: 'FIRST', startMode: 'demo' });
    first.services[0].price = 1;
    first.employees[0].name = 'changed';
    first.booking[0].minNoticeMinutes = 0;

    const second = buildSalonOnboardingPreset({ branchCode: 'SECOND', startMode: 'demo' });
    expect(second.services[0].price).toBe(200);
    expect(second.employees[0].name).toBe('أحمد Demo');
    expect(second.booking[0].minNoticeMinutes).toBe(30);
  });

  it('fails rather than assigning demo staff to an unknown/default CUT branch', () => {
    expect(() => buildSalonOnboardingPreset({ branchCode: '  ', startMode: 'demo' })).toThrow(
      'Salon onboarding requires the new tenant branch code',
    );
  });
});
