# Modular Quote Inquiry V1 — Nonpayable Intake

> 2026-10-26 · Request-for-pricing only. No approved prices or orders.

## Implemented
- Migration 017 creates `TenantModularQuoteRequest`: tenant-scoped immutable snapshot of draft revision, app choices, branch count and requested cadence. It stores **no amount**, paid flag, invoice or settlement record.
- Unique `TenantId,DraftId,DraftRevision` guarantees idempotent inquiries, with status `awaiting_pricing` or `closed` only.
- Tenant-admin `GET/POST /api/tenant/modular-quote-inquiries`, no client-supplied TenantId/price/catalog/status. POST accepts only the expected current draft revision.
- Serializes with draft writes through tenant commercial applock, validates tenant-owned draft and industry, emits an outbox audit event atomically.
- Billing UI shows a request button only after saving a draft and lists recent requests. Repeated submission returns existing request.
- Cut Salon bootstrap cannot create requests. Existing subscriptions, installed apps and financials are unchanged.

## Not implemented
- No **priced quotes**, accepted order, invoices, payment gateway, tax, proration, feature entitlements, fulfillment or subscriptions.
- A request **does not** mean an accepted financial offer. Operator must separately review prices and sign off a priced catalog before any approved quote can be issued.
- Apply migration 017 to Staging only after 015 and 016, verify two-tenant isolation, retries and no duplicate audit events. Production migration requires formal approval.

## Next
Approved price catalog → server-signed/versioned priced quote with expiration and tax rules → explicit customer acceptance → order/payment intent → verified settlement → auditable entitlement grant. None can bypass financial reconciliation.
