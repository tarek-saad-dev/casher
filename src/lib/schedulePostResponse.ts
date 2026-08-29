/**
 * Best-effort post-response work.
 * Uses Next.js `after()` inside an HTTP request; outside request scope
 * (workers, scripts) falls back to fire-and-forget so commits are not failed.
 */
import { after } from 'next/server';

export const POST_RESPONSE_MECHANISM = 'next_after_best_effort' as const;

function runDetached(task: () => Promise<void>): void {
  void Promise.resolve()
    .then(task)
    .catch((err) => {
      const message = err instanceof Error ? err.message : 'unknown_error';
      console.error('[schedulePostResponse]', message);
    });
}

export function schedulePostResponse(task: () => Promise<void>): void {
  try {
    after(async () => {
      try {
        await task();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown_error';
        console.error('[schedulePostResponse]', message);
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Worker / non-request contexts cannot use next/server after().
    if (/outside a request scope|next-dynamic-api-wrong-context/i.test(message)) {
      runDetached(task);
      return;
    }
    throw err;
  }
}
