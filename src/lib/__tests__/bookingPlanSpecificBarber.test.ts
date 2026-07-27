import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('bookingPlanSpecificBarber', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingSelectionEvaluator.ts'),
    'utf8',
  );

  it('fixed_barber strategy for specific mode', () => {
    expect(src).toContain("mode === 'specific_barber' ? 'fixed_barber'");
    expect(src).toContain('mode: \'specific\'');
  });
});

describe('bookingPlanAnyBarber', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingSelectionEvaluator.ts'),
    'utf8',
  );

  it('server_select_on_create and dedupe by EmpID', () => {
    expect(src).toContain('server_select_on_create');
    expect(src).toContain('byEmp');
    expect(src).toContain('collectAllCandidates: true');
  });
});

describe('bookingPlanOvernight', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingSelectionEvaluator.ts'),
    'utf8',
  );

  it('requires dayOffset 0|1 and absolute Cairo bounds', () => {
    expect(src).toContain('parseDayOffset');
    expect(src).toContain('salonDateTimeToMs');
    expect(src).toContain('expectedDayOffset');
  });
});

describe('bookingPlanSecurity', () => {
  const evalSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/booking/publicBookingSelectionEvaluator.ts'),
    'utf8',
  );
  const check = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/check-slot/route.ts'),
    'utf8',
  );
  const plan = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/plan/route.ts'),
    'utf8',
  );

  it('blocks preview=true public path and ignores client price/duration', () => {
    expect(evalSrc).toContain("p === 'true'");
    expect(check).toContain('void body.price');
    expect(plan).toContain('void body.duration');
    expect(evalSrc).toContain('isTestOrSmokeEmployeeName');
  });
});

describe('bookingPlanPerformanceContract', () => {
  it('check-slot and plan share one evaluator module', () => {
    const check = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/public/booking/check-slot/route.ts'),
      'utf8',
    );
    const plan = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/public/booking/plan/route.ts'),
      'utf8',
    );
    expect(check).toContain('evaluatePublicBookingSelection');
    expect(plan).toContain('evaluatePublicBookingSelection');
  });
});
