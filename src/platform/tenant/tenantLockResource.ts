/**
 * Tenant-scoped applock resource names (DRVO-002 §2.3).
 */
export function tenantLockResource(
  tenantId: string,
  parts: readonly string[],
): string {
  const suffix = parts.map((p) => String(p).trim()).filter(Boolean).join(':');
  if (!suffix) {
    throw new Error('tenantLockResource requires at least one part');
  }
  return `t:${tenantId}:${suffix}`;
}
