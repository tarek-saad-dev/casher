import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('bookingPublicBarberGlobalMode', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/barbers/route.ts'),
    'utf8',
  );
  it('global mode omits required branchCode and defaults when mode absent', () => {
    expect(route).toContain("'global'");
    expect(route).toContain("branchCode ? 'branch' : 'global'");
    expect(route).toContain('listPublicBookingBarbers');
  });
});
