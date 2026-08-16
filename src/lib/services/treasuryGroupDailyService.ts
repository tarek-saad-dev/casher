/**
 * Super-admin consolidated daily treasury across all active branches.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { listActiveBranches } from '@/lib/branch/repository';
import { EMPLOYEE_FUNDING_CATEGORY_NAME } from '@/lib/services/employeeLedgerFundingService';
import type {
  GroupDailyBranchSummary,
  GroupDailyDayStatus,
  GroupDailyIntegrityAlert,
  GroupDailyPaymentMethod,
  GroupDailyTreasuryResult,
} from '@/lib/types/treasury-group-daily';

export type {
  GroupDailyBranchSummary,
  GroupDailyDayStatus,
  GroupDailyIntegrityAlert,
  GroupDailyPaymentMethod,
  GroupDailyTreasuryResult,
} from '@/lib/types/treasury-group-daily';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pmKey(id: number | null): string {
  return id == null ? 'unassigned' : String(id);
}

export async function loadGroupDailyTreasury(day: string): Promise<GroupDailyTreasuryResult> {
  const db = await getPool();
  const branches = await listActiveBranches();

  const dayRows = await db
    .request()
    .input('day', sql.Date, day)
    .query(`
      SELECT ID, BranchID, Status
      FROM dbo.TblNewDay
      WHERE NewDay = @day
    `);

  const dayByBranch = new Map<number, { id: number; status: boolean }>();
  for (const r of dayRows.recordset as Array<{ ID: number; BranchID: number; Status: boolean | number }>) {
    dayByBranch.set(Number(r.BranchID), {
      id: Number(r.ID),
      status: Boolean(r.Status),
    });
  }

  const moveRows = await db
    .request()
    .input('day', sql.Date, day)
    .input('employeeFundingCategory', sql.NVarChar(200), EMPLOYEE_FUNDING_CATEGORY_NAME)
    .query(`
      SELECT
        cm.BranchID,
        cm.PaymentMethodID,
        COALESCE(NULLIF(LTRIM(RTRIM(pm.PaymentMethod)), N''), N'طريقة دفع غير محددة') AS PaymentMethod,
        sm.UserID,
        u.UserName,
        SUM(CASE WHEN cm.inOut = N'in' THEN cm.GrandTolal ELSE 0 END) AS Inflow,
        SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS Outflow,
        COUNT(cm.ID) AS TransactionCount,
        SUM(CASE WHEN cm.inOut = N'in' AND cm.invType = N'مبيعات' THEN cm.GrandTolal ELSE 0 END) AS SalesInflow,
        SUM(CASE
          WHEN cm.inOut = N'in'
           AND cm.invType = N'ايرادات'
           AND ISNULL(cat.CatName, N'') <> @employeeFundingCategory
          THEN cm.GrandTolal ELSE 0 END) AS IncomeInflow,
        SUM(CASE WHEN cm.inOut = N'out' AND cm.invType = N'مصروفات' THEN cm.GrandTolal ELSE 0 END) AS ExpenseOutflow
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblPaymentMethods pm ON pm.PaymentID = cm.PaymentMethodID
      LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
      LEFT JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      WHERE (sm.ID IS NULL OR sm.BranchID = cm.BranchID)
        AND (
          EXISTS (
            SELECT 1 FROM dbo.TblNewDay d
            WHERE d.ID = cm.BusinessDayID
              AND d.BranchID = cm.BranchID
              AND d.NewDay = @day
          )
          OR (
            cm.BusinessDayID IS NULL
            AND CAST(cm.invDate AS DATE) = @day
          )
        )
      GROUP BY
        cm.BranchID,
        cm.PaymentMethodID,
        COALESCE(NULLIF(LTRIM(RTRIM(pm.PaymentMethod)), N''), N'طريقة دفع غير محددة'),
        sm.UserID,
        u.UserName
    `);

  type AggRow = {
    BranchID: number;
    PaymentMethodID: number | null;
    PaymentMethod: string;
    UserID: number | null;
    UserName: string | null;
    Inflow: number;
    Outflow: number;
    TransactionCount: number;
    SalesInflow: number;
    IncomeInflow: number;
    ExpenseOutflow: number;
  };

  const rows = moveRows.recordset as AggRow[];

  const branchMaps = new Map<
    number,
    {
      pm: Map<string, GroupDailyPaymentMethod>;
      users: Map<number, { userId: number; userName: string; net: number; transactionCount: number }>;
      totalInflow: number;
      totalOutflow: number;
      cashNet: number;
      salesInflow: number;
      incomeInflow: number;
      expenseOutflow: number;
      transactionCount: number;
    }
  >();

  const groupPm = new Map<string, GroupDailyPaymentMethod>();

  for (const row of rows) {
    const branchId = Number(row.BranchID);
    if (!branchMaps.has(branchId)) {
      branchMaps.set(branchId, {
        pm: new Map(),
        users: new Map(),
        totalInflow: 0,
        totalOutflow: 0,
        cashNet: 0,
        salesInflow: 0,
        incomeInflow: 0,
        expenseOutflow: 0,
        transactionCount: 0,
      });
    }
    const b = branchMaps.get(branchId)!;
    const inflow = Number(row.Inflow) || 0;
    const outflow = Number(row.Outflow) || 0;
    const net = inflow - outflow;
    const tx = Number(row.TransactionCount) || 0;
    const sales = Number(row.SalesInflow) || 0;
    const income = Number(row.IncomeInflow) || 0;
    const expense = Number(row.ExpenseOutflow) || 0;
    const pmId = row.PaymentMethodID == null ? null : Number(row.PaymentMethodID);
    const key = pmKey(pmId);
    const name = row.PaymentMethod || 'طريقة دفع غير محددة';

    b.totalInflow += inflow;
    b.totalOutflow += outflow;
    b.transactionCount += tx;
    b.salesInflow += sales;
    b.incomeInflow += income;
    b.expenseOutflow += expense;
    if (name.includes('نقد')) b.cashNet += net;

    const bpm = b.pm.get(key) ?? {
      paymentMethodId: pmId,
      paymentMethodKey: key,
      paymentMethodName: name,
      inflow: 0,
      outflow: 0,
      net: 0,
      transactionCount: 0,
      salesInflow: 0,
      incomeInflow: 0,
      percentageOfTotal: 0,
    };
    bpm.inflow += inflow;
    bpm.outflow += outflow;
    bpm.net += net;
    bpm.transactionCount += tx;
    bpm.salesInflow += sales;
    bpm.incomeInflow += income;
    b.pm.set(key, bpm);

    if (row.UserID != null) {
      const uid = Number(row.UserID);
      const u = b.users.get(uid) ?? {
        userId: uid,
        userName: row.UserName || `User #${uid}`,
        net: 0,
        transactionCount: 0,
      };
      u.net += net;
      u.transactionCount += tx;
      b.users.set(uid, u);
    }

    const gpm = groupPm.get(key) ?? {
      paymentMethodId: pmId,
      paymentMethodKey: key,
      paymentMethodName: name,
      inflow: 0,
      outflow: 0,
      net: 0,
      transactionCount: 0,
      salesInflow: 0,
      incomeInflow: 0,
      percentageOfTotal: 0,
    };
    gpm.inflow += inflow;
    gpm.outflow += outflow;
    gpm.net += net;
    gpm.transactionCount += tx;
    gpm.salesInflow += sales;
    gpm.incomeInflow += income;
    groupPm.set(key, gpm);
  }

  let totalInflow = 0;
  let totalOutflow = 0;
  let cashNet = 0;
  let transactionCount = 0;
  let salesInflow = 0;
  let incomeInflow = 0;
  let expenseOutflow = 0;
  let openDayCount = 0;
  let closedDayCount = 0;
  let missingDayCount = 0;
  let branchesWithActivity = 0;

  const branchSummaries: GroupDailyBranchSummary[] = branches.map((br) => {
    const dayInfo = dayByBranch.get(br.branchId);
    let dayStatus: GroupDailyDayStatus = 'missing';
    if (dayInfo) {
      dayStatus = dayInfo.status ? 'open' : 'closed';
      if (dayInfo.status) openDayCount += 1;
      else closedDayCount += 1;
    } else {
      missingDayCount += 1;
    }

    const agg = branchMaps.get(br.branchId);
    const inflow = round2(agg?.totalInflow ?? 0);
    const outflow = round2(agg?.totalOutflow ?? 0);
    const net = round2(inflow - outflow);
    const tx = agg?.transactionCount ?? 0;
    if (tx > 0) branchesWithActivity += 1;

    totalInflow += inflow;
    totalOutflow += outflow;
    cashNet += round2(agg?.cashNet ?? 0);
    transactionCount += tx;
    salesInflow += round2(agg?.salesInflow ?? 0);
    incomeInflow += round2(agg?.incomeInflow ?? 0);
    expenseOutflow += round2(agg?.expenseOutflow ?? 0);

    const paymentMethods = [...(agg?.pm.values() ?? [])]
      .map((pm) => ({
        ...pm,
        inflow: round2(pm.inflow),
        outflow: round2(pm.outflow),
        net: round2(pm.net),
        salesInflow: round2(pm.salesInflow),
        incomeInflow: round2(pm.incomeInflow),
        percentageOfTotal: net !== 0 ? round2((pm.net / net) * 100) : 0,
      }))
      .sort((a, b) => b.net - a.net);

    const topUsers = [...(agg?.users.values() ?? [])]
      .map((u) => ({ ...u, net: round2(u.net) }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, 5);

    return {
      branchId: br.branchId,
      branchCode: br.branchCode,
      branchName: br.branchName,
      dayStatus,
      businessDayId: dayInfo?.id ?? null,
      totalInflow: inflow,
      totalOutflow: outflow,
      grandNet: net,
      cashNet: round2(agg?.cashNet ?? 0),
      transactionCount: tx,
      salesInflow: round2(agg?.salesInflow ?? 0),
      incomeInflow: round2(agg?.incomeInflow ?? 0),
      expenseOutflow: round2(agg?.expenseOutflow ?? 0),
      paymentMethods,
      topUsers,
    };
  });

  branchSummaries.sort((a, b) => b.grandNet - a.grandNet || a.branchName.localeCompare(b.branchName, 'ar'));

  const grandNet = round2(totalInflow - totalOutflow);
  const paymentMethods = [...groupPm.values()]
    .map((pm) => ({
      ...pm,
      inflow: round2(pm.inflow),
      outflow: round2(pm.outflow),
      net: round2(pm.net),
      salesInflow: round2(pm.salesInflow),
      incomeInflow: round2(pm.incomeInflow),
      percentageOfTotal: grandNet !== 0 ? round2((pm.net / grandNet) * 100) : 0,
    }))
    .sort((a, b) => b.net - a.net);

  const topPaymentMethod =
    paymentMethods.length > 0 ? paymentMethods[0].paymentMethodName : null;

  // Integrity alerts for the selected calendar day (cross-branch audit aids)
  const alertRes = await db
    .request()
    .input('day', sql.Date, day)
    .query(`
      SELECT
        (SELECT COUNT(*)
         FROM dbo.TblCashMove cm
         INNER JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID
         WHERE cm.BranchID <> sm.BranchID
           AND (
             EXISTS (
               SELECT 1 FROM dbo.TblNewDay d
               WHERE d.ID = cm.BusinessDayID AND d.NewDay = @day
             )
             OR (cm.BusinessDayID IS NULL AND CAST(cm.invDate AS DATE) = @day)
           )
        ) AS CashShiftMismatch,
        (SELECT COUNT(*)
         FROM dbo.TblinvServHead h
         INNER JOIN dbo.TblShiftMove sm ON sm.ID = h.ShiftMoveID
         WHERE h.BranchID <> sm.BranchID
           AND (
             EXISTS (
               SELECT 1 FROM dbo.TblNewDay d
               WHERE d.ID = h.BusinessDayID AND d.NewDay = @day
             )
             OR (h.BusinessDayID IS NULL AND CAST(h.invDate AS DATE) = @day)
           )
        ) AS SaleShiftMismatch
    `);

  const alerts: GroupDailyIntegrityAlert[] = [];
  const cashShiftMismatch = Number(alertRes.recordset[0]?.CashShiftMismatch ?? 0);
  const saleShiftMismatch = Number(alertRes.recordset[0]?.SaleShiftMismatch ?? 0);
  if (cashShiftMismatch > 0) {
    alerts.push({
      code: 'CASH_SHIFT_BRANCH_MISMATCH',
      message: 'حركات خزنة مربوطة بوردية فرع مختلف عن فرع الحركة',
      count: cashShiftMismatch,
    });
  }
  if (saleShiftMismatch > 0) {
    alerts.push({
      code: 'SALE_SHIFT_BRANCH_MISMATCH',
      message: 'فواتير مبيعات فرعها مختلف عن فرع الوردية',
      count: saleShiftMismatch,
    });
  }

  return {
    day,
    groupSummary: {
      totalInflow: round2(totalInflow),
      totalOutflow: round2(totalOutflow),
      grandNet,
      cashNet: round2(cashNet),
      transactionCount,
      salesInflow: round2(salesInflow),
      incomeInflow: round2(incomeInflow),
      expenseOutflow: round2(expenseOutflow),
      topPaymentMethod,
      branchCount: branches.length,
      openDayCount,
      closedDayCount,
      missingDayCount,
      branchesWithActivity,
    },
    paymentMethods,
    branches: branchSummaries,
    alerts,
  };
}
