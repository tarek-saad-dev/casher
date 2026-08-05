#!/usr/bin/env npx tsx
/**
 * Attempt local createPublicBooking against cloud DB for Karim slot.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { evaluatePublicBookingSelection } = await import(
    '../src/lib/booking/publicBookingSelectionEvaluator'
  );
  const { createPublicBooking, PublicBookingCreateError } = await import(
    '../src/lib/booking/publicBookingCreate'
  );

  const date = '2026-08-05';
  const time = process.argv[2] || '20:45';
  const serviceIds = [Number(process.argv[3] || 20)];

  const plan = await evaluatePublicBookingSelection({
    branchCode: 'GLEEM',
    date,
    time,
    dayOffset: 0,
    serviceIds,
    empId: 5,
    mode: 'specific_barber',
    purpose: 'plan',
  });
  console.log('plan', {
    available: plan.available,
    code: plan.availabilityCode,
    dur: plan.totalDurationMinutes,
    price: plan.subtotal,
    start: plan.startDateTime,
    hasToken: !!plan.planToken,
  });
  if (!plan.available) return;

  try {
    const result = await createPublicBooking({
      branchCode: 'GLEEM',
      date,
      time,
      dayOffset: 0,
      serviceIds,
      empId: 5,
      mode: 'specific_barber',
      planToken: plan.planToken,
      customer: { name: 'Diag Local Create', phone: '01155667788' },
      clientRequestId: `local-diag-${Date.now()}`,
      suppressNotification: true,
    });
    console.log('CREATE_OK', JSON.stringify(result, null, 2).slice(0, 1200));
  } catch (e) {
    if (e instanceof PublicBookingCreateError) {
      console.log('CREATE_FAIL', e.code, e.metadata, e.message);
    } else {
      console.log('CREATE_THROW', e instanceof Error ? e.message : e);
      console.error(e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
