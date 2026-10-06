/**
 * Tenant-scoped cache keys (DRVO-002 §2.3).
 * The tenant segment is normalized to lower-case so one tenant never maps to two keys.
 */
export function tenantCacheKey(
  tenantId: string,
  module: string,
  parts: readonly string[] = [],
): string {
  const tenant = String(tenantId ?? '').trim().toLowerCase();
  if (!tenant) {
    throw new Error('tenantCacheKey requires a tenantId');
  }
  const mod = String(module).trim();
  if (!mod) {
    throw new Error('tenantCacheKey requires a module name');
  }
  const rest = parts.map((p) => String(p).trim()).filter(Boolean).join(':');
  return rest ? `t:${tenant}:${mod}:${rest}` : `t:${tenant}:${mod}`;
}
