#!/usr/bin/env npx tsx
const BASE = 'https://casher-five.vercel.app';

async function main() {
  const slotsRes = await fetch(
    `${BASE}/api/public/booking/available-slots?branchCode=GLEEM&date=2026-08-05&serviceIds=20&empId=5`,
  );
  const slots = await slotsRes.json();
  const slot = slots.slots?.[0];
  console.log('slot', slot);
  if (!slot) return;

  const planRes = await fetch(`${BASE}/api/public/booking/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branchCode: 'GLEEM',
      date: '2026-08-05',
      time: slot.time,
      dayOffset: slot.dayOffset ?? 0,
      serviceIds: [20],
      empId: 5,
      mode: 'specific_barber',
    }),
  });
  const plan = await planRes.json();
  console.log('plan', {
    status: planRes.status,
    ok: plan.ok,
    code: plan.error?.code,
    hasToken: !!plan.plan?.planToken,
    dur: plan.plan?.services?.totalDurationMinutes ?? plan.plan?.totalDurationMinutes,
  });
  if (!plan.ok) {
    console.log(JSON.stringify(plan).slice(0, 500));
    return;
  }

  const createRes = await fetch(`${BASE}/api/public/booking/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branchCode: 'GLEEM',
      date: '2026-08-05',
      time: slot.time,
      dayOffset: slot.dayOffset ?? 0,
      serviceIds: [20],
      empId: 5,
      mode: 'specific_barber',
      planToken: plan.plan.planToken,
      customer: { name: 'Diag User', phone: '01155667788' },
      clientRequestId: `diag-${Date.now()}`,
      suppressNotification: true,
    }),
  });
  const create = await createRes.json();
  console.log('create', {
    status: createRes.status,
    ok: create.ok,
    code: create.error?.code,
    message: create.error?.message,
    bookingCode: create.booking?.bookingCode ?? create.bookingCode,
  });
  console.log(JSON.stringify(create).slice(0, 800));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
