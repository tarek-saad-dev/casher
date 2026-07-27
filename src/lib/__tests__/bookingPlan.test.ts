import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('bookingPlan route contract', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/plan/route.ts'),
    'utf8',
  );

  it('returns booking-plan-v1 fields without exposing branchId', () => {
    expect(src).toContain('contractVersion');
    expect(src).toContain('pricingScope');
    expect(src).toContain('discount: 0');
    expect(src).toContain('planFingerprint');
    expect(src).not.toContain('branchId');
  });

  it('does not reserve or create bookings', () => {
    expect(src).not.toMatch(/INSERT/i);
    expect(src).not.toContain('generateBookingCode');
  });
});
