import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const queries: string[] = [];

vi.mock('@/lib/db', () => {
  class Request {
    input() {
      return this;
    }
    async query(text: string) {
      queries.push(text);
      return { recordset: /SELECT EmpID/.test(text) ? [{ EmpID: 501 }] : [] };
    }
  }
  class Transaction {
    async begin() {}
    async commit() {}
    async rollback() {}
  }
  const type = () => 'type';
  return {
    getPool: async () => ({}),
    sql: { Request, Transaction, UniqueIdentifier: 'uid', NVarChar: type, Bit: 'bit', Int: 'int', Decimal: type, VarChar: type, Date: 'date' },
  };
});

vi.mock('@/lib/hr/employee-hr-advance', () => ({ ensureEmployeeAdvanceMapping: vi.fn(async () => undefined) }));

import { createTenantEmployee } from '@/lib/hr/tenantEmployeeCreate';

const TENANT = '083D433E-F36B-1410-8820-009EC495C7E1';

describe('createTenantEmployee', () => {
  beforeEach(() => {
    queries.length = 0;
  });

  it('inserts into trigger-bearing TblEmp without OUTPUT and reads the id via SCOPE_IDENTITY', async () => {
    const { empId } = await createTenantEmployee({ tenantId: TENANT, name: 'Ahmed Pilot', job: 'حلاق', isActive: true });

    expect(empId).toBe(501);
    const insert = queries.find((q) => /INSERT INTO dbo\.TblEmp/.test(q))!;
    expect(insert).not.toMatch(/OUTPUT\s+INSERTED/i);
    expect(insert).toMatch(/SCOPE_IDENTITY\(\)/);
  });

  it('uses the same trigger-safe shape for HR-model payloads', async () => {
    const { empId } = await createTenantEmployee({
      tenantId: TENANT,
      name: 'Karim Pilot',
      job: 'حلاق',
      isActive: true,
      hr: { employmentType: 'full_time', payrollMethod: 'monthly', monthlySalary: 6000 },
    });

    expect(empId).toBe(501);
    const insert = queries.find((q) => /INSERT INTO dbo\.TblEmp/.test(q))!;
    expect(insert).not.toMatch(/OUTPUT\s+INSERTED/i);
    expect(insert).toMatch(/SCOPE_IDENTITY\(\)/);
  });
});
