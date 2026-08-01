require('dotenv').config({ path: '.env.local' });
require('module').Module.prototype.require = new Proxy(
  require('module').Module.prototype.require,
  {
    apply(target, thisArg, args) {
      if (args[0] === 'server-only') return {};
      return Reflect.apply(target, thisArg, args);
    },
  },
);

async function main() {
  const { listAvailableBookingSlots } = await import(
    '../src/lib/bookingAvailabilityEngine.ts'
  );

  for (const date of ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-06']) {
    const result = await listAvailableBookingSlots({
      date,
      serviceIds: [9],
      mode: 'specific',
      empId: 5,
      source: 'operations',
      branchId: 1,
    });
    const slots = result.slots || [];
    const at20 = slots.find((s) => s.time === '20:00' || s.startTime === '20:00');
    const available = slots.filter((s) => s.available !== false);
    const times = available.map((s) => s.time || s.startTime).slice(0, 20);
    const near20 = slots.filter((s) => {
      const t = s.time || s.startTime || '';
      return t >= '19:00' && t <= '21:00';
    });
    console.log('\n====', date, '====');
    console.log('total slots', slots.length, 'available', available.length);
    console.log('first available', times);
    console.log('19-21 window', near20.map((s) => ({
      t: s.time || s.startTime,
      available: s.available,
      reason: s.reasonCode || s.reason,
    })));
    console.log('20:00 detail', at20 || 'MISSING');
    if (result.debug) {
      console.log('debug keys', Object.keys(result.debug));
      console.log('audit', result.debug.slotAudit || result.debug);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
