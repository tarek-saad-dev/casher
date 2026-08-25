import type { BusinessDayRecord } from '@/lib/branch/businessDay';
import { now as businessClockNow } from '../clock/BusinessClock';

export interface ShiftMoveRecord {
  id: number;
  branchId: number;
  businessDayId: number;
  newDay: string;
  userId: number;
  shiftId: number;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  status: boolean;
  userName?: string | null;
  shiftName?: string | null;
}

export function mapShiftMoveRow(row: Record<string, unknown>): ShiftMoveRecord {
  const asDate = (v: unknown) => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  };
  return {
    id: Number(row.ID),
    branchId: Number(row.BranchID),
    businessDayId: Number(row.BusinessDayID),
    newDay: asDate(row.NewDay) || '',
    userId: Number(row.UserID),
    shiftId: Number(row.ShiftID),
    startDate: asDate(row.StartDate),
    startTime: row.StartTime == null ? null : String(row.StartTime).trim(),
    endDate: asDate(row.EndDate),
    endTime: row.EndTime == null ? null : String(row.EndTime).trim(),
    status: Boolean(row.Status),
    userName: row.UserName == null ? null : String(row.UserName),
    shiftName: row.ShiftName == null ? null : String(row.ShiftName),
  };
}

export function mapDayRow(row: Record<string, unknown>): BusinessDayRecord {
  const rawDate = row.NewDay;
  const newDay =
    rawDate instanceof Date
      ? rawDate.toISOString().slice(0, 10)
      : String(rawDate).slice(0, 10);
  return {
    id: Number(row.ID),
    branchId: Number(row.BranchID),
    newDay,
    status: Boolean(row.Status),
  };
}

export function formatLegacyStartTime(at = businessClockNow()): string {
  const hours = at.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} ${ampm}`;
}

export function formatLegacyEndTime(at = businessClockNow()): string {
  const hours = at.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}:${String(at.getSeconds()).padStart(2, '0')} ${ampm}`;
}

export const SHIFT_MOVE_SELECT = `
  sm.ID, sm.BranchID, sm.BusinessDayID, sm.NewDay, sm.UserID, sm.ShiftID,
  sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
  u.UserName, s.ShiftName
`;
