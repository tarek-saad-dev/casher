import { NextRequest, NextResponse } from 'next/server';
import { resolveEmpServiceDurationPlan } from '@/lib/empServiceDuration';

/**
 * GET /api/services/resolve-durations?empId=12&serviceIds=1,2,3
 *
 * Returns effective durations for services for a barber
 * (override → service default → system default).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empIdRaw = searchParams.get('empId');
    const serviceIdsRaw = searchParams.get('serviceIds') ?? '';

    const empId = empIdRaw ? parseInt(empIdRaw, 10) : NaN;
    if (!Number.isFinite(empId) || empId <= 0) {
      return NextResponse.json({ error: 'empId مطلوب' }, { status: 400 });
    }

    const serviceIds = serviceIdsRaw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (!serviceIds.length) {
      return NextResponse.json({
        ok: true,
        empId,
        totalDurationMinutes: 0,
        durationSource: 'EMPTY',
        services: [],
        byProId: {},
      });
    }

    const plan = await resolveEmpServiceDurationPlan({
      serviceIds,
      empId,
    });

    const byProId: Record<number, number> = {};
    for (const line of plan.services) {
      byProId[line.serviceId] = line.durationMinutes;
    }

    return NextResponse.json({
      ok: true,
      empId: plan.empId,
      totalDurationMinutes: plan.totalDurationMinutes,
      totalPrice: plan.totalPrice,
      durationSource: plan.durationSource,
      services: plan.services,
      byProId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/resolve-durations] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
