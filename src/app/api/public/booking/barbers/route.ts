import { NextRequest, NextResponse } from 'next/server';
import {
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import {
  extractPublicBranchCode,
  resolvePublicBranchCode,
  publicBranchRequiredResponse,
  publicInvalidBranchResponse,
  listBookableEmployeeIdsForBranch,
} from '@/lib/branch/bookingQueueOwnership';
import { BranchDomainError } from '@/lib/branch/types';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { getPool } from '@/lib/db';
import { listGlobalPublicBarbers } from '@/lib/hr/barberGlobalCalendar';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/barbers
 * - with branchCode: branch-first bookable barbers (unchanged contract)
 * - without branchCode (mode=global|default): unique global barbers across public branches
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const { searchParams } = new URL(req.url);
    const branchCode = extractPublicBranchCode(searchParams);
    const mode = (searchParams.get('mode') || (branchCode ? 'branch' : 'global')).toLowerCase();
    const dateParam = searchParams.get('date');
    const operationalDate =
      dateParam && isValidDate(dateParam) ? dateParam : getCairoBusinessDate();

    // Global barber-first list
    if (!branchCode || mode === 'global') {
      if (branchCode && mode === 'global') {
        // Explicit global still ignores branch filter for identity list; branch calendar filters later
      }
      const barbers = await listGlobalPublicBarbers({ date: operationalDate });
      return NextResponse.json(
        {
          ok: true,
          mode: 'global',
          barbers: barbers.map((b) => ({
            empId: b.empId,
            id: b.empId,
            name: b.name,
            branches: b.branches,
            isBookableOnline: true,
          })),
        },
        { headers: PUBLIC_CORS_HEADERS },
      );
    }

    let branch;
    try {
      branch = await resolvePublicBranchCode(branchCode, {
        route: '/api/public/booking/barbers',
      });
    } catch (err) {
      if (err instanceof BranchDomainError) {
        return err.code === 'BRANCH_REQUIRED'
          ? publicBranchRequiredResponse()
          : publicInvalidBranchResponse();
      }
      throw err;
    }

    const bookableIds = await listBookableEmployeeIdsForBranch(branch.branchId, operationalDate);
    if (bookableIds.length === 0) {
      return NextResponse.json(
        { ok: true, mode: 'branch', barbers: [] },
        { headers: PUBLIC_CORS_HEADERS },
      );
    }

    const db = await getPool();
    const res = await db.request().query(`
      SELECT
        e.EmpID   AS id,
        e.EmpName AS name,
        e.Job     AS job
      FROM [dbo].[TblEmp] e
      WHERE ISNULL(e.isActive, 1) = 1
        AND e.Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
        AND e.EmpID IN (${bookableIds.join(',')})
      ORDER BY e.EmpName
    `);

    const barbers = res.recordset.map((r: { id: number; name: string; job: string }) => ({
      id: r.id,
      empId: r.id,
      name: r.name,
      job: r.job,
      photoUrl: null,
      bio: null,
      isBookableOnline: true,
      branches: [{ branchCode: branch.branchCode, branchName: branch.branchName }],
    }));

    return NextResponse.json(
      { ok: true, mode: 'branch', barbers },
      { headers: PUBLIC_CORS_HEADERS },
    );
  } catch (err) {
    console.error('[public/booking/barbers]', err);
    return NextResponse.json(
      { error: 'فشل تحميل الحلاقين' },
      { status: 500, headers: PUBLIC_CORS_HEADERS },
    );
  }
}
