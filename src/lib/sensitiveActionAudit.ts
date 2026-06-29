/**
 * Sensitive Action Audit Engine
 *
 * `executeAuditedAction` is the single entry point for every sensitive operation.
 * Pattern: Execute once -> Audit once -> Return once.
 *
 * 1. Validates the action metadata and required reason.
 * 2. Loads the user role snapshot.
 * 3. Starts a SQL transaction for multi-record / financial actions.
 * 4. Loads old data directly from the database.
 * 5. Executes the operation exactly once through the provided callback.
 * 6. Loads new data (post-execution snapshot).
 * 7. Calculates changed fields.
 * 8. Inserts a sanitized audit record inside the same transaction.
 * 9. Commits.
 * 10. If anything fails, rolls back and writes a failed audit record separately.
 */

import { getPool, sql } from '@/lib/db';
import { getUserAccess } from '@/lib/permissions-server';
import type { SessionUser } from '@/lib/session-types';
import { getSensitiveAction, type SensitiveRiskLevel } from '@/lib/sensitiveActionRegistry';
import { calculateChangedFields } from '@/lib/sensitiveActionDiff';
import { sanitizeForAudit } from '@/lib/sensitiveActionSanitize';
import { randomUUID } from 'crypto';

export type AuditExecutionStatus = 'success' | 'failed';

const SQL_LEAK_PATTERNS = [
  /connection/i,
  /timeout/i,
  /ECONNREFUSED/i,
  /TCP Provider/i,
  /Login failed/i,
  /invalid object name/i,
  /column name/i,
  /Request failed/i,
  /mssql/i,
  /unclosed quotation/i,
  /incorrect syntax/i,
];

function sanitizePublicError(error: unknown): string {
  if (error instanceof Error && error.message) {
    const msg = error.message;
    if (SQL_LEAK_PATTERNS.some((p) => p.test(msg))) {
      return 'حدث خطأ تقني أثناء تنفيذ العملية. يرجى المحاولة لاحقاً أو التواصل مع الدعم.';
    }
    return msg;
  }
  return 'حدث خطأ غير متوقع';
}

export interface AuditedActionResult<T = unknown> {
  success: true;
  auditId: number;
  data: T;
}

export interface AuditExecutionOptions<T = unknown> {
  actionType: string;
  user: SessionUser;
  entityType?: string;
  entityId?: string | number | null;
  request?: Request;
  reason?: string | null;
  requestId?: string;
  actionMethod?: string;
  endpointPath?: string;
  loadOldData?: (transaction: sql.Transaction) => Promise<Record<string, unknown> | null>;
  execute: (transaction: sql.Transaction) => Promise<T>;
  loadNewData?: (transaction: sql.Transaction, result: T) => Promise<Record<string, unknown> | null>;
}

interface AuditRecord {
  actionType: string;
  actionLabel: string;
  entityType: string;
  entityId: string | null;
  performedByUserId: number;
  performedByUserName: string;
  userRolesSnapshot: string;
  actionMethod: string | null;
  endpointPath: string | null;
  oldData: string | null;
  newData: string | null;
  changedFields: string | null;
  reason: string | null;
  riskLevel: SensitiveRiskLevel;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  executionStatus: AuditExecutionStatus;
  errorMessage: string | null;
}

async function loadUserRolesSnapshot(user: SessionUser): Promise<string> {
  try {
    const access = await getUserAccess(user.UserID, user.UserName, user.UserLevel);
    return JSON.stringify(access.roles);
  } catch {
    return '[]';
  }
}

function requestMeta(request?: Request): { ipAddress: string | null; userAgent: string | null } {
  if (!request) return { ipAddress: null, userAgent: null };
  const headers = request.headers;
  const forwarded = headers.get('x-forwarded-for');
  const realIp = headers.get('x-real-ip');
  return {
    ipAddress: forwarded || realIp || null,
    userAgent: headers.get('user-agent') || null,
  };
}

function safeSerialize(value: unknown, sensitiveFields: string[]): string | null {
  if (value === null || value === undefined) return null;
  const sanitized = sanitizeForAudit(value, sensitiveFields);
  return sanitized === null ? null : JSON.stringify(sanitized);
}

async function insertAuditRecord(
  connection: sql.Transaction | sql.ConnectionPool,
  record: AuditRecord,
): Promise<number> {
  const req =
    connection instanceof sql.Transaction
      ? new sql.Request(connection)
      : new sql.Request(connection);
  req.input('actionType', sql.NVarChar(100), record.actionType);
  req.input('actionLabel', sql.NVarChar(200), record.actionLabel);
  req.input('entityType', sql.NVarChar(100), record.entityType);
  req.input('entityId', sql.NVarChar(200), record.entityId);
  req.input('performedByUserId', sql.Int, record.performedByUserId);
  req.input('performedByUserName', sql.NVarChar(100), record.performedByUserName);
  req.input('userRolesSnapshot', sql.NVarChar(sql.MAX), record.userRolesSnapshot);
  req.input('actionMethod', sql.NVarChar(20), record.actionMethod);
  req.input('endpointPath', sql.NVarChar(300), record.endpointPath);
  req.input('oldData', sql.NVarChar(sql.MAX), record.oldData);
  req.input('newData', sql.NVarChar(sql.MAX), record.newData);
  req.input('changedFields', sql.NVarChar(sql.MAX), record.changedFields);
  req.input('reason', sql.NVarChar(500), record.reason);
  req.input('riskLevel', sql.NVarChar(30), record.riskLevel);
  req.input('requestId', sql.NVarChar(100), record.requestId);
  req.input('ipAddress', sql.NVarChar(100), record.ipAddress);
  req.input('userAgent', sql.NVarChar(500), record.userAgent);
  req.input('executionStatus', sql.NVarChar(30), record.executionStatus);
  req.input('errorMessage', sql.NVarChar(sql.MAX), record.errorMessage);

  const result = await req.query(`
    INSERT INTO dbo.TblSensitiveActionAuditLog
      (ActionType, ActionLabel, EntityType, EntityID,
       PerformedByUserID, PerformedByUserName, UserRolesSnapshot,
       ActionMethod, EndpointPath, OldData, NewData, ChangedFields,
       Reason, RiskLevel, RequestID, IPAddress, UserAgent,
       ExecutionStatus, ErrorMessage)
    OUTPUT INSERTED.AuditID
    VALUES
      (@actionType, @actionLabel, @entityType, @entityId,
       @performedByUserId, @performedByUserName, @userRolesSnapshot,
       @actionMethod, @endpointPath, @oldData, @newData, @changedFields,
       @reason, @riskLevel, @requestId, @ipAddress, @userAgent,
       @executionStatus, @errorMessage)
  `);

  return result.recordset[0].AuditID as number;
}

async function recordFailedAudit(
  options: AuditExecutionOptions<unknown>,
  error: unknown,
  entityId: string | null,
  userRolesSnapshot: string,
): Promise<number> {
  const meta = requestMeta(options.request);
  const metaData = getSensitiveAction(options.actionType);
  const safeError = error instanceof Error ? error.message : String(error);

  const record: AuditRecord = {
    actionType: metaData.actionType,
    actionLabel: metaData.label,
    entityType: options.entityType || metaData.entityType,
    entityId,
    performedByUserId: options.user.UserID,
    performedByUserName: options.user.UserName,
    userRolesSnapshot,
    actionMethod: options.actionMethod || null,
    endpointPath: options.endpointPath || null,
    oldData: null,
    newData: null,
    changedFields: null,
    reason: options.reason || null,
    riskLevel: metaData.riskLevel,
    requestId: options.requestId || null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    executionStatus: 'failed',
    errorMessage: safeError,
  };

  const db = await getPool();
  return insertAuditRecord(db, record);
}

function auditOptionsToUnknown<T>(options: AuditExecutionOptions<T>): AuditExecutionOptions<unknown> {
  return options as unknown as AuditExecutionOptions<unknown>;
}

function normalizeEntityId(entityId: string | number | null | undefined): string | null {
  if (entityId === null || entityId === undefined) return null;
  return String(entityId);
}

export async function executeAuditedAction<T>(options: AuditExecutionOptions<T>): Promise<AuditedActionResult<T>> {
  const metaData = getSensitiveAction(options.actionType);

  if (metaData.requiresReason && (!options.reason || options.reason.trim().length === 0)) {
    throw new Error(`العملية "${metaData.label}" تتطلب سبباً`);
  }

  const entityId = normalizeEntityId(options.entityId);
  const userRolesSnapshot = await loadUserRolesSnapshot(options.user);
  const meta = requestMeta(options.request);
  const requestId = options.requestId || randomUUID();

  const db = await getPool();
  const transaction = new sql.Transaction(db);
  let transactionStarted = false;
  let transactionCompleted = false;

  console.info(`[executeAuditedAction:${requestId}]`, { step: 'transaction-begin:start' });
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  transactionStarted = true;
  console.info(`[executeAuditedAction:${requestId}]`, { step: 'transaction-begin:complete' });

  try {
    // 1. Load old data
    let oldData: Record<string, unknown> | null = null;
    if (options.loadOldData) {
      console.info(`[executeAuditedAction:${requestId}]`, { step: 'load-old-data:start' });
      oldData = await options.loadOldData(transaction);
      console.info(`[executeAuditedAction:${requestId}]`, { step: 'load-old-data:complete' });
    }

    // 2. Execute the operation exactly once
    console.info(`[executeAuditedAction:${requestId}]`, { step: 'execute:start' });
    const result = await options.execute(transaction);
    console.info(`[executeAuditedAction:${requestId}]`, { step: 'execute:complete' });

    // 3. Load new data
    let newData: Record<string, unknown> | null = null;
    if (options.loadNewData) {
      console.info(`[executeAuditedAction:${requestId}]`, { step: 'load-new-data:start' });
      newData = await options.loadNewData(transaction, result);
      console.info(`[executeAuditedAction:${requestId}]`, { step: 'load-new-data:complete' });
    }

    // 4. Calculate changed fields
    const changedFields = calculateChangedFields(oldData, newData);

    // 5. Build audit record
    const record: AuditRecord = {
      actionType: metaData.actionType,
      actionLabel: metaData.label,
      entityType: options.entityType || metaData.entityType,
      entityId,
      performedByUserId: options.user.UserID,
      performedByUserName: options.user.UserName,
      userRolesSnapshot,
      actionMethod: options.actionMethod || null,
      endpointPath: options.endpointPath || null,
      oldData: safeSerialize(oldData, metaData.sensitiveFields),
      newData: safeSerialize(newData, metaData.sensitiveFields),
      changedFields: changedFields ? JSON.stringify(changedFields) : null,
      reason: options.reason || null,
      riskLevel: metaData.riskLevel,
      requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      executionStatus: 'success',
      errorMessage: null,
    };

    // 6. Insert audit record inside the same transaction
    console.info(`[executeAuditedAction:${requestId}]`, { step: 'audit-insert:start' });
    const auditId = await insertAuditRecord(transaction, record);
    console.info(`[executeAuditedAction:${requestId}]`, { step: 'audit-insert:complete', auditId });

    // 7. Commit
    console.info(`[executeAuditedAction:${requestId}]`, { step: 'commit:start' });
    await transaction.commit();
    transactionCompleted = true;
    console.info(`[executeAuditedAction:${requestId}]`, { step: 'commit:complete' });

    return { success: true, auditId, data: result };
  } catch (error) {
    // Roll back business transaction
    if (transactionStarted && !transactionCompleted) {
      console.info(`[executeAuditedAction:${requestId}]`, { step: 'rollback:start' });
      try {
        await transaction.rollback();
        console.info(`[executeAuditedAction:${requestId}]`, { step: 'rollback:complete' });
      } catch (rollbackError) {
        console.error(`[executeAuditedAction:${requestId}] rollback failed`, { rollbackError });
      }
    }

    // Record failed attempt separately after rollback (detailed error is safe for audit log)
    let failedAuditId: number;
    try {
      failedAuditId = await recordFailedAudit(
        auditOptionsToUnknown(options),
        error,
        entityId,
        userRolesSnapshot,
      );
    } catch (auditError) {
      console.error('[executeAuditedAction] failed to write failed audit:', auditError);
      failedAuditId = -1;
    }

    // Log full SQL error details server-side before sanitizing public message
    const rawMessage = error instanceof Error ? error.message : String(error);
    const sqlDetails = (error as any)?.number !== undefined
      ? { number: (error as any).number, state: (error as any).state, class: (error as any).class, lineNumber: (error as any).lineNumber, procName: (error as any).procName }
      : undefined;
    console.error(`[executeAuditedAction] Raw error before sanitization: ${rawMessage}`, sqlDetails);

    const statusCode =
      typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : 500;

    throw new AuditedActionError(
      sanitizePublicError(error),
      failedAuditId,
      statusCode,
    );
  }
}

export class AuditedActionError extends Error {
  failedAuditId: number;
  statusCode: number;

  constructor(message: string, failedAuditId: number, statusCode: number = 500) {
    super(message);
    this.failedAuditId = failedAuditId;
    this.statusCode = statusCode;
  }
}

export function isAuditedActionError(error: unknown): error is AuditedActionError {
  return error instanceof AuditedActionError;
}
