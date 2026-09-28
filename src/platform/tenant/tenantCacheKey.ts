/**
 * Tenant-scoped cache keys (DRVO-002 §2.3).
 */
export function tenantCacheKey(
  tenantId: string,
  module: string,
  parts: readonly string[] = [],
): string {
  const mod = String(module).trim();
  if (!mod) {
    throw new Error('tenantCacheKey requires a module name');
  }
  const rest = parts.map((p) => String(p).trim()).filter(Boolean).join(':');
  return rest ? `t:${tenantId}:${mod}:${rest}` : `t:${tenantId}:${mod}`;
}
