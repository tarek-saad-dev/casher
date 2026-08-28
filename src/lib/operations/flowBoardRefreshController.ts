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
  /** Background refresh: keep the current board mounted (no loading flash). */
  silent?: boolean;
  /** Abort other in-flight board requests (e.g. when the selected day changes quickly). */
  cancelOthers?: boolean;
  /** Write to cache only — do not call onData (prefetch adjacent days). */
  prefetch?: boolean;
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
  onPrefetch?: (data: FlowBoardPayload) => void;
  onLoading?: (loading: boolean) => void;
  onError?: (message: string | null) => void;
}): FlowBoardRefreshController {
  const inFlight = new Map<string, Promise<void>>();
  const abortByDate = new Map<string, AbortController>();

  const cacheKey = (date: string): string =>
    `${args.getBranchId ? args.getBranchId() : '_'}:${date}`;

  function abortAllExcept(keepKey?: string) {
    for (const [key, ac] of abortByDate) {
      if (key === keepKey) continue;
      ac.abort();
      abortByDate.delete(key);
      inFlight.delete(key);
    }
  }

  async function refreshFlowBoard(
    date: string,
    options: RefreshFlowBoardOptions = {},
  ): Promise<void> {
    const key = cacheKey(date);

    if (options.cancelOthers) {
      abortAllExcept(key);
    }

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
      const showLoading = isSelected() && !options.silent;
      if (showLoading) {
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
        if (!options.prefetch) {
          args.onData(data);
        } else {
          args.onPrefetch?.(data);
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        if (!isSelected()) return;
        args.onError?.(err instanceof Error ? err.message : 'فشل تحميل لوحة التشغيل');
      } finally {
        if (inFlight.get(key) === run) inFlight.delete(key);
        if (abortByDate.get(key) === ac) abortByDate.delete(key);
        if (showLoading) {
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
