/**
 * Live Phase 5 check-slot / plan probe (read-only — no booking INSERT).
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const {
    evaluatePublicBookingSelection,
    assertCheckSlotPlanParity,
    PublicBookingSelectionError,
  } = await import('../../src/lib/booking/publicBookingSelectionEvaluator');
  const { getPublicAvailableSlots } = await import('../../src/lib/booking/publicBookingAvailability');
  const { invalidatePublicBookingAvailabilityCache } = await import(
    '../../src/lib/booking/publicBookingAvailability'
  );

  invalidatePublicBookingAvailabilityCache();

  const serviceIds = [9];
  const empId = 12;
  const out: Record<string, unknown> = { ts: new Date().toISOString() };

  // Find a valid slot via Phase-4 listing (informational only — evaluator does not use its cache)
  const daysProbe = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: '2026-08-03',
    serviceIds,
    empId,
  });
  const slot0 = daysProbe.slots.find((s) => s.dayOffset === 0) ?? daysProbe.slots[0];
  const overnight = daysProbe.slots.find((s) => s.dayOffset === 1);
  const workDate = daysProbe.date;
  out.listingSlotCount = daysProbe.slots.length;
  out.sampleSlot = slot0 ?? null;
  out.overnightSample = overnight ?? null;

  async function timed(label: string, fn: () => Promise<unknown>) {
    const t0 = Date.now();
    try {
      const result = await fn();
      out[label] = { ms: Date.now() - t0, ok: true, result };
    } catch (e) {
      out[label] = {
        ms: Date.now() - t0,
        ok: false,
        code: e instanceof PublicBookingSelectionError ? e.code : String(e),
      };
    }
  }

  if (slot0) {
    const req = {
      branchCode: 'GLEEM',
      date: workDate,
      time: slot0.time,
      dayOffset: slot0.dayOffset,
      serviceIds,
      empId,
    };
    await timed('specific_check_cold', () =>
      evaluatePublicBookingSelection({ ...req, purpose: 'check_slot' }),
    );
    await timed('specific_check_warm', () =>
      evaluatePublicBookingSelection({ ...req, purpose: 'check_slot' }),
    );
    await timed('specific_plan_cold', () =>
      evaluatePublicBookingSelection({ ...req, purpose: 'plan' }),
    );
    await timed('specific_plan_warm', () =>
      evaluatePublicBookingSelection({ ...req, purpose: 'plan' }),
    );

    const check = await evaluatePublicBookingSelection({ ...req, purpose: 'check_slot' });
    const plan = await evaluatePublicBookingSelection({ ...req, purpose: 'plan' });
    try {
      assertCheckSlotPlanParity(check, plan);
      out.parity = { ok: true, available: check.available, fingerprint: plan.planFingerprint };
    } catch (e) {
      out.parity = {
        ok: false,
        code: e instanceof PublicBookingSelectionError ? e.code : String(e),
      };
    }

    await timed('any_check', () =>
      evaluatePublicBookingSelection({
        branchCode: 'GLEEM',
        date: workDate,
        time: slot0.time,
        dayOffset: slot0.dayOffset,
        serviceIds,
        purpose: 'check_slot',
      }),
    );
    await timed('any_plan', () =>
      evaluatePublicBookingSelection({
        branchCode: 'GLEEM',
        date: workDate,
        time: slot0.time,
        dayOffset: slot0.dayOffset,
        serviceIds,
        purpose: 'plan',
      }),
    );
  }

  await timed('invalid_day_offset', () =>
    evaluatePublicBookingSelection({
      branchCode: 'GLEEM',
      date: workDate,
      time: '10:00',
      dayOffset: 2,
      serviceIds,
      empId,
      purpose: 'check_slot',
    }),
  );

  await timed('camp_caesar_check', () =>
    evaluatePublicBookingSelection({
      branchCode: 'CAMP_CAESAR',
      date: workDate,
      time: '10:00',
      dayOffset: 0,
      serviceIds,
      empId,
      purpose: 'check_slot',
    }),
  );
  await timed('camp_caesar_plan', () =>
    evaluatePublicBookingSelection({
      branchCode: 'CAMP_CAESAR',
      date: workDate,
      time: '10:00',
      dayOffset: 0,
      serviceIds,
      empId,
      purpose: 'plan',
    }),
  );

  if (overnight) {
    await timed('overnight_check', () =>
      evaluatePublicBookingSelection({
        branchCode: 'GLEEM',
        date: workDate,
        time: overnight.time,
        dayOffset: 1,
        serviceIds,
        empId,
        purpose: 'check_slot',
      }),
    );
  }

  // Multi-service
  await timed('multi_service_check', () =>
    evaluatePublicBookingSelection({
      branchCode: 'GLEEM',
      date: workDate,
      time: slot0?.time ?? '11:00',
      dayOffset: slot0?.dayOffset ?? 0,
      serviceIds: [9, 15],
      empId,
      purpose: 'check_slot',
    }),
  );

  const dest = path.join(__dirname, '_booking-phase5-live-probe.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log('wrote', dest);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
