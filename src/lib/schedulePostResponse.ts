/**
 * Best-effort post-response work (Next.js `after()`).
 * Not a durable outbox — callbacks run after the response is sent when the
 * runtime supports it; failures are logged and must never fail the HTTP response.
 */
import { after } from 'next/server';

export const POST_RESPONSE_MECHANISM = 'next_after_best_effort' as const;

export function schedulePostResponse(task: () => Promise<void>): void {
  after(async () => {
    try {
      await task();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      console.error('[schedulePostResponse]', message);
    }
  });
}
