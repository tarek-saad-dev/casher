import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import {
  runDailyPayrollBulkCloseRange,
  type BulkCloseProgressEvent,
} from '@/lib/hr/dailyPayrollBulkCloseRange.service';

export const runtime = 'nodejs';
/** Range up to 31 days × nightly per day — allow long run. */
export const maxDuration = 300;

/**
 * POST /api/admin/hr/daily-payroll/bulk-close-range
 * Body: { fromDate, toDate, stream?: boolean }
 *
 * stream:true → NDJSON progress events (application/x-ndjson)
 * otherwise → single JSON result (200 / 207 / 400 / 409)
 */
export async function POST(request: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const sessionBranch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(sessionBranch)) return sessionBranch;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'بيانات غير صالحة' }, { status: 400 });
    }

    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const fromDate = String(record.fromDate ?? '').trim();
    const toDate = String(record.toDate ?? '').trim();
    const stream = record.stream === true;

    if (!stream) {
      const result = await runDailyPayrollBulkCloseRange({
        fromDate,
        toDate,
        actorUserId: auth.userId,
      });

      if (result.error && result.daysProcessed === 0) {
        const status = result.error.includes('قيد التنفيذ') ? 409 : 400;
        return NextResponse.json(result, { status });
      }

      return NextResponse.json(result, { status: result.ok ? 200 : 207 });
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (event: BulkCloseProgressEvent | { type: 'error'; error: string }) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          const result = await runDailyPayrollBulkCloseRange({
            fromDate,
            toDate,
            actorUserId: auth.userId,
            onProgress: (event) => write(event),
          });

          if (result.error && result.daysProcessed === 0) {
            write({ type: 'error', error: result.error });
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('[api/admin/hr/daily-payroll/bulk-close-range] stream error:', message);
          write({ type: 'error', error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/admin/hr/daily-payroll/bulk-close-range] POST error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
