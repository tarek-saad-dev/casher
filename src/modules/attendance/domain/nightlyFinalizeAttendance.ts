/**
 * Nightly incomplete attendance default-fill persistence contract.
 */

/** Structural DB session (pool or in-flight SQL transaction request factory). */
export type AttendanceWriteDb = {
  request: () => {
    input: (name: string, type: unknown, value: unknown) => unknown;
    query: (sqlText: string) => Promise<{
      recordset: unknown[];
      rowsAffected?: number[];
    }>;
  };
};

export type PersistNightlyDefaultFillAttendanceInput = {
  db: AttendanceWriteDb;
  mode: 'update' | 'insert';
  branchId: number;
  empId?: number;
  workDate?: string;
  attendanceId?: number;
  checkInTime: string;
  checkOutTime: string;
  status: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  notes: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
};
