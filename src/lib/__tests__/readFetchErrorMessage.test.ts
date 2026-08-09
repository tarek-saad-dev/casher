import { describe, expect, it } from 'vitest';
import { readFetchErrorMessage } from '@/lib/readFetchErrorMessage';

function mockRes(init: {
  status: number;
  contentType?: string;
  body: string;
}): Response {
  return new Response(init.body, {
    status: init.status,
    headers: init.contentType ? { 'content-type': init.contentType } : undefined,
  });
}

describe('readFetchErrorMessage', () => {
  it('prefers JSON error field', async () => {
    const msg = await readFetchErrorMessage(
      mockRes({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'غير مصرح — super_admin فقط' }),
      }),
    );
    expect(msg).toBe('غير مصرح — super_admin فقط');
  });

  it('does not dump HTML error pages', async () => {
    const msg = await readFetchErrorMessage(
      mockRes({
        status: 500,
        contentType: 'text/html; charset=utf-8',
        body: '<!DOCTYPE html><html lang="ar"><body>boom</body></html>',
      }),
    );
    expect(msg).toBe('فشل الطلب (HTTP 500)');
    expect(msg).not.toContain('<!DOCTYPE');
  });
});
