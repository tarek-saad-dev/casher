/**
 * Booking V2 — independent occupancy / work revisions + derived AvailabilityRevision.
 *
 * AvailabilityRevision is a deterministic function of:
 *   EffectiveWorkRevision ⊕ BookingOccupancyRevision ⊕ HoldOccupancyRevision
 *   ⊕ QueueOccupancyRevision (when queue layer is active)
 *
 * Projection cache may lag; write paths must still validate against DB + locks.
 * Revision is NOT a write correctness authority.
 */

export type AvailabilityRevisionParts = {
  effectiveWorkRevision: number;
  bookingOccupancyRevision: number;
  holdOccupancyRevision: number;
  /** Present when queue occupancy is part of FreeMask (B7A decision). */
  queueOccupancyRevision?: number;
};

/** Deterministic, readable revision token for Emp×BusinessDate availability. */
export function deriveAvailabilityRevision(
  parts: AvailabilityRevisionParts,
): string {
  const ew = Math.max(0, Math.floor(parts.effectiveWorkRevision));
  const bk = Math.max(0, Math.floor(parts.bookingOccupancyRevision));
  const hd = Math.max(0, Math.floor(parts.holdOccupancyRevision));
  const q = Math.max(0, Math.floor(parts.queueOccupancyRevision ?? 0));
  return `av:ew${ew}:bk${bk}:hd${hd}:q${q}`;
}

/** Numeric fingerprint for cheap inequality checks (not cryptographic). */
export function availabilityRevisionFingerprint(parts: AvailabilityRevisionParts): number {
  const ew = Math.max(0, Math.floor(parts.effectiveWorkRevision));
  const bk = Math.max(0, Math.floor(parts.bookingOccupancyRevision));
  const hd = Math.max(0, Math.floor(parts.holdOccupancyRevision));
  const q = Math.max(0, Math.floor(parts.queueOccupancyRevision ?? 0));
  return ((ew * 1_000_003) ^ (bk * 1_000_033) ^ (hd * 1_000_151) ^ (q * 1_000_183)) >>> 0;
}

export type AvailabilityRevisionBoard = {
  effectiveWorkRevision(employeeId: number, businessDate: string): number;
  bookingOccupancyRevision(employeeId: number, businessDate: string): number;
  holdOccupancyRevision(employeeId: number, businessDate: string): number;
  queueOccupancyRevision(employeeId: number, businessDate: string): number;
  availabilityRevision(employeeId: number, businessDate: string): string;
  bumpEffectiveWork(employeeId: number, businessDate: string): number;
  bumpBookingOccupancy(employeeId: number, businessDate: string): number;
  bumpHoldOccupancy(employeeId: number, businessDate: string): number;
  bumpQueueOccupancy(employeeId: number, businessDate: string): number;
  note(parts: {
    employeeId: number;
    businessDate: string;
    effectiveWorkRevision?: number;
    bookingOccupancyRevision?: number;
    holdOccupancyRevision?: number;
    queueOccupancyRevision?: number;
  }): void;
};

function dayKey(employeeId: number, businessDate: string): string {
  return `${employeeId}:${businessDate}`;
}

export function createAvailabilityRevisionBoard(): AvailabilityRevisionBoard {
  const ew = new Map<string, number>();
  const bk = new Map<string, number>();
  const hd = new Map<string, number>();
  const q = new Map<string, number>();

  const get = (m: Map<string, number>, k: string) => m.get(k) ?? 0;
  const bump = (m: Map<string, number>, k: string) => {
    const n = get(m, k) + 1;
    m.set(k, n);
    return n;
  };

  return {
    effectiveWorkRevision(employeeId, businessDate) {
      return get(ew, dayKey(employeeId, businessDate));
    },
    bookingOccupancyRevision(employeeId, businessDate) {
      return get(bk, dayKey(employeeId, businessDate));
    },
    holdOccupancyRevision(employeeId, businessDate) {
      return get(hd, dayKey(employeeId, businessDate));
    },
    queueOccupancyRevision(employeeId, businessDate) {
      return get(q, dayKey(employeeId, businessDate));
    },
    availabilityRevision(employeeId, businessDate) {
      const k = dayKey(employeeId, businessDate);
      return deriveAvailabilityRevision({
        effectiveWorkRevision: get(ew, k),
        bookingOccupancyRevision: get(bk, k),
        holdOccupancyRevision: get(hd, k),
        queueOccupancyRevision: get(q, k),
      });
    },
    bumpEffectiveWork(employeeId, businessDate) {
      return bump(ew, dayKey(employeeId, businessDate));
    },
    bumpBookingOccupancy(employeeId, businessDate) {
      return bump(bk, dayKey(employeeId, businessDate));
    },
    bumpHoldOccupancy(employeeId, businessDate) {
      return bump(hd, dayKey(employeeId, businessDate));
    },
    bumpQueueOccupancy(employeeId, businessDate) {
      return bump(q, dayKey(employeeId, businessDate));
    },
    note(parts) {
      const k = dayKey(parts.employeeId, parts.businessDate);
      if (parts.effectiveWorkRevision != null) {
        ew.set(k, Math.max(get(ew, k), parts.effectiveWorkRevision));
      }
      if (parts.bookingOccupancyRevision != null) {
        bk.set(k, Math.max(get(bk, k), parts.bookingOccupancyRevision));
      }
      if (parts.holdOccupancyRevision != null) {
        hd.set(k, Math.max(get(hd, k), parts.holdOccupancyRevision));
      }
      if (parts.queueOccupancyRevision != null) {
        q.set(k, Math.max(get(q, k), parts.queueOccupancyRevision));
      }
    },
  };
}
