/**
 * Booking V2 B6/B6.5 — legacy booking claim backfill + overlap conflict scan.
 *
 * NEVER silently cancels or modifies Bookings.
 * Overlapping legacy pairs are reported only; claims are skipped for conflicted ids.
 */

import { getPool, sql } from '@/lib/db';
import {
  findOverlappingIntervalPairs,
  absoluteSlotStartsForInterval,
} from '@/lib/booking/claims/slotClaimMath';
import { createBookingSlotClaimSqlStore } from '@/lib/booking/claims/BookingSlotClaimSqlStore';
import { createBookingSlotClaimService } from '@/lib/booking/claims/BookingSlotClaimService';
import { SlotClaimConflictError } from '@/lib/booking/claims/BookingSlotClaimTypes';

export type LegacyBookingInterval = {
  id: number;
  empId: number;
  branchId: number;
  startMs: number;
  endMs: number;
  status: string;
  hasAbsolute: boolean;
  malformedAbsolute: boolean;
};

export type LegacyOverlapConflict = {
  empId: number;
  bookingIdA: number;
  bookingIdB: number;
  branchIdA: number;
  branchIdB: number;
  crossBranch: boolean;
  startA: string;
  endA: string;
  startB: string;
  endB: string;
};

export type SlotClaimBackfillReport = {
  scanned: number;
  claimsRequiredSlots: number;
  claimed: number;
  skippedConflict: number;
  skippedAlreadyClaimed: number;
  skippedInvalidInterval: number;
  skippedMalformedAbsolute: number;
  claimInsertErrors: number;
  legacyOverlaps: LegacyOverlapConflict[];
  crossBranchConflicts: LegacyOverlapConflict[];
  conflictedBookingIds: number[];
  malformedBookingIds: number[];
  parity?: SlotClaimParityReport;
};

export type SlotClaimParityReport = {
  bookingsChecked: number;
  exactMatch: number;
  missingClaims: number;
  extraClaims: number;
  mismatchBookingIds: number[];
  parityPct: number;
};

function statusActive(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === 'confirmed' || v === 'pending' || v === 'rescheduled';
}

/** Load active future bookings with AbsoluteStart/End when present. */
export async function loadActiveFutureBookingsForClaimBackfill(opts?: {
  nowMs?: number;
}): Promise<LegacyBookingInterval[]> {
  const now = new Date(opts?.nowMs ?? Date.now());
  const db = await getPool();
  const res = await db
    .request()
    .input('now', sql.DateTime2, now)
    .query(`
      SELECT
        b.BookingID,
        b.AssignedEmpID AS EmpID,
        b.BranchID,
        b.Status,
        b.AbsoluteStartUtc,
        b.AbsoluteEndUtc,
        b.BookingDate,
        b.StartTime,
        b.EndTime
      FROM dbo.Bookings b
      WHERE LOWER(b.Status) IN (N'confirmed', N'pending', N'rescheduled')
        AND (
          (b.AbsoluteEndUtc IS NOT NULL AND b.AbsoluteEndUtc > @now)
          OR (b.AbsoluteEndUtc IS NULL AND b.BookingDate >= CAST(@now AS date))
        )
      ORDER BY b.AssignedEmpID, b.AbsoluteStartUtc, b.BookingID
    `);

  const out: LegacyBookingInterval[] = [];
  for (const row of res.recordset as Record<string, unknown>[]) {
    if (!statusActive(String(row.Status ?? ''))) continue;
    const empId = Number(row.EmpID);
    const id = Number(row.BookingID);
    const branchId = Number(row.BranchID ?? 0);
    let startMs: number;
    let endMs: number;
    let hasAbsolute = false;
    let malformedAbsolute = false;

    if (row.AbsoluteStartUtc && row.AbsoluteEndUtc) {
      hasAbsolute = true;
      startMs = new Date(String(row.AbsoluteStartUtc)).getTime();
      endMs = new Date(String(row.AbsoluteEndUtc)).getTime();
      if (!(endMs > startMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        malformedAbsolute = true;
      }
    } else {
      const date = String(row.BookingDate).slice(0, 10);
      const st = String(row.StartTime ?? '00:00').slice(0, 5);
      const et = String(row.EndTime ?? '00:00').slice(0, 5);
      startMs = Date.parse(`${date}T${st}:00+02:00`);
      endMs = Date.parse(`${date}T${et}:00+02:00`);
      if (endMs <= startMs) endMs += 24 * 60 * 60_000;
    }
    if (!(endMs > startMs) || !Number.isFinite(startMs)) {
      malformedAbsolute = true;
      out.push({
        id,
        empId,
        branchId,
        startMs: Number.isFinite(startMs) ? startMs : 0,
        endMs: Number.isFinite(endMs) ? endMs : 0,
        status: String(row.Status),
        hasAbsolute,
        malformedAbsolute: true,
      });
      continue;
    }
    out.push({
      id,
      empId,
      branchId,
      startMs,
      endMs,
      status: String(row.Status),
      hasAbsolute,
      malformedAbsolute,
    });
  }
  return out;
}

/** Detect overlapping legacy bookings per EmpID (report only). */
export function scanLegacyBookingOverlaps(
  bookings: LegacyBookingInterval[],
): LegacyOverlapConflict[] {
  const byEmp = new Map<number, LegacyBookingInterval[]>();
  for (const b of bookings) {
    if (b.malformedAbsolute) continue;
    const list = byEmp.get(b.empId) ?? [];
    list.push(b);
    byEmp.set(b.empId, list);
  }
  const conflicts: LegacyOverlapConflict[] = [];
  for (const [empId, list] of byEmp) {
    const pairs = findOverlappingIntervalPairs(
      list.map((b) => ({ id: b.id, startMs: b.startMs, endMs: b.endMs })),
    );
    for (const { a, b } of pairs) {
      const ba = list.find((x) => x.id === a.id)!;
      const bb = list.find((x) => x.id === b.id)!;
      conflicts.push({
        empId,
        bookingIdA: a.id,
        bookingIdB: b.id,
        branchIdA: ba.branchId,
        branchIdB: bb.branchId,
        crossBranch: ba.branchId !== bb.branchId,
        startA: new Date(ba.startMs).toISOString(),
        endA: new Date(ba.endMs).toISOString(),
        startB: new Date(bb.startMs).toISOString(),
        endB: new Date(bb.endMs).toISOString(),
      });
    }
  }
  return conflicts;
}

/**
 * Backfill BOOKING claims for non-conflicted future bookings.
 * dryRun=true → scan + report only (no inserts).
 */
export async function backfillBookingSlotClaims(opts?: {
  dryRun?: boolean;
  nowMs?: number;
  verifyParity?: boolean;
  service?: ReturnType<typeof createBookingSlotClaimService>;
  bookings?: LegacyBookingInterval[];
}): Promise<SlotClaimBackfillReport> {
  const dryRun = opts?.dryRun === true;
  const bookings =
    opts?.bookings ?? (await loadActiveFutureBookingsForClaimBackfill({ nowMs: opts?.nowMs }));
  const legacyOverlaps = scanLegacyBookingOverlaps(bookings);
  const crossBranchConflicts = legacyOverlaps.filter((c) => c.crossBranch);
  const conflictedBookingIds = [
    ...new Set(legacyOverlaps.flatMap((c) => [c.bookingIdA, c.bookingIdB])),
  ];
  const conflicted = new Set(conflictedBookingIds);
  const malformedBookingIds = bookings
    .filter((b) => b.malformedAbsolute)
    .map((b) => b.id);

  const service =
    opts?.service ??
    createBookingSlotClaimService({
      store: createBookingSlotClaimSqlStore(),
    });

  let claimed = 0;
  let skippedConflict = 0;
  let skippedAlreadyClaimed = 0;
  let skippedInvalidInterval = 0;
  let skippedMalformedAbsolute = 0;
  let claimInsertErrors = 0;
  let claimsRequiredSlots = 0;

  for (const b of bookings) {
    if (b.malformedAbsolute) {
      skippedMalformedAbsolute++;
      continue;
    }
    if (conflicted.has(b.id)) {
      skippedConflict++;
      continue;
    }
    const slots = absoluteSlotStartsForInterval({
      startAt: b.startMs,
      endAt: b.endMs,
    });
    if (!slots.length) {
      skippedInvalidInterval++;
      continue;
    }
    claimsRequiredSlots += slots.length;

    if (dryRun) {
      claimed++;
      continue;
    }

    try {
      const existing = await service.store.withTransaction((tx) =>
        tx.listByBookingId(b.id),
      );
      if (existing.length >= slots.length) {
        skippedAlreadyClaimed++;
        continue;
      }
      if (existing.length > 0) {
        await service.rebuildBookingClaimsFromInterval({
          empId: b.empId,
          branchId: b.branchId,
          startAt: new Date(b.startMs),
          endAt: new Date(b.endMs),
          bookingId: b.id,
        });
        claimed++;
        continue;
      }
      await service.claimBookingInterval({
        empId: b.empId,
        branchId: b.branchId,
        startAt: new Date(b.startMs),
        endAt: new Date(b.endMs),
        bookingId: b.id,
      });
      claimed++;
    } catch {
      claimInsertErrors++;
    }
  }

  const report: SlotClaimBackfillReport = {
    scanned: bookings.length,
    claimsRequiredSlots,
    claimed,
    skippedConflict,
    skippedAlreadyClaimed,
    skippedInvalidInterval,
    skippedMalformedAbsolute,
    claimInsertErrors,
    legacyOverlaps,
    crossBranchConflicts,
    conflictedBookingIds,
    malformedBookingIds,
  };

  if (opts?.verifyParity && !dryRun) {
    report.parity = await verifyActiveFutureClaimsParity({
      bookings,
      service,
      conflictedBookingIds,
    });
  }

  return report;
}

/** Verify Slot Claims ↔ active future bookings parity (non-conflicted only). */
export async function verifyActiveFutureClaimsParity(opts?: {
  bookings?: LegacyBookingInterval[];
  service?: ReturnType<typeof createBookingSlotClaimService>;
  conflictedBookingIds?: number[];
}): Promise<SlotClaimParityReport> {
  const bookings =
    opts?.bookings ?? (await loadActiveFutureBookingsForClaimBackfill());
  const conflicted = new Set(opts?.conflictedBookingIds ?? []);
  const service =
    opts?.service ??
    createBookingSlotClaimService({ store: createBookingSlotClaimSqlStore() });

  let exactMatch = 0;
  let missingClaims = 0;
  let extraClaims = 0;
  const mismatchBookingIds: number[] = [];
  let checked = 0;

  for (const b of bookings) {
    if (b.malformedAbsolute || conflicted.has(b.id)) continue;
    checked++;
    const expected = absoluteSlotStartsForInterval({
      startAt: b.startMs,
      endAt: b.endMs,
    });
    const rows = await service.store.withTransaction((tx) =>
      tx.listByBookingId(b.id),
    );
    const actual = new Set(
      rows
        .filter((r) => r.claimType === 'BOOKING' && r.empId === b.empId)
        .map((r) => r.absoluteSlotStartUtcMs),
    );
    const missing = expected.filter((ms) => !actual.has(ms));
    const extra = [...actual].filter((ms) => !expected.includes(ms));
    if (!missing.length && !extra.length && actual.size === expected.length) {
      exactMatch++;
    } else {
      mismatchBookingIds.push(b.id);
      if (missing.length) missingClaims++;
      if (extra.length) extraClaims++;
    }
  }

  return {
    bookingsChecked: checked,
    exactMatch,
    missingClaims,
    extraClaims,
    mismatchBookingIds,
    parityPct: checked === 0 ? 100 : Math.round((exactMatch / checked) * 10000) / 100,
  };
}

/** Verify claims for one booking match SoT interval (count + slot set). */
export async function verifyBookingClaimsAgainstSoT(args: {
  bookingId: number;
  empId: number;
  startAt: Date;
  endAt: Date;
  service?: ReturnType<typeof createBookingSlotClaimService>;
}): Promise<{ ok: boolean; expectedSlots: number; actualSlots: number; missing: number[] }> {
  const service =
    args.service ??
    createBookingSlotClaimService({ store: createBookingSlotClaimSqlStore() });
  const expected = absoluteSlotStartsForInterval({
    startAt: args.startAt,
    endAt: args.endAt,
  });
  const rows = await service.store.withTransaction((tx) =>
    tx.listByBookingId(args.bookingId),
  );
  const actual = new Set(
    rows
      .filter((r) => r.claimType === 'BOOKING' && r.empId === args.empId)
      .map((r) => r.absoluteSlotStartUtcMs),
  );
  const missing = expected.filter((ms) => !actual.has(ms));
  return {
    ok: missing.length === 0 && actual.size === expected.length,
    expectedSlots: expected.length,
    actualSlots: actual.size,
    missing,
  };
}
