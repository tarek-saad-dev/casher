// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EmployeeHrFormModal from '@/components/hr/EmployeeHrFormModal';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

describe('EmployeeHrFormModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders create form sections', () => {
    render(
      <EmployeeHrFormModal
        open
        onOpenChange={() => {}}
        mode="create"
        employee={null}
        onSaved={() => {}}
      />,
    );

    expect(screen.getByText('إضافة موظف جديد')).toBeInTheDocument();
    expect(screen.getByText('١ — البيانات الأساسية')).toBeInTheDocument();
    expect(screen.getByText('٢ — مواعيد وأيام العمل')).toBeInTheDocument();
    expect(screen.getByText('دوام كامل')).toBeInTheDocument();
    expect(screen.getByText('فري لانس')).toBeInTheDocument();
  });

  it('shows manualHourlyRate field for hourly payroll', () => {
    render(
      <EmployeeHrFormModal
        open
        onOpenChange={() => {}}
        mode="create"
        employee={null}
        onSaved={() => {}}
      />,
    );

    expect(screen.getAllByText('سعر الساعة *').length).toBeGreaterThan(0);
  });

  it('hides monthly option UI when freelance selected', async () => {
    render(
      <EmployeeHrFormModal
        open
        onOpenChange={() => {}}
        mode="create"
        employee={null}
        onSaved={() => {}}
      />,
    );

    const dialog = screen.getAllByTestId('dialog')[0]!;
    const ui = within(dialog);
    fireEvent.click(ui.getByText('فري لانس'));
    await waitFor(() => {
      expect(ui.queryByText('شهري')).not.toBeInTheDocument();
    });
    expect(ui.getByText(/الفري لانس لا يتم إنشاء جدول ثابت/)).toBeInTheDocument();
  });

  it('shows flexible weekly preview for full_time', () => {
    render(
      <EmployeeHrFormModal
        open
        onOpenChange={() => {}}
        mode="create"
        employee={null}
        onSaved={() => {}}
      />,
    );

    fireEvent.click(screen.getAllByText('إجازة أسبوعية مرنة')[0]!);
    expect(
      screen.getAllByText(/سيتم إنشاء جدول ٧ أيام عمل/).length,
    ).toBeGreaterThan(0);
  });
});
