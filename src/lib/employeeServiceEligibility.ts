/**
 * employeeServiceEligibility.ts
 *
 * Single source of truth for "can this employee perform these services?".
 *
 * ── IMPORTANT DATA-MODEL NOTE ────────────────────────────────────────────────
 * This system has NO employee↔service assignment table.
 *   - Services live in dbo.TblPro (soft-deleted via isDeleted).
 *   - dbo.TblEmpServiceSettings stores per-barber *duration overrides* only
 *     (see db/migrations/add-emp-service-settings.sql and the
 *     /api/services/[id]/barber-durations admin UI). It must NEVER be used to
 *     gate service eligibility.
 *
 * All active barbers can perform any active (non-deleted) service — this matches
 * the booking-create, find-nearest-barber and queue flows, which read serviceIds
 * purely to compute duration. Therefore a service is "supported" iff it exists in
 * TblPro and is not soft-deleted. Using this shared helper across every flow keeps
 * the compatibility rule consistent and prevents a duration override from silently
 * locking a service to a subset of barbers.
 */

import { getPool, sql } from '@/lib/db';
import type { ConnectionPool, Transaction } from 'mssql';

export interface UnsupportedService {
  serviceId: number;
  serviceName: string | null;
}

export interface EmployeeServiceSupportResult {
  valid: boolean;
  /** Normalized (numeric, deduped) service IDs that were validated. */
  requestedServiceIds: number[];
  /** Raw entries that could not be normalized to a positive integer id. */
  invalidServiceIds: Array<number | string | null>;
  /** Services the employee cannot perform (missing, deleted, or invalid id). */
  unsupportedServices: UnsupportedService[];
}

/**
 * Normalize an arbitrary list of service id inputs into a deduped list of
 * positive integers, collecting anything invalid separately.
 */
export function normalizeServiceIds(
  serviceIds: Array<number | string | null | undefined>,
): { valid: number[]; invalid: Array<number | string | null> } {
  const valid: number[] = [];
  const invalid: Array<number | string | null> = [];
  const seen = new Set<number>();

  for (const raw of serviceIds ?? []) {
    if (raw === null || raw === undefined || raw === '') {
      invalid.push(raw ?? null);
      continue;
    }
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n) || n <= 0) {
      invalid.push(raw);
      continue;
    }
    if (seen.has(n)) continue;
    seen.add(n);
    valid.push(n);
  }

  return { valid, invalid };
}

/**
 * Validate that an employee can perform every requested service.
 *
 * - Normalizes ids to numbers and deduplicates them.
 * - Explicitly rejects null/invalid ids.
 * - Loads only valid, active (non-deleted) services in a single query (no N+1).
 * - Returns ALL unsupported services (with names when known), not just a boolean.
 * - Works inside an existing transaction when provided.
 */
export async function validateEmployeeSupportsServices(args: {
  employeeId: number;
  serviceIds: Array<number | string | null | undefined>;
  transaction?: Transaction;
  pool?: ConnectionPool;
}): Promise<EmployeeServiceSupportResult> {
  const { transaction } = args;
  const { valid: normalized, invalid } = normalizeServiceIds(args.serviceIds);

  const result: EmployeeServiceSupportResult = {
    valid: false,
    requestedServiceIds: normalized,
    invalidServiceIds: invalid,
    unsupportedServices: [],
  };

  // Reject invalid/null ids explicitly — never silently drop them.
  if (invalid.length > 0) {
    result.unsupportedServices = invalid.map((id) => ({
      serviceId: typeof id === 'number' ? id : -1,
      serviceName: null,
    }));
    return result;
  }

  // Nothing to validate — vacuously supported.
  if (normalized.length === 0) {
    result.valid = true;
    return result;
  }

  const db = args.pool ?? (await getPool());
  const request = transaction ? new sql.Request(transaction) : db.request();
  normalized.forEach((id, i) => request.input(`svc${i}`, sql.Int, id));
  const placeholders = normalized.map((_, i) => `@svc${i}`).join(',');

  const res = await request.query(`
    SELECT ProID, ProName, ProNameAr, ISNULL(isDeleted, 0) AS isDeleted
    FROM [dbo].[TblPro]
    WHERE ProID IN (${placeholders})
  `);

  const byId = new Map<number, { name: string | null; isDeleted: boolean }>();
  for (const row of res.recordset as Array<{
    ProID: number;
    ProName: string | null;
    ProNameAr: string | null;
    isDeleted: number | boolean;
  }>) {
    byId.set(row.ProID, {
      name: row.ProNameAr || row.ProName || null,
      isDeleted: !!row.isDeleted,
    });
  }

  const unsupported: UnsupportedService[] = [];
  for (const id of normalized) {
    const svc = byId.get(id);
    // Unsupported iff the service does not exist or is soft-deleted.
    if (!svc || svc.isDeleted) {
      unsupported.push({ serviceId: id, serviceName: svc?.name ?? null });
    }
  }

  result.unsupportedServices = unsupported;
  result.valid = unsupported.length === 0;
  return result;
}

/** Build a human-readable Arabic message for unsupported services. */
export function buildUnsupportedServicesMessage(
  employeeName: string | null | undefined,
  unsupportedServices: UnsupportedService[],
): string {
  const name = employeeName?.trim() || 'الموظف';
  const names = unsupportedServices
    .map((s) => s.serviceName?.trim() || `خدمة #${s.serviceId}`)
    .filter(Boolean);

  if (names.length === 0) {
    return `لا يمكن نقل الموعد إلى ${name} لأنه لا يقدم إحدى الخدمات المطلوبة`;
  }
  if (names.length === 1) {
    return `لا يمكن نقل الموعد إلى ${name} لأنه لا يقدم خدمة: ${names[0]}`;
  }
  return `لا يمكن نقل الموعد إلى ${name} لأنه لا يقدم الخدمات التالية:\n${names.join('، ')}`;
}
