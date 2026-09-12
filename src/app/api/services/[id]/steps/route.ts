import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  listStepsByProId,
  proExists,
  replaceSteps,
  validateExecutionStepsBody,
} from '@/lib/catalog/serviceExecutionSteps';
import { ensureProExecutionStepsTable } from '@/lib/migrations/ensureProExecutionSteps';

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/services/[id]/steps
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requirePageAccess('/admin/services');
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await params;
    const proId = parseInt(id, 10);
    if (isNaN(proId)) {
      return NextResponse.json({ error: 'معرف الخدمة غير صالح' }, { status: 400 });
    }

    const db = await getPool();
    const ready = await ensureProExecutionStepsTable(db);
    if (!ready) {
      return NextResponse.json(
        { error: 'جدول خطوات التنفيذ غير متوفر' },
        { status: 503 },
      );
    }

    if (!(await proExists(db, proId))) {
      return NextResponse.json({ error: 'الخدمة غير موجودة' }, { status: 404 });
    }

    const steps = await listStepsByProId(db, proId);
    return NextResponse.json({ steps });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/[id]/steps] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/services/[id]/steps
export async function PUT(req: NextRequest, { params }: RouteCtx) {
  const auth = await requirePageAccess('/admin/services');
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await params;
    const proId = parseInt(id, 10);
    if (isNaN(proId)) {
      return NextResponse.json({ error: 'معرف الخدمة غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const validated = validateExecutionStepsBody(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const db = await getPool();
    const ready = await ensureProExecutionStepsTable(db);
    if (!ready) {
      return NextResponse.json(
        { error: 'جدول خطوات التنفيذ غير متوفر' },
        { status: 503 },
      );
    }

    if (!(await proExists(db, proId))) {
      return NextResponse.json({ error: 'الخدمة غير موجودة' }, { status: 404 });
    }

    const steps = await replaceSteps(db, proId, validated.steps);
    return NextResponse.json({ steps });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/[id]/steps] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
