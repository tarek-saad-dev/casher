import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(rel: string): string {
  return readFileSync(rel, 'utf8');
}

describe('customer upsert smoke isolation (source contract)', () => {
  it('legacyCustomersAdapter skips placeholder match and updates name on reuse', () => {
    const src = source('src/shared/customers/internal/legacyAdapter.ts');
    expect(src).toContain('isUsableCustomerPhone');
    expect(src).toContain('Mobile = @phone');
    expect(src).toContain('VALUES (@tenantId, @name, NULL, GETDATE())');
    expect(src).toContain('SET [Name] = @name');
  });

  it('upsertCustomer updates Name when usable phone already exists', () => {
    const src = source('src/lib/publicBookingHelpers.ts');
    expect(src).toContain('Empty / placeholder phones always create a NEW client');
    expect(src).toContain('SET [Name] = @name WHERE ClientID = @id AND TenantId = @tenantId');
  });

  it('createPublicBooking runs customer identity guard before insert', () => {
    const src = source('src/lib/booking/publicBookingCreate.ts');
    expect(src).toContain('evaluateCustomerIdentityForBooking');
    expect(src).toContain('appendBookingDiagnosticNote');
    expect(src).toContain('customer_identity_blocked');
    expect(src).toContain('customer_identity_rename_failed');
  });
});
