/**
 * Enforce active-session invariant under employee applock.
 */
import {
  ACTIVE_SESSION_ALREADY_OPEN_CODE,
  ACTIVE_SESSION_ALREADY_OPEN_MESSAGE,
} from '../domain/adminPutAttendance';
import {
  activeSessionLockResource,
  evaluateActiveOpenCreation,
  type OpenAttendanceSession,
} from '../domain/attendanceSessionPolicy';
import { AttendanceCommandError } from '../domain/adminPutAttendance';
import * as attendanceRepo from '../infra/AttendanceRepository';
import { listOpenSessionsForEmployee } from './openSessionInventory';

export { listOpenSessionsForEmployee, listStaleOpenSessionsForEmployee } from './openSessionInventory';

export async function acquireActiveSessionLock(
  db: attendanceRepo.AttendanceDb,
  empId: number,
  lockTimeoutMs = 5000,
): Promise<void> {
  await attendanceRepo.acquireEmployeeActiveSessionLock(
    db,
    empId,
    activeSessionLockResource(empId),
    lockTimeoutMs,
  );
}

/**
 * Lock is assumed already held (or not required). Loads OPEN rows and evaluates.
 */
export async function assertActiveOpenAllowed(args: {
  db: attendanceRepo.AttendanceDb;
  empId: number;
  candidateWorkDate: string;
  excludeAttendanceId?: number | null;
  message?: string;
  code?: string;
}): Promise<{ staleSessions: OpenAttendanceSession[] }> {
  const openSessions = await listOpenSessionsForEmployee(args.db, args.empId);
  const evaluation = evaluateActiveOpenCreation({
    candidateWorkDate: args.candidateWorkDate,
    openSessions,
    excludeAttendanceId: args.excludeAttendanceId,
  });
  if (!evaluation.allowed) {
    throw new AttendanceCommandError(
      args.message ?? ACTIVE_SESSION_ALREADY_OPEN_MESSAGE,
      409,
      args.code ?? ACTIVE_SESSION_ALREADY_OPEN_CODE,
    );
  }
  return { staleSessions: evaluation.staleSessions };
}

/**
 * Begin txn → lock emp → assert → return tx handles for mutation.
 * Caller owns commit/rollback.
 */
export async function beginActiveSessionGuard(args: {
  empId: number;
  candidateWorkDate: string;
  excludeAttendanceId?: number | null;
  message?: string;
  code?: string;
}): Promise<{
  transaction: attendanceRepo.AttendanceTransaction;
  txDb: attendanceRepo.AttendanceDb;
  staleSessions: OpenAttendanceSession[];
}> {
  const { transaction, txDb } = await attendanceRepo.beginAttendanceTransaction();
  try {
    await acquireActiveSessionLock(txDb, args.empId);
    const { staleSessions } = await assertActiveOpenAllowed({
      db: txDb,
      empId: args.empId,
      candidateWorkDate: args.candidateWorkDate,
      excludeAttendanceId: args.excludeAttendanceId,
      message: args.message,
      code: args.code,
    });
    return { transaction, txDb, staleSessions };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}
