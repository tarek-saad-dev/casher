import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

/**
 * GET /api/treasury/period-summary
 *
 * Returns a per-day aggregated treasury summary for a date range.
 *
 * Query params:
 *   dateFrom  YYYY-MM-DD  (required)
 *   dateTo    YYYY-MM-DD  (required)
 *   userId    number | undefined
 *
 * Response shape: TreasuryPeriodSummaryResponse (see types/treasury.ts)
 */
export async function GET(request: NextRequest) {
  try {
    const db = await getPool();
    const sp = request.nextUrl.searchParams;

    const dateFrom = sp.get('dateFrom');
    const dateTo   = sp.get('dateTo');
    const userIdRaw = sp.get('userId');
    const userId   = userIdRaw && userIdRaw !== 'all' ? parseInt(userIdRaw) : null;

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'dateFrom و dateTo مطلوبان' },
        { status: 400 }
      );
    }

    // ── 1. Load all payment methods ────────────────────────────────────────
    const pmResult = await db.request().query(`
      SELECT PaymentID, ISNULL(PaymentMethod, N'طريقة دفع غير محددة') AS PaymentMethod
      FROM dbo.TblPaymentMethods
      ORDER BY PaymentID ASC
    `);

    const paymentMethods: { id: number; name: string }[] = pmResult.recordset.map((r: any) => ({
      id:   r.PaymentID,
      name: r.PaymentMethod,
    }));

    // ── 2. Build where clause for cash-move query ───────────────────────────
    let whereConditions = ['cm.invDate >= @dateFrom', 'cm.invDate <= @dateTo'];
    const req2 = db.request()
      .input('dateFrom', sql.Date, dateFrom)
      .input('dateTo',   sql.Date, dateTo);

    if (userId !== null) {
      whereConditions.push('sm.UserID = @userId');
      req2.input('userId', sql.Int, userId);
    }

    const whereClause = whereConditions.join(' AND ');

    // ── 3. Per-day × per-payment-method aggregation ─────────────────────────
    //    Uses cm.invDate as the day key (consistent with /treasury/daily).
    //    NULL PaymentMethodID is kept as NULL so it maps to "unknown" later.
    const rawQuery = `
      SELECT
        CONVERT(date, cm.invDate)       AS DayDate,
        cm.PaymentMethodID,
        SUM(CASE WHEN cm.inOut = N'in'  THEN cm.GrandTolal ELSE 0 END) AS Inflow,
        SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS Outflow,
        COUNT(cm.ID)                                                    AS TxCount
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblShiftMove sm ON cm.ShiftMoveID = sm.ID
      WHERE ${whereClause}
      GROUP BY CONVERT(date, cm.invDate), cm.PaymentMethodID
      ORDER BY DayDate ASC, cm.PaymentMethodID ASC
    `;

    const rawResult = await req2.query(rawQuery);

    // ── 4. Load TblNewDay status for the range ─────────────────────────────
    const dayStatusResult = await db.request()
      .input('dateFrom', sql.Date, dateFrom)
      .input('dateTo',   sql.Date, dateTo)
      .query(`
        SELECT NewDay, Status
        FROM dbo.TblNewDay
        WHERE NewDay >= @dateFrom AND NewDay <= @dateTo
      `);

    const dayStatusMap: Record<string, number> = {};
    for (const row of dayStatusResult.recordset) {
      const key = row.NewDay instanceof Date
        ? row.NewDay.toISOString().split('T')[0]
        : String(row.NewDay).split('T')[0];
      dayStatusMap[key] = row.Status;
    }

    // ── 5. Group raw rows into per-day buckets ─────────────────────────────
    const dayMap: Record<string, {
      totalIncome: number;
      totalExpense: number;
      transactionsCount: number;
      paymentTotals: Record<string, number>;   // pmId (string) → net
      paymentInflow: Record<string, number>;
      paymentOutflow: Record<string, number>;
    }> = {};

    for (const row of rawResult.recordset as any[]) {
      const dateKey: string = row.DayDate instanceof Date
        ? row.DayDate.toISOString().split('T')[0]
        : String(row.DayDate).split('T')[0];

      if (!dayMap[dateKey]) {
        dayMap[dateKey] = {
          totalIncome: 0,
          totalExpense: 0,
          transactionsCount: 0,
          paymentTotals: {},
          paymentInflow: {},
          paymentOutflow: {},
        };
      }

      const inflow  = Number(row.Inflow)  || 0;
      const outflow = Number(row.Outflow) || 0;
      const net     = inflow - outflow;
      const pmKey   = row.PaymentMethodID !== null && row.PaymentMethodID !== undefined
        ? String(row.PaymentMethodID)
        : 'null';

      const d = dayMap[dateKey];
      d.totalIncome       += inflow;
      d.totalExpense      += outflow;
      d.transactionsCount += Number(row.TxCount) || 0;

      d.paymentTotals[pmKey]  = (d.paymentTotals[pmKey]  || 0) + net;
      d.paymentInflow[pmKey]  = (d.paymentInflow[pmKey]  || 0) + inflow;
      d.paymentOutflow[pmKey] = (d.paymentOutflow[pmKey] || 0) + outflow;
    }

    // ── 6. Build sorted day rows (base, no MTD yet) ────────────────────────
    const sortedDateKeys = Object.keys(dayMap).sort();

    // ── 6b. Determine unique months that appear in the result ──────────────
    //   For each month, we need data from YYYY-MM-01 to the last day of that
    //   month that appears in our result set. We query the DB once per month
    //   so that the MTD is always "from the 1st of the month", regardless of
    //   the user's dateFrom filter.
    const uniqueMonths = [...new Set(sortedDateKeys.map(d => d.slice(0, 7)))]; // ['2026-05', '2026-06']

    // mtdMap[dateKey] = { income, expense, paymentTotals }
    const mtdMap: Record<string, {
      income: number;
      expense: number;
      paymentTotals: Record<string, number>;
    }> = {};

    for (const monthStr of uniqueMonths) {
      const monthStart = `${monthStr}-01`;
      // Last day of this month that exists in our result
      const daysInMonth = sortedDateKeys.filter(d => d.startsWith(monthStr));
      const monthEnd = daysInMonth[daysInMonth.length - 1];

      // Query cumulative data for this month from its 1st day
      let mtdWhereConditions = [
        'cm.invDate >= @mtdFrom',
        'cm.invDate <= @mtdTo',
      ];
      const mtdReq = db.request()
        .input('mtdFrom', sql.Date, monthStart)
        .input('mtdTo',   sql.Date, monthEnd);

      if (userId !== null) {
        mtdWhereConditions.push('sm.UserID = @mtdUserId');
        mtdReq.input('mtdUserId', sql.Int, userId);
      }

      const mtdWhere = mtdWhereConditions.join(' AND ');

      const mtdRaw = await mtdReq.query(`
        SELECT
          CONVERT(date, cm.invDate) AS DayDate,
          cm.PaymentMethodID,
          SUM(CASE WHEN cm.inOut = N'in'  THEN cm.GrandTolal ELSE 0 END) AS Inflow,
          SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS Outflow
        FROM dbo.TblCashMove cm
        LEFT JOIN dbo.TblShiftMove sm ON cm.ShiftMoveID = sm.ID
        WHERE ${mtdWhere}
        GROUP BY CONVERT(date, cm.invDate), cm.PaymentMethodID
        ORDER BY DayDate ASC
      `);

      // Build running cumulative per day within this month.
      // Store inflow & outflow SEPARATELY per PM per day so that
      // net = runPmInflow[pmk] - runPmOutflow[pmk]  (matches /treasury/daily logic exactly)
      let runIncome  = 0;
      let runExpense = 0;
      const runPmInflow:  Record<string, number> = {};
      const runPmOutflow: Record<string, number> = {};

      // Group mtdRaw rows by date, keeping inflow/outflow split per PM
      const mtdByDate: Record<string, {
        income: number;
        expense: number;
        pmInflow:  Record<string, number>;
        pmOutflow: Record<string, number>;
      }> = {};

      for (const row of mtdRaw.recordset as any[]) {
        const dk: string = row.DayDate instanceof Date
          ? row.DayDate.toISOString().split('T')[0]
          : String(row.DayDate).split('T')[0];
        if (!mtdByDate[dk]) mtdByDate[dk] = { income: 0, expense: 0, pmInflow: {}, pmOutflow: {} };
        const inf = Number(row.Inflow)  || 0;
        const out = Number(row.Outflow) || 0;
        const pmk = row.PaymentMethodID != null ? String(row.PaymentMethodID) : 'null';
        mtdByDate[dk].income  += inf;
        mtdByDate[dk].expense += out;
        mtdByDate[dk].pmInflow[pmk]  = (mtdByDate[dk].pmInflow[pmk]  || 0) + inf;
        mtdByDate[dk].pmOutflow[pmk] = (mtdByDate[dk].pmOutflow[pmk] || 0) + out;
      }

      // Walk every calendar day from monthStart → monthEnd accumulating running totals
      const cursor = new Date(monthStart + 'T00:00:00');
      const endDate = new Date(monthEnd + 'T00:00:00');
      while (cursor <= endDate) {
        const dk = cursor.toISOString().split('T')[0];
        if (mtdByDate[dk]) {
          runIncome  += mtdByDate[dk].income;
          runExpense += mtdByDate[dk].expense;
          for (const pmk of Object.keys(mtdByDate[dk].pmInflow)) {
            runPmInflow[pmk]  = (runPmInflow[pmk]  || 0) + mtdByDate[dk].pmInflow[pmk];
          }
          for (const pmk of Object.keys(mtdByDate[dk].pmOutflow)) {
            runPmOutflow[pmk] = (runPmOutflow[pmk] || 0) + mtdByDate[dk].pmOutflow[pmk];
          }
        }
        // Snapshot only for days present in our result set
        if (daysInMonth.includes(dk)) {
          // net per PM = cumulative inflow - cumulative outflow  (same as /treasury/daily)
          const pmSnapshot: Record<string, number> = {};
          const allPmKeys = new Set([...Object.keys(runPmInflow), ...Object.keys(runPmOutflow)]);
          for (const pmk of allPmKeys) {
            pmSnapshot[pmk] = (runPmInflow[pmk] || 0) - (runPmOutflow[pmk] || 0);
          }
          mtdMap[dk] = {
            income:  runIncome,
            expense: runExpense,
            paymentTotals: pmSnapshot,
          };
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // ── 6c. Build final day rows with MTD attached ─────────────────────────
    const days = sortedDateKeys.map(dateKey => {
        const d = dayMap[dateKey];
        const netTotal = d.totalIncome - d.totalExpense;

        // Resolve day status
        let status: 'open' | 'closed' | 'unknown' = 'unknown';
        if (dayStatusMap[dateKey] !== undefined) {
          status = dayStatusMap[dateKey] === 1 ? 'open' : 'closed';
        }

        // Build per-pm totals (keyed by pm id as string)
        const paymentTotals: Record<string, number> = {};
        for (const pm of paymentMethods) {
          paymentTotals[String(pm.id)] = d.paymentTotals[String(pm.id)] || 0;
        }
        if (d.paymentTotals['null'] !== undefined) {
          paymentTotals['null'] = d.paymentTotals['null'];
        }

        // MTD values
        const mtd = mtdMap[dateKey] ?? { income: 0, expense: 0, paymentTotals: {} };
        const monthToDatePaymentTotals: Record<string, number> = {};
        for (const pm of paymentMethods) {
          monthToDatePaymentTotals[String(pm.id)] = mtd.paymentTotals[String(pm.id)] || 0;
        }
        if (mtd.paymentTotals['null'] !== undefined) {
          monthToDatePaymentTotals['null'] = mtd.paymentTotals['null'];
        }

        return {
          date: dateKey,
          totalIncome: d.totalIncome,
          totalExpense: d.totalExpense,
          netTotal,
          transactionsCount: d.transactionsCount,
          status,
          paymentTotals,
          monthToDateIncome:        mtd.income,
          monthToDateExpense:       mtd.expense,
          monthToDateNetTotal:      mtd.income - mtd.expense,
          monthToDatePaymentTotals,
        };
      });

    // ── 7. Period-level summary ────────────────────────────────────────────
    let totalIncome  = 0;
    let totalExpense = 0;
    let totalTx      = 0;
    const totalByPaymentMethod: Record<string, number> = {};

    for (const pm of paymentMethods) {
      totalByPaymentMethod[String(pm.id)] = 0;
    }

    for (const day of days) {
      totalIncome  += day.totalIncome;
      totalExpense += day.totalExpense;
      totalTx      += day.transactionsCount;

      for (const pmKey of Object.keys(day.paymentTotals)) {
        totalByPaymentMethod[pmKey] = (totalByPaymentMethod[pmKey] || 0) + day.paymentTotals[pmKey];
      }
    }

    // ── 8. Load users for filter dropdown ────────────────────────────────
    const usersResult = await db.request().query(`
      SELECT UserID, UserName
      FROM dbo.TblUser
      ORDER BY UserName ASC
    `);

    return NextResponse.json({
      paymentMethods,
      summary: {
        totalIncome,
        totalExpense,
        netTotal: totalIncome - totalExpense,
        totalByPaymentMethod,
        daysCount:        days.length,
        transactionsCount: totalTx,
      },
      days,
      users: usersResult.recordset.map((u: any) => ({
        userId:   u.UserID,
        userName: u.UserName,
      })),
    });

  } catch (error) {
    console.error('[api/treasury/period-summary] GET error:', error);
    return NextResponse.json(
      {
        error:   'فشل تحميل ملخص الخزنة للفترة',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
