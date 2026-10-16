import { describe, expect, it } from 'vitest';
import { validateCommercialEntitlementCommand } from './commercialEntitlementCommand';

const base = {
  tenantId: '083d433e-f36b-1410-8820-009ec495c7e1',
  moduleKey: 'booking',
  requestId: 'a05d433e-f36b-1410-8820-009ec495c7e1',
} as const;
const now = new Date('2026-10-16T00:00:00Z');
describe('commercial entitlement commands', () => {
  it('provisions only with a future UTC expiry', () => {
    expect(validateCommercialEntitlementCommand({
      ...base, action: 'provision', validUntilUtc: '2026-11-16T00:00:00Z',
    }, now).targetStatus).toBe('enabled');
  });
  it('requires an expiry on renewal', () => {
    expect(() => validateCommercialEntitlementCommand({ ...base, action: 'renew' }, now))
      .toThrow('EXPIRY_REQUIRED');
  });
  it('rejects expired grants', () => {
    expect(() => validateCommercialEntitlementCommand({
      ...base, action: 'provision', validUntilUtc: '2026-10-15T00:00:00Z',
    }, now)).toThrow('EXPIRY_MUST_BE_FUTURE');
  });
  it('suspends without altering expiry', () => {
    expect(validateCommercialEntitlementCommand({ ...base, action: 'suspend' }, now))
      .toMatchObject({ targetStatus: 'suspended', validUntilUtc: null });
  });
  it('cancels without accepting a new expiry', () => {
    expect(() => validateCommercialEntitlementCommand({
      ...base, action: 'cancel', validUntilUtc: '2026-12-01T00:00:00Z',
    }, now)).toThrow('EXPIRY_NOT_ALLOWED_FOR_ACTION');
  });
  it('rejects unknown modules and request IDs', () => {
    expect(() => validateCommercialEntitlementCommand({
      ...base, moduleKey: 'unknown', action: 'suspend',
    }, now)).toThrow('INVALID_MODULE');
    expect(() => validateCommercialEntitlementCommand({
      ...base, requestId: 'abc', action: 'suspend',
    }, now)).toThrow('INVALID_COMMERCIAL_COMMAND_ID');
  });
});
