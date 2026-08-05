/**
 * GET /api/operations/flow-board?date=YYYY-MM-DD&branchId=active|all|<id>&presence=present|all
 *
 * Defaults: branchId=active (session branch), presence=present (operationally present only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { getOperationalDateContext } from '@/lib/availability/operationalDateContext';
import { createDevTimer } from '@/lib/devRequestTiming';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { listUserValidBranchAccess } from '@/lib/branch/repository';
import {
  loadFlowBoardForBranch,
  type FlowBoardPresenceMode,
} from '@/lib/operations/loadFlowBoardForBranch';
import type { FlowBoardBarber } from '@/lib/operations/flowBoardTypes';

export const runtime = 'nodejs';

export type { FlowBoardBarber };

function parsePresenceMode(raw: string | null): FlowBoardPresenceMode {
  return raw === 'all' ? 'all' : 'present';
}

export async function GET(req: NextRequest) {
  const auth = await requirePageAccess('/operations');
  if (!isAuthResult(auth)) return auth;
  const timer = createDevTimer('flow_board');

  try {
    timer.mark('authMs');

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');
    const dateStr = dateParam || getCairoBusinessDate();
    const presenceMode = parsePresenceMode(searchParams.get('presence'));
    const branchParam = (searchParams.get('branchId') || 'active').trim().toLowerCase();
    const now = new Date();
    timer.mark('dateParseMs');

    const access = await listUserValidBranchAccess(auth.userId);
    const operableIds = new Set(
      access
        .filter((a) => a.canOperate || a.canSwitch || a.canViewReports || a.isDefault)
        .map((a) => a.branchId),
    );
    // Always allow the session active branch
    operableIds.add(auth.activeBranchId);

    let targetBranchIds: number[];
    if (branchParam === 'all') {
      targetBranchIds = [...operableIds];
    } else if (branchParam === 'active' || branchParam === '') {
      targetBranchIds = [auth.activeBranchId];
    } else {
      const bid = Number(branchParam);
      if (!Number.isFinite(bid) || bid <= 0) {
        return NextResponse.json(
          { ok: false, error: 'معرف الفرع غير صالح' },
          { status: 400 },
        );
      }
      if (!operableIds.has(bid)) {
        return NextResponse.json(
          { ok: false, error: 'غير مصرح بالوصول لهذا الفرع' },
          { status: 403 },
        );
      }
      targetBranchIds = [bid];
    }

    // Stable order: session branch first, then by id
    targetBranchIds.sort((a, b) => {
      if (a === auth.activeBranchId) return -1;
      if (b === auth.activeBranchId) return 1;
      return a - b;
    });

    timer.mark('poolMs');

    const boards = await Promise.all(
      targetBranchIds.map((branchId) =>
        loadFlowBoardForBranch({
          branchId,
          dateStr,
          presenceMode,
          now,
        }),
      ),
    );
    timer.setAbsolute('employeesMs', 0);
    timer.setAbsolute('resolvedLocationMs', 0);

    const barbers: FlowBoardBarber[] = [];
    for (const board of boards) {
      barbers.push(...board.barbers);
    }

    // When multi-branch, sort by branch then name; single-branch already sorted by name
    if (targetBranchIds.length > 1) {
      barbers.sort((a, b) => {
        const ba = a.branchName ?? '';
        const bb = b.branchName ?? '';
        const c = ba.localeCompare(bb, 'ar');
        if (c !== 0) return c;
        return a.empName.localeCompare(b.empName, 'ar');
      });
    }

    const primaryBranch =
      boards.find((b) => b.branch?.branchId === auth.activeBranchId)?.branch ??
      boards[0]?.branch ??
      null;

    const { getOperationsDayStateVersion } = await import(
      '@/lib/hr/scheduleAvailabilityInvalidation'
    );
    const availabilityVersion = targetBranchIds.reduce(
      (max, id) => Math.max(max, getOperationsDayStateVersion(id, dateStr)),
      0,
    );

    const opDate = getOperationalDateContext({ now });
    const payload = {
      ok: true as const,
      date: dateStr,
      businessDate: opDate.businessDate,
      timezone: opDate.timezone,
      cutoffHour: opDate.cutoffHour,
      generatedAt: now.toISOString(),
      availabilityVersion,
      filters: {
        branchId: branchParam === 'all' ? 'all' : targetBranchIds[0],
        presence: presenceMode,
        branchCount: targetBranchIds.length,
      },
      barbers,
      activeBranch: primaryBranch,
    };

    timer.log('[flow-board perf]', {
      date: dateStr,
      barberCount: barbers.length,
      branches: targetBranchIds.length,
      presence: presenceMode,
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const st = timer.serverTimingHeader();
    if (st) headers['Server-Timing'] = st;

    return new NextResponse(JSON.stringify(payload), { status: 200, headers });
  } catch (err) {
    console.error('[operations/flow-board] error:', err);
    timer.log('[flow-board perf]', { outcome: '500' });
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'فشل في تحميل لوحة التحكم',
      },
      { status: 500 },
    );
  }
}
