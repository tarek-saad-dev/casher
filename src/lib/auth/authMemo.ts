/**
 * Short-lived, per-process memo for the staff authentication hot path.
 *
 * Every staff API call used to run ~8 sequential DB round trips just to
 * authenticate (user status, page access ×4, tenant membership + location)
 * before doing any work — and many requests authenticate twice. Against a
 * remote SQL Server that is ~1.5–2 s per call. This memo keeps each answer
 * for AUTH_MEMO_TTL_MS and shares in-flight lookups, so a screen that fires
 * ten API calls authenticates once.
 *
 * Trade-off (same pattern as the 15 s commercial gate memo): a user that is
 * deactivated or loses a role/tenant membership is denied at most
 * AUTH_MEMO_TTL_MS later. Call invalidateUserAuth() after such changes for an
 * immediate effect. Disabled under tests and with AUTH_MEMO=off.
 */

export const AUTH_MEMO_TTL_MS = 10_000;
const MAX_ENTRIES = 2_000;

function memoDisabled(): boolean {
  return (
    process.env.VITEST === 'true' ||
    process.env.NODE_ENV === 'test' ||
    process.env.AUTH_MEMO === 'off'
  );
}

export class KeyedTtlMemo<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    if (memoDisabled()) return load();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    if (hit) this.entries.delete(key);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = load()
      .then((value) => {
        if (this.entries.size >= MAX_ENTRIES) {
          const oldest = this.entries.keys().next().value;
          if (oldest !== undefined) this.entries.delete(oldest);
        }
        this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  invalidate(prefix: string): void {
    for (const k of [...this.entries.keys()]) {
      if (k.startsWith(prefix)) this.entries.delete(k);
    }
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }
}

/** Keys always start with `u:<userId>:` so a user's entries can be dropped together. */
export const userStatusMemo = new KeyedTtlMemo<unknown>(AUTH_MEMO_TTL_MS);
export const userAccessMemo = new KeyedTtlMemo<unknown>(AUTH_MEMO_TTL_MS);
export const staffTenantMemo = new KeyedTtlMemo<unknown>(AUTH_MEMO_TTL_MS);
/** Branch-context gate: user ↔ branch link (keyed by userKey(userId, branchId)). */
export const userBranchAccessMemo = new KeyedTtlMemo<unknown>(AUTH_MEMO_TTL_MS);
/** Branch-context gate: the branch row itself (keyed by branchKey(branchId)). */
export const branchRecordMemo = new KeyedTtlMemo<unknown>(AUTH_MEMO_TTL_MS);

export function branchKey(branchId: number): string {
  return `b:${branchId}:`;
}

export function userKey(userId: number, ...parts: Array<string | number | null | undefined>): string {
  return [`u:${userId}`, ...parts.map((p) => String(p ?? ''))].join(':') + ':';
}

/** Drop cached auth answers for one user (role change, deactivation, membership change). */
export function invalidateUserAuth(userId: number): void {
  const prefix = `u:${userId}:`;
  userStatusMemo.invalidate(prefix);
  userAccessMemo.invalidate(prefix);
  staffTenantMemo.invalidate(prefix);
  userBranchAccessMemo.invalidate(prefix);
}

/**
 * A branch row changed (active flag, lifecycle, code): drop it and every cached
 * user↔branch link, since those carry the branch's active flag too.
 */
export function invalidateBranchAuth(branchId: number): void {
  branchRecordMemo.invalidate(branchKey(branchId));
  userBranchAccessMemo.clear();
}

/** Test-only. */
export function resetAuthMemo(): void {
  userStatusMemo.clear();
  userAccessMemo.clear();
  staffTenantMemo.clear();
  userBranchAccessMemo.clear();
  branchRecordMemo.clear();
}

/** Page grants changed for a role/page: every user's access answer is stale. */
export function invalidateAllUserAccess(): void {
  userAccessMemo.clear();
}
