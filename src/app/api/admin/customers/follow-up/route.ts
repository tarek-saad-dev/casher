import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

export const runtime = 'nodejs';

// Valid invoice condition — matches existing project pattern from sales/today
const VALID_INVOICE = `h.invType = N'مبيعات' AND ISNULL(h.isActive, 'no') = 'no'`;

export async function GET(req: NextRequest) {
  try {
    const db = await getPool();
    const sp = req.nextUrl.searchParams;

    const tab         = sp.get('tab') || 'new';          // new | birthdays | inactive
    const monthParam  = sp.get('month') || '';            // YYYY-MM
    const search      = (sp.get('search') || '').trim();
    const page        = Math.max(1, parseInt(sp.get('page') || '1', 10));
    const pageSize    = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') || '25', 10)));
    const inactiveMonths = Math.max(1, parseInt(sp.get('inactiveMonths') || '2', 10));
    const sortBy      = sp.get('sortBy') || '';
    const sortDir     = sp.get('sortDirection') === 'asc' ? 'ASC' : 'DESC';

    // ── Cairo "today" — SQL Server AT TIME ZONE ────────────────────────────
    // We compute today in Cairo using SQL so no Node TZ dependency
    const nowRes = await db.request().query(`
      SELECT
        CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '+03:00') AS DATE) AS TodayCairo,
        YEAR(SWITCHOFFSET(SYSDATETIMEOFFSET(), '+03:00'))  AS CurYear,
        MONTH(SWITCHOFFSET(SYSDATETIMEOFFSET(), '+03:00')) AS CurMonth
    `);
    const { TodayCairo, CurYear, CurMonth } = nowRes.recordset[0];

    // Resolve month
    let selYear: number, selMonth: number;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      [selYear, selMonth] = monthParam.split('-').map(Number);
    } else {
      selYear  = CurYear;
      selMonth = CurMonth;
    }

    const monthStart  = `${selYear}-${String(selMonth).padStart(2, '0')}-01`;
    const nextMonthStart = selMonth === 12
      ? `${selYear + 1}-01-01`
      : `${selYear}-${String(selMonth + 1).padStart(2, '0')}-01`;

    const offset = (page - 1) * pageSize;

    // ── Search filter ─────────────────────────────────────────────────────
    let searchCond = '';
    if (search) {
      searchCond = `AND (
        c.Name     LIKE N'%' + @search + '%'
        OR c.Phone  LIKE N'%' + @search + '%'
        OR c.Mobile LIKE N'%' + @search + '%'
        OR CAST(c.ClientID AS NVARCHAR) = @search
      )`;
    }

    // ── Summary counts (always returned regardless of active tab) ─────────
    const countsReq = db.request();
    countsReq.input('monthStart',     sql.Date, monthStart);
    countsReq.input('nextMonthStart', sql.Date, nextMonthStart);
    countsReq.input('today',          sql.Date, TodayCairo);
    countsReq.input('inactiveMonths', sql.Int,  inactiveMonths);
    countsReq.input('curMonth',       sql.Int,  selMonth);
    countsReq.input('curYear',        sql.Int,  selYear);

    const countsRes = await countsReq.query(`
      SELECT
        -- New customers this month
        (
          SELECT COUNT(*) FROM dbo.TblClient c2
          WHERE c2.RegisterDate >= @monthStart
            AND c2.RegisterDate <  @nextMonthStart
        ) AS newCustomers,

        -- Birthdays this month (non-null BirthDate, matching month)
        (
          SELECT COUNT(*) FROM dbo.TblClient c2
          WHERE c2.BirthDate IS NOT NULL
            AND MONTH(c2.BirthDate) = @curMonth
        ) AS birthdays,

        -- Inactive: had at least one valid visit, last visit > inactiveMonths ago
        (
          SELECT COUNT(*) FROM (
            SELECT c2.ClientID
            FROM dbo.TblClient c2
            INNER JOIN dbo.TblinvServHead h ON h.ClientID = c2.ClientID
            WHERE ${VALID_INVOICE}
            GROUP BY c2.ClientID
            HAVING MAX(h.invDate) < DATEADD(MONTH, -@inactiveMonths, @today)
          ) sub
        ) AS inactiveCustomers
    `);

    const counts = {
      newCustomers:      countsRes.recordset[0].newCustomers      || 0,
      birthdays:         countsRes.recordset[0].birthdays         || 0,
      inactiveCustomers: countsRes.recordset[0].inactiveCustomers || 0,
    };

    // ═══════════════════════════════════════════════════════════════════════
    // TAB 1 — New Customers This Month
    // ═══════════════════════════════════════════════════════════════════════
    if (tab === 'new') {
      const baseReq = db.request();
      baseReq.input('monthStart',     sql.Date,    monthStart);
      baseReq.input('nextMonthStart', sql.Date,    nextMonthStart);
      baseReq.input('offset',         sql.Int,     offset);
      baseReq.input('pageSize',       sql.Int,     pageSize);
      if (search) baseReq.input('search', sql.NVarChar(200), search);

      const orderBy = sortBy === 'visitCount'    ? `VisitCount ${sortDir}`
                    : sortBy === 'totalSpending' ? `TotalSpending ${sortDir}`
                    : sortBy === 'lastVisit'     ? `LastVisit ${sortDir}`
                    : `c.RegisterDate DESC`;

      const dataRes = await baseReq.query(`
        WITH VisitStats AS (
          SELECT
            h.ClientID,
            COUNT(*)        AS VisitCount,
            SUM(h.GrandTotal) AS TotalSpending,
            MAX(h.invDate)  AS LastVisit
          FROM dbo.TblinvServHead h
          WHERE ${VALID_INVOICE}
          GROUP BY h.ClientID
        )
        SELECT
          c.ClientID,
          c.Name,
          c.Phone,
          c.Mobile,
          c.RegisterDate,
          c.CameFrom,
          c.Notes,
          ISNULL(vs.VisitCount,    0)    AS VisitCount,
          ISNULL(vs.TotalSpending, 0)    AS TotalSpending,
          vs.LastVisit,
          COUNT(*) OVER () AS TotalCount
        FROM dbo.TblClient c
        LEFT JOIN VisitStats vs ON vs.ClientID = c.ClientID
        WHERE c.RegisterDate >= @monthStart
          AND c.RegisterDate <  @nextMonthStart
          ${searchCond}
        ORDER BY ${orderBy}
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `);

      const rows  = dataRes.recordset;
      const total = rows.length > 0 ? (rows[0].TotalCount || 0) : 0;

      return NextResponse.json({
        success: true,
        data: rows.map(r => ({
          clientId:      r.ClientID,
          name:          r.Name,
          phone:         r.Phone,
          mobile:        r.Mobile,
          registerDate:  r.RegisterDate,
          cameFrom:      r.CameFrom,
          notes:         r.Notes,
          visitCount:    r.VisitCount,
          totalSpending: r.TotalSpending,
          lastVisit:     r.LastVisit,
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
        counts,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TAB 2 — Birthdays This Month
    // ═══════════════════════════════════════════════════════════════════════
    if (tab === 'birthdays') {
      const baseReq = db.request();
      baseReq.input('curMonth',   sql.Int,  selMonth);
      baseReq.input('curYear',    sql.Int,  selYear);
      baseReq.input('today',      sql.Date, TodayCairo);
      baseReq.input('offset',     sql.Int,  offset);
      baseReq.input('pageSize',   sql.Int,  pageSize);
      if (search) baseReq.input('search', sql.NVarChar(200), search);

      // Days remaining — handle Feb 29 leap year by trying the target year and
      // falling back to the next year when the date doesn't exist (e.g. Feb 29 in non-leap)
      const dataRes = await baseReq.query(`
        WITH VisitStats AS (
          SELECT
            h.ClientID,
            COUNT(*) AS VisitCount,
            MAX(h.invDate) AS LastVisit
          FROM dbo.TblinvServHead h
          WHERE ${VALID_INVOICE}
          GROUP BY h.ClientID
        ),
        BirthdayThisMonth AS (
          SELECT
            c.ClientID,
            c.Name,
            c.Phone,
            c.Mobile,
            c.BirthDate,
            DAY(c.BirthDate)   AS BirthDay,
            MONTH(c.BirthDate) AS BirthMonth,
            -- Age this year
            @curYear - YEAR(c.BirthDate) AS AgeThisYear,
            -- Birthday date this year (handle Feb 29)
            CASE
              WHEN MONTH(c.BirthDate) = 2 AND DAY(c.BirthDate) = 29
                   AND NOT ((@curYear % 4 = 0 AND @curYear % 100 <> 0) OR @curYear % 400 = 0)
              THEN DATEFROMPARTS(@curYear, 3, 1)
              ELSE DATEFROMPARTS(@curYear, MONTH(c.BirthDate), DAY(c.BirthDate))
            END AS BirthdayThisYear
          FROM dbo.TblClient c
          WHERE c.BirthDate IS NOT NULL
            AND MONTH(c.BirthDate) = @curMonth
        )
        SELECT
          b.ClientID,
          b.Name,
          b.Phone,
          b.Mobile,
          b.BirthDate,
          b.BirthDay,
          b.BirthMonth,
          b.AgeThisYear,
          b.BirthdayThisYear,
          DATEDIFF(DAY, @today, b.BirthdayThisYear) AS DaysRemaining,
          ISNULL(vs.VisitCount, 0) AS VisitCount,
          vs.LastVisit,
          COUNT(*) OVER () AS TotalCount
        FROM BirthdayThisMonth b
        LEFT JOIN VisitStats vs ON vs.ClientID = b.ClientID
        WHERE 1=1 ${searchCond}
        ORDER BY
          CASE WHEN DATEDIFF(DAY, @today, b.BirthdayThisYear) >= 0 THEN 0 ELSE 1 END,
          ABS(DATEDIFF(DAY, @today, b.BirthdayThisYear))
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `);

      const rows  = dataRes.recordset;
      const total = rows.length > 0 ? (rows[0].TotalCount || 0) : 0;

      return NextResponse.json({
        success: true,
        data: rows.map(r => ({
          clientId:        r.ClientID,
          name:            r.Name,
          phone:           r.Phone,
          mobile:          r.Mobile,
          birthDate:       r.BirthDate,
          birthDay:        r.BirthDay,
          birthMonth:      r.BirthMonth,
          ageThisYear:     r.AgeThisYear,
          birthdayThisYear: r.BirthdayThisYear,
          daysRemaining:   r.DaysRemaining,
          visitCount:      r.VisitCount,
          lastVisit:       r.LastVisit,
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
        counts,
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TAB 3 — Inactive Customers
    // ═══════════════════════════════════════════════════════════════════════
    // tab === 'inactive'
    const baseReq = db.request();
    baseReq.input('today',          sql.Date, TodayCairo);
    baseReq.input('inactiveMonths', sql.Int,  inactiveMonths);
    baseReq.input('offset',         sql.Int,  offset);
    baseReq.input('pageSize',       sql.Int,  pageSize);
    if (search) baseReq.input('search', sql.NVarChar(200), search);

    const orderBy = sortBy === 'visitCount'      ? `vs.VisitCount ${sortDir}`
                  : sortBy === 'totalSpending'   ? `vs.TotalSpending ${sortDir}`
                  : sortBy === 'lastVisit'       ? `vs.LastVisit ${sortDir}`
                  : `vs.LastVisit ASC`; // default: longest inactive first

    const dataRes = await baseReq.query(`
      WITH VisitStats AS (
        SELECT
          h.ClientID,
          COUNT(*)          AS VisitCount,
          SUM(h.GrandTotal) AS TotalSpending,
          MAX(h.invDate)    AS LastVisit
        FROM dbo.TblinvServHead h
        WHERE ${VALID_INVOICE}
        GROUP BY h.ClientID
        HAVING MAX(h.invDate) < DATEADD(MONTH, -@inactiveMonths, @today)
      ),
      LastVisitDetail AS (
        SELECT
          h.ClientID,
          h.invID,
          h.invDate,
          ROW_NUMBER() OVER (PARTITION BY h.ClientID ORDER BY h.invDate DESC) AS rn
        FROM dbo.TblinvServHead h
        WHERE ${VALID_INVOICE}
      ),
      LastEmpService AS (
        SELECT
          lv.ClientID,
          e.EmpName  AS LastEmpName,
          p.ProName  AS LastServiceName
        FROM LastVisitDetail lv
        INNER JOIN dbo.TblinvServDetail d ON d.invID = lv.invID AND d.invType = N'مبيعات'
        LEFT  JOIN dbo.TblEmp e ON e.EmpID = d.EmpID
        LEFT  JOIN dbo.TblPro p ON p.ProID = d.ProID
        WHERE lv.rn = 1
      )
      SELECT
        c.ClientID,
        c.Name,
        c.Phone,
        c.Mobile,
        vs.LastVisit,
        vs.VisitCount,
        vs.TotalSpending,
        DATEDIFF(DAY, vs.LastVisit, @today) AS InactiveDays,
        les.LastEmpName,
        les.LastServiceName,
        COUNT(*) OVER () AS TotalCount
      FROM dbo.TblClient c
      INNER JOIN VisitStats vs ON vs.ClientID = c.ClientID
      LEFT  JOIN LastEmpService les ON les.ClientID = c.ClientID
      WHERE 1=1 ${searchCond}
      ORDER BY ${orderBy}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    const rows  = dataRes.recordset;
    const total = rows.length > 0 ? (rows[0].TotalCount || 0) : 0;

    return NextResponse.json({
      success: true,
      data: rows.map(r => ({
        clientId:        r.ClientID,
        name:            r.Name,
        phone:           r.Phone,
        mobile:          r.Mobile,
        lastVisit:       r.LastVisit,
        visitCount:      r.VisitCount,
        totalSpending:   r.TotalSpending,
        inactiveDays:    r.InactiveDays,
        lastEmpName:     r.LastEmpName,
        lastServiceName: r.LastServiceName,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      counts,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/admin/customers/follow-up]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
