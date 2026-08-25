/**
 * Admin bulk PUT /api/admin/attendance/bulk — current production semantics (Phase B4).
 * Dedicated command. Do not loop saveAdminAttendance (different txn/OPEN/schedule/WhatsApp).
 * Runtime Behavior Changes: NONE
 */

export const ADMIN_BULK_SUCCESS_MESSAGE = 'تم حفظ الحضور بنجاح';

export const ADMIN_BULK_WORK_ON_DAY_OFF_REASON =
  'نزل يشتغل يوم إجازته — تسجيل حضور';

export const ADMIN_BULK_WORK_ON_DAY_OFF_SOURCE_TAG = 'work-on-day-off';

export type SaveAdminAttendanceBulkItem = {
  EmpID?: unknown;
  CheckInTime?: unknown;
  CheckOutTime?: unknown;
  Status?: unknown;
  Notes?: unknown;
  Breaks?: unknown;
  BreakTimes?: unknown;
  BranchID?: unknown;
  WorkDate?: unknown;
};

export type SaveAdminAttendanceBulkInput = {
  branchId: number;
  userId: number | null;
  workDate: string;
  items: unknown;
};

export type SaveAdminAttendanceBulkSummary = {
  savedCount: number;
  insertedCount: number;
  updatedCount: number;
};
