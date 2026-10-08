/**
 * DRVO-016 — two-tenant proof for HR / attendance / payroll / employee ledger. Tenant A (CUT-like,
 * branches GLEEM + CAMP_CAESAR) and tenant B (synthetic, one branch) each create employees through
 * the real route handlers; a small in-memory TblEmp engine evaluates every EmpID / TenantId /
 * branch-tenant predicate, so a query that forgets its tenant predicate leaks here exactly as it
 * would against SQL Server. No real database is touched.
 */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A_GLEEM = 1;
const A_CAMP = 3;
const B_MAIN = 51;

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  tenantId: '' as string,
  emps: [] as Array<Record<string, unknown>>,
  locations: new Map<number, string>(),
  statements: [] as Array<{ text: string; params: Record<string, unknown> }>,
}));

function tblEmpFilter(text: string, params: Row): (r: Row) => boolean {
  const checks: Array<(r: Row) => boolean> = [];
  for (const m of text.matchAll(/(?:\b\w+\.)?EmpID\s*=\s*@(\w+)/gi)) {
    const v = Number(params[m[1]]);
    checks.push((r) => Number(r.EmpID) === v);
  }
  if (/EmpID\s*=\s*SCOPE_IDENTITY\(\)/i.test(text)) {
    const last = Math.max(0, ...h.emps.map((r) => Number(r.EmpID)));
    checks.push((r) => Number(r.EmpID) === last);
  }
  for (const m of text.matchAll(/(?:\b\w+\.)?TenantId\s*=\s*@(\w+)/gi)) {
    const v = String(params[m[1]] ?? '').toLowerCase();
    checks.push((r) => String(r.TenantId).toLowerCase() === v);
  }
  for (const m of text.matchAll(
    /TenantId\s+IN\s*\(\s*SELECT\s+\w+\.TenantId\s+FROM\s+dbo\.Location\s+\w+\s+WHERE\s+\w+\.LegacyBranchId\s*=\s*@(\w+)\s*\)/gi,
  )) {
    const tenant = h.locations.get(Number(params[m[1]]));
    checks.push((r) => tenant != null && String(r.TenantId) === tenant);
  }
  return (r) => checks.every((c) => c(r));
}

function runSql(text: string, params: Row) {
  h.statements.push({ text, params });
  const flat = text.replace(/\s+/g, ' ').trim();
  let recordset: Row[] = [];
  let rowsAffected = 0;
  for (const stmt of flat.split(';').map((s) => s.trim()).filter(Boolean)) {
    if (/FROM dbo\.Location l INNER JOIN dbo\.Tenant/i.test(stmt)) {
      const t = h.locations.get(Number(params.branchId));
      recordset = t ? [{ TenantId: t }] : [];
      continue;
    }
    const ins = /^INSERT INTO dbo\.TblEmp \(([^)]*)\) VALUES \(([^)]*)\)/i.exec(stmt);
    if (ins) {
      const cols = ins[1].split(',').map((c) => c.trim());
      const vals = ins[2].split(',').map((v) => params[v.trim().replace(/^@/, '')]);
      const row: Row = { EmpID: Math.max(0, ...h.emps.map((r) => Number(r.EmpID))) + 1 };
      cols.forEach((c, i) => (row[c] = vals[i]));
      if (row.TenantId == null) throw new Error("Cannot insert NULL into 'TenantId'");
      h.emps.push(row);
      rowsAffected = 1;
      continue;
    }
    if (/^SELECT @@ROWCOUNT AS (\w+)$/i.test(stmt)) {
      recordset = [{ [/AS (\w+)$/i.exec(stmt)![1]]: rowsAffected }];
      continue;
    }
    if (/^DELETE FROM dbo\.TblEmp\b/i.test(stmt)) {
      const hit = tblEmpFilter(stmt, params);
      const before = h.emps.length;
      h.emps = h.emps.filter((r) => !(hit(r) && !r.isActive));
      rowsAffected = before - h.emps.length;
      continue;
    }
    if (/^UPDATE dbo\.TblEmp\b/i.test(stmt)) {
      rowsAffected = h.emps.filter(tblEmpFilter(stmt, params)).length;
      continue;
    }
    if (/\bdbo\.TblEmp\b/i.test(stmt)) {
      recordset = h.emps.filter(tblEmpFilter(stmt, params)).map((r) => ({ ...r }));
      continue;
    }
    recordset = [];
  }
  return { recordset, recordsets: [recordset], rowsAffected: [rowsAffected] };
}

vi.mock('@/lib/db', () => {
  const typeFn = () => ({});
  class Request {
    private params: Record<string, unknown> = {};
    constructor(_executor?: unknown) {}
    input(name: string, ...rest: unknown[]) {
      this.params[name] = rest.length > 1 ? rest[1] : rest[0];
      return this;
    }
    async query(text: string) {
      return runSql(text, this.params);
    }
  }
  class Transaction {
    constructor(_pool?: unknown) {}
    async begin() {}
    async commit() {}
    async rollback() {}
    request() {
      return new Request(this);
    }
  }
  const pool = { request: () => new Request(pool) };
  const sql = {
    Int: typeFn, BigInt: typeFn, Bit: typeFn, Date: typeFn, DateTime: typeFn, DateTime2: typeFn,
    Decimal: typeFn, NVarChar: typeFn, VarChar: typeFn, UniqueIdentifier: typeFn, TinyInt: typeFn,
    Time: typeFn, MAX: -1, Request, Transaction,
    ISOLATION_LEVEL: { READ_COMMITTED: 0, SERIALIZABLE: 1 },
  };
  return { sql, getPool: async () => pool, pool, getUserFriendlyError: (e: unknown) => String(e) };
});

vi.mock('@/lib/api-auth', () => ({
  requireTenantSession: async () =>
    h.tenantId ? { UserID: 1, TenantId: h.tenantId } : NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/hr/employee-hr-advance', () => ({
  ensureEmployeeAdvanceMapping: async () => ({ expINID: 1, catName: 'advance' }),
}));
vi.mock('@/lib/booking/publicBookingBarbers', () => ({ invalidatePublicBookingBarbersCache: () => {} }));
vi.mock('@/lib/payroll/employee-target', () => ({ getEmployeesTargetSummaryBatch: async () => new Map() }));
vi.mock('@/lib/payroll/branchPayrollPlan', () => ({
  loadActiveBranchPayrollRatesByEmpIds: async () => new Map(),
  loadPrimaryBranchPayrollRatesForEmployee: async () => null,
  overlayEmployeeRowWithBranchPlanRates: (r: unknown) => r,
  syncHrRatesToActiveBranchPlans: async () => {},
}));
vi.mock('@/lib/migrations/ensureEmployeeArchived', () => ({ ensureTblEmpArchivedColumn: async () => true }));
vi.mock('@/lib/employeeLedgerConfig', async (orig) => ({
  ...(await orig<object>()),
  isEmployeeLedgerDualWriteEnabled: () => true,
}));

function as(tenantId: string) {
  h.tenantId = tenantId;
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createEmployee(tenantId: string, name: string): Promise<number> {
  const { POST } = await import('@/app/api/employees/route');
  as(tenantId);
  const res = await POST(req('/api/employees', 'POST', { empName: name }));
  expect(res.status).toBe(201);
  return Number((await res.json()).EmpID);
}

beforeEach(() => {
  h.tenantId = '';
  h.emps = [];
  h.statements = [];
  h.locations = new Map([
    [A_GLEEM, A],
    [A_CAMP, A],
    [B_MAIN, B],
  ]);
});

describe('DRVO-016 employees: create / delete per tenant', () => {
  it('each tenant creates its employee with its own TenantId', async () => {
    const a = await createEmployee(A, 'Ahmed');
    const b = await createEmployee(B, 'Ahmed');
    expect(a).not.toBe(b);
    expect(h.emps.find((r) => r.EmpID === a)!.TenantId).toBe(A);
    expect(h.emps.find((r) => r.EmpID === b)!.TenantId).toBe(B);
  });

  it("deleting another tenant's employee is not-found and leaves the row", async () => {
    const a = await createEmployee(A, 'Ahmed');
    h.emps.find((r) => r.EmpID === a)!.isActive = 0;
    const { DELETE } = await import('@/app/api/employees/[id]/route');
    as(B);
    const res = await DELETE(req(`/api/employees/${a}`, 'DELETE'), { params: Promise.resolve({ id: String(a) }) });
    expect(res.status).toBe(404);
    expect(h.emps.some((r) => r.EmpID === a)).toBe(true);

    as(A);
    const ok = await DELETE(req(`/api/employees/${a}`, 'DELETE'), { params: Promise.resolve({ id: String(a) }) });
    expect(ok.status).toBe(200);
    expect(h.emps.some((r) => r.EmpID === a)).toBe(false);
  });

  it('a missing tenant fails closed before any SQL', async () => {
    const { POST } = await import('@/app/api/employees/route');
    as('');
    const res = await POST(req('/api/employees', 'POST', { empName: 'X' }));
    expect(res.status).toBe(401);
    expect(h.emps).toHaveLength(0);
  });
});

describe('DRVO-016 HR tenant helpers', () => {
  it('assertEmployeeInTenant: own employee resolves, the other tenant is not-found', async () => {
    const a = await createEmployee(A, 'Ahmed');
    const { assertEmployeeInTenant, isHrEmployeeNotFoundError } = await import('@/lib/hr/hrTenantScope');
    await expect(assertEmployeeInTenant(A, a)).resolves.toMatchObject({ empId: a });
    const err = await assertEmployeeInTenant(B, a).catch((e: unknown) => e);
    expect(isHrEmployeeNotFoundError(err)).toBe(true);
  });

  it('filterEmployeeIdsInTenant keeps only the tenant employees', async () => {
    const a1 = await createEmployee(A, 'A1');
    const b1 = await createEmployee(B, 'B1');
    const a2 = await createEmployee(A, 'A2');
    const { filterEmployeeIdsInTenant } = await import('@/lib/hr/hrTenantScope');
    expect(await filterEmployeeIdsInTenant(A, [a1, b1, a2, a1])).toEqual([a1, a2]);
    expect(await filterEmployeeIdsInTenant(B, [a1, b1, a2])).toEqual([b1]);
  });

  it('requireHrTenantId rejects missing / malformed tenants', async () => {
    const { requireHrTenantId } = await import('@/lib/hr/hrTenantScope');
    expect(() => requireHrTenantId('', 'x')).toThrow();
    expect(() => requireHrTenantId('not-a-guid', 'x')).toThrow();
    expect(requireHrTenantId(A.toUpperCase(), 'x')).toBe(A);
  });

  it('bindEmpTenantPredicate binds the tenant or the branch tenant', async () => {
    const { bindEmpTenantPredicate } = await import('@/lib/hr/hrTenantScope');
    const inputs: Record<string, unknown> = {};
    const r = { input: (n: string, _t: unknown, v: unknown) => (inputs[n] = v) };
    expect(bindEmpTenantPredicate(r, 'e', { tenantId: A })).toBe('e.TenantId = @hrTenantId');
    expect(inputs.hrTenantId).toBe(A);
    expect(bindEmpTenantPredicate(r, 'e', { branchId: B_MAIN })).toMatch(/LegacyBranchId = @hrTenantBranchId/);
    expect(inputs.hrTenantBranchId).toBe(B_MAIN);
  });
});

describe('DRVO-016 attendance is branch-tenant scoped', () => {
  it("a branch never sees another tenant's employee", async () => {
    const a = await createEmployee(A, 'Ahmed');
    const b = await createEmployee(B, 'Bassem');
    const { employeeExists } = await import('@/modules/attendance/infra/AttendanceRepository');
    const { getPool } = await import('@/lib/db');
    const db = await getPool();
    expect(await employeeExists(db as never, a, A_GLEEM)).toBe(true);
    expect(await employeeExists(db as never, a, A_CAMP)).toBe(true);
    expect(await employeeExists(db as never, b, B_MAIN)).toBe(true);
    expect(await employeeExists(db as never, a, B_MAIN)).toBe(false);
    expect(await employeeExists(db as never, b, A_GLEEM)).toBe(false);
  });
});

describe('DRVO-016 employee-ledger payout is tenant scoped', () => {
  const payout = (empId: number, branchId: number) =>
    import('@/lib/services/employeeLedgerPayoutService').then(({ executeEmployeePayout }) =>
      executeEmployeePayout({
        empId,
        amount: 100,
        paymentMethodId: 1,
        payoutDate: '2026-10-01',
        branchId,
        businessDayId: 1,
      }),
    );

  it("a branch of tenant B cannot pay tenant A's employee", async () => {
    const a = await createEmployee(A, 'Ahmed');
    await expect(payout(a, B_MAIN)).rejects.toThrow(/الموظف غير موجود/);
  });

  it('the own tenant passes the employee check (fails later on the unseeded payment method)', async () => {
    const b = await createEmployee(B, 'Bassem');
    await expect(payout(b, B_MAIN)).rejects.toThrow(/طريقة الدفع غير موجودة/);
  });
});

describe('DRVO-016 wage-source audit binds the tenant', () => {
  it('every TblEmp / TblCashMove query carries the tenant', async () => {
    const { getEmployeeLedgerWageSourceAudit } = await import('@/lib/services/employeeLedgerWageSourceAuditService');
    await getEmployeeLedgerWageSourceAudit('2026-09', null, B);
    const relevant = h.statements.filter(
      (s) => /\bFROM dbo\.(TblEmp|TblCashMove|TblEmpLedgerEntry|TblEmpDailyPayroll)\b/.test(s.text),
    );
    expect(relevant.length).toBeGreaterThan(0);
    for (const s of relevant) {
      expect(s.text).toMatch(/TenantId = @tenantId/);
      expect(s.params.tenantId).toBe(B);
    }
  });

  it('rejects a missing tenant', async () => {
    const { getEmployeeLedgerWageSourceAudit } = await import('@/lib/services/employeeLedgerWageSourceAuditService');
    await expect(getEmployeeLedgerWageSourceAudit('2026-09', null, '')).rejects.toThrow();
  });
});

describe('DRVO-016 CUT compatibility policy', () => {
  it('CUT branch codes keep their labels and all-scope set; other tenants use names', async () => {
    const policy = await import('@/lib/hr/legacyHrBranchPolicy');
    expect(policy.hrBranchLabel({ branchCode: 'GLEEM', branchName: 'Gleem' })).toBe('جليم');
    expect(policy.hrBranchLabel({ branchCode: 'CAMP_CAESAR', branchName: 'Camp' })).toBe('كامب شيزار');
    expect(policy.hrBranchLabel({ branchCode: 'B_MAIN', branchName: 'Downtown' })).toBe('Downtown');
    expect(policy.isLegacyHrPrimaryBranch('GLEEM')).toBe(true);
    expect(policy.isLegacyHrPrimaryBranch('B_MAIN')).toBe(false);

    const cut = [
      { branchCode: 'GLEEM' },
      { branchCode: 'HQ' },
      { branchCode: 'CAMP_CAESAR' },
    ];
    expect(policy.legacyHrAllScopeBranches(cut).map((b) => b.branchCode)).toEqual(['GLEEM', 'CAMP_CAESAR']);
    const other = [{ branchCode: 'B_MAIN' }, { branchCode: 'B_2' }];
    expect(policy.legacyHrAllScopeBranches(other)).toEqual(other);
  });

  it('employeeScope accepts any tenant branch code and keeps CUT aliases', async () => {
    const { parseDailyPayrollEmployeeScope } = await import('@/lib/payroll/dailyPayrollEmployeeScope.shared');
    expect(parseDailyPayrollEmployeeScope('camp')).toBe('CAMP_CAESAR');
    expect(parseDailyPayrollEmployeeScope('b_main')).toBe('B_MAIN');
    expect(parseDailyPayrollEmployeeScope('all')).toBe('all');
    expect(parseDailyPayrollEmployeeScope("x' OR 1=1")).toBe('active');
  });

  it('branch badge colours follow the tenant branch order', async () => {
    const { hrBranchPalette } = await import('@/lib/hr/hrBranchUi');
    const cut = ['GLEEM', 'CAMP_CAESAR'];
    expect(hrBranchPalette('GLEEM', cut).badge).toMatch(/sky/);
    expect(hrBranchPalette('CAMP_CAESAR', cut).badge).toMatch(/amber/);
    expect(hrBranchPalette('B_MAIN', ['B_MAIN']).badge).toMatch(/sky/);
    expect(hrBranchPalette('GLEEM', ['B_MAIN']).badge).toMatch(/zinc/);
  });

  it('service catalog IDs belong to CASHER_BOOT only', async () => {
    const cfg = await import('@/lib/services/tenantServiceCatalogConfig');
    expect(cfg.serviceCatalogForTenantCode('CASHER_BOOT').quickQueueServiceId).toBe(9);
    expect(cfg.serviceCatalogForTenantCode('CASHER_BOOT').barberProIds.hair).toEqual([1, 4, 5]);
    expect(cfg.serviceCatalogForTenantCode('ACME').quickQueueServiceId).toBeNull();
    expect(cfg.serviceCatalogForTenantCode('ACME').barberProIds.hair).toEqual([]);
  });
});
