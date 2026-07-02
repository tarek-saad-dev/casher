type InvalidateListener = () => void;

const listeners = new Set<InvalidateListener>();

export function invalidateRecentInvoicesCache(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeRecentInvoicesInvalidation(
  listener: InvalidateListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
