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
  fetchBoard: (date: string, signal: AbortSignal) => Promise<FlowBoardPayload>;
  onData: (data: FlowBoardPayload) => void;
  onLoading?: (loading: boolean) => void;
  onError?: (message: string | null) => void;
}): FlowBoardRefreshController {
  const inFlight = new Map<string, Promise<void>>();
  const abortByDate = new Map<string, AbortController>();

  async function refreshFlowBoard(
    date: string,
    options: RefreshFlowBoardOptions = {},
  ): Promise<void> {
    if (!options.force) {
      const existing = inFlight.get(date);
      if (existing) return existing;
    } else {
      abortByDate.get(date)?.abort();
    }

    const ac = new AbortController();
    abortByDate.set(date, ac);
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
        if (inFlight.get(date) === run) inFlight.delete(date);
        if (abortByDate.get(date) === ac) abortByDate.delete(date);
        if (isSelected()) {
          args.onLoading?.(false);
        }
      }
    })();

    inFlight.set(date, run);
    return run;
  }

  return {
    refreshFlowBoard,
    getInFlightDates: () => [...inFlight.keys()],
  };
}
