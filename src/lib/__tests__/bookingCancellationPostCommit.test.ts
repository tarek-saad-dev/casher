/** Phase 7B — post-commit side-effect contract. */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('bookingCancellationPostCommit', () => {
  it('invalidates cache only after commit; no WhatsApp inside TX', () => {
    const svc = fs.readFileSync(
      path.join(__dirname, '../booking/publicBookingCancellation.ts'),
      'utf8',
    );
    const commitIdx = svc.lastIndexOf('await transaction.commit()');
    const invalidateIdx = svc.lastIndexOf('invalidatePublicBookingAvailabilityCache()');
    expect(commitIdx).toBeGreaterThan(0);
    expect(invalidateIdx).toBeGreaterThan(commitIdx);
    expect(svc).not.toContain('scheduleBookingWhatsApp');
  });
});
