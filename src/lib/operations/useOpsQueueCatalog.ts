'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BookingSelectService } from '@/components/operations/BookingServiceSelect';
import { useBookingV2Store } from '@/lib/operations/bookingV2';
import {
  fetchOpsQueueServicesFallback,
  resolveOpsQueueCatalogDecision,
  servicesFromBootstrapBranch,
  type OpsQueueCatalogSource,
} from '@/lib/operations/opsQueueCatalog';

/**
 * Shared Queue catalog: reuse warm Booking V2 bootstrap; fallback to GET /api/services only when needed.
 */
export function useOpsQueueCatalog(branchCode: string | null | undefined): {
  services: BookingSelectService[];
  loading: boolean;
  source: OpsQueueCatalogSource;
} {
  const v2 = useBookingV2Store();
  const bootstrapServices = useMemo(
    () => servicesFromBootstrapBranch(v2.bootstrap, branchCode),
    [v2.bootstrap, branchCode],
  );

  const decision = useMemo(
    () =>
      resolveOpsQueueCatalogDecision({
        branchCode,
        bootstrap: v2.bootstrap,
        bootstrapStatus: v2.bootstrapStatus,
        bootstrapServicesCount: bootstrapServices.length,
      }),
    [branchCode, v2.bootstrap, v2.bootstrapStatus, bootstrapServices.length],
  );

  const [apiServices, setApiServices] = useState<BookingSelectService[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiAttempted, setApiAttempted] = useState(false);

  useEffect(() => {
    if (decision.action !== 'fetch_api') {
      setApiAttempted(false);
      return;
    }
    let cancelled = false;
    setApiLoading(true);
    setApiAttempted(true);
    fetchOpsQueueServicesFallback()
      .then((list) => {
        if (!cancelled) setApiServices(list);
      })
      .catch(() => {
        if (!cancelled) setApiServices([]);
      })
      .finally(() => {
        if (!cancelled) setApiLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [decision.action, branchCode]);

  if (decision.action === 'use_bootstrap') {
    return { services: bootstrapServices, loading: false, source: 'bootstrap' };
  }
  if (decision.action === 'wait') {
    return { services: bootstrapServices, loading: true, source: 'pending' };
  }
  return {
    services: apiServices,
    loading: apiLoading || !apiAttempted,
    source: 'api',
  };
}
