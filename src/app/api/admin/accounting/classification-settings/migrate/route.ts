import { NextResponse } from 'next/server';
import { isAuthResult, requireRole } from '@/lib/api-auth';
import {
  getAccountingSettingsMigrationStatus,
  runFullAccountingSettingsMigration,
} from '@/lib/accounting/accountingSettingsService';
import { extractSqlError } from '@/lib/accounting/accountingSettingsMigration';

export async function POST() {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const result = await runFullAccountingSettingsMigration(auth.userId);
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          failedStep: result.failedStep,
          sqlError: result.sqlError,
          createdTables: result.createdTables,
          existingTables: result.existingTables,
          steps: result.steps,
        },
        { status: 500 },
      );
    }
    const status = await getAccountingSettingsMigrationStatus();
    return NextResponse.json({
      success: true,
      tablesExist: status.tablesExist,
      migrationRequired: status.migrationRequired,
      createdTables: result.createdTables,
      existingTables: result.existingTables,
      seededRows: result.seededRows,
      skippedSeeds: result.skippedSeeds,
      steps: result.steps,
    });
  } catch (error: unknown) {
    const sqlError = extractSqlError(error);
    return NextResponse.json(
      { success: false, sqlError, error: sqlError.message },
      { status: 500 },
    );
  }
}

export async function GET() {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  const status = await getAccountingSettingsMigrationStatus();
  return NextResponse.json({
    tablesExist: status.tablesExist,
    migrationRequired: status.migrationRequired,
    existingTables: status.existingTables,
    missingTables: status.missingTables,
  });
}
