import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const input = vi.fn();
  const query = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  return {
    input, query, request, begin: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined), rollback: vi.fn().mockResolvedValue(undefined),
    pool: vi.fn().mockResolvedValue({ request: () => request }),
  };
});
vi.mock('@/lib/db', () => ({
  getPool: db.pool,
  sql: {
    UniqueIdentifier: 'uuid', Int: 'int',
    NVarChar: (_n: number) => 'text',
    Request: class { constructor() { return db.request; } },
    Transaction: class {
      begin() { return db.begin(); }
      commit() { return db.commit(); }
      rollback() { return db.rollback(); }
    },
  },
}));
import {
  attachTreatmentSessionBooking, createTreatmentPlan, listTreatmentPlans,
} from '../internal/treatmentPlanRepository';

const ctx = { tenantId: 'tenant-1', branchId: 3, practitionerEmpId: 8, userId: 13 };
const encounterId = 'f8e4b6ec-118e-42d5-9ae7-f1c6b4d59fd2';
const planId = 'bd42d0c7-1bef-4561-9a41-bb1891b71ac8';

describe('treatment plan SQL: doctor, branch, booking and completion invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.input.mockReturnValue(db.request);
    db.query.mockReset();
  });

  it('creates session numbers atomically only when source visit was completed', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ClientID: 21, LocationId: 'location-1', Status: 'completed' }] })
      .mockResolvedValueOnce({ recordset: [{ PlanId: planId }] })
      .mockResolvedValueOnce({ recordset: [] });
    expect(await createTreatmentPlan({ ...ctx, encounterId, title: 'علاج طبيعي', totalSessions: 5 })).toBe(planId);
    expect(db.begin).toHaveBeenCalledOnce();
    expect(db.commit).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[0][0]).toContain('e.PractitionerEmpID=@doctor');
    expect(db.query.mock.calls[0][0]).toContain('l.LegacyBranchId=@branchId');
    expect(db.query.mock.calls[2][0]).toContain('ClinicTreatmentSession');
  });

  it('refuses new plan for unfinished clinical visit with a rollback', async () => {
    db.query.mockResolvedValueOnce({ recordset: [{ ClientID: 21, LocationId: 'location-1', Status: 'in_progress' }] });
    await expect(createTreatmentPlan({ ...ctx, encounterId, title: 'علاج طبيعي', totalSessions: 5 }))
      .rejects.toMatchObject({ code: 'NOT_READY' });
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('enforces a lock on session/plan and the existing Booking patient, doctor and branch', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ClientID: 21, PractitionerEmpID: 8, BookingID: null }] })
      .mockResolvedValueOnce({ recordset: [{ BookingID: 99, Status: 'confirmed' }] })
      .mockResolvedValueOnce({ recordset: [] });
    await expect(attachTreatmentSessionBooking({
      ...ctx, planId, sessionNumber: 2, bookingId: 99,
    })).resolves.toEqual({ bookingId: 99, reused: false });
    const sqlText = String(db.query.mock.calls[1][0]);
    expect(sqlText).toContain('b.BranchID=@branchId');
    expect(sqlText).toContain('b.ClientID=@clientId');
    expect(sqlText).toContain('b.AssignedEmpID=@doctor');
    expect(db.query.mock.calls[0][0]).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(db.commit).toHaveBeenCalledOnce();
  });

  it('cannot attach another booking to an already-linked slot', async () => {
    db.query.mockResolvedValueOnce({ recordset: [{ ClientID: 21, PractitionerEmpID: 8, BookingID: 55 }] });
    await expect(attachTreatmentSessionBooking({ ...ctx, planId, sessionNumber: 1, bookingId: 99 }))
      .rejects.toMatchObject({ code: 'SESSION_OCCUPIED' });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('reuses same booking ID without a second write', async () => {
    db.query.mockResolvedValueOnce({ recordset: [{ ClientID: 21, PractitionerEmpID: 8, BookingID: 55 }] });
    expect(await attachTreatmentSessionBooking({
      ...ctx, planId, sessionNumber: 1, bookingId: 55,
    })).toMatchObject({ reused: true });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.commit).toHaveBeenCalledOnce();
  });

  it('rejects cancelled booking and unique-linked booking from another plan', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ClientID: 21, PractitionerEmpID: 8, BookingID: null }] })
      .mockResolvedValueOnce({ recordset: [{ BookingID: 99, Status: 'cancelled' }] });
    await expect(attachTreatmentSessionBooking({ ...ctx, planId, sessionNumber: 1, bookingId: 99 }))
      .rejects.toMatchObject({ code: 'BOOKING_MISMATCH' });
    db.query.mockReset().mockResolvedValueOnce({ recordset: [{ ClientID: 21, PractitionerEmpID: 8, BookingID: null }] })
      .mockResolvedValueOnce({ recordset: [{ BookingID: 99, Status: 'confirmed' }] })
      .mockRejectedValueOnce({ number: 2627 });
    await expect(attachTreatmentSessionBooking({ ...ctx, planId, sessionNumber: 1, bookingId: 99 }))
      .rejects.toMatchObject({ code: 'BOOKING_ALREADY_LINKED' });
  });

  it('returns a tenant/doctor/location-filtered projection with completion derived from encounters', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ClientID: 21, LocationId: 'location-1', Status: 'completed' }] })
      .mockResolvedValueOnce({ recordset: [
        { PlanId: planId, Title: 'علاج', TotalSessions: 2, SourceEncounterId: encounterId,
          CreatedAt: '2026-10-26', SessionNumber: 1, BookingID: 55,
          BookingStatus: 'completed', BookingDate: '2026-10-26',
          EncounterId: null, EncounterStatus: null },
        { PlanId: planId, Title: 'علاج', TotalSessions: 2, SourceEncounterId: encounterId,
          CreatedAt: '2026-10-26', SessionNumber: 2, BookingID: 60,
          BookingStatus: 'in_service', BookingDate: '2026-10-27',
          EncounterId: 'e2', EncounterStatus: 'completed' },
      ] });
    const plans = await listTreatmentPlans({ ...ctx, encounterId });
    expect(plans[0].progress).toMatchObject({ completed: 1, remaining: 1, percent: 50 });
    const q = String(db.query.mock.calls[1][0]);
    expect(q).toContain('p.TenantId=@tenantId');
    expect(q).toContain('p.PractitionerEmpID=@doctor');
    expect(q).toContain('p.LocationId=@locationId');
    expect(q).toContain("e.BookingRef=CONCAT(N'booking:'");
  });
});
