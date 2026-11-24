/**
 * Shared beforeAll gate for *.integration.test.ts files.
 * Fail-closed: refuses production last132 and unapproved targets.
 */
import { getPool } from '@/lib/db';
import {
  UnapprovedTestDatabaseError,
  assertApprovedTestDatabase,
  type DbIdentity,
} from '@/lib/db/assertApprovedTestDatabase';

export type IntegrationDbGate = {
  available: boolean;
  reason: string;
  identity?: DbIdentity;
};

export async function prepareIntegrationDatabaseGate(
  env: NodeJS.ProcessEnv = process.env,
): Promise<IntegrationDbGate> {
  try {
    const pool = await getPool();
    const approved = await assertApprovedTestDatabase(pool, env);
    await pool.request().query('SELECT 1 AS ok');
    return {
      available: true,
      reason: '',
      identity: approved.identity,
    };
  } catch (e: unknown) {
    if (e instanceof UnapprovedTestDatabaseError) {
      return {
        available: false,
        reason: e.message,
        identity: e.identity,
      };
    }
    return {
      available: false,
      reason: e instanceof Error ? e.message : 'DB connection failed',
    };
  }
}
