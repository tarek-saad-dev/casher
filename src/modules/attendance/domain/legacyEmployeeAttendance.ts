/**
 * Legacy POST /api/employees/attendance — current production semantics (Phase B2).
 * Distinct from admin PUT. Do not reuse admin status/overwrite/side-effect contracts.
 * Runtime Behavior Changes: NONE
 */

export const LEGACY_EMPLOYEES_POST_ALREADY_OPEN_CODE = 'ALREADY_OPEN' as const;

export const LEGACY_EMPLOYEES_POST_ALREADY_OPEN_MESSAGE =
  'الموظف لديه حضور مفتوح في فرع آخر — سجّل الانصراف أولاً';

export const LEGACY_EMPLOYEES_POST_EMP_NOT_FOUND_MESSAGE = 'الموظف غير موجود';

export const LEGACY_EMPLOYEES_POST_NOTIFIER_REASON =
  'employees_attendance_upsert' as const;

export type SaveLegacyEmployeeAttendanceInput = {
  branchId: number;
  empId: unknown;
  workDate: unknown;
  checkInTime?: unknown;
  checkOutTime?: unknown;
  status?: unknown;
  notes?: unknown;
};

export type LegacyEmployeeAttendanceMergeRow = Record<string, unknown>;

export type SaveLegacyEmployeeAttendanceResult = {
  row: LegacyEmployeeAttendanceMergeRow;
  isNew: boolean;
};

/** Phase B3 — PUT /api/employees/attendance/:id. Distinct from POST MERGE+ISNULL. */

export const LEGACY_EMPLOYEES_PUT_BY_ID_NOT_FOUND_MESSAGE = 'غير موجود';

export const LEGACY_EMPLOYEES_PUT_BY_ID_NO_PATCH_MESSAGE =
  'لا توجد بيانات للتعديل';

export const LEGACY_EMPLOYEES_PUT_BY_ID_NOTIFIER_REASON =
  'employees_attendance_update' as const;

export type UpdateLegacyEmployeeAttendanceByIdInput = {
  branchId: number;
  attendanceId: number;
  checkInTime?: unknown;
  checkOutTime?: unknown;
  status?: unknown;
  notes?: unknown;
};

export type UpdateLegacyEmployeeAttendanceByIdResult = {
  row: Record<string, unknown>;
};
