import 'server-only';
import { createHash } from 'node:crypto';
import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate } from '@/lib/businessDate';

import { calculateRetroBranchImpacts, validateRetroInput, prorateSalary, type RetroInput, type RetroBranchImpact } from './payrollAgreementMath';
export type { RetroBranch, RetroInput } from './payrollAgreementMath';

export type RetroDailyRow = {
  id:number; branchId:number; date:string; amount:number; status:string;
  superseded:boolean; ledgerCount:number; ledgerAmount:number; ledgerBranchId:number|null;
  ledgerDirection:string|null; ledgerMonth:string|null; ledgerCashMoveId:number|null;
};
export type RetroPreview = {
  month:string; effectiveFrom:string; previousDailyAmount:number;
  previousLedgerCredits:number; proposedMonthlyAmount:number;
  difference:number; dailyCount:number; paidOut:number;
  advances:number; deductions:number; proratedDays:number;
  daysInMonth:number; blockers:string[]; dailyRows:RetroDailyRow[]; fingerprint:string;
  branchImpacts: RetroBranchImpact[];
};
const money=(n:number)=>Math.round(n*100)/100;
const formatDate=(v:Date|string)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);

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

  // A normal application health check does not guarantee the payroll V2
  // migration exists. Fail with an actionable message before querying it.
  const schema = await rq().query(`
    SELECT
      COL_LENGTH(N'dbo.TblEmpDailyPayroll', N'SupersededByPayrollRevisionID') AS RevisionColumn,
      OBJECT_ID(N'dbo.TblEmpPayrollAgreementRevision', N'U') AS RevisionTable
  `);
  if (schema.recordset[0]?.RevisionColumn == null ||
      schema.recordset[0]?.RevisionTable == null) {
    throw new Error('معاينة التسويات غير جاهزة على قاعدة البيانات. يلزم اختبار وتطبيق Payroll V2 Migration قبل الاستخدام.');
  }

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
  // The preview endpoint must be read-only without escalation to update locks.
  // During APPLY, retain locks for the whole serializable transaction.
  const sourceLock = params.transaction ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
  // Always reconcile each original payroll source to its own active ledger credit.
  // The review cannot approve orphan, misclassified or cross-branch wages.
  const source = await rq().input('emp',sql.Int,params.empId).input('start',sql.Date,start).input('today',sql.Date,today)
    .query([
      'SELECT p.ID, p.BranchID, p.WorkDate, p.DailyWage, p.Status,',
      'p.SupersededByPayrollRevisionID,',
      'w.LedgerCount, w.LedgerAmount, w.LedgerBranchId,',
      'w.LedgerDirection, w.LedgerMonth, w.LedgerCashMoveId',
      'FROM dbo.TblEmpDailyPayroll p '+sourceLock,
      'OUTER APPLY (',
      'SELECT COUNT_BIG(*) AS LedgerCount, SUM(le.Amount) AS LedgerAmount,',
      'MIN(le.BranchID) AS LedgerBranchId,',
      'MIN(le.EntryDirection) AS LedgerDirection,',
      'MIN(le.PayrollMonth) AS LedgerMonth,',
      'MAX(le.CashMoveID) AS LedgerCashMoveId',
      'FROM dbo.TblEmpLedgerEntry le '+sourceLock,
      "WHERE le.RefType=N'TblEmpDailyPayroll' AND le.RefID=p.ID",
      "AND le.EmpID=p.EmpID AND le.EntryReason=N'hourly_wage' AND le.IsVoided=0",
      ') w',
      'WHERE p.EmpID=@emp AND p.WorkDate BETWEEN @start AND @today',
      'ORDER BY p.WorkDate,p.BranchID,p.ID'
    ].join(' '));
  const dailyRows: RetroDailyRow[] = source.recordset.map((x: Record<string,unknown>)=>({
    id:Number(x.ID), branchId:Number(x.BranchID), date:formatDate(x.WorkDate as Date),
    amount:money(Number(x.DailyWage||0)), status:String(x.Status||''),
    superseded:x.SupersededByPayrollRevisionID!=null,
    ledgerCount:Number(x.LedgerCount||0), ledgerAmount:money(Number(x.LedgerAmount||0)),
    ledgerBranchId:x.LedgerBranchId==null?null:Number(x.LedgerBranchId),
    ledgerDirection:x.LedgerDirection==null?null:String(x.LedgerDirection),
    ledgerMonth:x.LedgerMonth==null?null:String(x.LedgerMonth),
    ledgerCashMoveId:x.LedgerCashMoveId==null?null:Number(x.LedgerCashMoveId),
  }));
  if (dailyRows.some(x=>!expectedBranches.has(x.branchId))) blocker.push('يوجد أجر سابق في فرع غير موجود بالاتفاقية الجديدة');
  if (dailyRows.some(x=>x.status!=='Generated')) blocker.push('يوجد أجر يومي بحالة مرحّلة أو مقفولة؛ يلزم تسوية مالية معتمدة');
  if (dailyRows.some(x=>x.superseded)) blocker.push('تم إلغاء بعض اليوميات بالفعل عبر تسوية سابقة');
  const month = start.slice(0,7);
  if (dailyRows.some(x=>x.ledgerCount!==1 || x.ledgerBranchId!==x.branchId ||
      x.ledgerDirection!=='credit' || x.ledgerMonth!==month ||
      x.ledgerCashMoveId!=null || x.ledgerAmount!==x.amount)) {
    blocker.push('يوجد اختلاف في قيد أجر يومية واحد أو أكثر: العدد أو المبلغ أو الفرع أو الشهر؛ يجب مراجعة دفتر الموظف قبل التسوية');
  }

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
  const oldLedgerFromSources=money(dailyRows.reduce((sum,x)=>sum+x.ledgerAmount,0));
  if (oldLedgerFromSources !== money(Number(l.DailyCredits||0))) {
    blocker.push('إجمالي أجور اليوميات لا يطابق قيود الأجور النشطة في الدفتر؛ يجب المراجعة قبل التسوية');
  }
  const portion=prorateSalary(start,1);
  const branchImpacts=calculateRetroBranchImpacts(start,enabled,dailyRows);
  const newAmount=money(branchImpacts.reduce((sum,b)=>sum+b.newEntitlement,0));
  const snapshot = {
    empId:params.empId,tenantId:params.tenantId,month,effectiveFrom:start,
    branches:[...params.input.branches].sort((a,b)=>a.branchId-b.branchId),
    dailyRows, ledgerTotals:{
      dailyCredits:money(Number(l.DailyCredits||0)),monthlyCount:Number(l.MonthlyCount||0),
      payouts:money(Number(l.Payouts||0)),advances:money(Number(l.Advances||0)),
      deductions:money(Number(l.Deductions||0)),
    }, pendingCount:Number(pending.recordset[0].Cnt||0),
    orphanCount:Number(orphan.recordset[0].Cnt||0),
    effectiveScope:employee.recordset[0].PayrollScope,
    activeAssignments:[...active].sort((a,b)=>a-b),
  };
  const fingerprint=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return {
    month,effectiveFrom:start,previousDailyAmount:oldAmount,
    previousLedgerCredits:money(Number(l.DailyCredits||0)),
    proposedMonthlyAmount:newAmount,difference:money(newAmount-money(Number(l.DailyCredits||0))),
    dailyCount:dailyRows.length,paidOut:money(Number(l.Payouts||0)),
    advances:money(Number(l.Advances||0)),deductions:money(Number(l.Deductions||0)),
    proratedDays:portion.days,daysInMonth:portion.monthDays,
    blockers:blocker,dailyRows,fingerprint,branchImpacts,
  };
}
