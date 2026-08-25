/**
 * Present placeholder for break attach. Isolated from CommandService barrel
 * to avoid schedule-sync ↔ AttendanceCommandService import cycles.
 */
import type { AttendanceWriteDb } from '../domain/nightlyFinalizeAttendance';
import * as attendanceRepo from '../infra/AttendanceRepository';

export async function ensurePresentAttendancePlaceholder(input: {
  db: AttendanceWriteDb;
  empId: number;
  workDate: string;
  branchId: number;
}): Promise<number> {
  return attendanceRepo.ensurePresentAttendancePlaceholder({
    db: input.db as attendanceRepo.AttendanceDb,
    empId: input.empId,
    workDate: input.workDate,
    branchId: input.branchId,
  });
}
