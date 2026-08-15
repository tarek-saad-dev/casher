/**
 * Prefer session-branch attendance; if that row has no check-in, use another
 * branch row that does (employee monthly report is employee-centric for hours).
 */
export function preferAttendanceRowForDate<
  T extends {
    BranchID: number | null;
    CheckInTime: string | null;
    CheckOutTime: string | null;
  },
>(rows: T[], sessionBranchId: number | null | undefined): T | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  const session =
    sessionBranchId != null && sessionBranchId > 0
      ? rows.find((r) => Number(r.BranchID) === sessionBranchId)
      : undefined;

  const score = (r: T): number => {
    let s = 0;
    if (r.CheckInTime) s += 4;
    if (r.CheckOutTime) s += 2;
    if (session && r === session) s += 1;
    return s;
  };

  if (session?.CheckInTime) return session;

  return [...rows].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function preferPayrollRowForDate<
  T extends {
    BranchID: number | null;
    DailyWage: number | null;
    ActualHours: number | null;
  },
>(rows: T[], sessionBranchId: number | null | undefined): T | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  const session =
    sessionBranchId != null && sessionBranchId > 0
      ? rows.find((r) => Number(r.BranchID) === sessionBranchId)
      : undefined;

  const score = (r: T): number => {
    let s = 0;
    if (r.DailyWage != null && Number.isFinite(Number(r.DailyWage))) s += 4;
    if (r.ActualHours != null && Number.isFinite(Number(r.ActualHours))) s += 2;
    if (session && r === session) s += 1;
    return s;
  };

  if (session && (session.DailyWage != null || session.ActualHours != null)) {
    return session;
  }

  return [...rows].sort((a, b) => score(b) - score(a))[0] ?? null;
}
