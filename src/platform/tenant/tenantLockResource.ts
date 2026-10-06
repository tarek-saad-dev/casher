/**
 * Tenant-scoped applock resource names (DRVO-002 A2.3).
 * sp_getapplock compares resource names case-sensitively and SQL Server returns
 * UNIQUEIDENTIFIER values upper-case, so the tenant segment is normalized to lower-case.
 */
export function tenantLockResource(
  tenantId: string,
  parts: readonly string[],
): string {
  const tenant = String(tenantId ?? '').trim().toLowerCase();
  if (!tenant) {
    throw new Error('tenantLockResource requires a tenantId');
  }
  const suffix = parts.map((p) => String(p).trim()).filter(Boolean).join(':');
  if (!suffix) {
    throw new Error('tenantLockResource requires at least one part');
  }
  return `t:${tenant}:${suffix}`;
}
