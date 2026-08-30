// Allow importing server-only modules in one-off probes
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require.cache[require.resolve('server-only')] = { exports: {}, loaded: true };

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

import { loadFlowBoardForBranch } from '../src/lib/operations/loadFlowBoardForBranch.ts';

const now = new Date('2026-08-28T12:45:00.000Z'); // ~14:45 Cairo, after check-in

for (const mode of ['present', 'all']) {
  const board = await loadFlowBoardForBranch({
    branchId: 1,
    dateStr: '2026-08-28',
    presenceMode: mode,
    now,
  });
  const emp7 = board.barbers.find((b) => b.empId === 7);
  const hit3816 = emp7?.timeline?.find((t) => t.type === 'booking' && t.sourceId === 3816);
  const bookings = emp7?.timeline?.filter((t) => t.type === 'booking').map((t) => ({
    id: t.sourceId,
    label: t.label,
    start: t.startTime,
    end: t.endTime,
  }));
  console.log(JSON.stringify({ mode, emp7Status: emp7?.status, workStart: emp7?.workStart, workEnd: emp7?.workEnd, hit3816: hit3816 ?? null, bookings }, null, 2));
}
