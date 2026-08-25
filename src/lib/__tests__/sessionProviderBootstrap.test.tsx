/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useContext } from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/operations',
}));

import SessionProvider, { SessionContext } from '@/components/session/SessionProvider';

function Probe() {
  const session = useContext(SessionContext);
  return (
    <div>
      <span data-testid="loading">{String(session.loading)}</span>
      <span data-testid="user">{session.user?.UserName ?? ''}</span>
      <span data-testid="revision">{session.revision ?? ''}</span>
      <span data-testid="day">{session.day?.ID ?? ''}</span>
      <span data-testid="shift">{session.shift?.ID ?? ''}</span>
    </div>
  );
}

const bootstrapBody = {
  user: { userId: 7, userName: 'saad', userLevel: 'admin', defaultShiftId: 1 },
  permissions: ['pos.sell'],
  access: {
    roles: ['admin'],
    isSuperAdmin: false,
    isPartnerOnly: false,
    defaultLandingPath: '/income/pos',
    allowedPagePaths: ['/income/pos'],
    allowedPageKeys: ['pos'],
  },
  branches: [
    {
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      shortName: 'جليم',
      isCurrent: true,
      canOperate: true,
    },
  ],
  activeBranch: {
    branchId: 1,
    branchCode: 'GLEEM',
    branchName: 'جليم',
    shortName: 'جليم',
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '04:00:00',
    canOperate: true,
    canViewReports: true,
    canSwitch: true,
  },
    operational: {
      branch: {
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
      },
      businessDay: { id: 10, branchId: 1, businessDate: '2026-08-25', status: true },
      shift: {
        id: 100,
        branchId: 1,
        businessDayId: 10,
        newDay: '2026-08-25',
        userId: 7,
        shiftId: 1,
        startTime: '10:00 AM',
        status: true,
        userName: 'saad',
        shiftName: 'صباحي',
      },
      shiftOnOtherBranch: null,
    },
    view: {
      branch: {
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
      },
      businessDay: { id: 10, branchId: 1, businessDate: '2026-08-25', status: true },
    },
  activeBranchState: {
    businessDay: { id: 10, branchId: 1, businessDate: '2026-08-25', status: true },
    openShiftCount: 1,
  },
  stale: false,
  needsRollover: false,
  expectedBusinessDate: '2026-08-25',
  reconciliationError: null,
  reconciliationAction: 'NO_OP',
  revision: '1:1:10:1:100:1:0',
  dbRoundTrips: 1,
};

describe('SessionProvider bootstrap load', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/operations/bootstrap')) {
          return {
            ok: true,
            status: 200,
            json: async () => bootstrapBody,
          };
        }
        if (url.includes('/api/shift/open') || url.includes('/api/shift/close')) {
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('performs one bootstrap call on initial authenticated load', async () => {
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-testid="user"]')?.textContent).toBe('saad');
    });
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('/api/operations/bootstrap'),
    );
    expect(calls).toHaveLength(1);
    expect(document.querySelector('[data-testid="day"]')?.textContent).toBe('10');
    expect(document.querySelector('[data-testid="shift"]')?.textContent).toBe('100');
  });

  it('deduplicates focus revalidation inside the debounce window', async () => {
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-testid="revision"]')?.textContent).toBe('1:1:10:1:100:1:0');
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('/api/operations/bootstrap'),
    );
    expect(calls).toHaveLength(1);
  });

  it('refreshes bootstrap after a successful open shift', async () => {
    let sessionRefresh: (() => Promise<unknown>) | null = null;
    let openShift: ((id?: number) => Promise<void>) | null = null;

    function Actions() {
      const session = useContext(SessionContext);
      sessionRefresh = session.refresh;
      openShift = session.openMyShift;
      return <Probe />;
    }

    render(
      <SessionProvider>
        <Actions />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-testid="user"]')?.textContent).toBe('saad');
    });

    await act(async () => {
      await openShift?.(1);
    });

    const bootstrapCalls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('/api/operations/bootstrap'),
    );
    const openCalls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('/api/shift/open'),
    );
    expect(openCalls).toHaveLength(1);
    expect(bootstrapCalls.length).toBeGreaterThanOrEqual(2);
    expect(sessionRefresh).toBeTruthy();
  });
});
