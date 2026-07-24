import 'server-only';

import { getPool, sql } from '@/lib/db';
import type { TargetRecalcRequestStatus } from './employee-target-recalc.schemas';

export interface TargetRecalcRequestRow {
  id: number;
  empId: number;
  branchId: number;
  workDate: string;
  status: TargetRecalcRequestStatus;
  requestedVersion: number;
  processedVersion: number;
  attemptCount: number;
  lastReason: string | null;
  sourceType: string | null;
  sourceRef: string | null;
  lastError: string | null;
  requestedAt: string;
  processingAt: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

function toDateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

export function mapRecalcRequest(row: Record<string, unknown>): TargetRecalcRequestRow {
  return {
    id: Number(row.ID),
    empId: Number(row.EmpID),
    branchId: Number(row.BranchID),
    workDate: toDateStr(row.WorkDate),
    status: String(row.Status) as TargetRecalcRequestStatus,
    requestedVersion: Number(row.RequestedVersion),
    processedVersion: Number(row.ProcessedVersion),
    attemptCount: Number(row.AttemptCount),
    lastReason: row.LastReason == null ? null : String(row.LastReason),
    sourceType: row.SourceType == null ? null : String(row.SourceType),
    sourceRef: row.SourceRef == null ? null : String(row.SourceRef),
    lastError: row.LastError == null ? null : String(row.LastError),
    requestedAt: String(row.RequestedAt ?? ''),
    processingAt: row.ProcessingAt == null ? null : String(row.ProcessingAt),
    processedAt: row.ProcessedAt == null ? null : String(row.ProcessedAt),
    createdAt: String(row.CreatedAt ?? ''),
    updatedAt: row.UpdatedAt == null ? null : String(row.UpdatedAt),
  };
}

const SELECT_COLS = `
  ID, EmpID, BranchID, WorkDate, Status, RequestedVersion, ProcessedVersion, AttemptCount,
  LastReason, SourceType, SourceRef, LastError,
  RequestedAt, ProcessingAt, ProcessedAt, CreatedAt, UpdatedAt
`;

export async function enqueueTargetRecalcInTransaction(
  transaction: sql.Transaction,
  params: {
    empId: number;
    branchId: number;
    workDate: string;
    reason: string;
    sourceType: string | null;
    sourceRef: string | null;
  },
): Promise<{ id: number; requestedVersion: number; created: boolean }> {
  if (!Number.isInteger(params.branchId) || params.branchId <= 0) {
    throw new Error('branchId مطلوب لطلب إعادة حساب التارجت (Phase 1L)');
  }

  const locked = await new sql.Request(transaction)
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('workDate', sql.Date, params.workDate)
    .query(`
      SELECT ID, RequestedVersion, ProcessedVersion
      FROM dbo.TblEmpTargetRecalcRequest WITH (UPDLOCK, HOLDLOCK)
      WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
    `);

  const existing = locked.recordset[0] as
    | { ID: number; RequestedVersion: number; ProcessedVersion: number }
    | undefined;

  if (!existing) {
    const inserted = await new sql.Request(transaction)
      .input('empId', sql.Int, params.empId)
      .input('branchId', sql.Int, params.branchId)
      .input('workDate', sql.Date, params.workDate)
      .input('reason', sql.NVarChar(100), params.reason.slice(0, 100))
      .input('sourceType', sql.NVarChar(50), params.sourceType)
      .input('sourceRef', sql.NVarChar(100), params.sourceRef)
      .query(`
        INSERT INTO dbo.TblEmpTargetRecalcRequest (
          EmpID, BranchID, WorkDate, Status, RequestedVersion, ProcessedVersion, AttemptCount,
          LastReason, SourceType, SourceRef, LastError, RequestedAt, CreatedAt
        )
        OUTPUT INSERTED.ID, INSERTED.RequestedVersion
        VALUES (
          @empId, @branchId, @workDate, N'pending', 1, 0, 0,
          @reason, @sourceType, @sourceRef, NULL, SYSDATETIME(), SYSDATETIME()
        )
      `);
    const row = inserted.recordset[0] as { ID: number; RequestedVersion: number };
    return { id: Number(row.ID), requestedVersion: Number(row.RequestedVersion), created: true };
  }

  const updated = await new sql.Request(transaction)
    .input('id', sql.Int, existing.ID)
    .input('reason', sql.NVarChar(100), params.reason.slice(0, 100))
    .input('sourceType', sql.NVarChar(50), params.sourceType)
    .input('sourceRef', sql.NVarChar(100), params.sourceRef)
    .query(`
      UPDATE dbo.TblEmpTargetRecalcRequest
      SET RequestedVersion = RequestedVersion + 1,
          Status = N'pending',
          LastReason = @reason,
          SourceType = @sourceType,
          SourceRef = @sourceRef,
          LastError = NULL,
          RequestedAt = SYSDATETIME(),
          UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.ID, INSERTED.RequestedVersion
      WHERE ID = @id
    `);
  const row = updated.recordset[0] as { ID: number; RequestedVersion: number };
  return { id: Number(row.ID), requestedVersion: Number(row.RequestedVersion), created: false };
}

export async function claimTargetRecalcRequests(params: {
  workDate?: string;
  empIds?: number[] | null;
  requestIds?: number[] | null;
  maxRequests: number;
}): Promise<TargetRecalcRequestRow[]> {
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();
  try {
    const request = new sql.Request(transaction).input('max', sql.Int, params.maxRequests);
    const filters: string[] = [`Status IN (N'pending', N'failed')`];

    if (params.workDate) {
      request.input('workDate', sql.Date, params.workDate);
      filters.push('WorkDate = @workDate');
    }
    if (params.empIds != null && params.empIds.length > 0) {
      const ph = params.empIds.map((_, i) => {
        request.input(`e${i}`, sql.Int, params.empIds![i]);
        return `@e${i}`;
      });
      filters.push(`EmpID IN (${ph.join(',')})`);
    }
    if (params.requestIds != null && params.requestIds.length > 0) {
      const ph = params.requestIds.map((_, i) => {
        request.input(`r${i}`, sql.Int, params.requestIds![i]);
        return `@r${i}`;
      });
      filters.push(`ID IN (${ph.join(',')})`);
    }

    const claimed = await request.query(`
      ;WITH cte AS (
        SELECT TOP (@max) *
        FROM dbo.TblEmpTargetRecalcRequest WITH (UPDLOCK, READPAST, ROWLOCK)
        WHERE ${filters.join(' AND ')}
        ORDER BY RequestedAt ASC, ID ASC
      )
      UPDATE cte
      SET Status = N'processing',
          AttemptCount = AttemptCount + 1,
          ProcessingAt = SYSDATETIME(),
          UpdatedAt = SYSDATETIME(),
          LastError = NULL
      OUTPUT INSERTED.*
    `);

    await transaction.commit();
    return (claimed.recordset as Record<string, unknown>[]).map(mapRecalcRequest);
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function finalizeTargetRecalcSuccess(params: {
  requestId: number;
  processingVersion: number;
}): Promise<'completed' | 'pending_newer'> {
  const db = await getPool();
  const result = await db
    .request()
    .input('id', sql.Int, params.requestId)
    .input('ver', sql.Int, params.processingVersion)
    .query(`
      UPDATE dbo.TblEmpTargetRecalcRequest
      SET ProcessedVersion = @ver,
          Status = CASE
            WHEN RequestedVersion = @ver THEN N'completed'
            ELSE N'pending'
          END,
          ProcessedAt = CASE
            WHEN RequestedVersion = @ver THEN SYSDATETIME()
            ELSE ProcessedAt
          END,
          LastError = NULL,
          UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.Status
      WHERE ID = @id
    `);
  const status = String((result.recordset[0] as { Status: string } | undefined)?.Status ?? '');
  return status === 'completed' ? 'completed' : 'pending_newer';
}

export async function finalizeTargetRecalcFailure(params: {
  requestId: number;
  errorSafe: string;
}): Promise<void> {
  const db = await getPool();
  await db
    .request()
    .input('id', sql.Int, params.requestId)
    .input('err', sql.NVarChar(1000), params.errorSafe.slice(0, 1000))
    .query(`
      UPDATE dbo.TblEmpTargetRecalcRequest
      SET Status = N'failed',
          LastError = @err,
          UpdatedAt = SYSDATETIME()
      WHERE ID = @id
    `);
}

export async function listTargetRecalcRequests(params: {
  workDate?: string;
  empId?: number | null;
  status?: TargetRecalcRequestStatus | null;
  limit: number;
}): Promise<TargetRecalcRequestRow[]> {
  const db = await getPool();
  const request = db.request().input('limit', sql.Int, params.limit);
  const filters: string[] = ['1=1'];
  if (params.workDate) {
    request.input('workDate', sql.Date, params.workDate);
    filters.push('WorkDate = @workDate');
  }
  if (params.empId != null) {
    request.input('empId', sql.Int, params.empId);
    filters.push('EmpID = @empId');
  }
  if (params.status) {
    request.input('status', sql.NVarChar(20), params.status);
    filters.push('Status = @status');
  }
  const result = await request.query(`
    SELECT TOP (@limit) ${SELECT_COLS}
    FROM dbo.TblEmpTargetRecalcRequest
    WHERE ${filters.join(' AND ')}
    ORDER BY RequestedAt DESC, ID DESC
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapRecalcRequest);
}

export async function listTargetRecalcRequestsForDate(
  workDate: string,
  empIds?: number[] | null,
): Promise<TargetRecalcRequestRow[]> {
  const db = await getPool();
  const request = db.request().input('workDate', sql.Date, workDate);
  let empFilter = '';
  if (empIds != null && empIds.length > 0) {
    const ph = empIds.map((_, i) => {
      request.input(`e${i}`, sql.Int, empIds[i]);
      return `@e${i}`;
    });
    empFilter = ` AND EmpID IN (${ph.join(',')})`;
  }
  const result = await request.query(`
    SELECT ${SELECT_COLS}
    FROM dbo.TblEmpTargetRecalcRequest
    WHERE WorkDate = @workDate ${empFilter}
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapRecalcRequest);
}
