import { NextRequest, NextResponse } from 'next/server';
import { getAvailableBarbers } from '@/lib/barberAvailability';
import { computeBarberEstimate } from '@/lib/queueEstimateEngine';
import { getPool, sql } from '@/lib/db';

export const runtime = 'nodejs';
console.log('[queue/estimate route] module loaded — v2 shared engine');

/**
 * POST /api/queue/estimate
 * Body: { mode?, empId?, serviceIds?, requestedAt? }
 *   mode = 'specific' (default if empId supplied) | 'nearest' (auto-pick best barber)
 *
 * Uses interval-based timeline engine (queueEstimateEngine.ts):
 *   - Respects stored EstimatedStartTime on existing queue tickets
 *   - Respects confirmed bookings
 *   - Returns earliest real free slot
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      mode = 'specific',
      empId,
      serviceIds = [],
      requestedAt,
    } = body as {
      mode?:        'nearest' | 'specific';
      empId?:       number;
      serviceIds?:  number[];
      requestedAt?: string;
    };

    // ── Nearest barber mode ───────────────────────────────────────────────
    if (mode === 'nearest') {
      return await handleNearest(serviceIds, requestedAt);
    }

    // ── Specific barber mode ──────────────────────────────────────────────
    if (!empId) {
      return NextResponse.json({ error: 'empId مطلوب في وضع specific' }, { status: 400 });
    }

    // Resolve emp name from DB
    let resolvedEmpName = '';
    try {
      const db = await getPool();
      const nr = await db.request().input('eid', sql.Int, empId)
        .query(`SELECT TOP 1 EmpName FROM [dbo].[TblEmp] WHERE EmpID = @eid`);
      resolvedEmpName = nr.recordset[0]?.EmpName ?? '';
    } catch { /* non-fatal */ }

    const est = await computeBarberEstimate(empId, resolvedEmpName, serviceIds, requestedAt);

    const now2      = requestedAt ? new Date(requestedAt) : new Date();
    const slot      = new Date(est.estimatedStartTime);
    const h12       = slot.getHours() % 12 || 12;
    const mm        = String(slot.getMinutes()).padStart(2, '0');
    const period    = slot.getHours() < 12 ? 'ص' : 'م';
    const timeStr   = `${h12}:${mm} ${period}`;

    // isFreeNow: barber has no active queue or booking blocking right now
    const isFreeNow = est.blockingQueueCount === 0 && est.blockingBookingCount === 0;
    const statusText = !est.isWorking
      ? (est.unavailableReason ?? 'غير متاح')
      : isFreeNow ? 'فاضي الآن' : 'مشغول';

    let contextMsg = '';
    if (!est.isWorking) {
      contextMsg = est.unavailableReason ?? 'الحلاق غير متاح';
    } else if (est.blockingQueueCount > 0 && est.blockingBookingCount > 0) {
      contextMsg = `يوجد ${est.blockingQueueCount} دور و${est.blockingBookingCount} حجز قبلك`;
    } else if (est.blockingQueueCount > 0) {
      contextMsg = `يوجد ${est.blockingQueueCount} ${est.blockingQueueCount === 1 ? 'دور' : 'أدوار'} قبلك مع نفس الحلاق`;
    } else if (est.blockingBookingCount > 0) {
      contextMsg = `يوجد حجز مؤكد قبل موعدك (تم الاحتساب)`;
    } else {
      contextMsg = 'الحلاق فاضي الآن — سيبدأ فورًا';
    }

    const waitMinutes = Math.max(0, Math.round((slot.getTime() - now2.getTime()) / 60000));

    const best = est.isWorking ? {
      empId:                est.empId,
      empName:              resolvedEmpName,
      available:            est.isWorking,
      isFreeNow,
      statusText,
      estimatedStartTime:   est.estimatedStartTime,
      estimatedWaitMinutes: waitMinutes,
      waitingCount:         est.blockingQueueCount,
      activeQueueCount:     est.blockingQueueCount,
      blockingQueueCount:   est.blockingQueueCount,
      blockingBookingCount: est.blockingBookingCount,
      blockingQueueTickets: est.blockingQueueTickets,
      blockingBookings:     est.blockingBookings,
      blockingTickets:      est.blockingTickets,
      contextMsg,
    } : null;

    const message = est.isWorking
      ? `الوقت المتوقع للدخول ${timeStr}`
      : est.unavailableReason!;

    console.log('[queue estimate] empId', empId);
    console.log('[queue estimate] activeTickets', est.blockingTickets.map(t => ({
      code: t.ticketCode, status: t.status, estimated: t.estimatedStart,
    })));
    console.log('[queue estimate] activeQueueCount', est.blockingQueueCount);
    console.log('[queue estimate] result', {
      empId, empName: resolvedEmpName,
      blockingQueueCount: est.blockingQueueCount,
      blockingBookingCount: est.blockingBookingCount,
      isFreeNow, statusText, contextMsg,
      estimatedStartTime: est.estimatedStartTime,
      waitMinutes,
    });

    // If barber unavailable, add to unavailable list
    const unavailableList = est.isWorking ? [] : [{
      empId,
      empName: resolvedEmpName,
      reason: est.unavailableReason ?? 'غير متاح',
    }];

    return NextResponse.json({
      ok:                   est.isWorking,
      best,
      alternatives:         [],
      unavailable:          unavailableList,
      unavailableReason:    est.unavailableReason,
      empId,
      empName:              resolvedEmpName,
      waitingCount:         est.blockingQueueCount,
      estimatedStartTime:   est.estimatedStartTime,
      estimatedWaitMinutes: waitMinutes,
      blockingQueueCount:   est.blockingQueueCount,
      blockingBookingCount: est.blockingBookingCount,
      contextMsg,
      message,
    });
  } catch (err) {
    console.error('[queue/estimate]', err);
    return NextResponse.json({ error: 'فشل حساب وقت الانتظار' }, { status: 500 });
  }
}

// ── Nearest barber handler ────────────────────────────────────────────────────
function buildEstimateShape(e: Awaited<ReturnType<typeof computeBarberEstimate>>, refNow: Date) {
  const slot         = new Date(e.estimatedStartTime);
  const isFreeNow    = e.blockingQueueCount === 0 && e.blockingBookingCount === 0;
  const statusText   = !e.isWorking
    ? (e.unavailableReason ?? 'غير متاح')
    : isFreeNow ? 'فاضي الآن' : 'مشغول';
  const waitMinutes  = Math.max(0, Math.round((slot.getTime() - refNow.getTime()) / 60000));

  let contextMsg = '';
  if (!e.isWorking) {
    contextMsg = e.unavailableReason ?? 'الحلاق غير متاح';
  } else if (e.blockingQueueCount > 0 && e.blockingBookingCount > 0) {
    contextMsg = `يوجد ${e.blockingQueueCount} دور و${e.blockingBookingCount} حجز قبلك`;
  } else if (e.blockingQueueCount > 0) {
    contextMsg = `يوجد ${e.blockingQueueCount} ${e.blockingQueueCount === 1 ? 'دور' : 'أدوار'} قبلك`;
  } else if (e.blockingBookingCount > 0) {
    contextMsg = `يوجد حجز مؤكد قبل موعدك (تم الاحتساب)`;
  } else {
    contextMsg = 'الحلاق فاضي الآن — سيبدأ فورًا';
  }

  return {
    empId:                e.empId,
    empName:              e.empName,
    available:            e.isWorking,
    isFreeNow,
    statusText,
    estimatedStartTime:   e.estimatedStartTime,
    estimatedWaitMinutes: waitMinutes,
    waitingCount:         e.blockingQueueCount,
    activeQueueCount:     e.blockingQueueCount,
    blockingQueueCount:   e.blockingQueueCount,
    blockingBookingCount: e.blockingBookingCount,
    blockingQueueTickets: e.blockingQueueTickets,
    blockingBookings:     e.blockingBookings,
    blockingTickets:      e.blockingTickets,
    contextMsg,
  };
}

async function handleNearest(
  serviceIds: number[],
  requestedAt: string | undefined,
) {
  try {
    const now        = requestedAt ? new Date(requestedAt) : new Date();
    const allBarbers = await getAvailableBarbers(now);

    if (allBarbers.length === 0) {
      return NextResponse.json({ ok: false, best: null, alternatives: [], unavailable: [],
        contextMsg: 'لا يوجد حلاق متاح حالياً' });
    }

    const estimates = await Promise.all(
      allBarbers.map(b => computeBarberEstimate(b.EmpID, b.EmpName, serviceIds, requestedAt))
    );

    console.log('[queue estimate] nearest all estimates', estimates.map(e => ({
      empId: e.empId, empName: e.empName,
      isWorking: e.isWorking,
      blockingQueueCount: e.blockingQueueCount,
      blockingBookingCount: e.blockingBookingCount,
      estimatedStartTime: e.estimatedStartTime,
    })));

    // Sort available barbers: earliest real slot → lower queue count
    const available = estimates
      .filter(e => e.isWorking)
      .sort((a, b) => {
        const tDiff = new Date(a.estimatedStartTime).getTime() - new Date(b.estimatedStartTime).getTime();
        if (tDiff !== 0) return tDiff;
        return a.blockingQueueCount - b.blockingQueueCount;
      });

    const unavailable = estimates
      .filter(e => !e.isWorking)
      .map(e => ({ empId: e.empId, empName: e.empName, reason: e.unavailableReason ?? 'غير متاح' }));

    const [bestRaw, ...altRaws] = available;
    const best         = bestRaw ? buildEstimateShape(bestRaw, now) : null;
    const alternatives = altRaws.map(e => buildEstimateShape(e, now));

    return NextResponse.json({
      ok:           available.length > 0,
      best,
      alternatives,
      unavailable,
      contextMsg:   best?.contextMsg ?? (available.length === 0 ? 'لا يوجد حلاق متاح' : ''),
    });
  } catch (err) {
    console.error('[queue/estimate nearest]', err);
    return NextResponse.json({ error: 'فشل حساب أقرب حلاق' }, { status: 500 });
  }
}
