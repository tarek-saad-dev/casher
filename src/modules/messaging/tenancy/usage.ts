import { getPool, sql } from '@/lib/db';
import { requireMessagingTenantId } from './messagingTenantScope';

export type MessagingUsageMetric =
  | 'inbound_message'
  | 'outbound_sent'
  | 'outbound_failed'
  | 'group_sent'
  | 'ai_turn';

export type MessagingUsageRecorder = (input: {
  tenantId: string;
  metric: MessagingUsageMetric;
  channel: 'whatsapp';
  usageDate: string;
  count: number;
}) => Promise<void>;

async function sqlUsageRecorder(input: Parameters<MessagingUsageRecorder>[0]): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('usageDate', sql.Date, input.usageDate)
    .input('channel', sql.NVarChar(20), input.channel)
    .input('metric', sql.NVarChar(40), input.metric)
    .input('count', sql.BigInt, input.count)
    .query(`
      UPDATE dbo.TenantMessagingUsage WITH (UPDLOCK, SERIALIZABLE)
      SET [Count] = [Count] + @count, UpdatedAt = SYSUTCDATETIME()
      WHERE TenantId = @tenantId AND UsageDate = @usageDate AND Channel = @channel AND Metric = @metric;
      IF @@ROWCOUNT = 0
        INSERT INTO dbo.TenantMessagingUsage (TenantId, UsageDate, Channel, Metric, [Count])
        VALUES (@tenantId, @usageDate, @channel, @metric, @count);
    `);
}

let recorder: MessagingUsageRecorder = sqlUsageRecorder;

/** Test seam: replace the SQL recorder (pass null to restore). */
export function setMessagingUsageRecorderForTests(next: MessagingUsageRecorder | null): void {
  recorder = next ?? sqlUsageRecorder;
}

/**
 * Increments the current tenant's daily counter. Metering is best-effort: a failed write never
 * fails the message it measures. Calls outside a tenant scope throw (no default tenant).
 */
export async function recordMessagingUsage(
  metric: MessagingUsageMetric,
  count = 1,
  now: Date = new Date(),
): Promise<void> {
  const tenantId = requireMessagingTenantId(`recordMessagingUsage:${metric}`);
  try {
    await recorder({
      tenantId,
      metric,
      channel: 'whatsapp',
      usageDate: now.toISOString().slice(0, 10),
      count,
    });
  } catch (err) {
    console.warn('[messaging/usage] counter write failed (non-critical)', {
      metric,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
