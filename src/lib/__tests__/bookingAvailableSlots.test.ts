import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('bookingAvailableSlots', () => {
  it('public and barber slot routes share getPublicAvailableSlots', () => {
    const slots = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/public/booking/available-slots/route.ts'),
      'utf8',
    );
    const barber = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/api/public/booking/barbers/[empId]/available-slots/route.ts',
      ),
      'utf8',
    );
    expect(slots).toContain('getPublicAvailableSlots');
    expect(barber).toContain('getPublicAvailableSlots');
  });
});
