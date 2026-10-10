import type { Instrumentation } from 'next';
import { captureException } from '@/lib/observability/errorTracking';

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  // Request headers carry session cookies and bearer tokens; only path/method/route are reported.
  captureException(
    err,
    { scope: `next:${context.routeType}` },
    {
      digest: (err as { digest?: string }).digest ?? null,
      method: request.method,
      path: request.path.split('?')[0],
      routePath: context.routePath,
      routerKind: context.routerKind,
    },
  );
};
