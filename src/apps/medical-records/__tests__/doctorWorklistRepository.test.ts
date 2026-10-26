import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const query = vi.fn();
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  return {
    query, input,
    getPool: vi.fn().mockResolvedValue({ request: () => request }),
  };
});

vi.mock('@/lib/db', () => ({
  getPool: db.getPool,
  sql: { UniqueIdentifier: 'uuid', Int: 'int', Date: 'date' },
}));

import { listDoctorAppointments } from '../internal/doctorWorklistRepository';

describe('doctor worklist: server-side patient isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockResolvedValue({ recordset: [] });
  });

  it('filters bookings using authenticated doctor login, doctor ID, branch, date and tenant in SQL', async () => {
    const result = await listDoctorAppointments({
      tenantId: 'tenant-1', branchId: 3, userId: 27,
      practitionerEmpId: 42, date: '2026-10-26',
    });
    expect(result).toEqual([]);
    expect(db.input).toHaveBeenCalledWith('tenantId', 'uuid', 'tenant-1');
    expect(db.input).toHaveBeenCalledWith('branchId', 'int', 3);
    expect(db.input).toHaveBeenCalledWith('userId', 'int', 27);
    expect(db.input).toHaveBeenCalledWith('empId', 'int', 42);
    expect(db.input).toHaveBeenCalledWith('day', 'date', '2026-10-26');
    const sqlText = String(db.query.mock.calls[0][0]);
    expect(sqlText).toContain('cp.UserID=@userId');
    expect(sqlText).toContain('b.AssignedEmpID=@empId');
    expect(sqlText).toContain('b.BranchID=@branchId');
    expect(sqlText).toContain('b.BookingDate=@day');
    expect(sqlText).toContain('ce.TenantId=@tenantId');
    expect(sqlText).toContain('ce.PractitionerEmpID=@empId');
    expect(sqlText).toContain('c.TenantId=@tenantId');
  });
});
