# DRVO-018 — Messaging / WhatsApp / AI Receptionist Multi-Tenancy

Stacked on DRVO-013 (authoritative tenant context). Messaging, WhatsApp and the AI receptionist are
cross-industry platform features: the platform layer carries no salon concepts; salon behaviour is an
opt-in conversation pack selected by tenant data.

## Model

| Concept | Where | Notes |
| --- | --- | --- |
| Tenant messaging data | `TenantId` on 26 legacy messaging tables (`MESSAGING_TENANT_SCOPED_TABLES`) | Inbox, outbox, templates, conversations/messages, AI turns, booking plans, handoff control/claims, outbound correlation, campaigns/recipients, groups, AI learning, concierge knowledge. FK to `dbo.Tenant`, tenant-leading indexes. |
| Channel identity | `dbo.TenantMessagingChannel` | One active WhatsApp channel per tenant (filtered unique). `Provider` (`whatsapp-bridge` in V1), `EndpointUrl`, `WebhookTokenHash` (sha256, globally unique), `SessionId`, `PhoneNumber`, `Status` pending/active/disabled. |
| AI profile | `dbo.TenantAiConfig` | Business name, persona phrase, locale, website/booking/prices URLs, location hours JSON, policies JSON, booking actor (must be a tenant member), `ConversationPack`. |
| Usage | `dbo.TenantMessagingUsage` | Daily counters per tenant/channel/metric: `inbound_message`, `outbound_sent`, `outbound_failed`, `group_sent`, `ai_turn`. Metering only (no billing). |

Global unique constraints (provider message ids, idempotency keys, conversation identity, template
keys, knowledge keys) are replaced by tenant-leading unique indexes, so two tenants may reuse keys.

## Migration 12 — `messaging-tenancy`

- ID 12 (10 and 11 are reserved by other DRVO branches). Checksum
  `bd2f33c78aeca03fa96a391c26ab14ed8e376da07ef0378012f69a404958c98e` (LF-normalized `schema.sql`).
- Additive, single transaction: new tables, nullable `TenantId` + FK + index on every present legacy
  table, backfill of existing rows to `CASHER_BOOT`, unique replacements, CASHER_BOOT `TenantAiConfig`
  (salon pack, CUT persona/URLs/hours, booking actor `1` only if that user is a CASHER_BOOT member) and
  a **pending** CASHER_BOOT WhatsApp channel.
- `verify` fails on any messaging row without `TenantId`; repair by re-running apply (idempotent).
- Rollback: revert the application commit (columns stay nullable, legacy code ignores them), then
  forward-fix and re-apply to backfill rows written meanwhile. See `rollbackStrategy` in the migration.

## Runtime tenancy

Every repository call binds `@tenantId` from an ambient scope (`bindMessagingTenant`), which throws
without one. Scopes are opened only at entry points:

| Entry | Scope source |
| --- | --- |
| Admin / POS routes | Staff session tenant (`runWithStaffMessagingTenant`), after the route's existing guard. |
| Inbound webhook (`/api/internal/messaging/inbox/whatsapp`, `/outbound-observed/whatsapp`) | Channel whose `WebhookTokenHash` = sha256(Bearer). Unknown/pending/disabled channel or suspended tenant → 401. The proxy only checks a Bearer is present; the handler is authoritative. |
| Internal system-job routes | Session tenant, or for cron `x-tenant-id` / `?tenantId=` (400 `TENANT_REQUIRED`, 404 inactive). |
| Workers (outbox, inbox, AI, lease reconcile) | Claim across tenants (`TenantId IS NOT NULL`), then each row runs in `runWithMessagingJobTenant(row.tenantId)`; settlement filters on `(ID, TenantId)`. Rows without a tenant are never processed. |
| Feature events (booking, sale receipt, tips, groups) | `runWithMessagingTenantForBranch`: inside a scope the branch must belong to it; otherwise the tenant is the branch's Location owner; neither → `tenant_unresolved` (never a default tenant). |
| HR digest / nightly close | Tenant derived from the active branches (must be exactly one tenant). |

Outbound always uses the scope tenant's active channel (`sendViaTenantChannel`). No channel →
skipped `channel_not_configured`, which the outbox retries with the normal backoff (10s → 5m) until the
row's `MaxAttempts`; rows still unbound after that fail, so bind the channel before (or immediately after)
deploying. The WhatsApp gateway client has no process-wide URL.

## AI receptionist

- `processAiTurn` loads `TenantAiConfig`; missing/disabled → turn skipped `AI_NOT_CONFIGURED`.
- System instructions are rendered from the profile (persona, policies, pack hints). For CASHER_BOOT's
  backfilled profile the prompts are byte-identical to the pre-DRVO-018 text (golden test).
- The CUT salon pack (`salon-concierge-v1`) gates the V4 kernel, V3 orchestrator, booking management,
  concierge knowledge and the salon hint line. Tenants without the pack get the generic path.
- Read tools see only the tenant's Locations (`tenantBookingDirectory`); a tool request for another
  tenant's branch returns `BRANCH_NOT_IN_TENANT`. Booking execution rejects foreign branches and uses
  the tenant's configured booking actor (membership-checked); `AI_BOOKING_ACTOR_USER_ID` is removed —
  unset actor → `BOOKING_ACTOR_NOT_CONFIGURED`.
- `dbo.TblClient` is owned by DRVO-015 (stacked below this branch). Messaging phone lookups go only
  through `contacts/tenantClientDirectory.ts` → DRVO-015 `lookupClientIdByPhone(messagingTenantId, …)`;
  inbound client linking, the customer-context tool, campaign audiences and the inbox list all filter
  `TblClient` by the messaging tenant. A customer of another tenant is indistinguishable from an unknown
  one. There is no CASHER_BOOT customer seam (`legacy-client-directory` / `legacy-messaging-worker` are
  gone); `drvo018StaticGuards` fails on any unscoped messaging `TblClient` statement.
- The salon concierge bootstrap mirrors only the current tenant's categories, services, packages and
  team (`TenantId = @tenantId`) and requires the salon pack.

## Rollout preflight (mandatory)

1. Apply migration 12 on the target DB (staging first) and run `drvo:verify`.
2. Bind CUT's channel from the existing env (token is read from env, only its hash is stored):
   `npm run drvo-018:bind-channel -- --expected-database=<db> --tenant-code=CASHER_BOOT`
   (production also needs `--allow-production`). Optionally set `AI_BOOKING_ACTOR_USER_ID` for that run
   to write the booking actor into `TenantAiConfig` after a membership check.
3. Until the channel is bound, CUT inbound webhooks return 401 and outbound rows retry in the outbox only
   until their max attempts (minutes). Bind before deploying the application.
4. The bridge keeps sending the same Bearer token; no bridge change is needed in V1. The legacy `'dev'`
   token fallback no longer exists.
5. Cron callers of internal system-job routes must add `x-tenant-id`.

## Known limitations

1. V1 transport is the bridge (one bridge process/session per channel endpoint). WhatsApp Cloud API is
   out of scope; it implements the same `MessagingTransport` contract later.
2. Salon pack internals (`salonConcierge/*`, V3 orchestrator, booking management, ai-control-plane
   learning) still contain CUT branch codes, fixed hours and cutsaloon URLs. They only run for tenants
   that opt into `salon-concierge-v1`; the concierge bootstrap additionally requires the legacy
   master-data owner (it scrapes the CUT site and reads TblBranch/TblCat/TblEmp).
3. Booking/receipt notification templates still default `bookingLink` / branch name from process env
   (`WHATSAPP_DEFAULT_BOOKING_LINK`, CUT values). Per-tenant notification defaults are a follow-up.
4. Usage metering is best-effort (a failed counter write never fails a send) and is not billing.
5. Pre-existing (unchanged) bug: `markAiTurnFailed` references `@retryable` without binding it, so the
   AI failure path throws at runtime; left untouched to keep CUT behaviour identical.
