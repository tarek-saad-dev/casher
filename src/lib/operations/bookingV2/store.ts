/**
 * Single Booking V2 store for Hawai /operations (Phase O1).
 * Components must not fetch bootstrap/availability themselves — use this store.
 */

import { shiftCalendarDate, getOperationalDate } from '@/lib/businessDate';
import {
  getCachedBootstrap,
  loadBootstrapSWR,
  revalidateBootstrap,
} from '@/lib/operations/bookingV2/bootstrapClient';
import { fetchAvailabilityMatrix } from '@/lib/operations/bookingV2/availabilityClient';
import {
  filterDaysForSelection,
  generateStartsForDay,
} from '@/lib/operations/bookingV2/generateOpsStarts';
import {
  MATRIX_WINDOW_DAYS,
  matrixScopeKey,
  revisionKey,
  type BookingV2Mode,
  type BookingV2StoreSnapshot,
  type GeneratedStart,
  type MatrixCacheEntry,
  type MatrixScope,
} from '@/lib/operations/bookingV2/types';
import {
  traceDayFromMatrixEntry,
  traceLog,
  traceScopeLabel,
  traceStartsInclude,
  traceSummaryForDay,
} from '@/lib/operations/bookingV2/traceSlotDebug';

type Listener = () => void;

function emptySnapshot(): BookingV2StoreSnapshot {
  return {
    bootstrap: null,
    bootstrapEtag: null,
    bootstrapStatus: 'idle',
    bootstrapError: null,
    bootstrapFetchedAt: null,
    bootstrapRevalidating: false,
    selectedEmployeeId: null,
    selectedBranchCode: null,
    selectedServiceIds: [],
    selectedBusinessDate: null,
    mode: 'nearest',
    matricesByKey: {},
    activeMatrixKey: null,
    availabilityStatus: 'idle',
    availabilityError: null,
    availabilityLoadingKey: null,
    availabilityRevalidating: false,
    generatedStarts: [],
    availabilityRevisions: {},
  };
}

let state: BookingV2StoreSnapshot = emptySnapshot();
const listeners = new Set<Listener>();
const matrixAbortByKey = new Map<string, AbortController>();

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<BookingV2StoreSnapshot>) {
  state = { ...state, ...patch };
  emit();
}

function mergeRevisions(
  existing: Record<string, string>,
  entry: MatrixCacheEntry,
): Record<string, string> {
  return { ...existing, ...entry.revisions };
}

function buildRevisions(
  matrix: MatrixCacheEntry['matrix'],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of matrix.days) {
    out[revisionKey(d.employeeId, d.branchCode, d.businessDate)] =
      d.availabilityRevision;
  }
  return out;
}

function recomputeGeneratedStarts(snapshot: BookingV2StoreSnapshot): GeneratedStart[] {
  const date = snapshot.selectedBusinessDate;
  const duration = resolveSelectedDuration(snapshot);
  if (!date || duration <= 0) return [];

  const entry = snapshot.activeMatrixKey
    ? snapshot.matricesByKey[snapshot.activeMatrixKey]
    : null;
  if (!entry) return [];

  const empId =
    snapshot.mode === 'specific' ? snapshot.selectedEmployeeId : null;
  const days = filterDaysForSelection({
    days: entry.matrix.days,
    businessDate: date,
    employeeId: empId,
    // Prefer selected branch when set; multi-branch emp still has all days cached.
    branchCode: snapshot.selectedBranchCode,
  });

  const nameByEmp = new Map<number, string>();
  for (const e of snapshot.bootstrap?.employees ?? []) {
    nameByEmp.set(e.employeeId, e.name || e.nameAr || e.nameEn || '');
  }

  const settingsByBranch = snapshot.bootstrap?.settingsByBranch ?? {};
  const starts: GeneratedStart[] = [];
  for (const day of days) {
    const settings = settingsByBranch[day.branchCode] ?? null;
    starts.push(
      ...generateStartsForDay({
        day,
        durationMinutes: duration,
        settings,
        barberName: nameByEmp.get(day.employeeId) || `Emp ${day.employeeId}`,
      }),
    );
  }

  starts.sort((a, b) => a.startAtMs - b.startAtMs || a.employeeId - b.employeeId);
  traceLog('[trace-slot][recomputeGeneratedStarts]', {
    employeeId: empId,
    branchCode: snapshot.selectedBranchCode,
    businessDate: date,
    durationMinutes: duration,
    activeMatrixKey: snapshot.activeMatrixKey,
    includes16_00: traceStartsInclude(starts),
    activeTraceDay: traceSummaryForDay(traceDayFromMatrixEntry(entry)),
  });
  return starts;
}

/**
 * Duration is supplied by the workspace (sum of selected services / emp overrides).
 * Stored service ids are for selection tracking; duration comes via setDurationMinutes.
 */
let effectiveDurationMinutes = 0;

function resolveSelectedDuration(_snapshot: BookingV2StoreSnapshot): number {
  return effectiveDurationMinutes;
}

export function getBookingV2StoreSnapshot(): BookingV2StoreSnapshot {
  if (typeof window !== 'undefined') {
    (window as any).__bv2 = state;
  }
  return state;
}

export function subscribeBookingV2Store(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test / hot-reload helper. */
export function resetBookingV2StoreForTests(): void {
  state = emptySnapshot();
  effectiveDurationMinutes = 0;
  for (const c of matrixAbortByKey.values()) c.abort();
  matrixAbortByKey.clear();
  emit();
}

/**
 * Prefetch bootstrap on /operations entry (not on first modal open).
 * Cached + ETag + SWR — returns immediately when memory cache is usable.
 */
export async function prefetchBookingV2Bootstrap(): Promise<void> {
  const cached = getCachedBootstrap();
  if (cached && state.bootstrapStatus !== 'ready') {
    setState({
      bootstrap: cached.body,
      bootstrapEtag: cached.etag,
      bootstrapStatus: 'ready',
      bootstrapError: null,
      bootstrapFetchedAt: cached.fetchedAt,
    });
  } else if (state.bootstrapStatus === 'idle') {
    setState({ bootstrapStatus: 'loading', bootstrapError: null });
  }

  try {
    const result = await loadBootstrapSWR();
    setState({
      bootstrap: result.body,
      bootstrapEtag: result.etag,
      bootstrapStatus: 'ready',
      bootstrapError: null,
      bootstrapFetchedAt: Date.now(),
      bootstrapRevalidating: result.revalidating,
    });
    if (result.revalidating) {
      void revalidateBootstrap()
        .then((fresh) => {
          setState({
            bootstrap: fresh.body,
            bootstrapEtag: fresh.etag,
            bootstrapFetchedAt: fresh.fetchedAt,
            bootstrapRevalidating: false,
            bootstrapStatus: 'ready',
          });
          // Recompute if matrix already present (settings may affect minNotice).
          const starts = recomputeGeneratedStarts(getBookingV2StoreSnapshot());
          setState({ generatedStarts: starts });
        })
        .catch(() => {
          setState({ bootstrapRevalidating: false });
        });
    }
  } catch (err) {
    if (state.bootstrap) {
      // Keep serving stale catalog.
      setState({
        bootstrapStatus: 'ready',
        bootstrapRevalidating: false,
        bootstrapError: err instanceof Error ? err.message : 'bootstrap failed',
      });
      return;
    }
    setState({
      bootstrapStatus: 'error',
      bootstrapRevalidating: false,
      bootstrapError: err instanceof Error ? err.message : 'bootstrap failed',
    });
  }
}

export function setBookingV2Selection(patch: {
  employeeId?: number | null;
  branchCode?: string | null;
  serviceIds?: number[];
  businessDate?: string | null;
  mode?: BookingV2Mode;
  durationMinutes?: number;
}): void {
  const next: Partial<BookingV2StoreSnapshot> = {};
  if ('employeeId' in patch) next.selectedEmployeeId = patch.employeeId ?? null;
  if ('branchCode' in patch) next.selectedBranchCode = patch.branchCode ?? null;
  if ('serviceIds' in patch) next.selectedServiceIds = patch.serviceIds ?? [];
  if ('businessDate' in patch) next.selectedBusinessDate = patch.businessDate ?? null;
  if ('mode' in patch && patch.mode) next.mode = patch.mode;
  if (typeof patch.durationMinutes === 'number') {
    effectiveDurationMinutes = Math.max(0, Math.floor(patch.durationMinutes));
  }

  const merged = { ...state, ...next };
  const generatedStarts = recomputeGeneratedStarts(merged);
  setState({ ...next, generatedStarts });
}

function resolveMatrixWindow(): {
  fromBusinessDate: string;
  toBusinessDate: string;
} {
  // Stable 14-day window from operational today — date picks inside it are local-only.
  const from = getOperationalDate();
  const to = shiftCalendarDate(from, MATRIX_WINDOW_DAYS - 1);
  return { fromBusinessDate: from, toBusinessDate: to };
}

export function commitBookingV2StoreUpdate(
  updater: (prev: BookingV2StoreSnapshot) => BookingV2StoreSnapshot,
): void {
  state = updater(state);
  emit();
}

export function recomputeGeneratedStartsForSnapshot(
  snapshot: BookingV2StoreSnapshot,
): GeneratedStart[] {
  return recomputeGeneratedStarts(snapshot);
}

export function resolveEmployeeBranchCodesFromSnapshot(
  snapshot: BookingV2StoreSnapshot,
  employeeId: number,
): string[] {
  const boot = snapshot.bootstrap;
  if (boot) {
    const emp = boot.employees.find((e) => e.employeeId === employeeId);
    if (emp?.branchCodes?.length) {
      return [...new Set(emp.branchCodes.map((c) => c.toUpperCase()))];
    }
    const mapped = boot.employeeBranchMappings
      .filter((m) => m.employeeId === employeeId)
      .map((m) => m.branchCode.toUpperCase());
    if (mapped.length) return [...new Set(mapped)];
  }
  const fromCache = new Set<string>();
  for (const entry of Object.values(snapshot.matricesByKey)) {
    for (const d of entry.matrix.days) {
      if (d.employeeId === employeeId) {
        fromCache.add(d.branchCode.toUpperCase());
      }
    }
  }
  return [...fromCache];
}

function resolveEmployeeBranchCodes(employeeId: number): string[] {
  const boot = state.bootstrap;
  if (!boot) return state.selectedBranchCode ? [state.selectedBranchCode] : [];
  const emp = boot.employees.find((e) => e.employeeId === employeeId);
  if (emp?.branchCodes?.length) {
    return [...new Set(emp.branchCodes.map((c) => c.toUpperCase()))];
  }
  const mapped = boot.employeeBranchMappings
    .filter((m) => m.employeeId === employeeId)
    .map((m) => m.branchCode.toUpperCase());
  if (mapped.length) return [...new Set(mapped)];
  if (state.selectedBranchCode) return [state.selectedBranchCode.toUpperCase()];
  return boot.branches.map((b) => b.branchCode.toUpperCase());
}

export function buildMatrixScopeForFlow(args: {
  mode: BookingV2Mode;
  employeeId?: number | null;
  branchCode?: string | null;
  /** @deprecated Window is always operational-today × 14d; kept for call-site compat. */
  anchorDate?: string | null;
}): MatrixScope | null {
  const window = resolveMatrixWindow();
  if (args.mode === 'specific' && args.employeeId) {
    let branchCodes = resolveEmployeeBranchCodes(args.employeeId);
    if (!branchCodes.length && args.branchCode) {
      branchCodes = [args.branchCode.toUpperCase()];
    }
    if (!branchCodes.length) return null;
    return {
      kind: 'employee',
      employeeId: args.employeeId,
      branchCodes,
      ...window,
    };
  }
  const branchCode = (args.branchCode || state.selectedBranchCode || '').toUpperCase();
  if (!branchCode) return null;
  return {
    kind: 'branch_roster',
    branchCode,
    ...window,
  };
}

function applyMatrixEntry(entry: MatrixCacheEntry, opts?: { soft?: boolean }): void {
  console.log('[bv2-applyMatrix]', entry.key, { dayCount: entry.matrix.days.length, soft: !!opts?.soft });
  traceLog('[trace-slot][applyMatrixEntry][before]', {
    matrixKey: entry.key,
    scope: traceScopeLabel(entry.scope),
    soft: !!opts?.soft,
    traceDay: traceSummaryForDay(traceDayFromMatrixEntry(entry)),
  });
  const prevRevisions = state.availabilityRevisions;
  const matricesByKey = { ...state.matricesByKey, [entry.key]: entry };
  const availabilityRevisions = mergeRevisions(prevRevisions, entry);
  const next = {
    ...state,
    matricesByKey,
    activeMatrixKey: entry.key,
    availabilityStatus: 'ready' as const,
    availabilityError: null,
    availabilityLoadingKey: null,
    availabilityRevalidating: false,
    availabilityRevisions,
  };
  const generatedStarts = recomputeGeneratedStarts(next);
  setState({
    matricesByKey,
    activeMatrixKey: entry.key,
    availabilityStatus: 'ready',
    availabilityError: null,
    availabilityLoadingKey: null,
    availabilityRevalidating: false,
    availabilityRevisions,
    generatedStarts,
  });
  traceLog('[trace-slot][applyMatrixEntry][after]', {
    matrixKey: entry.key,
    soft: !!opts?.soft,
    activeMatrixKey: entry.key,
    traceDay: traceSummaryForDay(traceDayFromMatrixEntry(matricesByKey[entry.key])),
    generatedIncludes16_00: traceStartsInclude(generatedStarts),
  });
  if (opts?.soft && process.env.NODE_ENV !== 'production') {
    const changed = Object.keys(entry.revisions).filter(
      (k) => prevRevisions[k] && prevRevisions[k] !== entry.revisions[k],
    );
    if (changed.length) {
      console.log('[booking-v2-ops] revision_refresh', {
        changedDays: changed.length,
        keys: changed.slice(0, 8),
      });
    }
  }
}

/**
 * Prefetch the matrix for the open booking flow.
 * Specific emp → 14-day scoped (all branches in one request for multi-branch).
 * Nearest / any-barber → branch roster in one request.
 */
export async function prefetchBookingV2Availability(args?: {
  mode?: BookingV2Mode;
  employeeId?: number | null;
  branchCode?: string | null;
  anchorDate?: string | null;
  force?: boolean;
}): Promise<void> {
  // Ensure bootstrap is at least attempted (non-blocking if already cached).
  if (state.bootstrapStatus === 'idle' || !state.bootstrap) {
    await prefetchBookingV2Bootstrap();
  }

  const mode = args?.mode ?? state.mode;
  const employeeId =
    args && 'employeeId' in args ? args.employeeId : state.selectedEmployeeId;
  const branchCode =
    args && 'branchCode' in args ? args.branchCode : state.selectedBranchCode;

  const scope = buildMatrixScopeForFlow({
    mode,
    employeeId,
    branchCode,
  });
  if (!scope) {
    setState({
      availabilityStatus: 'error',
      availabilityError: 'تعذر تحديد نطاق التوفر',
    });
    return;
  }

  const key = matrixScopeKey(scope);
  const cached = state.matricesByKey[key];
  console.log('[bv2-prefetch]', key, { cached: !!cached, force: !!args?.force, matrixKeys: Object.keys(state.matricesByKey), duration: effectiveDurationMinutes });
  traceLog('[trace-slot][prefetchBookingV2Availability]', {
    requestedMatrixScopeKey: key,
    scope: traceScopeLabel(scope),
    cached: !!cached,
    force: !!args?.force,
    cachedTraceDay: traceSummaryForDay(traceDayFromMatrixEntry(cached)),
  });
  if (cached && !args?.force) {
    const next = {
      ...state,
      activeMatrixKey: key,
      availabilityStatus: 'ready' as const,
      availabilityError: null,
    };
    setState({
      activeMatrixKey: key,
      availabilityStatus: 'ready',
      availabilityError: null,
      availabilityRevalidating: false,
      generatedStarts: recomputeGeneratedStarts(next),
    });
    traceLog('[trace-slot][prefetchBookingV2Availability][cache-hit]', {
      requestedMatrixScopeKey: key,
      cachedTraceDay: traceSummaryForDay(traceDayFromMatrixEntry(cached)),
      generatedIncludes16_00: traceStartsInclude(recomputeGeneratedStarts(next)),
    });
    return;
  }

  const softRefresh = !!(cached && args?.force);

  matrixAbortByKey.get(key)?.abort();
  const controller = new AbortController();
  matrixAbortByKey.set(key, controller);

  if (softRefresh) {
    // Keep modal starts/selection; refresh affected days only when response arrives.
    setState({
      availabilityRevalidating: true,
      availabilityError: null,
      activeMatrixKey: key,
      availabilityStatus: 'ready',
    });
  } else {
    setState({
      availabilityStatus: 'loading',
      availabilityError: null,
      availabilityLoadingKey: key,
      availabilityRevalidating: false,
    });
  }

  try {
    const matrix = await fetchAvailabilityMatrix({
      scope,
      key,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    const entry: MatrixCacheEntry = {
      key,
      scope,
      matrix,
      fetchedAt: Date.now(),
      revisions: buildRevisions(matrix),
    };
    applyMatrixEntry(entry, { soft: softRefresh });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    const message =
      err instanceof Error ? err.message : 'تعذر تحميل التوفر';
    if (softRefresh && cached) {
      // Preserve previous matrix + starts; surface retryable error without empty-state.
      setState({
        availabilityStatus: 'ready',
        availabilityError: message,
        availabilityRevalidating: false,
        availabilityLoadingKey: null,
        activeMatrixKey: key,
      });
      return;
    }
    setState({
      availabilityStatus: 'error',
      availabilityError: message,
      availabilityLoadingKey: null,
      availabilityRevalidating: false,
      generatedStarts: [],
    });
  } finally {
    if (matrixAbortByKey.get(key) === controller) {
      matrixAbortByKey.delete(key);
    }
  }
}

/** Force refresh the active matrix (e.g. after create 409). */
export async function refreshActiveBookingV2Matrix(): Promise<void> {
  const key = state.activeMatrixKey;
  const entry = key ? state.matricesByKey[key] : null;
  if (!entry) {
    await prefetchBookingV2Availability({ force: true });
    return;
  }
  await prefetchBookingV2Availability({
    mode: entry.scope.kind === 'employee' ? 'specific' : 'nearest',
    employeeId: entry.scope.kind === 'employee' ? entry.scope.employeeId : null,
    branchCode:
      entry.scope.kind === 'branch_roster'
        ? entry.scope.branchCode
        : state.selectedBranchCode,
    force: true,
  });
}

/**
 * Open booking flow: set selection + prefetch matrix early.
 * Does not await bootstrap if already cached.
 */
export async function openBookingV2Flow(args: {
  mode: BookingV2Mode;
  employeeId?: number | null;
  branchCode?: string | null;
  businessDate?: string | null;
  serviceIds?: number[];
  durationMinutes?: number;
}): Promise<void> {
  setBookingV2Selection({
    mode: args.mode,
    employeeId: args.employeeId ?? null,
    branchCode: args.branchCode ?? null,
    businessDate: args.businessDate ?? getOperationalDate(),
    serviceIds: args.serviceIds ?? [],
    durationMinutes: args.durationMinutes ?? 0,
  });
  // Fire matrix prefetch; bootstrap already prefetched on page entry.
  void prefetchBookingV2Availability({
    mode: args.mode,
    employeeId: args.employeeId ?? null,
    branchCode: args.branchCode ?? null,
  });
}

export function hasMatrixCoverageForDate(businessDate: string): boolean {
  const key = state.activeMatrixKey;
  if (!key) return false;
  const entry = state.matricesByKey[key];
  if (!entry) return false;
  return (
    businessDate >= entry.scope.fromBusinessDate
    && businessDate <= entry.scope.toBusinessDate
  );
}

export function getServicesForBranch(branchCode: string | null | undefined) {
  if (!branchCode || !state.bootstrap) return [];
  return state.bootstrap.servicesByBranch[branchCode] ?? [];
}

/** Branch codes available for an employee from bootstrap (multi-branch instant switch). */
export function getEmployeeBranchCodesFromStore(employeeId: number | null | undefined): string[] {
  if (employeeId == null) return [];
  return resolveEmployeeBranchCodes(employeeId);
}

/**
 * True when active matrix already contains days for this branch (no network needed).
 */
export function hasCachedBranchInActiveMatrix(branchCode: string | null | undefined): boolean {
  if (!branchCode) return false;
  const key = state.activeMatrixKey;
  const entry = key ? state.matricesByKey[key] : null;
  if (!entry) return false;
  const code = branchCode.toUpperCase();
  if (entry.scope.kind === 'employee') {
    return entry.scope.branchCodes.map((c) => c.toUpperCase()).includes(code)
      || entry.matrix.days.some((d) => d.branchCode.toUpperCase() === code);
  }
  return entry.scope.branchCode.toUpperCase() === code;
}
