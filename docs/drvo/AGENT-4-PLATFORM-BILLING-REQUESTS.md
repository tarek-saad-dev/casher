# DRVO ERP — Self-service plan request V1 (Agent 4)

## Supported
- A tenant administrator, including one whose trial has expired, can view authoritative active/public commercial plans, pricing and current subscription state in `/admin/billing`.
- The request stores server-computed EGP prices (monthly/annual) and subscription revision. Exactly one pending request is permitted per tenant; retries of an identical request are idempotent.
- Protected `CASHER_BOOT` cannot submit a request. Authenticated tenantId and actorUserId always originate from the session, not a submitted form or URL.
- Operator-only review queue at `/platform/billing-requests`: "contacted" and "rejected" require a review note.
- Outbox events audit requests and review. There is no update to `TenantSubscription`, and no payment receipt, invoice, activation, paid status, or payment-gateway callback.
- The tenant's installed apps are independent of commercial plan selection.

## Deployment order / gating
1. Apply DRVO migration 014 in an approved isolated staging environment **before** deploying the new routes. Migration is additive-only. Do not point feature code to databases missing the new table.
2. Test trial-active and trial-expired admins, a non-admin, protected CASHER_BOOT, two different tenants, concurrent duplicate requests and operator review, then full Cut Salon regression.
3. Only after verified acceptance: merge/deploy by the release owner with migration controls and backup policy.

## Still missing before automated charging
- Select/configure a real payment provider.
- Authenticated provider callbacks: HMAC/signature, amount/currency/order verification, replay/idempotency, settlement reconciliation.
- Transactional subscription activation only after verified payment, future-dated downgrades, refunds, invoices/receipts, renewals and reconciliation.
- The current operator subscription API remains manually controlled and is **not** called by the customer request flow.
