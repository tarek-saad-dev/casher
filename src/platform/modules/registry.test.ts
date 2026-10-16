import { describe, expect, it } from 'vitest';
import { canUseDrvoModule, DRVO_MODULES, isDrvoModuleKey } from './registry';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const entitlement = { tenantId: TENANT_A, moduleKey: 'pos', status: 'enabled' as const };

describe('DRVO module registry and feature gate', () => {
  it('recognizes catalog modules but not arbitrary names', () => {
    expect(isDrvoModuleKey('pos')).toBe(true);
    expect(isDrvoModuleKey('toString')).toBe(false);
    expect(isDrvoModuleKey('unknown')).toBe(false);
    expect(DRVO_MODULES.pos.key).toBe('pos');
    expect(isDrvoModuleKey('online_booking')).toBe(true);
    expect(isDrvoModuleKey('onlineBooking')).toBe(false);
    expect(DRVO_MODULES.online_booking.key).toBe('online_booking');
  });
  it('allows an explicitly enabled entitlement for the same tenant', () => {
    expect(canUseDrvoModule(TENANT_A, 'pos', entitlement)).toBe(true);
  });
  it('denies a different tenant even with a matching module key', () => {
    expect(canUseDrvoModule(TENANT_B, 'pos', entitlement)).toBe(false);
  });
  it('denies missing, suspended, disabled and wrong-module entitlements', () => {
    expect(canUseDrvoModule(TENANT_A, 'pos', null)).toBe(false);
    expect(canUseDrvoModule(TENANT_A, 'pos', { ...entitlement, status: 'disabled' })).toBe(false);
    expect(canUseDrvoModule(TENANT_A, 'pos', { ...entitlement, status: 'suspended' })).toBe(false);
    expect(canUseDrvoModule(TENANT_A, 'hr', entitlement)).toBe(false);
    expect(canUseDrvoModule(TENANT_A, 'unknown', entitlement)).toBe(false);
  });
  it('denies expired, malformed and exactly-now expiration', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    expect(canUseDrvoModule(TENANT_A, 'pos', { ...entitlement, validUntilUtc: '2026-10-16T11:59:59Z' }, now)).toBe(false);
    expect(canUseDrvoModule(TENANT_A, 'pos', { ...entitlement, validUntilUtc: '2026-10-16T12:00:00Z' }, now)).toBe(false);
    expect(canUseDrvoModule(TENANT_A, 'pos', { ...entitlement, validUntilUtc: 'not-a-date' }, now)).toBe(false);
    expect(canUseDrvoModule(TENANT_A, 'pos', { ...entitlement, validUntilUtc: '2026-10-17T12:00:00Z' }, now)).toBe(true);
  });
  it('denies invalid tenant identities', () => {
    expect(canUseDrvoModule('', 'pos', entitlement)).toBe(false);
    expect(canUseDrvoModule('tenant-a', 'pos', entitlement)).toBe(false);
  });
});
