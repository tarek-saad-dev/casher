import { getAvailableBarbers } from '@/lib/barberAvailability';
import { computeBarberEstimate } from '@/lib/queueEstimateEngine';
import { listBookableEmployeeIdsForBranch } from '@/lib/branch/bookingQueueOwnership';
import { getCairoBusinessDate } from '@/lib/businessDate';

export interface NearestBarberEstimate {
  empId: number;
  empName: string;
  estimatedStartTime: string;
  estimatedWaitMinutes: number;
  blockingQueueCount: number;
  blockingBookingCount: number;
  peopleBefore: number;
}

export interface FindNearestBarberResult {
  ok: boolean;
  best: NearestBarberEstimate | null;
  alternatives: NearestBarberEstimate[];
  nextAvailableTime: string | null;
  unavailable: Array<{ empId: number; empName: string; reason: string }>;
}

function toNearestShape(
  estimate: Awaited<ReturnType<typeof computeBarberEstimate>>,
  refNow: Date,
): NearestBarberEstimate {
  const slot = new Date(estimate.estimatedStartTime);
  const waitMinutes = Math.max(0, Math.round((slot.getTime() - refNow.getTime()) / 60000));

  return {
    empId: estimate.empId,
    empName: estimate.empName,
    estimatedStartTime: estimate.estimatedStartTime,
    estimatedWaitMinutes: waitMinutes,
    blockingQueueCount: estimate.blockingQueueCount,
    blockingBookingCount: estimate.blockingBookingCount,
    peopleBefore: estimate.blockingQueueCount,
  };
}

/**
 * Picks the barber who can start the requested services at the earliest valid time.
 * Tie-break: earliest start → lower queue count → lower EmpID.
 */
export async function findNearestBarberForServices(
  serviceIds: number[],
  requestedAt?: string,
  /** Branch scoping: restricts candidates to branch-eligible employees. */
  branchId?: number | null,
): Promise<FindNearestBarberResult> {
  const now = requestedAt ? new Date(requestedAt) : new Date();
  let allBarbers = await getAvailableBarbers(now);

  if (branchId != null) {
    const operationalDate = getCairoBusinessDate(now);
    const eligibleIds = new Set(await listBookableEmployeeIdsForBranch(branchId, operationalDate));
    allBarbers = allBarbers.filter((b) => eligibleIds.has(b.EmpID));
  }

  if (allBarbers.length === 0) {
    return {
      ok: false,
      best: null,
      alternatives: [],
      nextAvailableTime: null,
      unavailable: [],
    };
  }

  const estimates = await Promise.all(
    allBarbers.map((b) => computeBarberEstimate(b.EmpID, b.EmpName, serviceIds, requestedAt)),
  );

  const available = estimates
    .filter((e) => e.isWorking)
    .sort((a, b) => {
      const tDiff =
        new Date(a.estimatedStartTime).getTime() - new Date(b.estimatedStartTime).getTime();
      if (tDiff !== 0) return tDiff;
      const qDiff = a.blockingQueueCount - b.blockingQueueCount;
      if (qDiff !== 0) return qDiff;
      return a.empId - b.empId;
    });

  const unavailable = estimates
    .filter((e) => !e.isWorking)
    .map((e) => ({
      empId: e.empId,
      empName: e.empName,
      reason: e.unavailableReason ?? 'غير متاح',
    }));

  const [bestRaw, ...altRaws] = available;
  const best = bestRaw ? toNearestShape(bestRaw, now) : null;
  const alternatives = altRaws.map((e) => toNearestShape(e, now));

  const nextAvailableTime =
    !best && available.length === 0
      ? estimates
          .filter((e) => e.isWorking)
          .map((e) => e.estimatedStartTime)
          .sort(
            (a, b) => new Date(a).getTime() - new Date(b).getTime(),
          )[0] ?? null
      : null;

  return {
    ok: available.length > 0,
    best,
    alternatives,
    nextAvailableTime,
    unavailable,
  };
}
