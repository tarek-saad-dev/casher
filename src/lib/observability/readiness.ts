export type ReadinessCheckName = 'database' | 'sessionSecret';

export type ReadinessCheck = {
  name: ReadinessCheckName;
  ok: boolean;
  durationMs: number;
};

export type ReadinessReport = {
  status: 'ready' | 'not_ready';
  checks: ReadinessCheck[];
  timestamp: string;
};

export type ReadinessProbes = Record<ReadinessCheckName, () => Promise<void>>;

export const READINESS_CHECK_TIMEOUT_MS = 3000;

function withTimeout(probe: () => Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('READINESS_TIMEOUT')), timeoutMs);
    probe().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Failure details are deliberately dropped: the endpoint is public and must not leak infrastructure. */
export async function evaluateReadiness(
  probes: ReadinessProbes,
  timeoutMs = READINESS_CHECK_TIMEOUT_MS,
): Promise<ReadinessReport> {
  const checks = await Promise.all(
    (Object.keys(probes) as ReadinessCheckName[]).map(async (name) => {
      const startedAt = Date.now();
      try {
        await withTimeout(probes[name], timeoutMs);
        return { name, ok: true, durationMs: Date.now() - startedAt };
      } catch {
        return { name, ok: false, durationMs: Date.now() - startedAt };
      }
    }),
  );
  return {
    status: checks.every((c) => c.ok) ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  };
}
