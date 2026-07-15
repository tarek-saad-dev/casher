import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  buildEmployeeDailyWhatsAppPreview,
  sendEmployeeDailyWhatsAppReports,
} from '@/lib/hr/employee-daily-whatsapp-report.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseEmployeeIds(
  raw: string | null | undefined,
  bodyIds?: unknown,
): number[] | null {
  if (Array.isArray(bodyIds)) {
    const ids = bodyIds
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);
    return ids.length > 0 ? ids : null;
  }
  if (!raw) return null;
  const ids = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? ids : null;
}

/**
 * GET /api/admin/hr/employee-daily-whatsapp-report?workDate=YYYY-MM-DD&employeeId=
 * Preview composed WhatsApp daily digests (no send).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const { searchParams } = new URL(req.url);
    const workDate = searchParams.get('workDate');
    if (!workDate || !DATE_RE.test(workDate)) {
      return NextResponse.json(
        { error: 'workDate مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const single = searchParams.get('employeeId');
    const employeeIds = single
      ? parseEmployeeIds(single)
      : parseEmployeeIds(searchParams.get('employeeIds'));

    const preview = await buildEmployeeDailyWhatsAppPreview({
      workDate,
      employeeIds,
    });

    return NextResponse.json(preview);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/employee-daily-whatsapp-report] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/hr/employee-daily-whatsapp-report
 * Body: { workDate, employeeIds?, dryRun? }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    const body = (await req.json()) as {
      workDate?: string;
      employeeId?: number | string;
      employeeIds?: number[];
      dryRun?: boolean;
    };

    const workDate = String(body.workDate ?? '').trim();
    if (!DATE_RE.test(workDate)) {
      return NextResponse.json(
        { error: 'workDate مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    let employeeIds = parseEmployeeIds(null, body.employeeIds);
    if (!employeeIds && body.employeeId != null) {
      employeeIds = parseEmployeeIds(String(body.employeeId));
    }

    console.log(
      `[api/admin/hr/employee-daily-whatsapp-report] POST workDate=${workDate} empIds=${employeeIds?.join(',') ?? 'ALL'} dryRun=${Boolean(body.dryRun)}`,
    );

    const result = await sendEmployeeDailyWhatsAppReports({
      workDate,
      employeeIds,
      dryRun: Boolean(body.dryRun),
    });

    if (!result.ok && result.error && result.summary.sent === 0 && result.summary.dryRun === 0) {
      return NextResponse.json(result, { status: 422 });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/employee-daily-whatsapp-report] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
