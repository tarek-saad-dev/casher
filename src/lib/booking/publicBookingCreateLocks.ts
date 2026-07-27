/**
 * Booking Phase 6 — applocks for create (Transaction-owned).
 */
import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';

export class BookingCreateLockError extends Error {
  readonly code: PublicBookingErrorCode;
  constructor(code: PublicBookingErrorCode = 'BOOKING_LOCK_TIMEOUT') {
    super(code);
    this.name = 'BookingCreateLockError';
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 8_000;

/** Acquire Exclusive Transaction applock; throws BOOKING_LOCK_TIMEOUT on failure. */
export async function acquireBookingAppLock(
  transaction: Transaction,
  resource: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  // sp_getapplock resource max 255 chars
  const clipped = resource.length > 255 ? resource.slice(0, 255) : resource;
  const lockRes = await new sql.Request(transaction)
    .input('resource', sql.NVarChar(255), clipped)
    .input('timeout', sql.Int, timeoutMs)
    .query(`
      DECLARE @result INT;
      EXEC @result = sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = @timeout;
      SELECT @result AS LockResult;
    `);
  const lockResult = Number(lockRes.recordset[0]?.LockResult);
  if (lockResult !== 0 && lockResult !== 1) {
    throw new BookingCreateLockError('BOOKING_LOCK_TIMEOUT');
  }
}

/** Global EmpID absolute-interval lock (cross-branch). */
export function empIntervalLockResource(
  empId: number,
  startMs: number,
  endMs: number,
): string {
  return `booking:emp:${empId}:${startMs}:${endMs}`;
}

/** Any-barber assignment lock for branch + interval + service set. */
export function anyBarberAssignmentLockResource(
  branchId: number,
  startMs: number,
  endMs: number,
  serviceSetHash: string,
): string {
  return `booking:any:${branchId}:${startMs}:${endMs}:${serviceSetHash}`;
}

export function hashServiceSet(serviceIds: number[]): string {
  const sorted = [...serviceIds].sort((a, b) => a - b).join(',');
  // Short stable hash without crypto import cycle — FNV-1a 32-bit hex
  let h = 0x811c9dc5;
  for (let i = 0; i < sorted.length; i++) {
    h ^= sorted.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
