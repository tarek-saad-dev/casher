import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireRole } from '@/lib/api-auth';
import {
  classifyCashMove,
  emptySettingsBundle,
  type CashMoveClassificationInput,
} from '@/lib/accounting/cashMoveClassification';
import { loadClassificationSettings } from '@/lib/accounting/accountingSettingsService';

export async function POST(request: NextRequest) {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await request.json();
    const input: CashMoveClassificationInput = {
      cashMoveId: 0,
      invDate: body.invDate ?? new Date().toISOString().slice(0, 10),
      amount: Number(body.amount ?? 0),
      inOut: body.inOut ?? 'out',
      invType: body.invType ?? 'مصروفات',
      expInId: body.expInId != null ? Number(body.expInId) : null,
      categoryName: body.categoryName ?? null,
      notes: body.notes ?? null,
      empId: body.empId != null ? Number(body.empId) : null,
      isPayrollDeduction: !!body.isPayrollDeduction,
      isEmployeePayrollIncome: !!body.isEmployeePayrollIncome,
      linkedPayrollTxn: null,
      empIdFromCategoryMap: body.empIdFromCategoryMap != null ? Number(body.empIdFromCategoryMap) : null,
    };

    const settings = await loadClassificationSettings();
    const withoutAdmin = classifyCashMove(input, emptySettingsBundle());
    const withAdmin = classifyCashMove(input, settings);

    return NextResponse.json({
      withoutAdmin,
      withAdmin,
      settingsLoaded: settings.loaded,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}
