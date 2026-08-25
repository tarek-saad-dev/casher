/**
 * Request-scoped memo for operational reads. In-process only — no Redis.
 * Freshness: memo lives for a single AsyncLocalStorage request, not across requests.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type OperationalRequestStore = {
  memo: Map<string, Promise<unknown>>;
};

const als = new AsyncLocalStorage<OperationalRequestStore>();

export function withOperationalRequestScope<T>(fn: () => Promise<T>): Promise<T> {
  const existing = als.getStore();
  if (existing) return fn();
  return als.run({ memo: new Map() }, fn);
}

export function memoizeInOperationalRequest<T>(
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  const store = als.getStore();
  if (!store) return factory();
  const hit = store.memo.get(key);
  if (hit) return hit as Promise<T>;
  const pending = factory();
  store.memo.set(key, pending);
  return pending;
}
