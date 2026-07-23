/**
 * In-flight dedupe + stale-response protection for Operations flow-board GETs.
 */

export type FlowBoardPayload = {
  ok: boolean;
  date: string;
  generatedAt?: string;
  barbers?: unknown[];
  error?: string;
};

export type RefreshFlowBoardOptions = {
  reason?: string;
  force?: boolean;
};

export type FlowBoardRefreshController = {
  refreshFlowBoard: (date: string, options?: RefreshFlowBoardOptions) => Promise<void>;
  /** Test/diag: dates with an active request */
  getInFlightDates: () => string[];
};

export function shouldRefreshBoardForBooking(
  boardDate: string,
  bookingActualDate: string | null | undefined,
): boolean {
  if (!bookingActualDate) return true;
  return boardDate === bookingActualDate;
}

export function createFlowBoardRefreshController(args: {
  getSelectedDate: () => string;
  /** Active branch scoping the board — keeps dedupe/abort keys from colliding across branches. */
  getBranchId?: () => string | number;
  fetchBoard: (date: string, signal: AbortSignal) => Promise<FlowBoardPayload>;
  onData: (data: FlowBoardPayload) => void;
  onLoading?: (loading: boolean) => void;
  onError?: (message: string | null) => void;
}): FlowBoardRefreshController {
  const inFlight = new Map<string, Promise<void>>();
  const abortByDate = new Map<string, AbortController>();

  const cacheKey = (date: string): string =>
    `${args.getBranchId ? args.getBranchId() : '_'}:${date}`;

  async function refreshFlowBoard(
    date: string,
    options: RefreshFlowBoardOptions = {},
  ): Promise<void> {
    const key = cacheKey(date);

    if (!options.force) {
      const existing = inFlight.get(key);
      if (existing) return existing;
    } else {
      abortByDate.get(key)?.abort();
    }

    const ac = new AbortController();
    abortByDate.set(key, ac);
    const requestedDate = date;

    let run!: Promise<void>;
    run = (async () => {
      const isSelected = () => args.getSelectedDate() === requestedDate;
      if (isSelected()) {
        args.onLoading?.(true);
        args.onError?.(null);
      }
      try {
        const data = await args.fetchBoard(date, ac.signal);
        if (ac.signal.aborted) return;
        if (!isSelected()) return;
        if (!data.ok) {
          throw new Error(data.error || 'فشل تحميل البيانات');
        }
        args.onData(data);
      } catch (err) {
        if (ac.signal.aborted) return;
        if (!isSelected()) return;
        args.onError?.(err instanceof Error ? err.message : 'فشل تحميل لوحة التشغيل');
      } finally {
        if (inFlight.get(key) === run) inFlight.delete(key);
        if (abortByDate.get(key) === ac) abortByDate.delete(key);
        if (isSelected()) {
          args.onLoading?.(false);
        }
      }
    })();

    inFlight.set(key, run);
    return run;
  }

  return {
    refreshFlowBoard,
    getInFlightDates: () => [...inFlight.keys()].map((key) => key.split(':').slice(1).join(':')),
  };
}
