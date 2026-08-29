import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { BookingPlanSnapshot, BookingPlanStage } from './types';
import { BOOKING_PLAN_ACTIVE_STAGES } from './types';
import { mapPlanRow } from './planMappers';

export type UpsertBookingPlanInput = {
  conversationId: number;
  planId?: number | null;
  stage: BookingPlanStage;
  version: number;
  branchId: number | null;
  branchCode: string | null;
  branchName: string | null;
  serviceIds: number[];
  serviceNames: string[];
  empId: number | null;
  employeeName: string | null;
  requestedDate: string | null;
  timePreference: unknown;
  candidateSlots: unknown;
  selectedSlot: unknown;
  clientId: number | null;
  missingFields: string[];
  clarification: unknown;
  lastAvailabilityCheckedAt: string | null;
  lastTurnId: number | null;
  bookingId?: number | null;
  bookingCode?: string | null;
  idempotencyKey?: string | null;
  executionErrorCode?: string | null;
  trace: unknown;
  completedAt?: string | null;
};

function jsonOrNull(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

const ACTIVE_STAGE_SQL = `
  N'collecting', N'clarifying', N'choosing_slot',
  N'ready_to_confirm', N'confirmed_intent', N'executing'
`;

export async function getActiveBookingPlan(
  conversationId: number,
): Promise<BookingPlanSnapshot | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .query(`
      SELECT TOP 1 *
      FROM dbo.TblBotBookingPlan
      WHERE ConversationID = @conversationId
        AND Stage IN (${ACTIVE_STAGE_SQL})
      ORDER BY PlanID DESC
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPlanRow(row) : null;
}

export async function getBookingPlanById(planId: number): Promise<BookingPlanSnapshot | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('planId', sql.BigInt, planId)
    .query(`SELECT TOP 1 * FROM dbo.TblBotBookingPlan WHERE PlanID = @planId`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPlanRow(row) : null;
}

export async function upsertBookingPlan(
  input: UpsertBookingPlanInput,
): Promise<BookingPlanSnapshot> {
  const pool = await getPool();
  const completed =
    input.stage === 'abandoned' || input.stage === 'booked'
      ? input.completedAt ?? new Date().toISOString()
      : input.completedAt ?? null;

  const tracePayload = {
    ...(input.trace && typeof input.trace === 'object' ? (input.trace as object) : {}),
    clarification: input.clarification ?? null,
  };

  if (input.planId != null && input.planId > 0) {
    await pool
      .request()
      .input('planId', sql.BigInt, input.planId)
      .input('stage', sql.NVarChar(40), input.stage)
      .input('version', sql.Int, input.version)
      .input('branchId', sql.Int, input.branchId)
      .input('branchCode', sql.NVarChar(50), input.branchCode)
      .input('branchName', sql.NVarChar(200), input.branchName)
      .input('serviceIdsJson', sql.NVarChar(200), jsonOrNull(input.serviceIds))
      .input('serviceNamesJson', sql.NVarChar(500), jsonOrNull(input.serviceNames))
      .input('empId', sql.Int, input.empId)
      .input('employeeName', sql.NVarChar(200), input.employeeName)
      .input('requestedDate', sql.Date, input.requestedDate)
      .input('timePreferenceJson', sql.NVarChar(300), jsonOrNull(input.timePreference))
      .input('candidateSlotsJson', sql.NVarChar(sql.MAX), jsonOrNull(input.candidateSlots))
      .input('selectedSlotJson', sql.NVarChar(500), jsonOrNull(input.selectedSlot))
      .input('clientId', sql.Int, input.clientId)
      .input('missingFieldsJson', sql.NVarChar(300), jsonOrNull(input.missingFields))
      .input('lastAvailabilityCheckedAt', sql.DateTime2, input.lastAvailabilityCheckedAt)
      .input('lastTurnId', sql.BigInt, input.lastTurnId)
      .input('bookingId', sql.Int, input.bookingId ?? null)
      .input('bookingCode', sql.NVarChar(40), input.bookingCode ?? null)
      .input('idempotencyKey', sql.NVarChar(128), input.idempotencyKey ?? null)
      .input('executionErrorCode', sql.NVarChar(80), input.executionErrorCode ?? null)
      .input('traceJson', sql.NVarChar(sql.MAX), jsonOrNull(tracePayload))
      .input('completedAt', sql.DateTime2, completed)
      .query(`
        UPDATE dbo.TblBotBookingPlan
        SET
          Stage = @stage,
          Version = @version,
          BranchID = @branchId,
          BranchCode = @branchCode,
          BranchName = @branchName,
          ServiceIdsJson = @serviceIdsJson,
          ServiceNamesJson = @serviceNamesJson,
          EmpID = @empId,
          EmployeeName = @employeeName,
          RequestedDate = @requestedDate,
          TimePreferenceJson = @timePreferenceJson,
          CandidateSlotsJson = @candidateSlotsJson,
          SelectedSlotJson = @selectedSlotJson,
          ClientID = @clientId,
          MissingFieldsJson = @missingFieldsJson,
          LastAvailabilityCheckedAt = @lastAvailabilityCheckedAt,
          LastTurnID = @lastTurnId,
          BookingID = @bookingId,
          BookingCode = @bookingCode,
          IdempotencyKey = @idempotencyKey,
          ExecutionErrorCode = @executionErrorCode,
          TraceJson = @traceJson,
          UpdatedAt = SYSUTCDATETIME(),
          CompletedAt = @completedAt
        WHERE PlanID = @planId
      `);
    const updated = await getBookingPlanById(input.planId);
    if (!updated) throw new Error(`Booking plan ${input.planId} missing after update`);
    return updated;
  }

  await pool
    .request()
    .input('conversationId', sql.BigInt, input.conversationId)
    .query(`
      UPDATE dbo.TblBotBookingPlan
      SET Stage = N'abandoned',
          UpdatedAt = SYSUTCDATETIME(),
          CompletedAt = SYSUTCDATETIME()
      WHERE ConversationID = @conversationId
        AND Stage IN (${ACTIVE_STAGE_SQL})
    `);

  const insert = await pool
    .request()
    .input('conversationId', sql.BigInt, input.conversationId)
    .input('stage', sql.NVarChar(40), input.stage)
    .input('version', sql.Int, input.version)
    .input('branchId', sql.Int, input.branchId)
    .input('branchCode', sql.NVarChar(50), input.branchCode)
    .input('branchName', sql.NVarChar(200), input.branchName)
    .input('serviceIdsJson', sql.NVarChar(200), jsonOrNull(input.serviceIds))
    .input('serviceNamesJson', sql.NVarChar(500), jsonOrNull(input.serviceNames))
    .input('empId', sql.Int, input.empId)
    .input('employeeName', sql.NVarChar(200), input.employeeName)
    .input('requestedDate', sql.Date, input.requestedDate)
    .input('timePreferenceJson', sql.NVarChar(300), jsonOrNull(input.timePreference))
    .input('candidateSlotsJson', sql.NVarChar(sql.MAX), jsonOrNull(input.candidateSlots))
    .input('selectedSlotJson', sql.NVarChar(500), jsonOrNull(input.selectedSlot))
    .input('clientId', sql.Int, input.clientId)
    .input('missingFieldsJson', sql.NVarChar(300), jsonOrNull(input.missingFields))
    .input('lastAvailabilityCheckedAt', sql.DateTime2, input.lastAvailabilityCheckedAt)
    .input('lastTurnId', sql.BigInt, input.lastTurnId)
    .input('bookingId', sql.Int, input.bookingId ?? null)
    .input('bookingCode', sql.NVarChar(40), input.bookingCode ?? null)
    .input('idempotencyKey', sql.NVarChar(128), input.idempotencyKey ?? null)
    .input('executionErrorCode', sql.NVarChar(80), input.executionErrorCode ?? null)
    .input('traceJson', sql.NVarChar(sql.MAX), jsonOrNull(tracePayload))
    .query(`
      INSERT INTO dbo.TblBotBookingPlan (
        ConversationID, Stage, Version,
        BranchID, BranchCode, BranchName,
        ServiceIdsJson, ServiceNamesJson,
        EmpID, EmployeeName, RequestedDate, TimePreferenceJson,
        CandidateSlotsJson, SelectedSlotJson, ClientID,
        MissingFieldsJson, LastAvailabilityCheckedAt, LastTurnID,
        BookingID, BookingCode, IdempotencyKey, ExecutionErrorCode,
        TraceJson, CreatedAt, UpdatedAt
      )
      OUTPUT INSERTED.PlanID
      VALUES (
        @conversationId, @stage, @version,
        @branchId, @branchCode, @branchName,
        @serviceIdsJson, @serviceNamesJson,
        @empId, @employeeName, @requestedDate, @timePreferenceJson,
        @candidateSlotsJson, @selectedSlotJson, @clientId,
        @missingFieldsJson, @lastAvailabilityCheckedAt, @lastTurnId,
        @bookingId, @bookingCode, @idempotencyKey, @executionErrorCode,
        @traceJson, SYSUTCDATETIME(), SYSUTCDATETIME()
      )
    `);

  const planId = Number(insert.recordset[0]?.PlanID);
  const created = await getBookingPlanById(planId);
  if (!created) throw new Error('Failed to load created booking plan');
  return created;
}

export async function abandonBookingPlan(planId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('planId', sql.BigInt, planId)
    .query(`
      UPDATE dbo.TblBotBookingPlan
      SET Stage = N'abandoned',
          UpdatedAt = SYSUTCDATETIME(),
          CompletedAt = SYSUTCDATETIME()
      WHERE PlanID = @planId
        AND Stage <> N'abandoned'
    `);
}

export function isActiveBookingPlanStage(stage: BookingPlanStage): boolean {
  return BOOKING_PLAN_ACTIVE_STAGES.includes(stage);
}
