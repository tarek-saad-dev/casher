/**
 * bookingCancellationPostCommit — cancel must schedule WhatsApp only after commit.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('bookingCancellationPostCommit', () => {
  it('schedules cancel WhatsApp after transaction commit (not before)', () => {
    const svc = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingCancellation.ts'),
      'utf8',
    );
    expect(svc).toContain('scheduleCancelWhatsAppAfterCommit');
    const commitIdx = svc.indexOf('await transaction.commit()');
    const waIdx = svc.indexOf('scheduleCancelWhatsAppAfterCommit');
    expect(commitIdx).toBeGreaterThan(-1);
    expect(waIdx).toBeGreaterThan(commitIdx);
  });
});
