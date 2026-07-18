// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AttendancePanel from '@/components/hr/AttendancePanel';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

const fullTimeRow = {
  EmpID: 1,
  EmpName: 'محمد',
  WorkDate: '2026-07-12',
  DayOfWeek: 0,
  IsWorkingDay: true,
  isScheduledWorkingDay: true,
  isAttendanceRequired: true,
  isFreelance: false,
  expectedToday: true,
  displayReason: null,
  scheduleWarning: null,
  employmentTypeLabel: 'دوام كامل',
  payrollMethodLabel: 'بالساعة',
  dayOffPolicyLabel: 'إجازة مرنة',
  ScheduledStartTime: '09:00',
  ScheduledEndTime: '17:00',
  DefaultCheckInTime: '09:00',
  DefaultCheckOutTime: '17:00',
  CheckInTime: null,
  CheckOutTime: null,
  Status: 'Pending',
  LateMinutes: 0,
  EarlyLeaveMinutes: 0,
  Notes: '',
  HasRecord: false,
};

const freelancePresentRow = {
  ...fullTimeRow,
  EmpID: 2,
  EmpName: 'أحمد',
  isFreelance: true,
  isAttendanceRequired: false,
  employmentTypeLabel: 'فري لانس',
  dayOffPolicyLabel: null,
  payrollMethodLabel: 'بالساعة',
  Status: 'Present',
  CheckInTime: '10:00',
  HasRecord: true,
};

describe('AttendancePanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        attendance: [fullTimeRow],
        summary: {
          total: 1,
          present: 0,
          late: 0,
          absent: 0,
          dayOff: 0,
          pending: 1,
          requiredCount: 1,
        },
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not render freelancer without attendance by default', async () => {
    render(<AttendancePanel />);
    await waitFor(() => {
      expect(screen.getAllByText('محمد').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('أحمد')).not.toBeInTheDocument();
  });

  it('renders freelancer row when returned by API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        attendance: [fullTimeRow, freelancePresentRow],
        summary: {
          total: 2,
          present: 1,
          late: 0,
          absent: 0,
          dayOff: 0,
          pending: 1,
          requiredCount: 1,
        },
      }),
    }) as unknown as typeof fetch;

    render(<AttendancePanel />);
    await waitFor(() => {
      expect(screen.getAllByText('أحمد').length).toBeGreaterThan(0);
    });
  });

  it('shows employment type badges', async () => {
    render(<AttendancePanel />);
    await waitFor(() => {
      expect(screen.getAllByText('دوام كامل').length).toBeGreaterThan(0);
      expect(screen.getAllByText('إجازة مرنة').length).toBeGreaterThan(0);
    });
  });

  it('pending count uses summary and excludes not-required employees', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        attendance: [fullTimeRow, freelancePresentRow],
        summary: {
          total: 2,
          present: 1,
          late: 0,
          absent: 0,
          dayOff: 0,
          pending: 1,
          requiredCount: 1,
        },
      }),
    }) as unknown as typeof fetch;

    render(<AttendancePanel />);
    await waitFor(() => {
      expect(screen.getAllByText('(1 مطلوب الحضور)').length).toBeGreaterThan(0);
    });
  });

  it('renders D and N row action buttons', async () => {
    render(<AttendancePanel />);
    await waitFor(() => {
      expect(screen.getByTestId('attendance-fill-default-1')).toBeInTheDocument();
      expect(screen.getByTestId('attendance-fill-now-1')).toBeInTheDocument();
    });
  });

  it('D button fills default times on the row', async () => {
    render(<AttendancePanel />);
    await waitFor(() => expect(screen.getByTestId('attendance-fill-default-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('attendance-fill-default-1'));
    const checkInInput = document.querySelector('input[type="time"]') as HTMLInputElement;
    expect(checkInInput?.value).toBe('09:00');
  });

  it('opens freelance modal and saves via upsert endpoint', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/freelancers')) {
        return Promise.resolve({
          json: async () => ({
            success: true,
            freelancers: [{ EmpID: 2, EmpName: 'أحمد', DefaultCheckInTime: '10:00', HasAttendanceToday: false }],
          }),
        });
      }
      if (init?.method === 'PUT') {
        return Promise.resolve({
          json: async () => ({ success: true, data: { Status: 'Present', LateMinutes: 0, EarlyLeaveMinutes: 0 } }),
        });
      }
      return Promise.resolve({
        json: async () => ({
          success: true,
          attendance: [fullTimeRow],
          summary: { total: 1, present: 0, late: 0, absent: 0, dayOff: 0, pending: 1, requiredCount: 1 },
        }),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<AttendancePanel />);
    await waitFor(() => expect(screen.getAllByText('محمد').length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByTestId('add-freelance-attendance')[0]!);
    await vi.advanceTimersByTimeAsync(350);
    await waitFor(() => expect(screen.getByTestId('dialog')).toBeInTheDocument());

    await waitFor(() => expect(screen.getAllByText('أحمد').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('أحمد')[0]!);
    fireEvent.click(screen.getByText('تسجيل الحضور'));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        (c) => c[0] === '/api/admin/attendance' && (c[1] as RequestInit)?.method === 'PUT',
      );
      expect(putCall).toBeTruthy();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.EmpID).toBe(2);
    });
  });

  const pmDefaultRow = {
    ...fullTimeRow,
    ScheduledStartTime: '17:00',
    ScheduledEndTime: '23:00',
    DefaultCheckInTime: '17:00',
    DefaultCheckOutTime: '23:00',
  };

  function mockPmRow() {
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return Promise.resolve({
          json: async () => ({ success: true, data: { Status: 'Present', LateMinutes: 0, EarlyLeaveMinutes: 0 } }),
        });
      }
      return Promise.resolve({
        json: async () => ({
          success: true,
          attendance: [pmDefaultRow],
          summary: { total: 1, present: 0, late: 0, absent: 0, dayOff: 0, pending: 1, requiredCount: 1 },
        }),
      });
    }) as unknown as typeof fetch;
  }

  it('warns when a PM-default employee is checked in during AM', async () => {
    mockPmRow();
    render(<AttendancePanel />);
    await waitFor(() => expect(screen.getByTestId('attendance-checkin-1')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('attendance-checkin-1'), { target: { value: '05:00' } });

    await waitFor(() =>
      expect(screen.getByTestId('attendance-period-warning-1')).toBeInTheDocument(),
    );
  });

  it('one-click fix converts the AM check-in to the PM equivalent', async () => {
    mockPmRow();
    render(<AttendancePanel />);
    await waitFor(() => expect(screen.getByTestId('attendance-checkin-1')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('attendance-checkin-1'), { target: { value: '05:00' } });
    await waitFor(() => expect(screen.getByTestId('attendance-period-fix-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('attendance-period-fix-1'));

    const input = screen.getByTestId('attendance-checkin-1') as HTMLInputElement;
    expect(input.value).toBe('17:00');
    expect(screen.queryByTestId('attendance-period-warning-1')).not.toBeInTheDocument();
  });

  it('blocks saving an AM check-in until confirmed, then allows it', async () => {
    mockPmRow();
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<AttendancePanel />);
    await waitFor(() => expect(screen.getByTestId('attendance-checkin-1')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('attendance-checkin-1'), { target: { value: '05:00' } });
    await waitFor(() => expect(screen.getByTestId('attendance-period-warning-1')).toBeInTheDocument());

    fetchSpy.mockClear();
    fireEvent.click(screen.getByTestId('attendance-save-1'));
    // Save is guarded — no PUT fired while the mismatch is unresolved
    const putBefore = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT');
    expect(putBefore).toBeFalsy();

    fireEvent.click(screen.getByTestId('attendance-period-confirm-1'));
    expect(screen.queryByTestId('attendance-period-warning-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('attendance-save-1'));
    await waitFor(() => {
      const putAfter = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT');
      expect(putAfter).toBeTruthy();
    });
  });
});
