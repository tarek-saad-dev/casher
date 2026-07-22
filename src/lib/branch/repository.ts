import 'server-only';
import { getPool, sql } from '@/lib/db';
import type {
  BranchRecord,
  EmpBranchAssignmentRecord,
  UserBranchAccessRecord,
} from './types';

/** One consistent current-time source for branch validity checks. */
export function branchNow(): Date {
  return new Date();
}

function formatTime(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, 8);
  if (value instanceof Date) {
    return value.toISOString().slice(11, 19);
  }
  return String(value).slice(0, 8);
}

function formatDate(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapBranch(row: Record<string, unknown>): BranchRecord {
  return {
    branchId: Number(row.BranchID),
    branchCode: String(row.BranchCode),
    branchName: String(row.BranchName),
    shortName: row.ShortName == null ? null : String(row.ShortName),
    address: row.Address == null ? null : String(row.Address),
    phone: row.Phone == null ? null : String(row.Phone),
    timeZone: String(row.TimeZone),
    businessDayCutoffTime: formatTime(row.BusinessDayCutoffTime),
    defaultOpenTime: row.DefaultOpenTime == null ? null : formatTime(row.DefaultOpenTime),
    defaultCloseTime: row.DefaultCloseTime == null ? null : formatTime(row.DefaultCloseTime),
    isActive: Boolean(row.IsActive),
    createdAt: row.CreatedAt instanceof Date ? row.CreatedAt : new Date(String(row.CreatedAt)),
    updatedAt:
      row.UpdatedAt == null
        ? null
        : row.UpdatedAt instanceof Date
          ? row.UpdatedAt
          : new Date(String(row.UpdatedAt)),
  };
}

const BRANCH_SELECT = `
  BranchID, BranchCode, BranchName, ShortName, Address, Phone,
  TimeZone, BusinessDayCutoffTime, DefaultOpenTime, DefaultCloseTime,
  IsActive, CreatedAt, UpdatedAt
`;

export async function getBranchById(branchId: number): Promise<BranchRecord | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT ${BRANCH_SELECT}
      FROM dbo.TblBranch
      WHERE BranchID = @branchId
    `);
  if (!result.recordset[0]) return null;
  return mapBranch(result.recordset[0]);
}

export async function getBranchByCode(branchCode: string): Promise<BranchRecord | null> {
  const db = await getPool();
  const normalized = branchCode.trim().toUpperCase();
  const result = await db
    .request()
    .input('branchCode', sql.NVarChar(30), normalized)
    .query(`
      SELECT ${BRANCH_SELECT}
      FROM dbo.TblBranch
      WHERE BranchCode = @branchCode
    `);
  if (!result.recordset[0]) return null;
  return mapBranch(result.recordset[0]);
}

export async function listActiveBranches(): Promise<BranchRecord[]> {
  const db = await getPool();
  const result = await db.request().query(`
    SELECT ${BRANCH_SELECT}
    FROM dbo.TblBranch
    WHERE IsActive = 1
    ORDER BY BranchCode
  `);
  return result.recordset.map(mapBranch);
}

function mapAccess(row: Record<string, unknown>): UserBranchAccessRecord {
  return {
    id: Number(row.ID),
    userId: Number(row.UserID),
    branchId: Number(row.BranchID),
    branchCode: String(row.BranchCode),
    branchName: String(row.BranchName),
    shortName: row.ShortName == null ? null : String(row.ShortName),
    isDefault: Boolean(row.IsDefault),
    canOperate: Boolean(row.CanOperate),
    canViewReports: Boolean(row.CanViewReports),
    canSwitch: Boolean(row.CanSwitch),
    isActive: Boolean(row.IsActive),
    validFrom: row.ValidFrom instanceof Date ? row.ValidFrom : new Date(String(row.ValidFrom)),
    validTo:
      row.ValidTo == null
        ? null
        : row.ValidTo instanceof Date
          ? row.ValidTo
          : new Date(String(row.ValidTo)),
    branchIsActive: Boolean(row.BranchIsActive),
  };
}

const ACCESS_SELECT = `
  uba.ID, uba.UserID, uba.BranchID, b.BranchCode, b.BranchName, b.ShortName,
  uba.IsDefault, uba.CanOperate, uba.CanViewReports, uba.CanSwitch,
  uba.IsActive, uba.ValidFrom, uba.ValidTo, b.IsActive AS BranchIsActive
`;

export async function listUserBranchAccessRows(
  userId: number,
): Promise<UserBranchAccessRecord[]> {
  const db = await getPool();
  const result = await db
    .request()
    .input('userId', sql.Int, userId)
    .query(`
      SELECT ${ACCESS_SELECT}
      FROM dbo.TblUserBranchAccess uba
      INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
      WHERE uba.UserID = @userId
      ORDER BY uba.IsDefault DESC, b.BranchCode
    `);
  return result.recordset.map(mapAccess);
}

export async function listUserValidBranchAccess(
  userId: number,
  at: Date = branchNow(),
): Promise<UserBranchAccessRecord[]> {
  const rows = await listUserBranchAccessRows(userId);
  return rows.filter((row) => isValidUserBranchAccess(row, at));
}

export function isValidUserBranchAccess(
  row: UserBranchAccessRecord,
  at: Date = branchNow(),
): boolean {
  if (!row.isActive) return false;
  if (!row.branchIsActive) return false;
  if (row.validFrom.getTime() > at.getTime()) return false;
  if (row.validTo != null && row.validTo.getTime() <= at.getTime()) return false;
  return true;
}

export async function getUserDefaultBranch(
  userId: number,
  at: Date = branchNow(),
): Promise<UserBranchAccessRecord | null> {
  const valid = await listUserValidBranchAccess(userId, at);
  const defaults = valid.filter((r) => r.isDefault);
  if (defaults.length === 0) return null;
  if (defaults.length > 1) {
    // Caller must treat multiple defaults as an error.
    return defaults[0];
  }
  return defaults[0];
}

export async function countUserValidDefaults(
  userId: number,
  at: Date = branchNow(),
): Promise<number> {
  const valid = await listUserValidBranchAccess(userId, at);
  return valid.filter((r) => r.isDefault).length;
}

export async function getUserBranchAccess(
  userId: number,
  branchId: number,
): Promise<UserBranchAccessRecord | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('userId', sql.Int, userId)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT ${ACCESS_SELECT}
      FROM dbo.TblUserBranchAccess uba
      INNER JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
      WHERE uba.UserID = @userId AND uba.BranchID = @branchId
    `);
  if (!result.recordset[0]) return null;
  return mapAccess(result.recordset[0]);
}

export async function listEmployeeActiveBranchAssignments(
  empId: number,
  at: Date = branchNow(),
): Promise<EmpBranchAssignmentRecord[]> {
  const db = await getPool();
  const day = at.toISOString().slice(0, 10);
  const result = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('day', sql.Date, day)
    .query(`
      SELECT
        ea.ID, ea.EmpID, ea.BranchID, b.BranchCode, b.BranchName,
        ea.IsHomeBranch, ea.CanReceiveBookings, ea.IsActive,
        ea.EffectiveFrom, ea.EffectiveTo
      FROM dbo.TblEmpBranchAssignment ea
      INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
      WHERE ea.EmpID = @empId
        AND ea.IsActive = 1
        AND b.IsActive = 1
        AND ea.EffectiveFrom <= @day
        AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
      ORDER BY ea.IsHomeBranch DESC, b.BranchCode
    `);
  return result.recordset.map((row: Record<string, unknown>) => ({
    id: Number(row.ID),
    empId: Number(row.EmpID),
    branchId: Number(row.BranchID),
    branchCode: String(row.BranchCode),
    branchName: String(row.BranchName),
    isHomeBranch: Boolean(row.IsHomeBranch),
    canReceiveBookings: Boolean(row.CanReceiveBookings),
    isActive: Boolean(row.IsActive),
    effectiveFrom: formatDate(row.EffectiveFrom),
    effectiveTo: row.EffectiveTo == null ? null : formatDate(row.EffectiveTo),
  }));
}

export async function getEmployeeHomeBranch(
  empId: number,
  at: Date = branchNow(),
): Promise<EmpBranchAssignmentRecord | null> {
  const rows = await listEmployeeActiveBranchAssignments(empId, at);
  return rows.find((r) => r.isHomeBranch) ?? null;
}

export async function getUserActiveStatus(userId: number): Promise<{
  exists: boolean;
  isDeleted: boolean;
  userName: string | null;
  userLevel: string | null;
}> {
  const db = await getPool();
  const result = await db
    .request()
    .input('userId', sql.Int, userId)
    .query(`
      SELECT UserID, UserName, UserLevel, ISNULL(isDeleted, 0) AS isDeleted
      FROM dbo.TblUser
      WHERE UserID = @userId
    `);
  const row = result.recordset[0];
  if (!row) return { exists: false, isDeleted: true, userName: null, userLevel: null };
  return {
    exists: true,
    isDeleted: Boolean(row.isDeleted),
    userName: String(row.UserName),
    userLevel: String(row.UserLevel),
  };
}
