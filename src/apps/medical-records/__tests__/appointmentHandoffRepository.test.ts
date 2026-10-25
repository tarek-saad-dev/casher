import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const query = vi.fn();
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const getPool = vi.fn().mockResolvedValue({ request: () => request });
  const begin = vi.fn(), commit = vi.fn(), rollback = vi.fn().mockResolvedValue(undefined);
  return { query, input, request, getPool, begin, commit, rollback };
});

vi.mock('@/lib/db', () => ({
  getPool: db.getPool,
  sql: {
    UniqueIdentifier: 'uuid',
    Int: 'int',
    Date: 'date',
    NVarChar: () => 'text',
    Transaction: class {
      begin = db.begin;
      commit = db.commit;
      rollback = db.rollback;
    },
    Request: class { constructor() { return db.request; } },
  },
}));

import {
  ClinicAppointmentConflict,
  listClinicAppointments,
  transitionClinicAppointment,
} from '../internal/appointmentHandoffRepository';

const params = {
  tenantId: 'tenant-a', branchId: 4, locationId: 'location-a', bookingId: 19,
  actorUserId: 7,
};

const booking = { BookingID: 19, ClientID: 21, AssignedEmpID: 3, Status: 'confirmed' };

describe('canonical Booking -> Clinic Encounter handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockReset().mockResolvedValue({ recordset: [] });
  });

  it('lists branch appointments with both patient and doctor scoped by authoritative tenant', async () => {
    await listClinicAppointments({ tenantId: 'tenant-a', branchId: 4, date: '2026-10-26' });
    expect(db.input).toHaveBeenCalledWith('tenantId', 'uuid', 'tenant-a');
    expect(db.input).toHaveBeenCalledWith('branchId', 'int', 4);
    expect(db.query.mock.calls[0][0]).toContain('c.TenantId=@tenantId');
    expect(db.query.mock.calls[0][0]).toContain('p.TenantId=@tenantId');
    expect(db.query.mock.calls[0][0]).toContain('b.BranchID=@branchId');
    expect(db.query.mock.calls[0][0]).toContain("BookingRef=CONCAT(N'booking:'");
    expect(db.commit).not.toHaveBeenCalled();
  });

  it('checks a confirmed patient in by updating the existing Booking row, not cloning appointments', async () => {
    db.query.mockResolvedValueOnce({ recordset: [booking] });
    db.query.mockResolvedValueOnce({ recordset: [{ BookingID: 19 }] });
    const result = await transitionClinicAppointment({ ...params, action: 'arrive' });
    expect(result).toEqual({ bookingId: 19, status: 'arrived' });
    expect(db.query.mock.calls[0][0]).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(db.query.mock.calls[1][0]).toContain("SET Status=N'arrived'");
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.commit).toHaveBeenCalledOnce();
  });

  it.each(['cancelled', 'no_show', 'rescheduled', 'completed'])('never revives %s bookings', async status => {
    db.query.mockResolvedValueOnce({ recordset: [{ ...booking, Status: status }] });
    await expect(transitionClinicAppointment({ ...params, action: 'arrive' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.commit).not.toHaveBeenCalled();
  });

  it('starts from an arrived canonical booking, writes the audit and updates booking atomically', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ...booking, Status: 'arrived' }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ EncounterId: 'encounter-a' }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ BookingID: 19 }] });
    const result = await transitionClinicAppointment({ ...params, action: 'start', visitType: 'follow_up' });
    expect(result).toMatchObject({ bookingId: 19, status: 'in_service', encounterId: 'encounter-a' });
    expect(db.input).toHaveBeenCalledWith('bookingRef', 'text', 'booking:19');
    expect(db.query.mock.calls[2][0]).toContain('a.CanReceiveBookings=1');
    expect(db.query.mock.calls[2][0]).toContain('a.EffectiveFrom<=b.BookingDate');
    expect(db.query.mock.calls[2][0]).toContain('OUTPUT INSERTED.EncounterId');
    expect(db.query.mock.calls[3][0]).toContain("N'booking-started'");
    expect(db.query.mock.calls[4][0]).toContain("Status=N'in_service'");
    expect(db.commit).toHaveBeenCalledOnce();
  });

  it('returns an existing EncounterId on retries without inserting a duplicate visit', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ...booking, Status: 'in_service' }] })
      .mockResolvedValueOnce({ recordset: [{ EncounterId: 'existing-a' }] });
    const result = await transitionClinicAppointment({ ...params, action: 'start' });
    expect(result).toEqual({ bookingId: 19, status: 'in_service', encounterId: 'existing-a', reused: true });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.commit).toHaveBeenCalledOnce();
  });

  it('does not start a cancelled booking without a linked visit', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ...booking, Status: 'cancelled' }] })
      .mockResolvedValueOnce({ recordset: [] });
    await expect(transitionClinicAppointment({ ...params, action: 'start' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.rollback).toHaveBeenCalledOnce();
  });

  it('fails closed when a foreign tenant or branch booking has no scoped match', async () => {
    db.query.mockResolvedValueOnce({ recordset: [] });
    await expect(transitionClinicAppointment({ ...params, action: 'start' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.rollback).toHaveBeenCalledOnce();
  });

  it('rolls back encounter creation if the audit insert fails', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ...booking, Status: 'arrived' }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ EncounterId: 'new-a' }] })
      .mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(transitionClinicAppointment({ ...params, action: 'start' }))
      .rejects.toThrow('audit unavailable');
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.commit).not.toHaveBeenCalled();
  });

  it('blocks starting when branch assignment expired for the booked date', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ...booking, Status: 'arrived' }] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] });
    await expect(transitionClinicAppointment({ ...params, action: 'start' }))
      .rejects.toBeInstanceOf(ClinicAppointmentConflict);
    expect(db.rollback).toHaveBeenCalledOnce();
  });
});
