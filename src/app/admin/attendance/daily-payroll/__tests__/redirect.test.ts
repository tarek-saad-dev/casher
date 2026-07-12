import { describe, expect, it, vi, beforeEach } from 'vitest';

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

describe('/admin/attendance/daily-payroll redirect', () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it('redirects to /admin/hr?tab=daily-payroll', async () => {
    const mod = await import('@/app/admin/attendance/daily-payroll/page');
    expect(() => mod.default()).toThrow('REDIRECT:/admin/hr?tab=daily-payroll');
    expect(redirectMock).toHaveBeenCalledWith('/admin/hr?tab=daily-payroll');
  });

  it('does not export a client standalone payroll UI', async () => {
    const mod = await import('@/app/admin/attendance/daily-payroll/page');
    expect(typeof mod.default).toBe('function');
    const source = mod.default.toString();
    expect(source).not.toContain('handlePostToCash');
    expect(source).not.toContain('useState');
  });
});
