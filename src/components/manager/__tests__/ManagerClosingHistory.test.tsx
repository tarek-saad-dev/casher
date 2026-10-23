// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ManagerClosingHistory from '../ManagerClosingHistory';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (body: unknown) => ({ ok: true, json: async () => body });
const history = { available: true, month: '2026-10', lastSuccessfulWorkDate: '2026-10-20', days: [{ date: '2026-10-20', success: true }, { date: '2026-10-21', success: false }] };

describe('manager closing chart', () => {
  it('shows the last successful work date and all calendar days with accessible states', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(history)));
    render(<ManagerClosingHistory workDate="2026-10-23" />);
    await screen.findByText(/آخر قفل تلقائي ناجح/);
    expect(document.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-20');
    expect(screen.getAllByRole('listitem')).toHaveLength(31);
    expect(screen.getByRole('listitem', { name: '2026-10-21: آخر محاولة لم تكتمل' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: '2026-10-22: لا توجد محاولة مسجّلة' })).toBeTruthy();
  });
  it('refreshes persisted history after closing, without inventing a success from local state', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(history));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<ManagerClosingHistory workDate="2026-10-23" revision={0} />);
    await screen.findByText(/آخر قفل تلقائي ناجح/);
    fetcher.mockResolvedValue(response({ ...history, lastSuccessfulWorkDate: '2026-10-23' }));
    view.rerender(<ManagerClosingHistory workDate="2026-10-23" revision={1} />);
    await waitFor(() => expect(document.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-23'));
  });
  it('shows an error and allows retry instead of showing no closed days', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('تعذر تحميل السجل'));
    vi.stubGlobal('fetch', fetcher);
    render(<ManagerClosingHistory workDate="2026-10-23" />);
    await screen.findByRole('alert');
    expect(screen.queryByText(/لا يوجد قفل تلقائي ناجح/)).toBeNull();
    fetcher.mockResolvedValue(response({ ...history, days: [], lastSuccessfulWorkDate: null }));
    fireEvent.click(screen.getByRole('button', { name: 'تحديث السجل' }));
    await screen.findByText('لا يوجد قفل تلقائي ناجح مسجّل حتى الآن');
  });
  it('ignores a late response from the previous month', async () => {
    let resolveOctober!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveOctober = resolve; }))
      .mockResolvedValueOnce(response({ ...history, month: '2026-02', days: [] })));
    const view = render(<ManagerClosingHistory workDate="2026-10-23" />);
    view.rerender(<ManagerClosingHistory workDate="2026-02-01" />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(28));
    resolveOctober(response(history));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /2026-10-20/ })).toBeNull());
    expect(screen.getAllByRole('listitem')).toHaveLength(28);
  });
});
