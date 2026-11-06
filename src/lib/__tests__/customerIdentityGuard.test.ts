import { describe, expect, it } from 'vitest';
import {
  appendBookingDiagnosticNote,
  classifyBookingPhoneKind,
  evaluateCustomerIdentityForBooking,
  isTestOrSmokeCustomerName,
  maskPhoneForLog,
  resolveBookingCreatePath,
  shouldPersistSubmittedCustomerName,
} from '@/lib/booking/customerIdentityGuard';

describe('isTestOrSmokeCustomerName', () => {
  it('detects known smoke/test markers', () => {
    expect(isTestOrSmokeCustomerName('smoke test')).toBe(true);
    expect(isTestOrSmokeCustomerName('Smoke Test Client')).toBe(true);
    expect(isTestOrSmokeCustomerName('BM Smoke')).toBe(true);
    expect(isTestOrSmokeCustomerName('[SMOKE P8C]')).toBe(true);
    expect(isTestOrSmokeCustomerName('[TEST] Guest')).toBe(true);
    expect(isTestOrSmokeCustomerName('DRVO-005 Smoke')).toBe(true);
    expect(isTestOrSmokeCustomerName('DRVO008-SMOKE')).toBe(true);
  });

  it('allows real customer names', () => {
    expect(isTestOrSmokeCustomerName('أحمد محمد')).toBe(false);
    expect(isTestOrSmokeCustomerName('Ali Hassan')).toBe(false);
    expect(isTestOrSmokeCustomerName('')).toBe(false);
    expect(isTestOrSmokeCustomerName(null)).toBe(false);
  });
});

describe('classifyBookingPhoneKind / path', () => {
  it('classifies placeholder and usable phones', () => {
    expect(classifyBookingPhoneKind('01000000000')).toBe('placeholder');
    expect(classifyBookingPhoneKind('01012345678')).toBe('usable');
    expect(classifyBookingPhoneKind('')).toBe('empty');
  });

  it('resolves booking create path', () => {
    expect(
      resolveBookingCreatePath({ purpose: 'internal_preview', bookingSource: 'operations' }),
    ).toBe('operations');
    expect(
      resolveBookingCreatePath({ purpose: 'internal_preview', bookingSource: 'admin' }),
    ).toBe('admin');
    expect(resolveBookingCreatePath({ purpose: 'public_booking' })).toBe('public');
  });
});

describe('evaluateCustomerIdentityForBooking', () => {
  const now = new Date('2026-11-04T00:00:00.000Z');

  it('renames when stored smoke and submitted real (placeholder phone)', () => {
    const r = evaluateCustomerIdentityForBooking({
      submittedName: 'أحمد',
      storedName: 'smoke test',
      clientId: 99,
      phone: '01000000000',
      bookingPath: 'operations',
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.renamed).toBe(true);
    expect(r.finalName).toBe('أحمد');
    expect(r.diagnostic?.cause).toBe('placeholder_phone_matched_existing_client');
    expect(r.diagnostic?.causeConfirmed).toBe(true);
    expect(r.diagnostic?.action).toBe('renamed_client');
  });

  it('renames when usable phone matched a smoke-named client', () => {
    const r = evaluateCustomerIdentityForBooking({
      submittedName: 'سارة',
      storedName: 'BM Smoke',
      clientId: 7,
      phone: '01012345678',
      bookingPath: 'public',
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.renamed).toBe(true);
    expect(r.diagnostic?.cause).toBe('usable_phone_matched_smoke_named_client');
  });

  it('renames when real stored name differs from submitted', () => {
    const r = evaluateCustomerIdentityForBooking({
      submittedName: 'محمد علي',
      storedName: 'محمد',
      clientId: 3,
      phone: '01012345678',
      bookingPath: 'admin',
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.renamed).toBe(true);
    expect(r.finalName).toBe('محمد علي');
    expect(r.diagnostic?.cause).toBe('stored_name_differs_from_submitted');
  });

  it('allows intentional smoke submits without rewrite', () => {
    const r = evaluateCustomerIdentityForBooking({
      submittedName: '[SMOKE P8C]',
      storedName: '[SMOKE P8C]',
      clientId: 1,
      phone: '01099999999',
      bookingPath: 'public',
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.renamed).toBe(false);
    expect(r.diagnostic).toBeNull();
  });

  it('no-op when names already match', () => {
    const r = evaluateCustomerIdentityForBooking({
      submittedName: 'كريم',
      storedName: 'كريم',
      clientId: 5,
      phone: '01012345678',
      bookingPath: 'operations',
      now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.renamed).toBe(false);
    expect(r.diagnostic).toBeNull();
  });
});

describe('appendBookingDiagnosticNote', () => {
  const diagnostic = {
    submittedName: 'أحمد',
    previousName: 'smoke test',
    clientId: 42,
    phoneKind: 'placeholder' as const,
    bookingPath: 'operations' as const,
    cause: 'placeholder_phone_matched_existing_client' as const,
    causeConfirmed: true,
    action: 'renamed_client' as const,
    detectedAtUtc: '2026-11-04T00:00:00.000Z',
  };

  it('keeps original notes and appends diagnostic when under limit', () => {
    const r = appendBookingDiagnosticNote('note-a', diagnostic, 500);
    expect(r.notes.startsWith('note-a ')).toBe(true);
    expect(r.notes).toContain('[customer-identity-diag]');
    expect(r.notes).toContain('submittedName=أحمد');
    expect(r.notes).toContain('previousName=smoke test');
    expect(r.overflowLog).toBeNull();
  });

  it('overflows to stub + server log payload when over limit', () => {
    const long = 'x'.repeat(480);
    const r = appendBookingDiagnosticNote(long, diagnostic, 500);
    expect(r.notes.length).toBeLessThanOrEqual(500);
    expect(r.notes).toContain('ref=');
    expect(r.overflowLog).toContain('[customer-identity-diag]');
    expect(r.diagRef).toBeTruthy();
  });
});

describe('maskPhoneForLog', () => {
  it('masks all but last 4 digits', () => {
    expect(maskPhoneForLog('01012345678')).toMatch(/\d{4}$/);
    expect(maskPhoneForLog('01012345678')).not.toContain('0101234');
  });
});

describe('shouldPersistSubmittedCustomerName', () => {
  it('persists real first-time booking names from ops and website', () => {
    expect(shouldPersistSubmittedCustomerName('أحمد محمد')).toBe(true);
    expect(shouldPersistSubmittedCustomerName('Ali')).toBe(true);
    expect(shouldPersistSubmittedCustomerName('smoke test')).toBe(false);
    expect(shouldPersistSubmittedCustomerName('[SMOKE P8C]')).toBe(false);
    expect(shouldPersistSubmittedCustomerName('أ')).toBe(false);
  });
});
