/**
 * Alternative availability search — reuse public booking SoT.
 * Asking about alternatives does NOT mutate the selected plan.
 */
import 'server-only';
import { getPublicAvailableSlots } from '@/lib/booking/publicBookingAvailability';
import type { MutablePlan } from '../planner/planState';
import { minutesOf } from './timePreference';
import type { AlternativeEmployee, AlternativeSearchResult } from './alternativeSearchReply';

export type { AlternativeEmployee, AlternativeSearchResult } from './alternativeSearchReply';
export { buildAlternativeEmployeesReply } from './alternativeSearchReply';

function targetTimeFromPlan(plan: MutablePlan): string | null {
  return plan.selectedSlot?.time || plan.timePreference?.timeHm || null;
}

/**
 * Find OTHER employees available for the same service/date at the selected/preferred time.
 */
export async function findAlternativeEmployeesSameTime(
  plan: MutablePlan,
): Promise<AlternativeSearchResult> {
  const targetTime = targetTimeFromPlan(plan);
  if (!plan.branchCode || !plan.requestedDate || !plan.serviceIds.length || !targetTime) {
    return {
      ok: false,
      targetTime,
      alternatives: [],
      nearbyOtherTimes: [],
      errorCode: 'PLAN_INCOMPLETE',
    };
  }

  try {
    const slotsResp = await getPublicAvailableSlots({
      branchCode: plan.branchCode,
      date: plan.requestedDate,
      serviceIds: plan.serviceIds,
      empId: null, // any barber
    });

    const excludeEmp = plan.empId;
    const atExact: AlternativeEmployee[] = [];
    const nearby: AlternativeEmployee[] = [];
    const targetMin = minutesOf(targetTime);
    const seenExact = new Set<number>();
    const seenNear = new Set<number>();

    for (const slot of slotsResp.slots) {
      const dist = Math.abs(minutesOf(slot.time) - targetMin);
      for (const b of slot.barbers) {
        if (excludeEmp != null && b.empId === excludeEmp) continue;
        const row: AlternativeEmployee = {
          empId: b.empId,
          name: b.nameAr || String(b.empId),
          time: slot.time,
          branchCode: plan.branchCode,
        };
        if (slot.time === targetTime) {
          if (!seenExact.has(b.empId)) {
            seenExact.add(b.empId);
            atExact.push(row);
          }
        } else if (dist <= 30) {
          if (!seenNear.has(b.empId) && !seenExact.has(b.empId)) {
            seenNear.add(b.empId);
            nearby.push(row);
          }
        }
      }
    }

    nearby.sort(
      (a, b) => Math.abs(minutesOf(a.time) - targetMin) - Math.abs(minutesOf(b.time) - targetMin),
    );

    return {
      ok: true,
      targetTime,
      alternatives: atExact.slice(0, 5),
      nearbyOtherTimes: nearby.slice(0, 3),
    };
  } catch (err) {
    return {
      ok: false,
      targetTime,
      alternatives: [],
      nearbyOtherTimes: [],
      errorCode: err instanceof Error ? err.message : 'ALT_SEARCH_FAILED',
    };
  }
}
