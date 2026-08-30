import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

import { loadFlowBoardForBranch } from '../src/lib/operations/loadFlowBoardForBranch.ts';
import { getBarbersDayStatus } from '../src/lib/availabilityEngine.ts';
import { listOperationalPresenceForBranch } from '../src/lib/hr/operationsDayState.ts';
import { normalizeBookingTimes } from '../src/lib/bookingDateTime.ts';

const now = new Date('2026-08-28T12:30:00.000Z'); // 14:30 Cairo

const norm = normalizeBookingTimes('2026-08-28', new Date('1970-01-01T16:00:00.000Z'), new Date('1970-01-01T16:45:00.000Z'), 45, 3816);
console.log('NORMALIZED 3816:', JSON.stringify({
  start: norm.startDateTimeCairo,
  end: norm.endDateTimeCairo,
  display: norm.startTimeDisplay,
}, null, 2));

const presence = await listOperationalPresenceForBranch(1, '2026-08-28');
console.log('PRESENCE emp7:', JSON.stringify(presence.present.find(p => p.empId === 7), null, 2));
console.log('PRESENT IDS has 7:', presence.presentIds.has(7));

const dayStatus = await getBarbersDayStatus([7], '2026-08-28', { isToday: true, branchId: 1 });
console.log('DAY STATUS emp7:', JSON.stringify(dayStatus.get(7), null, 2));

for (const mode of ['present', 'all']) {
  const board = await loadFlowBoardForBranch({ branchId: 1, dateStr: '2026-08-28', presenceMode: mode, now });
  const emp7 = board.barbers.find((b) => b.empId === 7);
  const b3816 = emp7?.timeline?.filter((t) => t.sourceId === 3816) ?? [];
  console.log(`FLOW BOARD mode=${mode}:`, JSON.stringify({
    emp7Found: Boolean(emp7),
    emp7Status: emp7?.status,
    workStart: emp7 ? 'see timeline' : null,
    timelineCount: emp7?.timeline?.length ?? 0,
    booking3816: b3816,
    allBookings: emp7?.timeline?.filter((t) => t.type === 'booking').map((t) => ({
      id: t.sourceId,
      label: t.label,
      start: t.startTime,
      end: t.endTime,
    })),
  }, null, 2));
}
