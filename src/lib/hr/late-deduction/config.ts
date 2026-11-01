import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getCairoCalendarDate } from '@/lib/businessDate';
import {
  LATE_DEDUCTION_CONFIG_KEY_ACTIVATED_ON,
  LATE_DEDUCTION_CONFIG_KEY_ENABLED,
} from './constants';
import { isLateDeductionSchemaReady } from './schema';

export interface LateDeductionConfig {
  enabled: boolean;
  activatedOn: string | null;
}

function parseEnabled(raw: string | null | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(raw ?? '').trim().toLowerCase());
}

/** Fail closed if a legacy branch cannot be mapped to exactly one active tenant. */
export async function resolveLateDeductionTenantId(branchId: number): Promise<string | null> {
  if (!Number.isInteger(branchId) || branchId <= 0) return null;
  const db = await getPool();
  const result = await db.request().input('branchId', sql.Int, branchId).query(`
    SELECT DISTINCT CONVERT(VARCHAR(36), TenantId) AS TenantId
    FROM dbo.Location
    WHERE LegacyBranchId = @branchId AND Status = N'active'
  `);
  const rows = result.recordset as Array<{ TenantId: string }>;
  return rows.length === 1 ? String(rows[0].TenantId).toLowerCase() : null;
}

/** The already-applied DRVO-020 SettingKey PK supports tenant-suffixed keys (<=80 chars). */
function tenantSettingKey(base: string, tenantId: string): string {
  return `${base}:${tenantId}`;
}

export async function getLateDeductionConfig(branchId: number): Promise<LateDeductionConfig> {
  const disabled = { enabled: false, activatedOn: null };
  const db = await getPool();
  if (!(await isLateDeductionSchemaReady(db))) return disabled;
  const tenantId = await resolveLateDeductionTenantId(branchId);
  if (!tenantId) return disabled;

  const enabledKey = tenantSettingKey(LATE_DEDUCTION_CONFIG_KEY_ENABLED, tenantId);
  const activatedKey = tenantSettingKey(LATE_DEDUCTION_CONFIG_KEY_ACTIVATED_ON, tenantId);
  const result = await db.request()
    .input('enabledKey', sql.NVarChar(80), enabledKey)
    .input('activatedKey', sql.NVarChar(80), activatedKey)
    .query(`
      SELECT SettingKey, SettingValue FROM dbo.TblHrFeatureSetting
      WHERE SettingKey IN (@enabledKey, @activatedKey)
    `);

  let enabled = false;
  let activatedOn: string | null = null;
  for (const row of result.recordset as Array<{ SettingKey: string; SettingValue: string | null }>) {
    if (row.SettingKey === enabledKey) enabled = parseEnabled(row.SettingValue);
    if (row.SettingKey === activatedKey) {
      const raw = String(row.SettingValue ?? '').trim();
      activatedOn = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    }
  }
  return { enabled, activatedOn };
}

export { isWorkDateEligibleForLateDeduction } from './rules';

/** Tenant-local feature flag. No caller-controlled backdating. */
export async function setLateDeductionEnabled(params: {
  enabled: boolean;
  branchId: number;
  tenantId: string;
  userId?: number | null;
}): Promise<LateDeductionConfig> {
  const db = await getPool();
  if (!(await isLateDeductionSchemaReady(db))) {
    throw new Error('Late deduction schema missing — apply DRVO migration employee-late-deduction');
  }
  const tenantId = await resolveLateDeductionTenantId(params.branchId);
  if (!tenantId || tenantId !== params.tenantId.toLowerCase()) {
    throw new Error('Late deduction configuration denied for this branch/tenant');
  }

  const enabledKey = tenantSettingKey(LATE_DEDUCTION_CONFIG_KEY_ENABLED, tenantId);
  const activatedKey = tenantSettingKey(LATE_DEDUCTION_CONFIG_KEY_ACTIVATED_ON, tenantId);
  const current = await getLateDeductionConfig(params.branchId);
  // On each re-enable, never restart charges before today.
  const today = getCairoCalendarDate();
  const activatedOn = params.enabled
    ? (current.activatedOn && current.activatedOn > today ? current.activatedOn : today)
    : current.activatedOn;

  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    for (const [key, value] of [
      [enabledKey, params.enabled ? 'true' : 'false'],
      ...(activatedOn ? [[activatedKey, activatedOn]] : []),
    ]) {
      await new sql.Request(tx)
        .input('key', sql.NVarChar(80), key)
        .input('value', sql.NVarChar(200), value)
        .input('userId', sql.Int, params.userId ?? null)
        .query(`
          MERGE dbo.TblHrFeatureSetting WITH (HOLDLOCK) AS t
          USING (SELECT @key AS SettingKey) AS s ON t.SettingKey = s.SettingKey
          WHEN MATCHED THEN UPDATE SET SettingValue = @value,
            UpdatedAt = SYSUTCDATETIME(), UpdatedByUserID = @userId
          WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedByUserID)
            VALUES (@key, @value, @userId);
        `);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
  return getLateDeductionConfig(params.branchId);
}
