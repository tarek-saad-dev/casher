/**
 * Work-on-day-off Present upsert persistence (Attendance-owned).
 * Separated from AttendanceCommandService barrel to avoid lib ↔ command cycles.
 */
import * as attendanceRepo from '../infra/AttendanceRepository';

export async function persistWorkOnDayOffAttendance(args: {
  empId: number;
  workDate: string;
  branchId: number;
  checkInTime: string;
  notes: string;
}): Promise<void> {
  const db = await attendanceRepo.getAttendanceDb();
  await attendanceRepo.upsertWorkOnDayOffPresent({
    db,
    empId: args.empId,
    workDate: args.workDate,
    branchId: args.branchId,
    checkInTime: args.checkInTime,
    notes: args.notes,
  });
}
