// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ManagerDailyClose from '../ManagerDailyClose';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('manager daily close', () => {
  it('blocks closing with unsaved attendance', () => {
    render(<ManagerDailyClose workDate="2026-10-22" blocked onClosed={async () => {}} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('uses the reviewed work date and suppresses WhatsApp, then refreshes attendance', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, workDate: '2026-10-22' }) });
    vi.stubGlobal('fetch', fetcher);
    let refreshed = false;
    render(<ManagerDailyClose workDate="2026-10-22" blocked={false} onClosed={async () => { refreshed = true; }} />);
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('تم تنفيذ قفل اليوم 2026-10-22 بنجاح');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ workDate: '2026-10-22', dryRun: false, skipWhatsApp: true });
    expect(refreshed).toBe(true);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not report success for partial failure', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, errors: ['تعذر حساب اليوميات'] }) }));
    let historyNeedsRefresh = false;
    render(<ManagerDailyClose workDate="2026-10-22" blocked={false} onClosed={async () => {}} onAttemptFinished={() => { historyNeedsRefresh = true; }} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('تعذر حساب اليوميات'));
    expect(screen.queryByText(/بنجاح/)).toBeNull();
    expect(historyNeedsRefresh).toBe(true);
  });
});
