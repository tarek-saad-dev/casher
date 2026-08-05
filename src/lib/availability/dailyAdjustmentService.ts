/**
 * Phase 3A / 3B.1 — Daily adjustment persistence (admin/ops).
 */

import { getPool, sql } from '@/lib/db';
import {
  type CancelDailyAdjustmentInput,
  type CreateDailyAdjustmentInput,
  type EmployeeDailyAdjustment,
  type EmployeeDailyAdjustmentHistoryItem,
  type ListDailyAdjustmentsInput,
  materializeAdjustmentWindow,
  validateCreateDailyAdjustmentInput,
  type DailyAdjustmentErrorCode,
  type DailyAdjustmentSource,
  type DailyAdjustmentType,
} from '@/lib/availability/dailyAdjustments';
import { ensureDailyAdjustmentTables } from '@/lib/availability/ensureDailyAdjustmentTables';
import { loadDailyAdjustmentsBatch } from '@/lib/availability/loadDailyAdjustmentsBatch';
import { isEmployeeEligibleForBranchBookings } from '@/lib/branch/bookingQueueOwnership';
import { invalidateEmployeeScheduleCaches } from '@/lib/hr/scheduleAvailabilityInvalidation';

export class DailyAdjustmentServiceError extends Error {
  code: DailyAdjustmentErrorCode;
  status: number;

  constructor(code: DailyAdjustmentErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'DailyAdjustmentServiceError';
    this.code = code;
    this.status = status;
  }
}

/** Active-only list (backward compatible). Prefer listDailyAdjustmentHistory for status filters. */
export async function listDailyAdjustments(
  input: ListDailyAdjustmentsInput,
): Promise<EmployeeDailyAdjustment[]> {
  const status = input.status ?? 'active';
  if (status === 'active') {
    await ensureDailyAdjustmentTables();
    const map = await loadDailyAdjustmentsBatch({
      branchId: input.branchId,
      empIds: input.empId != null ? [input.empId] : await listEmpIdsWithAdjustments(input, true),
      businessDate: input.businessDate,
    });
    if (input.empId != null) return map.get(input.empId) ?? [];
    const all: EmployeeDailyAdjustment[] = [];
    for (const list of map.values()) all.push(...list);
    all.sort((a, b) => {
      if (a.employeeId !== b.employeeId) return a.employeeId - b.employeeId;
      return a.adjustmentId - b.adjustmentId;
    });
    return all;
  }

  const history = await listDailyAdjustmentHistory(input);
  return history.map((h) => ({
    adjustmentId: h.adjustmentId,
    branchId: h.branchId,
    employeeId: h.employeeId,
    businessDate: h.businessDate,
    adjustmentType: h.adjustmentType,
    reasonCode: h.reasonCode,
    reasonText: h.reasonText,
    source: h.source,
    windows: h.windows,
    createdBy: h.createdBy,
    createdAt: h.createdAt,
    version: h.version,
  }));
}

async function listEmpIdsWithAdjustments(
  input: ListDailyAdjustmentsInput,
  activeOnly: boolean,
): Promise<number[]> {
  const db = await getPool();
  try {
    const activeClause = activeOnly
      ? 'AND IsActive = 1 AND CancelledAt IS NULL'
      : '';
    const res = await db
      .request()
      .input('branchId', sql.Int, input.branchId)
      .input('businessDate', sql.Date, input.businessDate)
      .query(`
        SELECT DISTINCT EmpID
        FROM dbo.TblEmpDailyAdjustment
        WHERE BranchID = @branchId
          AND BusinessDate = @businessDate
          ${activeClause}
      `);
    return res.recordset.map((r: { EmpID: number }) => Number(r.EmpID)).filter((id) => id > 0);
  } catch {
    return [];
  }
}

function sqlTimeToHhmm(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const h = String(val.getUTCHours()).padStart(2, '0');
    const m = String(val.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  if (typeof val === 'string') {
    const m = val.trim().match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  return null;
}

/**
 * History list with optional cancelled rows + creator/canceller names (batched).
 * Always branch-scoped. Does not feed the resolver.
 */
export async function listDailyAdjustmentHistory(
  input: ListDailyAdjustmentsInput,
): Promise<EmployeeDailyAdjustmentHistoryItem[]> {
  await ensureDailyAdjustmentTables();
  const status = input.status ?? 'active';
  const db = await getPool();

  let statusSql = 'AND a.IsActive = 1 AND a.CancelledAt IS NULL';
  if (status === 'cancelled') {
    statusSql = 'AND (a.IsActive = 0 OR a.CancelledAt IS NOT NULL)';
  } else if (status === 'all') {
    statusSql = '';
  }

  const empClause =
    input.empId != null && Number.isInteger(input.empId) && input.empId > 0
      ? 'AND a.EmpID = @empId'
      : '';

  const req = db
    .request()
    .input('branchId', sql.Int, input.branchId)
    .input('businessDate', sql.Date, input.businessDate);
  if (empClause) req.input('empId', sql.Int, input.empId);

  const headerRes = await req.query(`
    SELECT
      a.AdjustmentID, a.BranchID, a.EmpID,
      CONVERT(VARCHAR(10), a.BusinessDate, 120) AS BusinessDate,
      a.AdjustmentType, a.ReasonCode, a.ReasonText, a.Source,
      a.CreatedBy, a.CancelledBy, a.IsActive, a.Version,
      CONVERT(VARCHAR(33), a.CreatedAt, 127) AS CreatedAt,
      CASE WHEN a.CancelledAt IS NULL THEN NULL
           ELSE CONVERT(VARCHAR(33), a.CancelledAt, 127) END AS CancelledAt
    FROM dbo.TblEmpDailyAdjustment a
    WHERE a.BranchID = @branchId
      AND a.BusinessDate = @businessDate
      ${empClause}
      ${statusSql}
    ORDER BY a.CreatedAt ASC, a.AdjustmentID ASC
  `);

  const headers = headerRes.recordset as Array<Record<string, unknown>>;
  if (!headers.length) return [];

  const adjIds = headers.map((h) => Number(h.AdjustmentID)).filter((id) => id > 0);
  const userIds = new Set<number>();
  for (const h of headers) {
    if (h.CreatedBy != null) userIds.add(Number(h.CreatedBy));
    if (h.CancelledBy != null) userIds.add(Number(h.CancelledBy));
  }

  const windowsByAdj = new Map<number, EmployeeDailyAdjustmentHistoryItem['windows']>();
  if (adjIds.length) {
    const winRes = await db.request().query(`
      SELECT AdjustmentWindowID, AdjustmentID, StartTime, EndTime, EndDayOffset, SortOrder
      FROM dbo.TblEmpDailyAdjustmentWindow
      WHERE AdjustmentID IN (${adjIds.join(',')})
      ORDER BY AdjustmentID, SortOrder ASC, AdjustmentWindowID ASC
    `);
    for (const row of winRes.recordset as Array<Record<string, unknown>>) {
      const adjId = Number(row.AdjustmentID);
      const start = sqlTimeToHhmm(row.StartTime);
      const end = sqlTimeToHhmm(row.EndTime);
      if (!start || !end) continue;
      const endDayOffset = Number(row.EndDayOffset) === 1 ? 1 : 0;
      const mat = materializeAdjustmentWindow(input.businessDate, {
        start,
        end,
        endDayOffset: endDayOffset as 0 | 1,
      });
      if (!mat) continue;
      const list = windowsByAdj.get(adjId) ?? [];
      list.push(mat);
      windowsByAdj.set(adjId, list);
    }
  }

  const nameByUserId = new Map<number, string>();
  if (userIds.size) {
    const idList = [...userIds].join(',');
    try {
      const users = await db.request().query(`
        SELECT UserID, UserName, loginName
        FROM dbo.TblUser
        WHERE UserID IN (${idList})
      `);
      for (const u of users.recordset as Array<Record<string, unknown>>) {
        const id = Number(u.UserID);
        const name = String(u.UserName || u.loginName || id);
        nameByUserId.set(id, name);
      }
    } catch {
      /* optional */
    }
  }

  return headers.map((h) => {
    const adjustmentId = Number(h.AdjustmentID);
    const createdBy = h.CreatedBy != null ? Number(h.CreatedBy) : null;
    const cancelledBy = h.CancelledBy != null ? Number(h.CancelledBy) : null;
    const isActive = Boolean(h.IsActive) && h.CancelledAt == null;
    return {
      adjustmentId,
      branchId: Number(h.BranchID),
      employeeId: Number(h.EmpID),
      businessDate: String(h.BusinessDate).slice(0, 10),
      adjustmentType: String(h.AdjustmentType) as DailyAdjustmentType,
      reasonCode: (h.ReasonCode as string) ?? null,
      reasonText: (h.ReasonText as string) ?? null,
      source: String(h.Source) as DailyAdjustmentSource,
      windows: windowsByAdj.get(adjustmentId) ?? [],
      createdBy,
      createdByName: createdBy != null ? nameByUserId.get(createdBy) ?? null : null,
      createdAt: String(h.CreatedAt),
      version: Number(h.Version) || 1,
      isActive,
      cancelledBy,
      cancelledByName: cancelledBy != null ? nameByUserId.get(cancelledBy) ?? null : null,
      cancelledAt: h.CancelledAt != null ? String(h.CancelledAt) : null,
    };
  });
}


export async function createDailyAdjustment(
  input: CreateDailyAdjustmentInput,
): Promise<EmployeeDailyAdjustment> {
  const validated = validateCreateDailyAdjustmentInput(input);
  if (!validated.ok) {
    throw new DailyAdjustmentServiceError(validated.code, validated.message);
  }

  const eligible = await isEmployeeEligibleForBranchBookings({
    empId: input.empId,
    branchId: input.branchId,
    operationalDate: input.businessDate,
    requireCanReceiveBookings: false,
    includeTemporaryTransfer: true,
  });
  if (!eligible) {
    throw new DailyAdjustmentServiceError(
      'EMPLOYEE_NOT_ASSIGNED',
      'الموظف غير معيَّن على هذا الفرع',
      400,
    );
  }

  await ensureDailyAdjustmentTables();
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();

  try {
    const source = input.source ?? 'admin';
    const ins = await transaction
      .request()
      .input('branchId', sql.Int, input.branchId)
      .input('empId', sql.Int, input.empId)
      .input('businessDate', sql.Date, input.businessDate)
      .input('adjustmentType', sql.VarChar(32), input.adjustmentType)
      .input('reasonCode', sql.VarChar(64), input.reasonCode ?? null)
      .input('reasonText', sql.NVarChar(500), input.reasonText ?? null)
      .input('source', sql.VarChar(32), source)
      .input('createdBy', sql.Int, input.createdBy)
      .query(`
        INSERT INTO dbo.TblEmpDailyAdjustment (
          BranchID, EmpID, BusinessDate, AdjustmentType,
          ReasonCode, ReasonText, Source, IsActive, CreatedBy, CreatedAt, Version
        )
        OUTPUT INSERTED.AdjustmentID, CONVERT(VARCHAR(33), INSERTED.CreatedAt, 127) AS CreatedAt
        VALUES (
          @branchId, @empId, @businessDate, @adjustmentType,
          @reasonCode, @reasonText, @source, 1, @createdBy, SYSUTCDATETIME(), 1
        )
      `);

    const adjustmentId = Number(ins.recordset[0]?.AdjustmentID);
    const createdAt = String(ins.recordset[0]?.CreatedAt ?? new Date().toISOString());
    if (!adjustmentId) {
      throw new DailyAdjustmentServiceError('DAILY_ADJUSTMENT_CONFLICT', 'فشل إنشاء التعديل', 500);
    }

    const windows = input.windows ?? [];
    let sortOrder = 0;
    for (const w of windows) {
      const mat = materializeAdjustmentWindow(input.businessDate, w);
      if (!mat) {
        throw new DailyAdjustmentServiceError('INVALID_WINDOW', 'نافذة زمنية غير صالحة');
      }
      await transaction
        .request()
        .input('adjustmentId', sql.BigInt, adjustmentId)
        .input('startTime', sql.VarChar(8), `${mat.start}:00`)
        .input('endTime', sql.VarChar(8), `${mat.end}:00`)
        .input('endDayOffset', sql.TinyInt, mat.endDayOffset)
        .input('sortOrder', sql.Int, sortOrder++)
        .query(`
          INSERT INTO dbo.TblEmpDailyAdjustmentWindow (
            AdjustmentID, StartTime, EndTime, EndDayOffset, SortOrder
          )
          VALUES (
            @adjustmentId,
            CAST(@startTime AS TIME),
            CAST(@endTime AS TIME),
            @endDayOffset,
            @sortOrder
          )
        `);
    }

    await transaction.commit();

    invalidateEmployeeScheduleCaches({
      empId: input.empId,
      workDate: input.businessDate,
      branchIds: [input.branchId],
    });

    return {
      adjustmentId,
      branchId: input.branchId,
      employeeId: input.empId,
      businessDate: input.businessDate,
      adjustmentType: input.adjustmentType,
      reasonCode: input.reasonCode ?? null,
      reasonText: input.reasonText ?? null,
      source,
      windows: windows
        .map((w) => materializeAdjustmentWindow(input.businessDate, w))
        .filter((w): w is NonNullable<typeof w> => !!w),
      createdBy: input.createdBy,
      createdAt,
      version: 1,
    };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    if (err instanceof DailyAdjustmentServiceError) throw err;
    throw err;
  }
}

export async function cancelDailyAdjustment(
  input: CancelDailyAdjustmentInput,
): Promise<{ adjustmentId: number; cancelled: true }> {
  await ensureDailyAdjustmentTables();
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();

  try {
    const existing = await transaction
      .request()
      .input('id', sql.BigInt, input.adjustmentId)
      .input('branchId', sql.Int, input.branchId)
      .query(`
        SELECT TOP 1 AdjustmentID, EmpID,
          CONVERT(VARCHAR(10), BusinessDate, 120) AS BusinessDate,
          IsActive, CancelledAt
        FROM dbo.TblEmpDailyAdjustment
        WHERE AdjustmentID = @id AND BranchID = @branchId
      `);

    const row = existing.recordset[0];
    if (!row) {
      throw new DailyAdjustmentServiceError('ADJUSTMENT_NOT_FOUND', 'التعديل غير موجود', 404);
    }
    if (!row.IsActive || row.CancelledAt != null) {
      throw new DailyAdjustmentServiceError(
        'ADJUSTMENT_ALREADY_CANCELLED',
        'التعديل ملغى مسبقاً',
        409,
      );
    }

    await transaction
      .request()
      .input('id', sql.BigInt, input.adjustmentId)
      .input('cancelledBy', sql.Int, input.cancelledBy)
      .query(`
        UPDATE dbo.TblEmpDailyAdjustment
        SET IsActive = 0,
            CancelledBy = @cancelledBy,
            CancelledAt = SYSUTCDATETIME(),
            UpdatedBy = @cancelledBy,
            UpdatedAt = SYSUTCDATETIME(),
            Version = Version + 1
        WHERE AdjustmentID = @id
      `);

    await transaction.commit();

    const workDate = String(row.BusinessDate).slice(0, 10);
    invalidateEmployeeScheduleCaches({
      empId: Number(row.EmpID),
      workDate,
      branchIds: [input.branchId],
    });

    return { adjustmentId: input.adjustmentId, cancelled: true };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}
