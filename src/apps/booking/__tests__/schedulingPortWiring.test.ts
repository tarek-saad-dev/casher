import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('DRVO-004 scheduling port wiring', () => {
  it('preferred public cancel uses the extracted port when the flag is on', () => {
    const route = read('src/app/api/public/booking/[code]/cancel/route.ts');
    expect(route).toContain('isBookingSchedulingPortEnabled');
    expect(route).toContain('cancelBooking');
    expect(route).toContain('cancelPublicBooking');
    expect(route).toContain('schedulingPortHooks');
  });

  it('affected-bookings reschedule uses the extracted port when the flag is on', () => {
    const route = read('src/app/api/operations/affected-bookings/route.ts');
    expect(route).toContain('isBookingSchedulingPortEnabled');
    expect(route).toContain('rescheduleOpsBooking');
    expect(route).toContain('schedulingPortHooks');
    expect(route).toContain('rescheduleBookingMove');
  });

  it('employee busy-interval SQL is not filtered by branch', () => {
    const src = read('src/lib/queueEstimateEngine.ts');
    const fn = src.slice(src.indexOf('export async function buildBookingIntervalsForEmps'));
    const body = fn.slice(0, fn.indexOf('export async function buildBookingIntervals('));
    expect(body).toContain('b.AssignedEmpID');
    expect(body).not.toContain('BranchID');
  });
});
