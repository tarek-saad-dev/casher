/**
 * Structured JSON logs (one line per event) tagged with tenant/request context.
 * Values under sensitive keys are always redacted, so passwords and tokens never reach log sinks.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = {
  scope: string;
  tenantId?: string | null;
  requestId?: string | null;
  userId?: number | null;
  branchId?: number | null;
};

export type LogFields = Record<string, unknown>;

export type LogRecord = {
  ts: string;
  level: LogLevel;
  scope: string;
  event: string;
  tenantId: string | null;
  requestId?: string;
  userId?: number;
  branchId?: number;
} & LogFields;

export const REDACTED = '[redacted]';

const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authori[sz]ation|cookie|api[-_]?key|credential|session|otp|pin$/i;
const MAX_DEPTH = 6;

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactLogValue(inner, depth + 1);
    }
    return out;
  }
  return value;
}

type LogSink = (level: LogLevel, line: string) => void;

const consoleSink: LogSink = (level, line) => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
};

let sink: LogSink = consoleSink;

/** Test/integration hook; pass `null` to restore console output. */
export function setLogSink(next: LogSink | null) {
  sink = next ?? consoleSink;
}

export function buildLogRecord(
  context: LogContext,
  level: LogLevel,
  event: string,
  fields?: LogFields,
): LogRecord {
  const safeFields = (fields ? redactLogValue(fields) : {}) as LogFields;
  const record: LogRecord = {
    ...safeFields,
    ts: new Date().toISOString(),
    level,
    scope: context.scope,
    event,
    tenantId: context.tenantId ?? null,
  };
  if (context.requestId) record.requestId = context.requestId;
  if (typeof context.userId === 'number') record.userId = context.userId;
  if (typeof context.branchId === 'number') record.branchId = context.branchId;
  return record;
}

export type Logger = {
  context: LogContext;
  child(extra: Partial<LogContext>): Logger;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

export function createLogger(context: LogContext): Logger {
  const emit = (level: LogLevel, event: string, fields?: LogFields) => {
    if (level === 'debug' && process.env.LOG_LEVEL !== 'debug') return;
    sink(level, JSON.stringify(buildLogRecord(context, level, event, fields)));
  };
  return {
    context,
    child: (extra) => createLogger({ ...context, ...extra }),
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
