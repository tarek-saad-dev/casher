import type {
  BookingCandidateSlot,
  BookingPlanClarification,
  BookingPlanMissingField,
  BookingPlanSnapshot,
  BookingPlanStage,
  BookingTimePreference,
} from './types';

export function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function parseJsonObject<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as T) : null;
  } catch {
    return null;
  }
}

export function toDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export function mapPlanRow(row: Record<string, unknown>): BookingPlanSnapshot {
  const clarification = parseJsonObject<BookingPlanClarification>(
    row.ClarificationJson != null ? String(row.ClarificationJson) : null,
  );
  // clarification stored inside TraceJson.clarification for schema compactness —
  // also accept MissingFieldsJson only; clarification in TraceJson
  const trace = parseJsonObject<{ clarification?: BookingPlanClarification }>(
    row.TraceJson != null ? String(row.TraceJson) : null,
  );
  return {
    planId: Number(row.PlanID),
    conversationId: Number(row.ConversationID),
    stage: String(row.Stage) as BookingPlanStage,
    version: Number(row.Version ?? 1),
    branchId: row.BranchID == null ? null : Number(row.BranchID),
    branchCode: row.BranchCode == null ? null : String(row.BranchCode),
    branchName: row.BranchName == null ? null : String(row.BranchName),
    serviceIds: parseJsonArray<number>(row.ServiceIdsJson != null ? String(row.ServiceIdsJson) : null),
    serviceNames: parseJsonArray<string>(
      row.ServiceNamesJson != null ? String(row.ServiceNamesJson) : null,
    ),
    empId: row.EmpID == null ? null : Number(row.EmpID),
    employeeName: row.EmployeeName == null ? null : String(row.EmployeeName),
    requestedDate: toDateOnly(row.RequestedDate as Date | string | null),
    timePreference: parseJsonObject<BookingTimePreference>(
      row.TimePreferenceJson != null ? String(row.TimePreferenceJson) : null,
    ),
    candidateSlots: parseJsonArray<BookingCandidateSlot>(
      row.CandidateSlotsJson != null ? String(row.CandidateSlotsJson) : null,
    ),
    selectedSlot: parseJsonObject<BookingCandidateSlot>(
      row.SelectedSlotJson != null ? String(row.SelectedSlotJson) : null,
    ),
    clientId: row.ClientID == null ? null : Number(row.ClientID),
    missingFields: parseJsonArray<BookingPlanMissingField>(
      row.MissingFieldsJson != null ? String(row.MissingFieldsJson) : null,
    ),
    clarification: clarification ?? trace?.clarification ?? null,
    lastAvailabilityCheckedAt:
      row.LastAvailabilityCheckedAt == null
        ? null
        : new Date(String(row.LastAvailabilityCheckedAt)).toISOString(),
    lastTurnId: row.LastTurnID == null ? null : Number(row.LastTurnID),
    bookingId: row.BookingID == null ? null : Number(row.BookingID),
    bookingCode: row.BookingCode == null ? null : String(row.BookingCode),
    idempotencyKey: row.IdempotencyKey == null ? null : String(row.IdempotencyKey),
    executionErrorCode:
      row.ExecutionErrorCode == null ? null : String(row.ExecutionErrorCode),
    createdAt: new Date(String(row.CreatedAt)).toISOString(),
    updatedAt: row.UpdatedAt == null ? null : new Date(String(row.UpdatedAt)).toISOString(),
    completedAt: row.CompletedAt == null ? null : new Date(String(row.CompletedAt)).toISOString(),
  };
}
