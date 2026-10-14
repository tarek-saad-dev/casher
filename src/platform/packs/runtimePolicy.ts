import 'server-only';
import type { ConnectionPool } from 'mssql';
import { getPool } from '@/lib/db';
import { findIndustryPack } from '@/packs';
import { getTenantPackState } from '@/platform/apps/tenantApps';
import type { IndustryPackDefinition } from '@/platform/packs/types';

export async function getTenantIndustryPackDefinition(
  tenantId: string,
  pool?: ConnectionPool,
): Promise<IndustryPackDefinition | null> {
  const db = pool ?? (await getPool());
  const state = await getTenantPackState(db, tenantId);
  return state ? findIndustryPack(state.packCode) : null;
}

export function isBookableJobForPack(
  pack: IndustryPackDefinition | null,
  job: string | null | undefined,
): boolean {
  const normalized = String(job ?? '').trim().toLowerCase();
  return Boolean(
    normalized &&
      pack?.onboarding.bookableJobs.some(
        (x) => String(x).trim().toLowerCase() === normalized,
      ),
  );
}

export async function isTenantBookableJob(
  tenantId: string,
  job: string | null | undefined,
  pool?: ConnectionPool,
): Promise<boolean> {
  return isBookableJobForPack(
    await getTenantIndustryPackDefinition(tenantId, pool),
    job,
  );
}
