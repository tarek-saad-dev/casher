import 'server-only';
import { getPool, sql } from '@/lib/db';
import { assertLegacyBranchInTenant } from '@/platform/tenant/tenantContext';
import { getFinancialSummary, getDailyFinancialData } from '@/lib/services/TreasurySummaryService';
import { getAllEmployeesRevenueTotal } from '@/lib/reports/employeeServicesRevenue';
import { getPayrollExpenseFromLedger } from '@/lib/accounting/payrollExpenseFromLedger';
import { addDays, buildCashForecast, type Commitment, type Settlement, type CommitmentKind, type Frequency } from './forecast';

export interface BranchForFinance { branchId: number; branchCode: string; branchName: string }
export interface FinanceOverview {
  asOf: string;
  scopeKey: string;
  branches: Array<BranchForFinance & {
    bookCash: number; confirmedAvailableCash: number | null; servicesRevenueMTD: number; treasuryNetMTD: number;
    payrollAccruedMTD: number; recentCashIn: number; recentCashOut: number; recentTransactions: number; recentObservedDays: number;
  }>;
  totals: { bookCash: number; confirmedAvailableCash: number | null; servicesRevenueMTD: number; treasuryNetMTD: number; payrollAccruedMTD: number };
  forecast: ReturnType<typeof buildCashForecast>;
  warnings: string[];
  snapshots: Array<{ id: number; asOfDate: string; createdAt: string }>;
}

export async function assertFinanceBranches(tenantId: string, branches: BranchForFinance[]): Promise<void> {
  if (!branches.length) throw new Error('No accessible branches');
  const db = await getPool();
  await Promise.all(branches.map(b => assertLegacyBranchInTenant(tenantId, b.branchId, { executor: db })));
}
export function financeScopeKey(branches: BranchForFinance[]): string {
  return 'branches:' + branches.map(b => b.branchId).sort((a,b)=>a-b).join(',');
}

function dateString(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0,10) : String(v ?? '').slice(0,10);
}
async function readCommitments(tenantId: string, branches: BranchForFinance[]): Promise<{
  commitments: Commitment[]; settlements: Settlement[];
}> {
  const db = await getPool();
  const req = db.request().input('tenant', sql.UniqueIdentifier, tenantId);
  const named = branches.map((b,i) => {
    req.input('branch' + i, sql.Int, b.branchId);
    return '@branch' + i;
  });
  const result = await req.query(
    'SELECT ID, BranchID, Title, Kind, Amount, DueDate, Frequency, EndDate FROM dbo.TblFinInsightCommitment WHERE TenantId=@tenant AND IsActive=1 AND BranchID IN (' + named.join(',') + ')'
  );
  const commitments: Commitment[] = result.recordset.map((r: Record<string, unknown>) => ({
    id: Number(r.ID), branchId: Number(r.BranchID), title: String(r.Title),
    kind: String(r.Kind) as CommitmentKind, amount: Number(r.Amount),
    dueDate: dateString(r.DueDate), frequency: String(r.Frequency) as Frequency,
    endDate: r.EndDate ? dateString(r.EndDate) : null,
  }));
  if (!commitments.length) return { commitments, settlements: [] };
  const paymentReq = db.request().input('tenant', sql.UniqueIdentifier, tenantId);
  const names = branches.map((b,i) => {
    paymentReq.input('branch' + i, sql.Int, b.branchId);
    return '@branch' + i;
  });
  const payments = await paymentReq.query(
    'SELECT p.CommitmentID, p.DueDate, p.Amount FROM dbo.TblFinInsightSettlement p INNER JOIN dbo.TblFinInsightCommitment c ON c.ID=p.CommitmentID WHERE c.TenantId=@tenant AND c.BranchID IN (' + names.join(',') + ')'
  );
  const settlements: Settlement[] = payments.recordset.map((r: Record<string, unknown>) => ({
    commitmentId: Number(r.CommitmentID), dueDate: dateString(r.DueDate), amount: Number(r.Amount),
  }));
  return { commitments, settlements };
}
export async function loadFinanceOverview(tenantId: string, branches: BranchForFinance[], asOf: string): Promise<FinanceOverview> {
  await assertFinanceBranches(tenantId, branches);
  const monthStart = asOf.slice(0,7) + '-01';
  const year = Number(asOf.slice(0,4));
  const month = Number(asOf.slice(5,7));
  const historyStart = addDays(asOf, -13);
  const db = await getPool();
  const [perBranch, ledger, snapshotRows] = await Promise.all([
    Promise.all(branches.map(async (b) => {
      const [mtd, recent, sales, payroll, balance, observed, liquidity] = await Promise.all([
        getFinancialSummary({ fromDate: monthStart, toDate: asOf, branchId: b.branchId }),
        getFinancialSummary({ fromDate: historyStart, toDate: asOf, branchId: b.branchId }),
        getAllEmployeesRevenueTotal(monthStart, addDays(asOf,1), b.branchId),
        getPayrollExpenseFromLedger({ year, month, branchId: b.branchId }),
        db.request().input('branchId', sql.Int, b.branchId).query(
          'SELECT COALESCE(SUM(CASE WHEN inOut=N\'in\' THEN GrandTolal WHEN inOut=N\'out\' THEN -GrandTolal ELSE 0 END),0) AS BookCash FROM dbo.TblCashMove WHERE BranchID=@branchId'
        ),
        getDailyFinancialData(historyStart, asOf, b.branchId),
        db.request().input('tenant', sql.UniqueIdentifier, tenantId).input('branchId', sql.Int, b.branchId).input('day', sql.Date, asOf)
          .query('SELECT TOP 1 AvailableAmount FROM dbo.TblFinInsightLiquidityCheck WHERE TenantId=@tenant AND BranchID=@branchId AND AsOfDate=@day ORDER BY ID DESC'),
      ]);
      return {
        ...b, bookCash: Number(balance.recordset[0]?.BookCash || 0),
        confirmedAvailableCash: liquidity.recordset[0] ? Number(liquidity.recordset[0].AvailableAmount) : null,
        servicesRevenueMTD: sales, treasuryNetMTD: mtd.netAmount,
        payrollAccruedMTD: payroll.totalPayrollExpense,
        recentCashIn: recent.totalIncoming, recentCashOut: recent.totalOutgoing,
        recentTransactions: recent.transactionsCount,
        recentObservedDays: observed.filter(d=>d.incoming!==0||d.outgoing!==0).length,
      };
    })),
    readCommitments(tenantId, branches),
    db.request().input('tenant', sql.UniqueIdentifier, tenantId)
      .input('scope', sql.NVarChar(200), financeScopeKey(branches))
      .query('SELECT TOP 8 ID, AsOfDate, CreatedAt FROM dbo.TblFinInsightSnapshot WHERE TenantId=@tenant AND ScopeKey=@scope ORDER BY AsOfDate DESC'),
  ]);
  const sum = (pick: (row: (typeof perBranch)[number]) => number) => Math.round(perBranch.reduce((s,r)=>s+pick(r),0)*100)/100;
  const confirmedAvailableCash = perBranch.every(b=>b.confirmedAvailableCash!==null) ? sum(b=>b.confirmedAvailableCash ?? 0) : null;
  const totals = {
    bookCash: sum(b=>b.bookCash), confirmedAvailableCash,
    servicesRevenueMTD: sum(b=>b.servicesRevenueMTD),
    treasuryNetMTD: sum(b=>b.treasuryNetMTD),
    payrollAccruedMTD: sum(b=>b.payrollAccruedMTD),
  };
  const seenTransactions = perBranch.reduce((s,b)=>s+b.recentTransactions,0);
  const sufficientHistory = seenTransactions>0 && perBranch.every(b=>b.recentObservedDays>=7);
  const dailyReceiptsEstimate = sufficientHistory ? sum(b=>b.recentCashIn)/14 : null;
  const dailyOperatingOutflowEstimate = sufficientHistory ? sum(b=>b.recentCashOut)/14 : null;
  const forecast = buildCashForecast({
    today: asOf,
    bookCash: confirmedAvailableCash,
    dailyReceiptsEstimate,
    dailyOperatingOutflowEstimate,
    commitments: ledger.commitments, settlements: ledger.settlements,
  });
  const warnings = [
    'رصيد الخزنة الدفتري ليس بديلًا عن الرصيد القابل للصرف؛ توقع السيولة يتطلب تأكيد رصيد كل فرع بتاريخ اليوم.',
    'التوقع يستخدم متوسط حركة الخزنة لآخر 14 يومًا مع الالتزامات المسجلة؛ قد يحدث تكرار لتكاليف دورية ضمن المتوسط. راجع النتائج قبل اتخاذ قرار.',
    'الالتزامات غير المسجلة وتغيرات الإيراد المستقبلية غير مضمونة ضمن التوقع.',
    'رواتب دفتر الموظفين المعروضة تكلفة مستحقة مسجلة وليست بالضرورة مبلغ الرواتب غير المدفوعة؛ لا تُخصم تلقائيًا مرة ثانية.',
  ];
  if (confirmedAvailableCash === null) warnings.push('لا يوجد تأكيد حديث لسيولة كل الفروع المعروضة؛ توقع العجز غير مكتمل حتى تتم المطابقة.');
  if (!sufficientHistory) warnings.push('لا تتوفر حركة مسجلة في 7 أيام مختلفة على الأقل لكل فرع خلال آخر 14 يومًا؛ توقع السيولة غير مكتمل.');
  if (ledger.commitments.length === 0) warnings.push('لم يتم تسجيل أي إيجار أو دين أو قسط حتى الآن، وبالتالي التنبيه على الاستحقاقات غير مكتمل.');
  return {
    asOf, scopeKey: financeScopeKey(branches), branches: perBranch, totals, forecast, warnings,
    snapshots: snapshotRows.recordset.map((r: Record<string,unknown>)=>({
      id: Number(r.ID), asOfDate: dateString(r.AsOfDate), createdAt: r.CreatedAt instanceof Date ? r.CreatedAt.toISOString() : String(r.CreatedAt),
    })),
  };
}
