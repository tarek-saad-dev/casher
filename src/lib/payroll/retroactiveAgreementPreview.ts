import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate } from '@/lib/businessDate';

export type RetroBranch = { branchId: number; enabled: boolean; monthlySalary: number };
export type RetroInput = { effectiveFrom: string; branches: RetroBranch[]; reason: string; requestKey?: string };
export type RetroDailyRow = { id: number; branchId: number; date: string; amount: number; status: string; superseded: boolean };
export type RetroPreview = {
  month: string; effectiveFrom: string; previousDailyAmount: number;
  previousLedgerCredits: number; proposedMonthlyAmount: number;
  difference: number; dailyCount: number; paidOut: number;
  advances: number; deductions: number; proratedDays: number;
  daysInMonth: number; blockers: string[]; dailyRows: RetroDailyRow[];
};

const money = (n: number) => Math.round(n * 100) / 100;
const formatDate = (value: Date | string) => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function validateRetroInput(input: RetroInput): void {
  if (!input || typeof input.effectiveFrom !== 'string' ||
      !dateRegex.test(input.effectiveFrom) ||
      Number.isNaN(Date.parse(input.effectiveFrom)) ||
      new Date(input.effectiveFrom).toISOString().slice(0,10) !== input.effectiveFrom) {
    throw new Error('تاريخ الاتفاقية غير صالح');
  }
  if (!Array.isArray(input.branches) || !input.branches.length ||
      !input.branches.some((x) => x.enabled) ||
      new Set(input.branches.map((x) => x.branchId)).size !== input.branches.length ||
      input.branches.some((x) => !Number.isSafeInteger(x.branchId) || x.branchId < 1 ||
        typeof x.enabled !== 'boolean' ||
        (x.enabled && (!Number.isFinite(x.monthlySalary) || x.monthlySalary <= 0 ||
          x.monthlySalary > 100000000 || money(x.monthlySalary) !== x.monthlySalary)))) {
    throw new Error('حدد مرتبًا صحيحًا لكل فرع مفعل');
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length < 8 ||
      input.reason.length > 500) {
    throw new Error('سبب تعديل القبض مطلوب (8 أحرف على الأقل)');
  }
}
export function prorateSalary(effectiveFrom: string, salary: number) {
  const day = Number(effectiveFrom.slice(8,10));
  const monthDays = new Date(Date.UTC(Number(effectiveFrom.slice(0,4)), Number(effectiveFrom.slice(5,7)), 0)).getUTCDate();
  const days = monthDays - day + 1;
  return { days, monthDays, amount: money(salary * days / monthDays) };
}

export async function previewRetroVip(params: {
  empId: number; tenantId: string; input: RetroInput; transaction?: sql.Transaction;
}): Promise<RetroPreview> {
  validateRetroInput(params.input);
  if (!Number.isSafeInteger(params.empId) || params.empId < 1) throw new Error('موظف غير صالح');
  const today = getCairoBusinessDate();
  const start = params.input.effectiveFrom;
  if (start > today || start.slice(0,7) !== today.slice(0,7)) {
    throw new Error('التسوية الآلية متاحة داخل الشهر الجاري فقط؛ الفترات المقفولة تحتاج تسوية محاسبية مستقلة');
  }
  const pool = await getPool();
  const rq = () => params.transaction ? new sql.Request(params.transaction) : pool.request();
  const employee = await rq().input('emp',sql.Int,params.empId)
    .input('tenant',sql.UniqueIdentifier,params.tenantId)
    .query('SELECT EmpID, PayrollScope, EmploymentType FROM dbo.TblEmp WHERE EmpID=@emp AND TenantId=@tenant');
  if (!employee.recordset.length) throw new Error('الموظف غير موجود');
  if (employee.recordset[0].EmploymentType === 'freelance') throw new Error('المرتب الشهري لا ينطبق على فري لانس');

  const blocker: string[] = [];
  if (employee.recordset[0].PayrollScope !== 'global') blocker.push('توجد بالفعل اتفاقية VIP؛ لا يمكن استبدالها بأثر رجعي بهذا المسار');
  const enabled = params.input.branches.filter(b => b.enabled);
  const expectedBranches = new Set(enabled.map(b => b.branchId));

  const assigned = await rq().input('emp',sql.Int,params.empId).input('start',sql.Date,start)
    .input('tenant',sql.UniqueIdentifier,params.tenantId)
    .query([
      'SELECT b.BranchID, CASE WHEN EXISTS (SELECT 1 FROM dbo.TblEmpBranchAssignment a',
      'WHERE a.EmpID=@emp AND a.BranchID=b.BranchID AND a.IsActive=1',
      'AND a.EffectiveFrom<=@start AND (a.EffectiveTo IS NULL OR a.EffectiveTo>=@start))',
      'THEN 1 ELSE 0 END AS Assigned FROM dbo.TblBranch b WHERE b.IsActive=1',
      'AND EXISTS (SELECT 1 FROM dbo.Location l WHERE l.LegacyBranchId=b.BranchID AND l.TenantId=@tenant)'
    ].join(' '));
  const active = new Set(assigned.recordset.filter((x: {Assigned:number}) => Boolean(x.Assigned))
    .map((x: {BranchID:number}) => Number(x.BranchID)));
  if (enabled.some(b=>!active.has(b.branchId))) blocker.push('يجب تعيين الموظف في كل فرع له مرتب');
  const source = await rq().input('emp',sql.Int,params.empId).input('start',sql.Date,start).input('today',sql.Date,today)
    .query([
      'SELECT ID, BranchID, WorkDate, DailyWage, Status, SupersededByPayrollRevisionID',
      'FROM dbo.TblEmpDailyPayroll WHERE EmpID=@emp AND WorkDate BETWEEN @start AND @today'
    ].join(' '));
  const dailyRows: RetroDailyRow[] = source.recordset.map((x: Record<string,unknown>)=>({
    id:Number(x.ID), branchId:Number(x.BranchID), date:formatDate(x.WorkDate as Date),
    amount:money(Number(x.DailyWage||0)), status:String(x.Status||''),
    superseded:x.SupersededByPayrollRevisionID!=null
  }));
  if (dailyRows.some(x=>!expectedBranches.has(x.branchId))) blocker.push('يوجد أجر سابق في فرع غير موجود بالاتفاقية الجديدة');
  if (dailyRows.some(x=>x.status!=='Generated')) blocker.push('يوجد أجر يومي بحالة مرحّلة أو مقفولة؛ يلزم تسوية مالية معتمدة');
  if (dailyRows.some(x=>x.superseded)) blocker.push('تم إلغاء بعض اليوميات بالفعل عبر تسوية سابقة');

  const month = start.slice(0,7);
  const ledger = await rq().input('emp',sql.Int,params.empId).input('month',sql.NVarChar(7),month)
    .input('start',sql.Date,start)
    .query([
      'SELECT',
      "SUM(CASE WHEN EntryReason=N'hourly_wage' AND EntryDate>=@start AND EntryDirection=N'credit' THEN Amount ELSE 0 END) AS DailyCredits,",
      "SUM(CASE WHEN EntryReason=N'monthly_salary' THEN 1 ELSE 0 END) AS MonthlyCount,",
      "SUM(CASE WHEN EntryReason=N'payout' THEN Amount ELSE 0 END) AS Payouts,",
      "SUM(CASE WHEN EntryReason=N'advance' THEN Amount ELSE 0 END) AS Advances,",
      "SUM(CASE WHEN EntryReason=N'deduction' THEN Amount ELSE 0 END) AS Deductions",
      'FROM dbo.TblEmpLedgerEntry WHERE EmpID=@emp AND PayrollMonth=@month AND IsVoided=0'
    ].join(' '));
  const l=ledger.recordset[0];
  if(Number(l.MonthlyCount)>0) blocker.push('المرتب الشهري للشهر ده مترحّل بالفعل');
  const pending = await rq().input('emp',sql.Int,params.empId).input('start',sql.Date,start)
    .query('SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchPayrollPlan WHERE EmpID=@emp AND IsActive=1 AND EffectiveFrom>=@start');
  if(Number(pending.recordset[0].Cnt)>0) blocker.push('يوجد اتفاق فرع يبدأ في نفس التاريخ أو بعده');
  const orphan = await rq().input('emp',sql.Int,params.empId).input('start',sql.Date,start).input('today',sql.Date,today)
    .query([
      "SELECT COUNT_BIG(*) AS Cnt FROM dbo.TblEmpLedgerEntry l",
      "WHERE l.EmpID=@emp AND l.EntryReason=N'hourly_wage' AND l.IsVoided=0",
      'AND l.EntryDate BETWEEN @start AND @today',
      "AND NOT EXISTS (SELECT 1 FROM dbo.TblEmpDailyPayroll p WHERE p.ID=l.RefID AND l.RefType=N'TblEmpDailyPayroll')"
    ].join(' '));
  if(Number(orphan.recordset[0].Cnt)>0) blocker.push('هناك أجور في الدفتر بلا مصادر يومية مطابقة');
  const oldAmount=money(dailyRows.reduce((sum,x)=>sum+x.amount,0));
  const portion=prorateSalary(start,1);
  const newAmount=money(enabled.reduce((sum,b)=>sum+prorateSalary(start,b.monthlySalary).amount,0));
  return {
    month,effectiveFrom:start,previousDailyAmount:oldAmount,
    previousLedgerCredits:money(Number(l.DailyCredits||0)),
    proposedMonthlyAmount:newAmount,difference:money(newAmount-oldAmount),
    dailyCount:dailyRows.length,paidOut:money(Number(l.Payouts||0)),
    advances:money(Number(l.Advances||0)),deductions:money(Number(l.Deductions||0)),
    proratedDays:portion.days,daysInMonth:portion.monthDays,
    blockers:blocker,dailyRows,
  };
}
