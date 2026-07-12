/**
 * Expense print UI strategy tests (happy-dom).
 * Verifies local-service-first behavior and manual browser fallback gating.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ExpenseReceiptPopup from '@/components/expenses/ExpenseReceiptPopup';

vi.mock('@/lib/localPrintClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/localPrintClient')>('@/lib/localPrintClient');
  return {
    ...actual,
    printHtmlViaLocalService: vi.fn(),
    openBrowserPrintFallback: vi.fn(() => ({ ok: true as const })),
  };
});

import {
  printHtmlViaLocalService,
  openBrowserPrintFallback,
} from '@/lib/localPrintClient';

const expense = {
  invID: 42,
  invDate: '2026-07-12',
  invTime: '22:00',
  CatName: 'بوفيه',
  GrandTolal: 50,
  PaymentMethod: 'نقدي',
  Notes: null,
  UserName: 'admin',
};

describe('ExpenseReceiptPopup print strategy', () => {
  beforeEach(() => {
    vi.mocked(printHtmlViaLocalService).mockReset();
    vi.mocked(openBrowserPrintFallback).mockReset();
    vi.mocked(openBrowserPrintFallback).mockReturnValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('sends one local print request and does not open browser on success', async () => {
    vi.mocked(printHtmlViaLocalService).mockResolvedValue({
      ok: true,
      requestId: 'exp-42-1',
      printer: 'XP-80',
      message: 'ok',
    });

    render(<ExpenseReceiptPopup open expense={expense} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('expense-print-button'));

    await waitFor(() => {
      expect(printHtmlViaLocalService).toHaveBeenCalledTimes(1);
    });

    expect(openBrowserPrintFallback).not.toHaveBeenCalled();
    expect(screen.queryByTestId('expense-browser-print-fallback')).toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/تمت الطباعة/)).toBeTruthy();
    });
  });

  it('shows manual browser fallback only after service failure', async () => {
    vi.mocked(printHtmlViaLocalService).mockResolvedValue({
      ok: false,
      requestId: 'exp-42-2',
      code: 'SERVICE_UNAVAILABLE',
      message: 'down',
      userMessage: 'تعذر الوصول إلى خدمة الطباعة المحلية على هذا الجهاز.',
    });

    render(<ExpenseReceiptPopup open expense={expense} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('expense-print-button'));

    await waitFor(() => {
      expect(screen.getByTestId('expense-browser-print-fallback')).toBeTruthy();
    });

    expect(openBrowserPrintFallback).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('expense-browser-print-fallback'));
    expect(openBrowserPrintFallback).toHaveBeenCalledTimes(1);
  });

  it('ignores double click while printing', async () => {
    let resolvePrint!: (value: {
      ok: true;
      requestId: string;
      printer: string;
    }) => void;
    vi.mocked(printHtmlViaLocalService).mockImplementation(
      () => new Promise((resolve) => { resolvePrint = resolve; }),
    );

    render(<ExpenseReceiptPopup open expense={expense} onClose={() => {}} />);
    const btn = screen.getByTestId('expense-print-button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(printHtmlViaLocalService).toHaveBeenCalledTimes(1);
    resolvePrint({ ok: true, requestId: 'exp-42-3', printer: 'XP-80' });
    await waitFor(() => {
      expect(screen.getByText(/تمت الطباعة/)).toBeTruthy();
    });
  });
});
