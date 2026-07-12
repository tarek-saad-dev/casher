import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const executedSql: string[] = [];
let poolQueryResults: Array<{ recordset: unknown[] }> = [];
let poolQueryIdx = 0;
let txQueryResults: Array<{ recordset: unknown[] }> = [];
let txQueryIdx = 0;

function trackQuery(sqlText: string) {
  executedSql.push(sqlText.replace(/\s+/g, ' ').trim());
}

function makePoolRequest() {
  return {
    input: vi.fn().mockReturnThis(),
    query: vi.fn(async (sqlText: string) => {
      trackQuery(sqlText);
      const res = poolQueryResults[poolQueryIdx] ?? { recordset: [] };
      poolQueryIdx++;
      return res;
    }),
  };
}

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: vi.fn(() => makePoolRequest()),
  })),
  sql: {
    Int: () => ({ type: 'int' }),
    TinyInt: () => ({ type: 'tinyint' }),
    Bit: () => ({ type: 'bit' }),
    Date: () => ({ type: 'date' }),
    Time: () => ({ type: 'time' }),
    Decimal: () => ({ type: 'decimal' }),
    VarChar: () => ({ type: 'varchar' }),
    NVarChar: () => ({ type: 'nvarchar' }),
    Request: class FakeRequest {
      input() {
        return this;
      }
      async query(sqlText: string) {
        trackQuery(sqlText);
        const res = txQueryResults[txQueryIdx] ?? { recordset: [] };
        txQueryIdx++;
        return res;
      }
    },
    Transaction: class FakeTx {
      async begin() {}
      async commit() {}
      async rollback() {}
    },
  },
}));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({ UserID: 1, UserName: 'Admin', UserLevel: 1 })),
}));

function resetMocks() {
  executedSql.length = 0;
  poolQueryResults = [];
  poolQueryIdx = 0;
  txQueryResults = [];
  txQueryIdx = 0;
}

beforeEach(() => {
  resetMocks();
  vi.resetModules();
});

describe('POST /api/employees HR model', () => {
  it('legacy create with empName only still works', async () => {
    txQueryResults = [
      { recordset: [{ EmpID: 99, EmpName: 'أحمد', isActive: true }] },
      { recordset: [] },
      { recordset: [{ ExpINID: 501 }] },
      { recordset: [] },
    ];

    const { POST } = await import('@/app/api/employees/route');
    const res = await POST(
      new NextRequest('http://localhost/api/employees', {
        method: 'POST',
        body: JSON.stringify({ empName: 'أحمد' }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.EmpID).toBe(99);
    expect(body.AdvanceExpINID).toBe(501);
    expect(executedSql.some((s) => s.includes('INSERT INTO dbo.TblEmp (EmpName, isActive)'))).toBe(
      true,
    );
    expect(executedSql.some((s) => s.includes('TblExpCatEmpMap'))).toBe(true);
    expect(executedSql.some((s) => s.includes('EmploymentType'))).toBe(false);
  });

  it('full_time hourly create stores HR columns', async () => {
    txQueryResults = [
      { recordset: [{ EmpID: 100, EmpName: 'سارة', isActive: true }] },
      { recordset: [] },
      { recordset: [{ ExpINID: 502 }] },
      { recordset: [] },
    ];

    const { POST } = await import('@/app/api/employees/route');
    const res = await POST(
      new NextRequest('http://localhost/api/employees', {
        method: 'POST',
        body: JSON.stringify({
          empName: 'سارة',
          employmentType: 'full_time',
          payrollMethod: 'hourly',
          manualHourlyRate: 25,
        }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.EmploymentType).toBe('full_time');
    expect(body.PayrollMethod).toBe('hourly');
    expect(executedSql.some((s) => s.includes('EmploymentType, PayrollMethod'))).toBe(true);
    expect(executedSql.some((s) => s.includes('ManualHourlyRate'))).toBe(true);
  });

  it('freelance monthly create is rejected', async () => {
    const { POST } = await import('@/app/api/employees/route');
    const res = await POST(
      new NextRequest('http://localhost/api/employees', {
        method: 'POST',
        body: JSON.stringify({
          empName: 'طارق',
          employmentType: 'freelance',
          payrollMethod: 'monthly',
          monthlySalary: 5000,
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('الفري لانس');
  });

  it('does not write TblCashMove or TblEmpLedgerEntry on create', async () => {
    txQueryResults = [
      { recordset: [{ EmpID: 101, EmpName: 'x', isActive: true }] },
      { recordset: [] },
      { recordset: [{ ExpINID: 503 }] },
      { recordset: [] },
    ];

    const { POST } = await import('@/app/api/employees/route');
    await POST(
      new NextRequest('http://localhost/api/employees', {
        method: 'POST',
        body: JSON.stringify({ empName: 'x' }),
      }),
    );

    expect(executedSql.some((s) => s.includes('TblCashMove'))).toBe(false);
    expect(executedSql.some((s) => s.includes('TblEmpLedgerEntry'))).toBe(false);
  });
});

describe('PATCH /api/employees/:id HR model', () => {
  it('patch employmentType to freelance sets IsAttendanceExempt', async () => {
    poolQueryResults = [
      {
        recordset: [
          {
            EmploymentType: 'full_time',
            PayrollMethod: 'hourly',
            IsPayrollEnabled: true,
            ManualHourlyRate: 25,
            DailyRate: null,
            BaseSalary: null,
          },
        ],
      },
      { recordset: [{ EmpID: 7, EmploymentType: 'freelance', IsAttendanceExempt: 1 }] },
    ];
    txQueryResults = [{ recordset: [] }];

    const { PATCH } = await import('@/app/api/employees/[id]/route');
    const res = await PATCH(
      new NextRequest('http://localhost/api/employees/7', {
        method: 'PATCH',
        body: JSON.stringify({ employmentType: 'freelance' }),
      }),
      { params: Promise.resolve({ id: '7' }) },
    );

    expect(res.status).toBe(200);
    expect(executedSql.some((s) => s.includes('IsAttendanceExempt = @isAttendanceExempt'))).toBe(
      true,
    );
  });

  it('patch freelance to monthly is rejected', async () => {
    poolQueryResults = [
      {
        recordset: [
          {
            EmploymentType: 'freelance',
            PayrollMethod: 'hourly',
            IsPayrollEnabled: true,
            ManualHourlyRate: 30,
            DailyRate: null,
            BaseSalary: null,
          },
        ],
      },
    ];

    const { PATCH } = await import('@/app/api/employees/[id]/route');
    const res = await PATCH(
      new NextRequest('http://localhost/api/employees/22', {
        method: 'PATCH',
        body: JSON.stringify({ payrollMethod: 'monthly', monthlySalary: 5000 }),
      }),
      { params: Promise.resolve({ id: '22' }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('الفري لانس');
  });
});

describe('GET /api/employees HR fields', () => {
  it('returns new HR columns and labels', async () => {
    poolQueryResults = [
      {
        recordset: [
          {
            EmpID: 1,
            EmpName: 'Test',
            isActive: true,
            EmploymentType: 'full_time',
            PayrollMethod: 'hourly',
            DayOffPolicy: 'flexible_weekly',
            DailyRate: null,
            ManualHourlyRate: 25,
            HireDate: '2026-01-01',
            IsAttendanceExempt: false,
            DefaultCheckInTime: '09:00',
            DefaultCheckOutTime: '17:00',
            SalaryType: 'Daily',
            Salary: null,
            BaseSalary: null,
            HourlyRate: 25,
            IsPayrollEnabled: true,
          },
        ],
      },
    ];

    const { GET } = await import('@/app/api/employees/route');
    const res = await GET(new NextRequest('http://localhost/api/employees'));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows[0].EmploymentType).toBe('full_time');
    expect(rows[0].PayrollMethod).toBe('hourly');
    expect(rows[0].DayOffPolicy).toBe('flexible_weekly');
    expect(rows[0].employmentTypeLabel).toBe('دوام كامل');
    expect(rows[0].payrollMethodLabel).toBe('بالساعة');
    expect(rows[0].dayOffPolicyLabel).toBe('إجازة أسبوعية مرنة');
    expect(rows[0].ManualHourlyRate).toBe(25);
  });
});
