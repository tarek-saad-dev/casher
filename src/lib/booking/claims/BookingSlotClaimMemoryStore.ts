/**
 * In-memory slot claim store — simulates UNIQUE(EmpID, AbsoluteSlotStartUtc).
 * Used for concurrency unit tests without SQL Server.
 */

import { absoluteSlotStartsForInterval } from '@/lib/booking/claims/slotClaimMath';
import {
  SlotClaimConflictError,
  type SlotClaimRow,
} from '@/lib/booking/claims/BookingSlotClaimTypes';
import type {
  SlotClaimInsert,
  SlotClaimStore,
  SlotClaimStoreTx,
} from '@/lib/booking/claims/BookingSlotClaimStore';

type MemRow = SlotClaimRow;

function slotKey(empId: number, slotMs: number): string {
  return `${empId}:${slotMs}`;
}

export function createBookingSlotClaimMemoryStore(opts?: {
  nowMs?: () => number;
}): SlotClaimStore {
  const nowFn = opts?.nowMs ?? (() => Date.now());
  const byId = new Map<number, MemRow>();
  const byEmpSlot = new Map<string, number>(); // key → claimId
  let nextId = 1;
  let chain: Promise<unknown> = Promise.resolve();

  function isLive(row: MemRow, nowMs: number): boolean {
    if (row.claimType === 'HOLD' && row.expiresAtUtcMs != null && row.expiresAtUtcMs <= nowMs) {
      return false;
    }
    return true;
  }

  function purgeExpired(nowMs: number): number {
    let n = 0;
    for (const [id, row] of [...byId]) {
      if (row.claimType === 'HOLD' && row.expiresAtUtcMs != null && row.expiresAtUtcMs <= nowMs) {
        byId.delete(id);
        byEmpSlot.delete(slotKey(row.empId, row.absoluteSlotStartUtcMs));
        n++;
      }
    }
    return n;
  }

  function makeTx(): SlotClaimStoreTx {
    // Snapshot for rollback
    const snapRows = new Map(byId);
    const snapIndex = new Map(byEmpSlot);
    const snapNext = nextId;
    let rolledBack = false;

    const tx: SlotClaimStoreTx & { __rollback: () => void; __commit: () => void } = {
      __rollback() {
        if (rolledBack) return;
        rolledBack = true;
        byId.clear();
        for (const [k, v] of snapRows) byId.set(k, v);
        byEmpSlot.clear();
        for (const [k, v] of snapIndex) byEmpSlot.set(k, v);
        nextId = snapNext;
      },
      __commit() {
        rolledBack = false;
      },
      async insert(row: SlotClaimInsert) {
        const nowMs = nowFn();
        purgeExpired(nowMs);
        const key = slotKey(row.empId, row.absoluteSlotStartUtcMs);
        const existingId = byEmpSlot.get(key);
        if (existingId != null) {
          const existing = byId.get(existingId);
          if (existing && isLive(existing, nowMs)) {
            throw new SlotClaimConflictError(
              row.claimType === 'HOLD' ? 'HOLD_CONFLICT' : 'SLOT_CLAIM_CONFLICT',
              {
                empId: row.empId,
                slotMs: row.absoluteSlotStartUtcMs,
                existingClaimId: existing.claimId,
                existingType: existing.claimType,
              },
            );
          }
          // stale expired — replace
          if (existing) {
            byId.delete(existing.claimId);
            byEmpSlot.delete(key);
          }
        }
        const claimId = nextId++;
        const stored: MemRow = {
          claimId,
          empId: row.empId,
          branchId: row.branchId,
          absoluteSlotStartUtcMs: row.absoluteSlotStartUtcMs,
          claimType: row.claimType,
          holdToken: row.holdToken ?? null,
          bookingId: row.bookingId ?? null,
          ownerKey: row.ownerKey ?? null,
          expiresAtUtcMs: row.expiresAtUtcMs ?? null,
          createdAtUtcMs: nowMs,
        };
        byId.set(claimId, stored);
        byEmpSlot.set(key, claimId);
        return stored;
      },
      async deleteByHoldToken(holdToken) {
        let n = 0;
        for (const [id, row] of [...byId]) {
          if (row.holdToken === holdToken) {
            byId.delete(id);
            byEmpSlot.delete(slotKey(row.empId, row.absoluteSlotStartUtcMs));
            n++;
          }
        }
        return n;
      },
      async deleteByBookingId(bookingId) {
        let n = 0;
        for (const [id, row] of [...byId]) {
          if (row.bookingId === bookingId) {
            byId.delete(id);
            byEmpSlot.delete(slotKey(row.empId, row.absoluteSlotStartUtcMs));
            n++;
          }
        }
        return n;
      },
      async deleteByBookingIdAndSlots(bookingId, slotStartsUtcMs) {
        const want = new Set(slotStartsUtcMs);
        let n = 0;
        for (const [id, row] of [...byId]) {
          if (
            row.bookingId === bookingId &&
            want.has(row.absoluteSlotStartUtcMs)
          ) {
            byId.delete(id);
            byEmpSlot.delete(slotKey(row.empId, row.absoluteSlotStartUtcMs));
            n++;
          }
        }
        return n;
      },
      async convertHoldToBooking(args) {
        let n = 0;
        for (const row of byId.values()) {
          if (row.holdToken === args.holdToken && row.claimType === 'HOLD') {
            row.claimType = 'BOOKING';
            row.bookingId = args.bookingId;
            row.holdToken = null;
            row.expiresAtUtcMs = null;
            row.ownerKey = args.ownerKey ?? row.ownerKey;
            n++;
          }
        }
        return n;
      },
      async listByHoldToken(holdToken) {
        return [...byId.values()].filter((r) => r.holdToken === holdToken);
      },
      async listByBookingId(bookingId) {
        return [...byId.values()].filter((r) => r.bookingId === bookingId);
      },
      async listByEmpSlots(args) {
        const nowMs = nowFn();
        purgeExpired(nowMs);
        const out: SlotClaimRow[] = [];
        for (const slot of args.slotStartsUtcMs) {
          const id = byEmpSlot.get(slotKey(args.empId, slot));
          if (id != null) {
            const row = byId.get(id);
            if (row && isLive(row, nowMs)) out.push(row);
          }
        }
        return out;
      },
      async deleteExpiredHolds(nowMs) {
        return purgeExpired(nowMs);
      },
      async deleteExpiredHoldsForSlots(args) {
        let n = 0;
        for (const slot of args.slotStartsUtcMs) {
          const id = byEmpSlot.get(slotKey(args.empId, slot));
          if (id == null) continue;
          const row = byId.get(id);
          if (
            row &&
            row.claimType === 'HOLD' &&
            row.expiresAtUtcMs != null &&
            row.expiresAtUtcMs <= args.nowMs
          ) {
            byId.delete(id);
            byEmpSlot.delete(slotKey(row.empId, row.absoluteSlotStartUtcMs));
            n++;
          }
        }
        return n;
      },
    };
    return tx;
  }

  return {
    async withTransaction(fn) {
      // Serialize transactions to simulate DB isolation for concurrency tests.
      const run = chain.then(async () => {
        const tx = makeTx() as SlotClaimStoreTx & {
          __rollback: () => void;
          __commit: () => void;
        };
        try {
          const result = await fn(tx);
          tx.__commit();
          return result;
        } catch (err) {
          tx.__rollback();
          throw err;
        }
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    async deleteExpiredHolds(nowMs) {
      return purgeExpired(nowMs);
    },
    async listByEmpRange(args) {
      purgeExpired(nowFn());
      return [...byId.values()].filter(
        (r) =>
          r.empId === args.empId &&
          r.absoluteSlotStartUtcMs >= args.rangeStartMs &&
          r.absoluteSlotStartUtcMs < args.rangeEndMs,
      );
    },
    size() {
      return byId.size;
    },
  };
}

/** Helper for tests — expand interval via shared math. */
export { absoluteSlotStartsForInterval };
