import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const input = vi.fn();
  const query = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  return { input, query, request, getPool: vi.fn().mockResolvedValue({ request: () => request }) };
});
vi.mock('@/lib/db', () => ({
  getPool: db.getPool,
  sql: {
    UniqueIdentifier: 'uuid', Int: 'int', Date: 'date',
    Request: class { constructor() { return db.request; } },
  },
}));
import { linkClinicSaleWithinTransaction } from '../internal/clinicBillingRepository';

const input = {
  tenantId: 'tenant-1', encounterId: 'f8e4b6ec-118e-42d5-9ae7-f1c6b4d59fd2',
  branchId: 3, invId: 8123, clientId: 22, userId: 17,
  items: [{ proId: 9, empId: 6, sPrice: 300, bonus: 15, qty: 1 }],
};

describe('clinic billing link atomic POS adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockReset();
    db.input.mockReturnValue(db.request);
  });

  it('locks the encounter and inserts the unique invoice link in POS transaction', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ClientID: 22, PractitionerEmpID: 6, Status: 'completed', BookingID: 11 }] })
      .mockResolvedValueOnce({ recordset: [{ ProID: 9, SPrice1: 300, Bonus: 15 }] })
      .mockResolvedValueOnce({ recordset: [] });
    const tx = {} as never;
    await linkClinicSaleWithinTransaction(tx, input);
    expect(db.query.mock.calls[0][0]).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(db.query.mock.calls[0][0]).toContain('location.LegacyBranchID=@branchId');
    expect(db.input).toHaveBeenCalledWith('tenantId', 'uuid', 'tenant-1');
    expect(db.input).toHaveBeenCalledWith('encounterId', 'uuid', input.encounterId);
    expect(db.input).toHaveBeenCalledWith('invID', 'int', 8123);
    expect(db.query.mock.calls[2][0]).toContain('INSERT INTO dbo.ClinicEncounterBillingLink');
  });

  it('rejects mismatch of clinic patient or incomplete encounter before any financial link', async () => {
    db.query.mockResolvedValueOnce({ recordset: [{ ClientID: 31, PractitionerEmpID: 6, Status: 'completed', BookingID: 11 }] });
    await expect(linkClinicSaleWithinTransaction({} as never, input))
      .rejects.toMatchObject({ code: 'NOT_READY' });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('rejects unexpected price or wrong doctor before inserting a link', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ClientID: 22, PractitionerEmpID: 6, Status: 'completed', BookingID: 11 }] })
      .mockResolvedValueOnce({ recordset: [{ ProID: 9, SPrice1: 350, Bonus: 15 }] });
    await expect(linkClinicSaleWithinTransaction({} as never, input))
      .rejects.toMatchObject({ code: 'INVALID_ITEMS' });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('maps the database unique index violation into an already-billed conflict', async () => {
    db.query
      .mockResolvedValueOnce({ recordset: [{ ClientID: 22, PractitionerEmpID: 6, Status: 'completed', BookingID: 11 }] })
      .mockResolvedValueOnce({ recordset: [{ ProID: 9, SPrice1: 300, Bonus: 15 }] })
      .mockRejectedValueOnce({ number: 2627 });
    await expect(linkClinicSaleWithinTransaction({} as never, input))
      .rejects.toMatchObject({ code: 'ALREADY_BILLED' });
  });
});
