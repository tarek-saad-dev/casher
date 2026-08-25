import 'server-only';
import { getPool, sql } from '@/lib/db';
import { SHIFT_MOVE_SELECT, mapShiftMoveRow } from './shiftMoveRecord';
import { mapDayRow } from './shiftMoveRecord';
import type { BusinessDayRecord } from '@/lib/branch/businessDay';
import type { ShiftMoveRecord } from './shiftMoveRecord';

export type BootstrapUserRow = {
  userId: number;
  userName: string;
  userLevel: string;
  defaultShiftId: number | null;
  isDeleted: boolean;
};

export type BootstrapActiveBranchRow = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  timeZone: string;
  businessDayCutoffTime: string;
  branchIsActive: boolean;
  canOperate: boolean;
  canViewReports: boolean;
  canSwitch: boolean;
  accessIsActive: boolean;
  validFrom: Date | null;
  validTo: Date | null;
};

export type BootstrapAccessRow = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  isDefault: boolean;
  canOperate: boolean;
  canViewReports: boolean;
  canSwitch: boolean;
  isActive: boolean;
  validFrom: Date;
  validTo: Date | null;
  branchIsActive: boolean;
  timeZone: string;
  businessDayCutoffTime: string;
};

export type OperationalBootstrapSnapshot = {
  user: BootstrapUserRow | null;
  activeBranch: BootstrapActiveBranchRow | null;
  accessRows: BootstrapAccessRow[];
  openDay: BusinessDayRecord | null;
  userOpenShift: ShiftMoveRecord | null;
  openShiftCount: number;
  roles: string[];
  rolePages: Array<{ pageKey: string; pagePath: string }>;
  allAccessPages: Array<{ pageKey: string; pagePath: string }>;
  allPages: Array<{ pageKey: string; pagePath: string }>;
};

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function formatTime(value: unknown): string {
  if (value == null) return '04:00:00';
  if (typeof value === 'string') return value.slice(0, 8);
  if (value instanceof Date) return value.toISOString().slice(11, 19);
  return String(value).slice(0, 8);
}

function mapAccessRow(row: Record<string, unknown>): BootstrapAccessRow {
  return {
    branchId: Number(row.BranchID),
    branchCode: String(row.BranchCode),
    branchName: String(row.BranchName),
    shortName: row.ShortName == null ? null : String(row.ShortName),
    isDefault: Boolean(row.IsDefault),
    canOperate: Boolean(row.CanOperate),
    canViewReports: Boolean(row.CanViewReports),
    canSwitch: Boolean(row.CanSwitch),
    isActive: Boolean(row.IsActive),
    validFrom: asDate(row.ValidFrom) ?? new Date(0),
    validTo: asDate(row.ValidTo),
    branchIsActive: Boolean(row.BranchIsActive),
    timeZone: String(row.TimeZone || 'Africa/Cairo'),
    businessDayCutoffTime: formatTime(row.BusinessDayCutoffTime),
  };
}

function mapPages(rows: Record<string, unknown>[]): Array<{ pageKey: string; pagePath: string }> {
  return rows.map((row) => ({
    pageKey: String(row.PageKey),
    pagePath: String(row.PagePath),
  }));
}

/**
 * One SQL batch / multiple result sets for core operational shell state.
 * Day and shift are read fresh — never served from a TTL cache.
 */
export async function loadOperationalBootstrapSnapshot(args: {
  userId: number;
  branchId: number;
}): Promise<OperationalBootstrapSnapshot> {
  const db = await getPool();
  const result = await db
    .request()
    .input('userId', sql.Int, args.userId)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      SELECT TOP 1
        UserID, UserName, UserLevel, ShiftID, ISNULL(isDeleted, 0) AS isDeleted
      FROM dbo.TblUser
      WHERE UserID = @userId;

      SELECT TOP 1
        b.BranchID, b.BranchCode, b.BranchName, b.ShortName,
        b.TimeZone, b.BusinessDayCutoffTime, b.IsActive AS BranchIsActive,
        ISNULL(uba.CanOperate, 0) AS CanOperate,
        ISNULL(uba.CanViewReports, 0) AS CanViewReports,
        ISNULL(uba.CanSwitch, 0) AS CanSwitch,
        ISNULL(uba.IsActive, 0) AS AccessIsActive,
        uba.ValidFrom, uba.ValidTo
      FROM dbo.TblBranch b
      LEFT JOIN dbo.TblUserBranchAccess uba
        ON uba.BranchID = b.BranchID AND uba.UserID = @userId
      WHERE b.BranchID = @branchId;

      SELECT
        uba.ID, uba.UserID, uba.BranchID, b.BranchCode, b.BranchName, b.ShortName,
        uba.IsDefault, uba.CanOperate, uba.CanViewReports, uba.CanSwitch,
        uba.IsActive, uba.ValidFrom, uba.ValidTo, b.IsActive AS BranchIsActive,
        b.TimeZone, b.BusinessDayCutoffTime
      FROM dbo.TblUserBranchAccess uba
      INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
      WHERE uba.UserID = @userId
      ORDER BY uba.IsDefault DESC, b.BranchCode;

      SELECT TOP 1 ID, BranchID, NewDay, Status
      FROM dbo.TblNewDay
      WHERE BranchID = @branchId AND Status = 1
      ORDER BY ID DESC;

      SELECT TOP 1
        ${SHIFT_MOVE_SELECT}
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.Status = 1 AND sm.UserID = @userId
      ORDER BY sm.ID DESC;

      SELECT COUNT(*) AS OpenShiftCount
      FROM dbo.TblShiftMove sm
      INNER JOIN dbo.TblNewDay d ON d.ID = sm.BusinessDayID
      WHERE sm.BranchID = @branchId
        AND sm.Status = 1
        AND d.Status = 1
        AND d.BranchID = @branchId;

      SELECT r.RoleKey
      FROM dbo.TblUserRoles ur
      INNER JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID
      WHERE ur.UserID = @userId AND r.IsActive = 1;

      SELECT DISTINCT sp.PageKey, sp.PagePath
      FROM dbo.TblPageRoleAccess pra
      INNER JOIN dbo.TblSystemPages sp ON sp.PageID = pra.PageID
      INNER JOIN dbo.TblUserRoles ur ON ur.RoleID = pra.RoleID
      WHERE ur.UserID = @userId AND sp.IsActive = 1 AND pra.CanView = 1;

      SELECT PageKey, PagePath
      FROM dbo.TblSystemPages
      WHERE IsActive = 1 AND AccessMode = N'all';

      SELECT PageKey, PagePath
      FROM dbo.TblSystemPages
      WHERE IsActive = 1;
    `);

  const sets = (result.recordsets ?? [result.recordset]) as Record<string, unknown>[][];
  const userRow = sets[0]?.[0];
  const branchRow = sets[1]?.[0];
  const accessRows = sets[2] ?? [];
  const dayRow = sets[3]?.[0];
  const shiftRow = sets[4]?.[0];
  const countRow = sets[5]?.[0];
  const roleRows = sets[6] ?? [];
  const rolePages = sets[7] ?? [];
  const allPages = sets[8] ?? [];
  const everyPage = sets[9] ?? [];

  return {
    user: userRow
      ? {
          userId: Number(userRow.UserID),
          userName: String(userRow.UserName),
          userLevel: String(userRow.UserLevel),
          defaultShiftId:
            userRow.ShiftID != null && Number.isFinite(Number(userRow.ShiftID))
              ? Number(userRow.ShiftID)
              : null,
          isDeleted: Boolean(userRow.isDeleted),
        }
      : null,
    activeBranch: branchRow
      ? {
          branchId: Number(branchRow.BranchID),
          branchCode: String(branchRow.BranchCode),
          branchName: String(branchRow.BranchName),
          shortName: branchRow.ShortName == null ? null : String(branchRow.ShortName),
          timeZone: String(branchRow.TimeZone || 'Africa/Cairo'),
          businessDayCutoffTime: formatTime(branchRow.BusinessDayCutoffTime),
          branchIsActive: Boolean(branchRow.BranchIsActive),
          canOperate: Boolean(branchRow.CanOperate),
          canViewReports: Boolean(branchRow.CanViewReports),
          canSwitch: Boolean(branchRow.CanSwitch),
          accessIsActive: Boolean(branchRow.AccessIsActive),
          validFrom: asDate(branchRow.ValidFrom),
          validTo: asDate(branchRow.ValidTo),
        }
      : null,
    accessRows: accessRows.map(mapAccessRow),
    openDay: dayRow ? mapDayRow(dayRow) : null,
    userOpenShift: shiftRow ? mapShiftMoveRow(shiftRow) : null,
    openShiftCount: Number(countRow?.OpenShiftCount ?? 0),
    roles: roleRows.map((row) => String(row.RoleKey)),
    rolePages: mapPages(rolePages),
    allAccessPages: mapPages(allPages),
    allPages: mapPages(everyPage),
  };
}
