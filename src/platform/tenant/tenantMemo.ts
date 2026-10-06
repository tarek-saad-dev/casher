import { tenantCacheKey } from './tenantCacheKey';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireTenantId(tenantId: string | null | undefined, where: string): string {
  const id = String(tenantId ?? '').trim();
  if (!UUID_RE.test(id)) {
    throw new Error(`${where} requires an authoritative tenantId`);
  }
  return id.toLowerCase();
}

/**
 * In-memory memoization that can only be addressed through a tenant namespace.
 * There is no API to read or write an entry without a TenantId, so values cannot leak
 * between tenants that share the same local key (branch id, plan code, ...).
 */
export class TenantScopedMemo<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly module: string,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  key(tenantId: string, parts: readonly string[] = []): string {
    return tenantCacheKey(requireTenantId(tenantId, `TenantScopedMemo(${this.module})`), this.module, parts);
  }

  get(tenantId: string, parts: readonly string[] = []): T | undefined {
    const k = this.key(tenantId, parts);
    const hit = this.entries.get(k);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(k);
      return undefined;
    }
    return hit.value;
  }

  set(tenantId: string, parts: readonly string[], value: T): void {
    this.entries.set(this.key(tenantId, parts), { value, expiresAt: this.now() + this.ttlMs });
  }

  async getOrLoad(tenantId: string, parts: readonly string[], load: () => Promise<T>): Promise<T> {
    const hit = this.get(tenantId, parts);
    if (hit !== undefined) return hit;
    const value = await load();
    this.set(tenantId, parts, value);
    return value;
  }

  invalidateTenant(tenantId: string): void {
    const prefix = `t:${requireTenantId(tenantId, `TenantScopedMemo(${this.module})`)}:`;
    for (const k of [...this.entries.keys()]) {
      if (k.startsWith(prefix)) this.entries.delete(k);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Tenant-namespaced idempotency key for stores that are not already unique per tenant
 * (PlatformOutbox and TreasuryMovementRegistry are unique on (TenantId, IdempotencyKey)).
 */
export function tenantIdempotencyKey(tenantId: string, scope: string, key: string): string {
  const s = String(scope).trim();
  const k = String(key).trim();
  if (!s || !k) throw new Error('tenantIdempotencyKey requires scope and key');
  return `t:${requireTenantId(tenantId, 'tenantIdempotencyKey')}:${s}:${k}`;
}
