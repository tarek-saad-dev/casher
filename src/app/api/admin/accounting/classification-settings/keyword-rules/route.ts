import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireRole } from '@/lib/api-auth';
import {
  createKeywordRule,
  deleteKeywordRule,
  getAccountingSettingsMigrationStatus,
  listKeywordRules,
  updateKeywordRule,
} from '@/lib/accounting/accountingSettingsService';
import { validateClassificationOutputs } from '@/lib/accounting/accountingSettingsValidate';

export async function GET() {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const status = await getAccountingSettingsMigrationStatus();
    const rules = status.migrationRequired ? [] : await listKeywordRules();
    return NextResponse.json({
      rules,
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
    const errors = validateClassificationOutputs(body);
    if (errors.length) return NextResponse.json({ error: errors.join(', ') }, { status: 400 });
    if (!body.keyword) return NextResponse.json({ error: 'keyword مطلوب' }, { status: 400 });

    const rule = await createKeywordRule({
      keyword: body.keyword,
      matchTarget: body.matchTarget ?? 'both',
      matchMode: body.matchMode ?? 'contains',
      flowGroup: body.flowGroup,
      flowKind: body.flowKind,
      pnlImpact: body.pnlImpact,
      partyType: body.partyType,
      requiresEmployee: !!body.requiresEmployee,
      needsReviewByDefault: !!body.needsReviewByDefault,
      confidence: body.confidence ?? 'high',
      priority: Number(body.priority ?? 100),
      isActive: body.isActive !== false,
    }, auth.userId);
    return NextResponse.json({ rule });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 });
    const errors = validateClassificationOutputs(body);
    if (errors.length) return NextResponse.json({ error: errors.join(', ') }, { status: 400 });
    const rule = await updateKeywordRule(Number(body.id), body, auth.userId);
    return NextResponse.json({ rule });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 });
    await deleteKeywordRule(id, auth.userId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}
