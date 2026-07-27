import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { publicBookingErrorBody } from '@/lib/booking/publicBookingErrorCatalog';

describe('bookingPublicBarberBranchMode / GlobalMode (source)', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/barbers/route.ts'),
    'utf8',
  );

  it('branch mode requires branchCode via central list; no GLEEM fallback', () => {
    expect(route).toContain("modeRaw === 'branch'");
    expect(route).toContain('listPublicBookingBarbers');
    expect(route).not.toContain('resolvePublicBranchCode');
    expect(route).not.toMatch(/branchCode\s*\|\|\s*['"]GLEEM['"]/);
    const lib = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/booking/publicBookingBarbers.ts'),
      'utf8',
    );
    expect(lib).toContain('BRANCH_REQUIRED');
  });

  it('defaults to global when mode and branchCode absent', () => {
    expect(route).toContain("branchCode ? 'branch' : 'global'");
  });

  it('ignores includeTest/preview unlockers', () => {
    expect(route).toContain("searchParams.get('includeTest')");
    expect(route).toContain('previewQueryParam');
  });
});

describe('bookingPublicBarberSecurity', () => {
  const calendar = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/barbers/[empId]/calendar/route.ts'),
    'utf8',
  );
  const location = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/barbers/[empId]/location/route.ts'),
    'utf8',
  );
  const lib = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingBarbers.ts'),
    'utf8',
  );

  it('OPTIONS/CORS and nested errors exist', () => {
    expect(calendar).toContain('OPTIONS');
    expect(location).toContain('OPTIONS');
    expect(calendar).toContain('publicBookingOptionsResponse');
    expect(location).toContain('PUBLIC_BOOKING_ROUTE_CORS');
    for (const code of [
      'BARBER_NOT_FOUND',
      'INVALID_DATE',
      'INVALID_DATE_RANGE',
      'DATE_RANGE_TOO_LARGE',
      'BARBER_CATALOG_UNAVAILABLE',
      'BRANCH_NOT_PUBLIC',
      'SERVICE_NOT_AVAILABLE_AT_BRANCH',
    ] as const) {
      const body = publicBookingErrorBody(code);
      expect(body.error.code).toBe(code);
    }
  });

  it('hides non-public destinations as not_available_publicly', () => {
    expect(lib).toContain('not_available_publicly');
    expect(lib).toContain('publicOnly: false');
    expect(lib).toContain('BARBER_NOT_FOUND');
    expect(lib).toContain('isEmployeeHiddenFromPublicBooking');
  });

  it('calendar is presence_only without serviceIds; enrichment uses availability module when services provided', () => {
    expect(lib).toContain('presenceOnly: serviceIds.length === 0');
    expect(lib).toContain('enrichCalendarDayAvailability');
    expect(lib).not.toContain('listAvailableBookingSlots');
  });
});
