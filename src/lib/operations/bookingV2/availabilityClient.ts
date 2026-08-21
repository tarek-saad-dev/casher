/**
 * Availability matrix client — POST /api/public/booking/v2/availability
 * Single request per scope (emp×branches or branch roster). No per-service calls.
 */

import type {
  V2PublicAvailabilityMatrixRequest,
  V2PublicAvailabilityMatrixResponse,
} from '@/lib/booking/v2Frontend/publicSafeDtos';
import type { MatrixScope } from '@/lib/operations/bookingV2/types';
import {
  isTraceDay,
  traceLog,
  traceScopeLabel,
  traceSummaryForDay,
} from '@/lib/operations/bookingV2/traceSlotDebug';

const AVAILABILITY_URL = '/api/public/booking/v2/availability';

const inflightByKey = new Map<string, Promise<V2PublicAvailabilityMatrixResponse>>();

export function scopeToRequest(scope: MatrixScope): V2PublicAvailabilityMatrixRequest {
  if (scope.kind === 'employee') {
    return {
      employeeId: scope.employeeId,
      branchCodes: scope.branchCodes,
      fromBusinessDate: scope.fromBusinessDate,
      toBusinessDate: scope.toBusinessDate,
    };
  }
  return {
    branchCode: scope.branchCode,
    fromBusinessDate: scope.fromBusinessDate,
    toBusinessDate: scope.toBusinessDate,
  };
}

export async function fetchAvailabilityMatrix(args: {
  scope: MatrixScope;
  key: string;
  signal?: AbortSignal;
}): Promise<V2PublicAvailabilityMatrixResponse> {
  const existing = inflightByKey.get(args.key);
  if (existing) {
    traceLog('[trace-slot][availabilityClient][inflight-hit]', {
      key: args.key,
      scope: traceScopeLabel(args.scope),
    });
    return existing;
  }

  const body = scopeToRequest(args.scope);
  traceLog('[trace-slot][availabilityClient][request]', {
    key: args.key,
    scope: traceScopeLabel(args.scope),
    body,
  });
  const run = (async () => {
    const res = await fetch(AVAILABILITY_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: args.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      let message = `availability ${res.status}`;
      try {
        const err = await res.json();
        if (err?.error || err?.message) message = String(err.error || err.message);
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const json = (await res.json()) as V2PublicAvailabilityMatrixResponse;
    if (!json?.ok || !Array.isArray(json.days)) {
      throw new Error('availability invalid');
    }
    traceLog('[trace-slot][availabilityClient][response]', {
      key: args.key,
      scope: traceScopeLabel(args.scope),
      traceDay: traceSummaryForDay(json.days.find(isTraceDay)),
      days: json.days.length,
    });
    return json;
  })();

  inflightByKey.set(args.key, run);
  try {
    return await run;
  } finally {
    if (inflightByKey.get(args.key) === run) inflightByKey.delete(args.key);
  }
}

export function clearAvailabilityInflight(): void {
  inflightByKey.clear();
}
