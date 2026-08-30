import 'server-only';
import { getPool, sql } from '@/lib/db';
import type {
  BookingManagementOperation,
  BookingManagementPlanSnapshot,
  BookingManagementStage,
  DesiredBookingChanges,
  UpcomingBookingSummary,
} from './types';
import { BOOKING_MANAGEMENT_OPERATIONS, BOOKING_MANAGEMENT_STAGES } from './types';

function isStage(v: unknown): v is BookingManagementStage {
  return typeof v === 'string' && (BOOKING_MANAGEMENT_STAGES as readonly string[]).includes(v);
}

function isOp(v: unknown): v is BookingManagementOperation {
  return typeof v === 'string' && (BOOKING_MANAGEMENT_OPERATIONS as readonly string[]).includes(v);
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: Record<string, unknown>): BookingManagementPlanSnapshot {
  const stage = isStage(row.Stage) ? row.Stage : 'RESOLVING_BOOKING';
  const operation = isOp(row.Operation) ? row.Operation : 'CANCEL';
  return {
    planId: Number(row.PlanID),
    conversationId: Number(row.ConversationID),
    version: Number(row.Version) || 1,
    operation,
    stage,
    targetBookingId: row.TargetBookingID != null ? Number(row.TargetBookingID) : null,
    targetBookingCode: row.TargetBookingCode != null ? String(row.TargetBookingCode) : null,
    originalSnapshot: parseJson<UpcomingBookingSummary | null>(row.OriginalSnapshotJson, null),
    desiredChanges: parseJson<DesiredBookingChanges>(row.DesiredChangesJson, {}),
    validatedDesiredState: parseJson<Record<string, unknown> | null>(
      row.ValidatedDesiredStateJson,
      null,
    ),
    candidateAlternatives: parseJson<unknown[]>(row.CandidateAlternativesJson, []),
    confirmationVersion: Number(row.ConfirmationVersion) || 1,
    idempotencyKey: row.IdempotencyKey != null ? String(row.IdempotencyKey) : null,
    lastTurnId: row.LastTurnID != null ? Number(row.LastTurnID) : null,
  };
}

const ACTIVE_STAGES = BOOKING_MANAGEMENT_STAGES.filter(
  (s) => s !== 'COMPLETED' && s !== 'FAILED' && s !== 'ABANDONED',
);

export async function getActiveManagementPlan(
  conversationId: number,
): Promise<BookingManagementPlanSnapshot | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('cid', sql.BigInt, conversationId)
    .query(`
      SELECT TOP 1 *
      FROM dbo.TblBotBookingManagementPlan
      WHERE ConversationID = @cid
        AND CompletedAt IS NULL
        AND Stage NOT IN (N'COMPLETED', N'FAILED', N'ABANDONED')
      ORDER BY PlanID DESC
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export async function upsertManagementPlan(input: {
  conversationId: number;
  operation: BookingManagementOperation;
  stage: BookingManagementStage;
  version?: number;
  confirmationVersion?: number;
  targetBookingId?: number | null;
  targetBookingCode?: string | null;
  originalSnapshot?: UpcomingBookingSummary | null;
  desiredChanges?: DesiredBookingChanges;
  validatedDesiredState?: Record<string, unknown> | null;
  candidateAlternatives?: unknown[];
  idempotencyKey?: string | null;
  lastTurnId?: number | null;
  planId?: number | null;
}): Promise<BookingManagementPlanSnapshot> {
  const pool = await getPool();
  const existing =
    input.planId != null
      ? null
      : await getActiveManagementPlan(input.conversationId);

  if (existing || input.planId != null) {
    const planId = input.planId ?? existing!.planId;
    const version = (input.version ?? existing?.version ?? 1) + (input.planId ? 0 : 1);
    await pool
      .request()
      .input('planId', sql.BigInt, planId)
      .input('op', sql.NVarChar(20), input.operation)
      .input('stage', sql.NVarChar(40), input.stage)
      .input('version', sql.Int, version)
      .input('conf', sql.Int, input.confirmationVersion ?? existing?.confirmationVersion ?? 1)
      .input('tid', sql.Int, input.targetBookingId ?? null)
      .input('tcode', sql.NVarChar(40), input.targetBookingCode ?? null)
      .input('orig', sql.NVarChar(sql.MAX), JSON.stringify(input.originalSnapshot ?? null))
      .input('desired', sql.NVarChar(sql.MAX), JSON.stringify(input.desiredChanges ?? {}))
      .input(
        'validated',
        sql.NVarChar(sql.MAX),
        JSON.stringify(input.validatedDesiredState ?? null),
      )
      .input(
        'alts',
        sql.NVarChar(sql.MAX),
        JSON.stringify(input.candidateAlternatives ?? []),
      )
      .input('idem', sql.NVarChar(200), input.idempotencyKey ?? null)
      .input('turnId', sql.BigInt, input.lastTurnId ?? null)
      .query(`
        UPDATE dbo.TblBotBookingManagementPlan
        SET Operation = @op,
            Stage = @stage,
            Version = @version,
            ConfirmationVersion = @conf,
            TargetBookingID = @tid,
            TargetBookingCode = @tcode,
            OriginalSnapshotJson = @orig,
            DesiredChangesJson = @desired,
            ValidatedDesiredStateJson = @validated,
            CandidateAlternativesJson = @alts,
            IdempotencyKey = @idem,
            LastTurnID = @turnId,
            UpdatedAt = SYSUTCDATETIME(),
            CompletedAt = CASE WHEN @stage IN (N'COMPLETED', N'FAILED', N'ABANDONED')
              THEN SYSUTCDATETIME() ELSE NULL END
        WHERE PlanID = @planId
      `);
    const again = await getActiveManagementPlan(input.conversationId);
    if (again) return again;
    const pool2 = await getPool();
    const loaded = await pool2
      .request()
      .input('planId', sql.BigInt, planId)
      .query(`SELECT TOP 1 * FROM dbo.TblBotBookingManagementPlan WHERE PlanID = @planId`);
    return mapRow(loaded.recordset[0] as Record<string, unknown>);
  }

  const inserted = await pool
    .request()
    .input('cid', sql.BigInt, input.conversationId)
    .input('op', sql.NVarChar(20), input.operation)
    .input('stage', sql.NVarChar(40), input.stage)
    .input('conf', sql.Int, input.confirmationVersion ?? 1)
    .input('tid', sql.Int, input.targetBookingId ?? null)
    .input('tcode', sql.NVarChar(40), input.targetBookingCode ?? null)
    .input('orig', sql.NVarChar(sql.MAX), JSON.stringify(input.originalSnapshot ?? null))
    .input('desired', sql.NVarChar(sql.MAX), JSON.stringify(input.desiredChanges ?? {}))
    .input('turnId', sql.BigInt, input.lastTurnId ?? null)
    .query(`
      INSERT INTO dbo.TblBotBookingManagementPlan
        (ConversationID, Operation, Stage, ConfirmationVersion, TargetBookingID, TargetBookingCode,
         OriginalSnapshotJson, DesiredChangesJson, LastTurnID)
      OUTPUT INSERTED.*
      VALUES (@cid, @op, @stage, @conf, @tid, @tcode, @orig, @desired, @turnId)
    `);
  return mapRow(inserted.recordset[0] as Record<string, unknown>);
}

export async function abandonManagementPlan(conversationId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('cid', sql.BigInt, conversationId)
    .query(`
      UPDATE dbo.TblBotBookingManagementPlan
      SET Stage = N'ABANDONED', CompletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
      WHERE ConversationID = @cid
        AND CompletedAt IS NULL
        AND Stage NOT IN (N'COMPLETED', N'FAILED', N'ABANDONED')
    `);
}

void ACTIVE_STAGES;
