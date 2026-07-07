import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireRole } from '@/lib/api-auth';
import {
  bulkMapOperatingExpense,
  getAccountingSettingsMigrationStatus,
  listCategoryMappings,
  upsertCategoryMapping,
} from '@/lib/accounting/accountingSettingsService';
import { validateClassificationOutputs } from '@/lib/accounting/accountingSettingsValidate';

export async function GET(request: NextRequest) {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const status = await getAccountingSettingsMigrationStatus();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') ?? undefined;
    const unmappedOnly = searchParams.get('unmappedOnly') === 'true';
    const rows = status.migrationRequired ? [] : await listCategoryMappings(search, unmappedOnly);
    return NextResponse.json({
      rows,
      meta: {
        migrationRequired: status.migrationRequired,
        tablesExist: status.tablesExist,
        missingTables: status.missingTables,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await request.json();

    if (body.bulkOperating && Array.isArray(body.expInIds)) {
      await bulkMapOperatingExpense(body.expInIds.map(Number), auth.userId);
      return NextResponse.json({ success: true, count: body.expInIds.length });
    }

    const errors = validateClassificationOutputs(body);
    if (errors.length) return NextResponse.json({ error: errors.join(', ') }, { status: 400 });
    if (!body.expInId) return NextResponse.json({ error: 'expInId مطلوب' }, { status: 400 });

    await upsertCategoryMapping({
      expInId: Number(body.expInId),
      flowGroup: body.flowGroup,
      flowKind: body.flowKind,
      pnlImpact: body.pnlImpact,
      partyType: body.partyType,
      requiresEmployee: !!body.requiresEmployee,
      needsReviewByDefault: !!body.needsReviewByDefault,
      confidence: body.confidence,
      notes: body.notes ?? null,
      userId: auth.userId,
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}
