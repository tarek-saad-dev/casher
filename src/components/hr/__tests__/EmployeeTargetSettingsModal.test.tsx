// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EmployeeTargetSettingsModal, {
  toDailyDisplay,
  buildTierInterpretation,
  currentMonthCoverage,
} from '@/components/hr/EmployeeTargetSettingsModal';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="enabled-switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    >
      {checked ? 'on' : 'off'}
    </button>
  ),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="basis-select">
      <button type="button" onClick={() => onValueChange('daily')}>set-daily</button>
      <button type="button" onClick={() => onValueChange('monthly')}>set-monthly</button>
      <span data-testid="basis-value">{value}</span>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('month coverage', () => {
  it('mid-month date still starts from day 1', () => {
    const c = currentMonthCoverage('2026-07-15');
    expect(c.effectiveFrom).toBe('2026-07-01');
    expect(c.monthEnd).toBe('2026-07-31');
  });
});

describe('EmployeeTargetSettingsModal helpers', () => {
  it('converts monthly start to daily display when conversion days change', () => {
    expect(toDailyDisplay('26000', 'monthly', 26)).toMatch(/1|١/);
    expect(toDailyDisplay('26000', 'monthly', 20)).not.toBe(toDailyDisplay('26000', 'monthly', 26));
  });

  it('builds Arabic interpretation for tiers', () => {
    const lines = buildTierInterpretation(
      [
        { inputStartAmount: '1000', ratePercent: '10' },
        { inputStartAmount: '3000', ratePercent: '20' },
      ],
      'daily',
      26,
    );
    expect(lines[0]).toMatch(/بدون تارجت/);
    expect(lines[lines.length - 1]).toMatch(/الجزء الزائد/);
  });
});

describe('EmployeeTargetSettingsModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        employee: { empId: 1, empName: 'سارة' },
        effectivePlan: null,
        latestPlan: null,
        history: [],
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => cleanup());

  it('has single save and no history UI', async () => {
    render(
      <EmployeeTargetSettingsModal open onClose={() => {}} empId={1} empName="سارة" />,
    );
    const dialog = await screen.findByTestId('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^حفظ$/ })).toBeInTheDocument());
    expect(within(dialog).queryByText(/سجل الخطط/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /تشغيل/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/الشهر الحالي بالكامل/)).toBeInTheDocument();
    expect(within(dialog).getByText('تشغيل التارجت')).toBeInTheDocument();
  });

  it('loads and allows adding/removing tiers', async () => {
    render(
      <EmployeeTargetSettingsModal open onClose={() => {}} empId={1} empName="سارة" />,
    );
    const dialog = await screen.findByTestId('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /إضافة شريحة/ }));
    expect(within(dialog).getByText('البداية')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText(/حذف الشريحة/));
    expect(within(dialog).queryByText('البداية')).not.toBeInTheDocument();
  });

  it('validates enabled save without tiers', async () => {
    render(
      <EmployeeTargetSettingsModal open onClose={() => {}} empId={1} empName="سارة" />,
    );
    const dialog = await screen.findByTestId('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('enabled-switch')).toBeInTheDocument());
    fireEvent.click(within(dialog).getByTestId('enabled-switch'));
    fireEvent.click(within(dialog).getByRole('button', { name: /^حفظ$/ }));
    await waitFor(() => {
      expect(within(dialog).getByText('التارجت المفعّل يحتاج شريحة واحدة على الأقل')).toBeInTheDocument();
    });
  });

  it('saves with month-start effectiveFrom', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return { ok: true, json: async () => ({ plan: { id: 1, isEnabled: true } }) };
      }
      return {
        ok: true,
        json: async () => ({
          employee: { empId: 1, empName: 'سارة' },
          effectivePlan: null,
          latestPlan: null,
          history: [],
        }),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <EmployeeTargetSettingsModal open onClose={() => {}} empId={1} empName="سارة" />,
    );
    const dialog = await screen.findByTestId('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /إضافة شريحة/ }));
    fireEvent.click(within(dialog).getByTestId('enabled-switch'));
    fireEvent.click(within(dialog).getByRole('button', { name: /^حفظ$/ }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put![1]?.body));
      expect(body.effectiveFrom.endsWith('-01')).toBe(true);
      expect(body.isEnabled).toBe(true);
    });
  });
});
