import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getCairoCalendarDate } from '@/lib/businessDate';
import {
  LATE_DEDUCTION_CONFIG_KEY_ACTIVATED_ON,
  LATE_DEDUCTION_CONFIG_KEY_ENABLED,
} from './constants';
import { ensureLateDeductionSchema } from './schema';

export interface LateDeductionConfig {
  enabled: boolean;
  activatedOn: string | null;
}

function parseEnabled(raw: string | null | undefined): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export async function getLateDeductionConfig(): Promise<LateDeductionConfig> {
  const db = await getPool();
  const ok = await ensureLateDeductionSchema(db);
  if (!ok) return { enabled: false, activatedOn: null };

  const result = await db.request().query(`
    SELECT SettingKey, SettingValue
    FROM dbo.TblHrFeatureSetting
    WHERE SettingKey IN (
      N'${LATE_DEDUCTION_CONFIG_KEY_ENABLED}',
      N'${LATE_DEDUCTION_CONFIG_KEY_ACTIVATED_ON}'
    )
  `);

  let enabled = false;
  let activatedOn: string | null = null;
  for (const row of result.recordset as Array<{ SettingKey: string; SettingValue: string | null }>) {
    if (row.SettingKey === LATE_DEDUCTION_CONFIG_KEY_ENABLED) {
      enabled = parseEnabled(row.SettingValue);
    }
    if (row.SettingKey === LATE_DEDUCTION_CONFIG_KEY_ACTIVATED_ON) {
      const raw = String(row.SettingValue ?? '').trim();
      activatedOn = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    }
  }
  return { enabled, activatedOn };
}

export { isWorkDateEligibleForLateDeduction } from './rules';

/**
 * Enable/disable the global system.
 * When enabling for the first time (or re-enabling without an activation date),
 * sets ActivatedOn to today's Cairo calendar date so history is not charged.
 */
export async function setLateDeductionEnabled(params: {
  enabled: boolean;
  userId?: number | null;
  activatedOn?: string | null;
}): Promise<LateDeductionConfig> {
  const db = await getPool();
  await ensureLateDeductionSchema(db);

  const current = await getLateDeductionConfig();
  let activatedOn = current.activatedOn;

  if (params.enabled) {
    if (params.activatedOn && /^\d{4}-\d{2}-\d{2}$/.test(params.activatedOn)) {
      activatedOn = params.activatedOn;
    } else if (!activatedOn) {
      activatedOn = getCairoCalendarDate();
    }
  }

  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input('key', sql.NVarChar(80), LATE_DEDUCTION_CONFIG_KEY_ENABLED)
      .input('value', sql.NVarChar(200), params.enabled ? 'true' : 'false')
      .input('userId', sql.Int, params.userId ?? null)
      .query(`
        MERGE dbo.TblHrFeatureSetting AS t
        USING (SELECT @key AS SettingKey) AS s
        ON t.SettingKey = s.SettingKey
        WHEN MATCHED THEN UPDATE SET
          SettingValue = @value,
          UpdatedAt = SYSUTCDATETIME(),
          UpdatedByUserID = @userId
        WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedByUserID)
          VALUES (@key, @value, @userId);
      `);

    if (activatedOn) {
      await new sql.Request(tx)
        .input('key', sql.NVarChar(80), LATE_DEDUCTION_CONFIG_KEY_ACTIVATED_ON)
        .input('value', sql.NVarChar(200), activatedOn)
        .input('userId', sql.Int, params.userId ?? null)
        .query(`
          MERGE dbo.TblHrFeatureSetting AS t
          USING (SELECT @key AS SettingKey) AS s
          ON t.SettingKey = s.SettingKey
          WHEN MATCHED THEN UPDATE SET
            SettingValue = @value,
            UpdatedAt = SYSUTCDATETIME(),
            UpdatedByUserID = @userId
          WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedByUserID)
            VALUES (@key, @value, @userId);
        `);
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  return getLateDeductionConfig();
}
