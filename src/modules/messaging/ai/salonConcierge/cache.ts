const TTL_MS = 45_000;

type Entry<T> = { at: number; value: T };

let entry: Entry<unknown> | null = null;

export function getCachedSnapshot<T>(loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  if (entry && now - entry.at < TTL_MS) {
    return Promise.resolve(entry.value as T);
  }
  return loader().then((value) => {
    entry = { at: Date.now(), value };
    return value;
  });
}

export function invalidateConciergeCache(): void {
  entry = null;
}

export function conciergeCacheStats(): { hit: boolean; ageMs: number | null } {
  if (!entry) return { hit: false, ageMs: null };
  return { hit: true, ageMs: Date.now() - entry.at };
}
