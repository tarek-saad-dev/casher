import { createLogger, redactLogValue, type LogContext } from './logger';

/**
 * Error-tracking seam. The default reporter writes a tenant-tagged structured log line;
 * a vendor SDK (Sentry, etc.) is wired in once at startup via `setErrorReporter`.
 */
export type ErrorReport = {
  error: { name: string; message: string; stack?: string };
  context: LogContext;
  extra: Record<string, unknown>;
};

export type ErrorReporter = (report: ErrorReport) => void | Promise<void>;

const defaultReporter: ErrorReporter = (report) => {
  createLogger(report.context).error('exception', { error: report.error, ...report.extra });
};

let reporter: ErrorReporter = defaultReporter;

export function setErrorReporter(next: ErrorReporter | null) {
  reporter = next ?? defaultReporter;
}

function normalizeError(err: unknown): ErrorReport['error'] {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { name: 'NonError', message: typeof err === 'string' ? err : JSON.stringify(err) ?? 'unknown' };
}

/** Never throws: a failing reporter must not change the outcome of the request being handled. */
export function captureException(
  err: unknown,
  context: LogContext,
  extra: Record<string, unknown> = {},
): void {
  const report: ErrorReport = {
    error: normalizeError(err),
    context,
    extra: redactLogValue(extra) as Record<string, unknown>,
  };
  try {
    const pending = reporter(report);
    if (pending && typeof (pending as Promise<void>).catch === 'function') {
      (pending as Promise<void>).catch(() => defaultReporter(report));
    }
  } catch {
    defaultReporter(report);
  }
}
