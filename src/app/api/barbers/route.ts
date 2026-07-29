import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getActiveBranchContext } from '@/lib/branch/context';

/**
 * GET /api/barbers
 * Query:
 *   scope=service (default) — حلاق + مساعد (legacy POS/booking list)
 *   scope=barber — حلاق فقط
 *   scope=other — كل الموظفين النشطين ما عدا الحلاقين
 *   all=1 — skip branch assignment filter (admin catalog)
 *
 * When session has an active branch, results are limited to employees assigned
 * to that branch (unless all=1).
 */
export async function GET(req: NextRequest) {
  try {
    const scope = (req.nextUrl.searchParams.get('scope') || 'service').toLowerCase();
    const listAll = req.nextUrl.searchParams.get('all') === '1';

    let jobFilter: string;
    if (scope === 'barber') {
      jobFilter = `(
        e.Job = N'حلاق'
        OR LOWER(LTRIM(RTRIM(ISNULL(e.Job, N'')))) IN (N'barber')
      )`;
    } else if (scope === 'other') {
      // مساعدين، إداريين، وأي وظيفة أخرى — باستثناء الحلاقين
      jobFilter = `(
        e.Job IS NULL
        OR (
          e.Job <> N'حلاق'
          AND LOWER(LTRIM(RTRIM(e.Job))) NOT IN (N'barber')
          AND e.Job NOT LIKE N'%حلاق%'
        )
      )`;
    } else {
      // service (default)
      jobFilter = `e.Job IN (N'حلاق', N'مساعد')`;
    }

    const branchCtx = listAll ? null : await getActiveBranchContext();
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

    const db = await getPool();
    const request = db.request();
    let assignmentJoin = '';
    if (branchCtx) {
      request.input('branchId', sql.Int, branchCtx.branchId);
      request.input('day', sql.Date, day);
      assignmentJoin = `
        INNER JOIN dbo.TblEmpBranchAssignment ea
          ON ea.EmpID = e.EmpID
         AND ea.BranchID = @branchId
         AND ea.IsActive = 1
         AND ea.EffectiveFrom <= @day
         AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
      `;
    }

    const result = await request.query(`
      SELECT 
        e.EmpID, 
        e.EmpName,
        e.Job,
        ISNULL(sales.SalesCount, 0) AS SalesCount
      FROM [dbo].[TblEmp] e
      ${assignmentJoin}
      LEFT JOIN (
        SELECT EmpID, COUNT(*) AS SalesCount
        FROM [dbo].[TblinvServDetail]
        GROUP BY EmpID
      ) sales ON e.EmpID = sales.EmpID
      WHERE e.isActive = 1
        AND ${jobFilter}
      ORDER BY ISNULL(sales.SalesCount, 0) DESC, e.EmpName
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/barbers] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
