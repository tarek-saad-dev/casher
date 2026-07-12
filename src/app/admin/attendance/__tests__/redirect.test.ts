import { describe, expect, it, vi, beforeEach } from 'vitest';

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

describe('/admin/attendance redirect', () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it('redirects to /admin/hr?tab=attendance', async () => {
    const mod = await import('@/app/admin/attendance/page');
    expect(() => mod.default()).toThrow('REDIRECT:/admin/hr?tab=attendance');
    expect(redirectMock).toHaveBeenCalledWith('/admin/hr?tab=attendance');
  });
});
