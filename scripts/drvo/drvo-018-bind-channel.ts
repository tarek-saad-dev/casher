#!/usr/bin/env npx tsx
/**
 * DRVO-018 operator step: bind a tenant's WhatsApp bridge channel (endpoint + webhook token hash)
 * and activate it. Run once per tenant after migration 12; for CUT this moves the legacy process
 * env (WHATSAPP_API_BASE_URL / WHATSAPP_INBOX_WEBHOOK_TOKEN) onto CASHER_BOOT's channel row.
 *
 *   npm run drvo-018:bind-channel -- --expected-database=<db> --tenant-code=CASHER_BOOT
 *     [--endpoint=<url>] [--session-id=<id>] [--phone=<e164>] [--allow-production]
 *
 * Endpoint defaults to WHATSAPP_API_BASE_URL; the token is always read from
 * WHATSAPP_INBOX_WEBHOOK_TOKEN (never from argv) and only its sha256 is stored.
 * When AI_BOOKING_ACTOR_USER_ID is set, it is written to TenantAiConfig.BookingActorUserId after
 * verifying the user is a member of the tenant.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, parent, isMain);
};

function argValue(argv: string[], name: string): string | undefined {
  const arg = argv.find((a) => a.startsWith(`--${name}=`));
  const value = arg ? arg.slice(name.length + 3).trim() : undefined;
  return value || undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const allowProduction = argv.includes('--allow-production');
  const expectedDatabase = argValue(argv, 'expected-database');
  const tenantCode = argValue(argv, 'tenant-code');
  const endpoint = argValue(argv, 'endpoint') ?? process.env.WHATSAPP_API_BASE_URL?.trim();
  const token = process.env.WHATSAPP_INBOX_WEBHOOK_TOKEN?.trim();
  const actorRaw = process.env.AI_BOOKING_ACTOR_USER_ID?.trim();

  if (!expectedDatabase) throw new Error('Missing --expected-database=<name>.');
  if (!tenantCode) throw new Error('Missing --tenant-code=<code>.');
  if (!endpoint || !/^https?:\/\//i.test(endpoint)) {
    throw new Error('Missing bridge endpoint (--endpoint= or WHATSAPP_API_BASE_URL).');
  }
  if (!token || token.length < 16) {
    throw new Error('WHATSAPP_INBOX_WEBHOOK_TOKEN must be set (>= 16 chars) to bind the webhook token.');
  }
  const actorUserId = actorRaw ? Number(actorRaw) : null;
  if (actorRaw && (!Number.isInteger(actorUserId) || (actorUserId as number) <= 0)) {
    throw new Error('AI_BOOKING_ACTOR_USER_ID must be a positive integer when set.');
  }

  const { getPool, closePool, sql } = await import('../../src/lib/db');
  const { assertDatabaseAllowed } = await import('./runner');
  const { listAppliedDrvoMigrations } = await import('./registry');
  const { MESSAGING_TENANCY_MIGRATION_KEY } = await import('./migrations/012-messaging-tenancy');
  const { hashChannelWebhookToken } = await import('../../src/modules/messaging/tenancy/channelToken');
  const { bindTenantWhatsAppChannel } = await import('../../src/modules/messaging/tenancy/channelRepository');
  const { assertLegacyUserInTenant } = await import('../../src/platform/tenant/tenantContext');

  try {
    const pool = await getPool();
    const database = await assertDatabaseAllowed(pool, { allowProduction, expectedDatabase });
    if (database !== expectedDatabase) {
      throw new Error(`Refusing: DB_NAME()="${database}" does not match "${expectedDatabase}".`);
    }
    const applied = await listAppliedDrvoMigrations(pool);
    if (!applied.some((r) => r.MigrationKey === MESSAGING_TENANCY_MIGRATION_KEY)) {
      throw new Error(`Refusing: ${MESSAGING_TENANCY_MIGRATION_KEY} is not applied on ${database}.`);
    }

    const tenantRes = await pool
      .request()
      .input('code', sql.NVarChar(64), tenantCode)
      .query(`SELECT TenantId FROM dbo.Tenant WHERE Code = @code AND Status = N'active';`);
    const tenantId = tenantRes.recordset[0]?.TenantId
      ? String(tenantRes.recordset[0].TenantId).toLowerCase()
      : null;
    if (!tenantId) throw new Error(`Refusing: no active tenant with code ${tenantCode}.`);

    const channel = await bindTenantWhatsAppChannel({
      tenantId,
      provider: 'whatsapp-bridge',
      endpointUrl: endpoint,
      webhookTokenHash: hashChannelWebhookToken(token),
      sessionId: argValue(argv, 'session-id') ?? null,
      phoneNumber: argValue(argv, 'phone') ?? null,
    });

    let bookingActorUserId: number | null = null;
    if (actorUserId !== null) {
      await assertLegacyUserInTenant(tenantId, actorUserId);
      await pool
        .request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('actor', sql.Int, actorUserId)
        .query(`
          UPDATE dbo.TenantAiConfig
          SET BookingActorUserId = @actor, Revision = Revision + 1, UpdatedAt = SYSUTCDATETIME()
          WHERE TenantId = @tenantId;
        `);
      bookingActorUserId = actorUserId;
    }

    console.log(
      JSON.stringify(
        {
          database,
          tenantCode,
          tenantId,
          channelId: channel.channelId,
          status: channel.status,
          endpointUrl: channel.endpointUrl,
          bookingActorUserId,
        },
        null,
        2,
      ),
    );
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
