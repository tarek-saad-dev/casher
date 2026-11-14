# DRVOWA CRM ↔ CUT Cashier: invoice cancellation reconciliation

**Status:** release candidate, not yet deployed. Source PR: [#267](https://github.com/tarek-saad-dev/casher/pull/267).

## Why this tool exists

Cashier has **two distinct cancellation paths**:

1. Legacy soft cancellation with `TblinvServHead.isActive = 'yes'`: visible in `invoice.list_changes` with `includeInactive=true` and in the rotating `statusSweep`.
2. **Audited hard-delete** through `DELETE /api/sales/:id`, including fully refunded referral invoices: the sale header, detail, payment and cash entries can be physically removed. Re-reading invoice headers never finds the deleted invoice again. The successful `delete_invoice` action is written to `dbo.TblSensitiveActionAuditLog` in the **same transaction** as the deletion.

`invoice.list_deletions` exposes just the audit's committed identity, not financial or customer details. Treat this as a **cancellation notification**, not an instruction to erase bookkeeping or reverse payments in another system automatically.

## Contract

Use the existing authorized `/api/integrations/drvowa/v1/tools/invoice.list_deletions` tool route, which already validates the caller's integration credentials. Tool mode is `READ`; no new write or privileged migration is involved.

Synthetic call body (never copy a real bearer token into documentation):

```json
{
  "requestId": "e3d61417-321d-4aa8-a723-62564c6fae28",
  "input": {
    "sinceAuditId": 0,
    "limit": 100
  }
}
```

`invoice.list_deletions` returns `{ok:true, tool, data}` where `data` contains:

```json
{
  "deletions": [
    {
      "auditId": 71,
      "invId": 5101,
      "invType": "مبيعات",
      "status": "cancelled",
      "source": "audited_hard_delete"
    }
  ],
  "nextCursor": { "sinceAuditId": 71 },
  "hasMore": false
}
```

These are **illustrative synthetic IDs only**. A response with no rows retains the submitted cursor. `hasMore=true` means the returned page was full: call again with `nextCursor.sinceAuditId`. Persist the new cursor **only after successfully applying all cancellation events from that page**.

## Required CRM consumer algorithm

1. Load newly created sales with `invoice.list_changes` using `includeInactive=true` and the append-only `sinceInvId` cursor. Key mirrored sales by `(invType, invId)`, not by employee, customer, or notes.
2. Reconcile late *soft* status changes using `invoice.list_changes` `statusSweep=true` and its independent rotating `statusSweepSinceInvId` cursor.
3. **Always** poll `invoice.list_deletions` with the independent `sinceAuditId` cursor, including after cold start and after an outage. A high `sinceInvId` does not tell you anything about deletions of older invoices.
4. When an audited cancellation arrives, mark the corresponding mirrored sale **cancelled / not counted as active revenue** according to the CRM accounting policy. Do not re-create the invoice, refund money, mutate original Cashier records, or delete its audit trail.
5. Make reprocessing idempotent. Use `auditId` as the event identity and `(invType,invId)` for the mirrored sale; do not reset cancelled status based on stale cached rows. Apply events in increasing `auditId` order.
6. Save each cursor **after** the target CRM transaction succeeds. On HTTP error, bad token, SQL read error, timeout or incomplete processing, keep the old cursor and retry without data loss.

## Security, scope and limitations

- The SQL tool returns only `AuditID` and positive numeric `EntityID`, and filters `ActionType=delete_invoice`, `ActionMethod=DELETE`, `ExecutionStatus=success`, `EndpointPath LIKE /api/sales/%` **and the authenticated CASHER_BOOT TenantId**. It uses SQL `JSON_VALUE` to inspect only `$.header.BranchID` inside `OldData` to match the original deleted invoice's tenant-owned `Location`; neither `OldData` nor any name, phone, cashier/employee, IP, reason or customer field is returned.
- Caller authentication and repository authorization remain enforced by the existing DRVOWA tool route. Never expose the bearer token in browser code, GitHub logs or customer-facing reports.
- The cursor is **AuditID**, not sale ID or creation date. It is append-only for successful *audited* API deletions only. Unlogged historical manual SQL deletions and other unaudited legacy delete endpoints cannot be recovered from this stream; perform an independently approved periodic source/mirror reconciliation for those.
- When no matching staging rows exist, SQL schema permission checks alone do **not** establish complete real-world cancellation integration. Verify at least one synthetic audited deletion and subsequent CRM mirror state change in an authorized end-to-end pilot.
- During a partial rollout, older DRVOWA clients that only call `invoice.list_changes` will **continue to miss hard deletions**. Both teams must explicitly adopt the new tool before calling the synchronization complete.

## Operator acceptance

- [ ] Cashier staging schema and read-only query prove the audit stream exists under `last132_agent/drvo_agent`, with no PII in logs
- [ ] Current source CI tests manifest, SQL filter, retry-safe cursor, bad inputs and error sanitization
- [ ] Consumer starts with `sinceAuditId=0`, handles paginated results, retries same page after an injected failure
- [ ] Synthetic paid sale is synchronized to CRM, then the same sale is audited-deleted, then CRM marks the original record cancelled
- [ ] Repeat the deletion-poll response: no duplicate refund/accounting side effect
- [ ] Confirm cross-tenant integration access scope, negative test with a foreign TenantId (zero audit rows), audit-table grants and SQL query load with a security reviewer
- [ ] Obtain explicit independent operations and accounting sign-off before enabling production consumption

**Independent note:** This read-only CRM change does not approve or merge financial PR #248, its DRVO-023/024 production migrations, or new referral feature flags.
