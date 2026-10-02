import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';

type LegacyIdMapDecision =
  | { action: 'ok' }
  | { action: 'insert'; drvoId: string }
  | { action: 'abort'; reason: string };

function decideLegacyIdMapAction(args: {
  entityName: string;
  legacyKey: string;
  authoritativeDrvoId: string;
  existingMapDrvoId: string | null;
}): LegacyIdMapDecision {
  const auth = String(args.authoritativeDrvoId).toLowerCase();
  if (args.existingMapDrvoId == null) {
    return { action: 'insert', drvoId: args.authoritativeDrvoId };
  }
  const existing = String(args.existingMapDrvoId).toLowerCase();
  if (existing === auth) {
    return { action: 'ok' };
  }
  return {
    action: 'abort',
    reason:
      `Conflicting LegacyIdMap for ${args.entityName}/${args.legacyKey}: ` +
      `map=${args.existingMapDrvoId} authoritative=${args.authoritativeDrvoId}`,
  };
}

export async function ensureLegacyIdMapInTransaction(
  tx: Transaction,
  args: {
    tenantId: string;
    entityName: 'branch' | 'staff_user';
    legacyKey: string;
    authoritativeDrvoId: string;
  },
): Promise<'ok' | 'inserted'> {
  const existing = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, args.tenantId)
    .input('entityName', sql.NVarChar(64), args.entityName)
    .input('legacyKey', sql.NVarChar(128), args.legacyKey)
    .query(`
      SELECT DrvoId FROM dbo.LegacyIdMap WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId AND EntityName = @entityName AND LegacyKey = @legacyKey;
    `);

  const existingDrvoId =
    existing.recordset.length > 0
      ? String((existing.recordset[0] as { DrvoId: string }).DrvoId)
      : null;

  if (existing.recordset.length > 1) {
    throw new Error(
      `Abort: duplicate LegacyIdMap rows for ${args.entityName}/${args.legacyKey}`,
    );
  }

  const decision = decideLegacyIdMapAction({
    entityName: args.entityName,
    legacyKey: args.legacyKey,
    authoritativeDrvoId: args.authoritativeDrvoId,
    existingMapDrvoId: existingDrvoId,
  });

  if (decision.action === 'abort') {
    throw new Error(`Abort: ${decision.reason}`);
  }
  if (decision.action === 'ok') {
    return 'ok';
  }

  await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, args.tenantId)
    .input('entityName', sql.NVarChar(64), args.entityName)
    .input('legacyKey', sql.NVarChar(128), args.legacyKey)
    .input('drvoId', sql.UniqueIdentifier, decision.drvoId)
    .query(`
      INSERT INTO dbo.LegacyIdMap (TenantId, EntityName, LegacyKey, DrvoId)
      VALUES (@tenantId, @entityName, @legacyKey, @drvoId);
    `);
  return 'inserted';
}
