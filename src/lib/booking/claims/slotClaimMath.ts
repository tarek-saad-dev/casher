/**
 * Booking V2 B6 — 5-minute absolute slot claim math (pure).
 * Intervals are half-open [start, end).
 */

export const SLOT_CLAIM_QUANTUM_MS = 5 * 60_000;

/** Floor an instant to the quantum start (UTC epoch). */
export function floorToClaimSlotUtcMs(epochMs: number): number {
  if (!Number.isFinite(epochMs)) throw new Error('INVALID_CLAIM_EPOCH');
  return Math.floor(epochMs / SLOT_CLAIM_QUANTUM_MS) * SLOT_CLAIM_QUANTUM_MS;
}

/**
 * Expand [startAt, endAt) into discrete AbsoluteSlotStartUtc instants.
 * Adjacent intervals that only touch at the boundary do not share slots.
 */
export function absoluteSlotStartsForInterval(args: {
  startAt: Date | number;
  endAt: Date | number;
}): number[] {
  const startMs =
    typeof args.startAt === 'number' ? args.startAt : args.startAt.getTime();
  const endMs = typeof args.endAt === 'number' ? args.endAt : args.endAt.getTime();
  if (!(endMs > startMs)) return [];
  const first = floorToClaimSlotUtcMs(startMs);
  const slots: number[] = [];
  for (let t = first; t < endMs; t += SLOT_CLAIM_QUANTUM_MS) {
    slots.push(t);
  }
  return slots;
}

export function intervalsOverlapHalfOpen(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Detect overlapping pairs among booking intervals (legacy conflict scan). */
export function findOverlappingIntervalPairs<T extends { id: number; startMs: number; endMs: number }>(
  items: T[],
): Array<{ a: T; b: T }> {
  const sorted = [...items].sort((x, y) => x.startMs - y.startMs || x.id - y.id);
  const pairs: Array<{ a: T; b: T }> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (b.startMs >= a.endMs) break;
      if (intervalsOverlapHalfOpen(a.startMs, a.endMs, b.startMs, b.endMs)) {
        pairs.push({ a, b });
      }
    }
  }
  return pairs;
}
